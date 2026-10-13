import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errorResponse } from '@/lib/apiError'
import { rejectUnlessAutomation } from '@/lib/automation/auth'
import { reminderMessage } from '@/lib/automation/messages'

export const dynamic = 'force-dynamic'

// GET /api/automation/reminders?fromMinutes=60&toMinutes=75
// Scheduled sessions that start between `fromMinutes` and `toMinutes` from now
// and whose client has a WhatsApp number, each with a ready-to-send `message`.
//
// Stateless on purpose: run the n8n workflow every N minutes and ask for a window
// exactly N minutes wide (e.g. every 15 min with 60->75 for a "1 hour before"
// reminder, 1440->1455 for "24 hours before"). Every session then falls into
// exactly one run, so nothing is sent twice and nothing needs to be stored.
export async function GET(request: Request) {
  try {
    const denied = rejectUnlessAutomation(request)
    if (denied) return denied

    const params = new URL(request.url).searchParams
    const from = Number(params.get('fromMinutes') ?? 60)
    const to = Number(params.get('toMinutes') ?? 75)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > 7 * 24 * 60) {
      return NextResponse.json(
        { error: 'fromMinutes and toMinutes must be whole numbers with 0 <= fromMinutes < toMinutes <= 10080' },
        { status: 400 }
      )
    }

    const now = Date.now()
    const sessions = await prisma.session.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { gt: new Date(now + from * 60_000), lte: new Date(now + to * 60_000) },
        client: { phoneNumber: { not: null } },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        scheduledAt: true,
        client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        therapist: { select: { firstName: true, lastName: true } },
      },
    })

    const items = sessions.map((s) => {
      const doctorName = `${s.therapist.firstName} ${s.therapist.lastName}`.trim()
      return {
        sessionId: s.id,
        scheduledAt: s.scheduledAt.toISOString(),
        client: {
          id: s.client.id,
          name: `${s.client.firstName} ${s.client.lastName}`.trim(),
          phoneNumber: s.client.phoneNumber,
        },
        doctorName,
        message: reminderMessage(s.client.firstName, doctorName, s.scheduledAt),
      }
    })
    return NextResponse.json({ fromMinutes: from, toMinutes: to, count: items.length, sessions: items })
  } catch (error: any) {
    return errorResponse(error, 'automation reminders')
  }
}
