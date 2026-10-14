import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { appUrl } from '@/lib/app-url'
import { errorResponse } from '@/lib/apiError'
import { rejectUnlessAutomation } from '@/lib/automation/auth'
import { joinLinkMessage } from '@/lib/automation/messages'
import { getOrCreateGuestInvite } from '@/lib/session-whatsapp'

export const dynamic = 'force-dynamic'

// POST /api/automation/sessions/[sessionId]/join-link
// Creates (or reuses) the client's join link for this session and returns it
// with the client's number and a ready-to-send `message`. It does not send
// anything: n8n does that. POST because the first call creates the invite.
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const denied = rejectUnlessAutomation(request)
    if (denied) return denied

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { client: true, therapist: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (session.status === 'CANCELLED' || session.status === 'COMPLETED') {
      return NextResponse.json({ error: `Session is ${session.status.toLowerCase()}` }, { status: 409 })
    }

    const invite = await getOrCreateGuestInvite(session)
    const link = `${appUrl(request)}/join/${invite.token}`
    const doctorName = `${session.therapist.firstName} ${session.therapist.lastName}`.trim()

    return NextResponse.json({
      sessionId: session.id,
      scheduledAt: session.scheduledAt.toISOString(),
      link,
      client: {
        id: session.client.id,
        name: `${session.client.firstName} ${session.client.lastName}`.trim(),
        phoneNumber: session.client.phoneNumber,
      },
      doctorName,
      shouldSend: Boolean(session.client.phoneNumber),
      message: joinLinkMessage(session.client.firstName, doctorName, link),
    })
  } catch (error: any) {
    return errorResponse(error, 'automation join link')
  }
}
