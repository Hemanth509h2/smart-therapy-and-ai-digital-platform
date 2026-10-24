import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/core/db'
import { therapistIdForUser } from '@/lib/core/links'
import { requireActivePlan } from '@/lib/billing/subscriptions'
import { requireAuth } from '@/lib/http/apiAuth'
import { requireTherapist } from '@/lib/http/progressAuth'
import { generateSessionReport } from '@/lib/reports/generate'
import { getReportStats } from '@/lib/reports/session-data'
import { errorResponse } from '@/lib/http/apiError'

function ageFrom(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined
  const diff = Date.now() - new Date(dob).getTime()
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 3600 * 1000)))
}

export const dynamic = 'force-dynamic';

// Fetch the stored report for a session. Readable by the therapist who owns the
// session, or by the session's own client once the therapist has released it
// (visibleToClient). A missing report and one the caller may not see both
// return { report: null, stats: null }, so session IDs cannot be probed.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response

    const sessionId = new URL(req.url).searchParams.get('sessionId')
    if (!sessionId) {
      return NextResponse.json({ error: "We couldn't tell which session this is for. Refresh the page and try again." }, { status: 400 })
    }

    const [user, therapistId] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.uid },
        select: { role: true, client: { select: { id: true } } },
      }),
      therapistIdForUser(auth.uid),
    ])

    let where: Prisma.SessionReportWhereInput
    if (user?.role === 'THERAPIST' && therapistId) {
      where = { sessionId, session: { therapistId } }
    } else if (user?.role === 'CLIENT' && user.client) {
      where = { sessionId, visibleToClient: true, session: { clientId: user.client.id } }
    } else {
      return NextResponse.json(
        { error: "Only the session's therapist or client can view this report." },
        { status: 403 }
      )
    }

    const report = await prisma.sessionReport.findFirst({ where })
    // Stats live on the Firestore session doc, saved when the report was generated.
    const stats = report ? await getReportStats(sessionId) : null
    return NextResponse.json({ report, stats })
  } catch (e: any) {
    return errorResponse(e, 'session-report get')
  }
}

// Generate (or regenerate) the report for a session, then persist it.
// Only the therapist who owns the session may do this.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireTherapist(req)
    if (!auth.ok) return auth.response

    const { sessionId } = await req.json()
    if (!sessionId) {
      return NextResponse.json({ error: "We couldn't tell which session this is for. Refresh the page and try again." }, { status: 400 })
    }

    // Not-owned and non-existent sessions are indistinguishable (both 404).
    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      include: { client: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 })
    }
    const noPlan = await requireActivePlan({ therapistId: session.therapistId }, 'generate a session report')
    if (noPlan) return noPlan

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
    return errorResponse(e, 'session-report generate', "We couldn't generate the report. Please try again.")
  }
}

// Save the therapist's edits to the report body. Only the therapist who owns
// the session may do this.
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTherapist(req)
    if (!auth.ok) return auth.response

    const { sessionId, content } = await req.json()
    if (!sessionId || typeof content !== 'string') {
      return NextResponse.json(
        { error: "The report can't be empty. Add some text and save again." },
        { status: 400 }
      )
    }
    const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'edit session reports')
    if (noPlan) return noPlan
    // Ownership is part of the update's filter, so a report on another
    // therapist's session can never be written. A missing or non-owned report
    // fails with P2025, which errorResponse maps to the same 404.
    const report = await prisma.sessionReport.update({
      where: { sessionId, session: { therapistId: auth.therapist.id } },
      data: { content, editedByTherapist: true, editedAt: new Date() },
    })
    return NextResponse.json({ report })
  } catch (e: any) {
    return errorResponse(e, 'session-report save', "We couldn't save the report. Please try again.")
  }
}
