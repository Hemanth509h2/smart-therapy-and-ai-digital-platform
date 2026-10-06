import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runAnalysis } from '@/lib/rag/analysis'
import { checkAIConsent, getSessionTranscript, appendCopilotEvent } from '@/lib/rag/transcript-store'
import type { ClientProfile } from '@/lib/rag/retrieval'
import type { AIInsight } from '@/lib/rag/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { sessionId, therapistId, clientProfile, transcriptWindowMinutes } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId is required and must be a string' },
        { status: 400 }
      )
    }

    if (!therapistId || typeof therapistId !== 'string') {
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

    const profile: ClientProfile = {
      clientId: String(clientProfile.clientId ?? ''),
      name: String(clientProfile.name ?? 'Unknown'),
      age: Number(clientProfile.age ?? 0),
      conditions: Array.isArray(clientProfile.conditions)
        ? clientProfile.conditions.map(String)
        : [],
      sessionNumber: Number(clientProfile.sessionNumber ?? 1),
      therapistId,
    }

    if (!profile.clientId) {
      return NextResponse.json(
        { error: 'clientProfile.clientId is required' },
        { status: 400 }
      )
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
    try {
      const t = await prisma.profileTherapist.findUnique({ where: { userId: therapistId }, select: { id: true } })
      if (t) {
        await prisma.usageEvent.create({ data: { therapistId: t.id, sessionId, type: 'AI_ANALYSIS' } })
      }
    } catch (e) {
      console.error('Failed to log AI usage event:', e)
    }

    return NextResponse.json({ insight })
  } catch (error: any) {
    console.error('AI insight generation error:', error)
    return NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}
