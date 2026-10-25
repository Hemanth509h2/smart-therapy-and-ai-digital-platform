import { NextResponse } from 'next/server'
import { prisma, appDb } from '@/lib/core/db'
import { requireActivePlan } from '@/lib/billing/subscriptions'
import { requireTherapist } from '@/lib/http/progressAuth'
import { callAIService } from '@/lib/ai-service'
import {
  appendCopilotEvent,
  checkAIConsent,
  getSessionActivity,
  getSessionTranscript,
} from '@/lib/sessions/transcript-store'
import { getSetting } from '@/lib/core/settings'
import { errorResponse, logError, notYourProfile } from '@/lib/http/apiError'
import { firebasePrivateKey } from '@/lib/core/firebaseKey'

export async function POST(request: Request) {
  try {
    // Authenticate before any consent/transcript/notes read, LLM call or write.
    const auth = await requireTherapist(request)
    if (!auth.ok) return auth.response

    if (!(await getSetting('features.aiInsights'))) {
      return NextResponse.json({ error: 'AI insights are turned off by an admin.' }, { status: 503 })
    }

    const body = await request.json()
    const { sessionId, therapistId: bodyTherapistId, clientProfile, transcriptWindowMinutes } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: "We couldn't tell which session this is for. Refresh the page and try again." },
        { status: 400 }
      )
    }

    if (!bodyTherapistId || typeof bodyTherapistId !== 'string') {
      return NextResponse.json(
        { error: "Your therapist profile hasn't loaded yet. Refresh the page and try again." },
        { status: 400 }
      )
    }
    if (!clientProfile || typeof clientProfile !== 'object') {
      return NextResponse.json(
        { error: "The client's details haven't loaded yet. Refresh the page and try again." },
        { status: 400 }
      )
    }

    // Kept as a required field for the existing request contract, but never
    // used: the client is taken from the verified session row below.
    if (!String(clientProfile.clientId ?? '')) {
      return NextResponse.json(
        { error: "The client's details haven't loaded yet. Refresh the page and try again." },
        { status: 400 }
      )
    }

    // The body's therapistId must be the caller's own uid; from here on only the
    // verified uid is used (study material, previous notes, usage logging).
    if (bodyTherapistId !== auth.uid) {
      return notYourProfile('this therapist profile')
    }
    const therapistId = auth.uid
    const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'use AI insights')
    if (noPlan) return noPlan

    // Ownership check before consent, transcript, notes, LLM calls or writes.
    // Non-owned and non-existent sessions get the same 404.
    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      select: { id: true, clientId: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 })
    }

    // name/age/conditions are the owning therapist's descriptive input for the
    // prompt only — not identity.
    const client = {
      name: String(clientProfile.name ?? 'Unknown'),
      age: Number(clientProfile.age ?? 0),
      conditions: Array.isArray(clientProfile.conditions)
        ? clientProfile.conditions.map(String)
        : [],
      sessionNumber: Number(clientProfile.sessionNumber ?? 1),
    }

    // Dev test mode bypasses the both-consent gate so the copilot can be verified
    // solo (matches NEXT_PUBLIC_STT_TEST_MODE used for transcription).
    //
    // Hard-gated to non-production for the same reason as the transcription gate:
    // this path sends session audio transcripts to a third-party LLM, and must
    // not run on a real deployment without both parties having consented,
    // whatever the environment file happens to say.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production'
    const consent = await checkAIConsent(sessionId)
    if (!consent && !sttTestMode) {
      return NextResponse.json(
        {
          error: 'Both you and the client need to allow AI analysis before AI insights can run.',
          detail: 'Both therapist and client must consent to AI analysis',
        },
        { status: 403 }
      )
    }

    const existingTranscript = await getSessionTranscript(sessionId)
    if (existingTranscript.length === 0) {
      return NextResponse.json(
        { error: 'There is no transcript for this session yet. AI insights appear once the conversation has been transcribed.' },
        { status: 404 }
      )
    }

    // Everything the AI service needs comes from here (it has no Firebase
    // access): this session's activity and notes, and this therapist's last
    // notes on this client, newest first.
    const [activity, previousNotes] = await Promise.all([
      getSessionActivity(sessionId),
      prisma.therapistNote.findMany({
        where: { session: { therapistId: auth.therapist.id, clientId: session.clientId } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { content: true, createdAt: true },
      }),
    ])
    const { insight } = await callAIService('insight', sessionId, {
      // The study material (document_chunks) is keyed by the Firebase uid.
      therapistUid: therapistId,
      client,
      windowMinutes: Number(transcriptWindowMinutes) || 5,
      transcript: existingTranscript,
      moduleEvents: activity.moduleEvents,
      inCallNotes: activity.inCallNotes,
      previousNotes: previousNotes.map((n, i) => ({
        content: n.content,
        createdAt: n.createdAt.toISOString(),
        sessionNumber: i + 1,
      })),
    })

    const { getFirestore } = await import('firebase-admin/firestore')
    const { initializeApp, getApps, cert } = await import('firebase-admin/app')

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: firebasePrivateKey(),
        }),
      })
    }

    const db = getFirestore()
    await db.collection('sessions').doc(sessionId).set(
      {
        aiInsight: insight,
        aiInsightGeneratedAt: new Date().toISOString(),
      },
      { merge: true }
    )

    // Lightweight append-only audit trail of every copilot suggestion. Survives
    // alongside the transcript so the end-of-session report can reference it
    // (e.g. "copilot flagged a safeguarding concern mid-session"). Never blocks.
    await appendCopilotEvent(sessionId, {
      timestamp: Date.now(),
      summary: insight.summary,
      module: insight.module,
      riskFlag: insight.riskFlag,
      riskLevel: insight.riskLevel ?? 'none',
      riskDetail: insight.riskDetail ?? '',
    })

    // Log AI analysis as a usage event for the admin dashboard (therapistId here
    // is the Firebase uid; resolve to the therapist profile). Never block on this.
    let therapistProfileId: string | null = null
    try {
      const t = await appDb.profileTherapist.findUnique({ where: { userId: therapistId }, select: { id: true, trackUsage: true } })
      therapistProfileId = t?.id ?? null
      if (t?.trackUsage) {
        await appDb.usageEvent.create({ data: { therapistId: t.id, sessionId, type: 'AI_ANALYSIS' } })
      }
    } catch (e) {
      logError('ai-insight usage event', e)
    }

    // Persist risk flags for the admin Sessions monitor. The copilot re-runs
    // every few minutes, so skip a flag already raised (and not yet
    // acknowledged) for this session at this level in the last 30 minutes.
    const level = insight.riskLevel
    if (insight.riskFlag && (level === 'watch' || level === 'urgent')) {
      try {
        const recent = await prisma.riskFlag.findFirst({
          where: { sessionId, level, acknowledgedAt: null, raisedAt: { gte: new Date(Date.now() - 30 * 60_000) } },
          select: { id: true },
        })
        if (!recent) {
          await prisma.riskFlag.create({
            data: { sessionId, therapistId: therapistProfileId, level, detail: insight.riskDetail || null },
          })
        }
      } catch (e) {
        console.error('Failed to record risk flag:', e)
      }
    }

    return NextResponse.json({ insight })
  } catch (error: any) {
    return errorResponse(error, 'ai-insight')
  }
}
