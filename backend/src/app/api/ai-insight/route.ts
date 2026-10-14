import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireTherapist } from '@/lib/progressAuth'
import { runAnalysis } from '@/lib/rag/analysis'
import { checkAIConsent, getSessionTranscript, appendCopilotEvent } from '@/lib/rag/transcript-store'
import type { ClientProfile } from '@/lib/rag/retrieval'
import type { AIInsight } from '@/lib/rag/types'
import { getSetting } from '@/lib/settings'
import { errorResponse, logError } from '@/lib/apiError'

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
        { error: 'sessionId is required and must be a string' },
        { status: 400 }
      )
    }

    if (!bodyTherapistId || typeof bodyTherapistId !== 'string') {
      return NextResponse.json(
        { error: 'therapistId is required and must be a string' },
        { status: 400 }
      )
    }

    if (!clientProfile || typeof clientProfile !== 'object') {
      return NextResponse.json(
        { error: 'clientProfile is required and must be an object' },
        { status: 400 }
      )
    }

    // Kept as a required field for the existing request contract, but never
    // used: the client is taken from the verified session row below.
    if (!String(clientProfile.clientId ?? '')) {
      return NextResponse.json(
        { error: 'clientProfile.clientId is required' },
        { status: 400 }
      )
    }

    // The body's therapistId must be the caller's own uid; from here on only the
    // verified uid is used (study material, previous notes, usage logging).
    if (bodyTherapistId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const therapistId = auth.uid

    // Ownership check before consent, transcript, notes, LLM calls or writes.
    // Non-owned and non-existent sessions get the same 404.
    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      select: { id: true, clientId: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // name/age/conditions are the owning therapist's descriptive input for the
    // prompt only — not identity. clientId and therapistId are verified values.
    const profile: ClientProfile = {
      clientId: session.clientId,
      name: String(clientProfile.name ?? 'Unknown'),
      age: Number(clientProfile.age ?? 0),
      conditions: Array.isArray(clientProfile.conditions)
        ? clientProfile.conditions.map(String)
        : [],
      sessionNumber: Number(clientProfile.sessionNumber ?? 1),
      therapistId,
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
          error: 'AI analysis not consented',
          detail: 'Both therapist and client must consent to AI analysis',
        },
        { status: 403 }
      )
    }

    const existingTranscript = await getSessionTranscript(sessionId)
    if (existingTranscript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript data found for this session' },
        { status: 404 }
      )
    }

    const insight: AIInsight = await runAnalysis({
      sessionId,
      therapistId,
      clientProfile: profile,
      transcriptWindowMinutes: transcriptWindowMinutes ?? 5,
    })

    const { getFirestore } = await import('firebase-admin/firestore')
    const { initializeApp, getApps, cert } = await import('firebase-admin/app')

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
      const t = await prisma.profileTherapist.findUnique({ where: { userId: therapistId }, select: { id: true } })
      therapistProfileId = t?.id ?? null
      if (t) {
        await prisma.usageEvent.create({ data: { therapistId: t.id, sessionId, type: 'AI_ANALYSIS' } })
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
