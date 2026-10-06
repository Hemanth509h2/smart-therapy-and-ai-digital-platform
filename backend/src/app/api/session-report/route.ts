import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateSessionReport } from '@/lib/report/generate'
import { getReportStats } from '@/lib/report/session-data'

function ageFrom(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined
  const diff = Date.now() - new Date(dob).getTime()
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 3600 * 1000)))
}

// Fetch the stored report for a session.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }
  const report = await prisma.sessionReport.findUnique({ where: { sessionId } })
  // Stats live on the Firestore session doc, saved when the report was generated.
  const stats = report ? await getReportStats(sessionId) : null
  return NextResponse.json({ report, stats })
}

// Generate (or regenerate) the report for a session, then persist it.
export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { client: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const priorCount = await prisma.session.count({
      where: {
        therapistId: session.therapistId,
        clientId: session.clientId,
        createdAt: { lte: session.createdAt },
      },
    })

    const { content, model, stats } = await generateSessionReport(sessionId, {
      name: `${session.client.firstName} ${session.client.lastName}`.trim(),
      age: ageFrom(session.client.dateOfBirth),
      conditions: session.client.diagnosis,
      sessionNumber: priorCount,
    })

    const report = await prisma.sessionReport.upsert({
      where: { sessionId },
      create: {
        sessionId,
        therapistId: session.therapistId,
        clientId: session.clientId,
        content,
        model,
      },
      update: {
        content,
        model,
        aiGenerated: true,
        editedByTherapist: false,
        editedAt: null,
        generatedAt: new Date(),
      },
    })

    return NextResponse.json({ report, stats })
  } catch (e: any) {
    console.error('[session-report] generate failed:', e)
    return NextResponse.json(
      { error: e?.message || 'Report generation failed' },
      { status: 500 }
    )
  }
}

// Save the therapist's edits to the report body.
export async function PATCH(req: NextRequest) {
  try {
    const { sessionId, content } = await req.json()
    if (!sessionId || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'sessionId and content are required' },
        { status: 400 }
      )
    }
    const report = await prisma.sessionReport.update({
      where: { sessionId },
      data: { content, editedByTherapist: true, editedAt: new Date() },
    })
    return NextResponse.json({ report })
  } catch (e: any) {
    console.error('[session-report] save failed:', e)
    return NextResponse.json(
      { error: e?.message || 'Save failed' },
      { status: 500 }
    )
  }
}
