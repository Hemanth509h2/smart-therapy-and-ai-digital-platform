import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { adminAuth } from '@/lib/firebaseAdmin'
import { prisma } from '@/lib/db'
import { sendWhatsAppInvite } from '@/lib/whatsapp-bot'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get('authorization')
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const decoded = await adminAuth().verifyIdToken(token)
    const { therapistId, patientName, inviteLink } = await request.json()

    if (!therapistId || !inviteLink) {
      return NextResponse.json(
        { error: 'therapistId and inviteLink are required' },
        { status: 400 }
      )
    }

    const therapist = await prisma.profileTherapist.findUnique({
      where: { id: String(therapistId) },
      select: { userId: true, firstName: true, lastName: true },
    })
    if (!therapist || therapist.userId !== decoded.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(String(inviteLink))
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 })
    }

    const inviteToken = url.searchParams.get('invite')
    const invite = inviteToken
      ? await prisma.invite.findFirst({
          where: { token: inviteToken, therapistId: String(therapistId) },
          select: { id: true, phoneNumber: true, claimedClientId: true },
        })
      : null
    if (!invite) {
      return NextResponse.json({ error: 'Invite does not belong to this therapist' }, { status: 403 })
    }
    if (!invite.phoneNumber) {
      return NextResponse.json(
        { error: 'This invite has no WhatsApp number. Create a new invite with a patient number.' },
        { status: 400 }
      )
    }

    const now = new Date()
    const delivery = await prisma.whatsAppMessage.upsert({
      where: { inviteId_messageType: { inviteId: invite.id, messageType: 'CLIENT_INVITE' } },
      create: {
        id: randomUUID(),
        inviteId: invite.id,
        clientId: invite.claimedClientId,
        phoneNumber: invite.phoneNumber,
        generatedLink: url.toString(),
        status: 'SENDING',
        attempts: 1,
        lastAttemptAt: now,
        updatedAt: now,
      },
      update: {
        phoneNumber: invite.phoneNumber,
        generatedLink: url.toString(),
        status: 'SENDING',
        attempts: { increment: 1 },
        lastAttemptAt: now,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      },
    })

    try {
      const message = await sendWhatsAppInvite({
        to: invite.phoneNumber,
        patientName: typeof patientName === 'string' ? patientName.trim() : '',
        inviteLink: url.toString(),
        therapistName: `${therapist.firstName} ${therapist.lastName}`.trim(),
      })
      await prisma.whatsAppMessage.update({
        where: { id: delivery.id },
        data: {
          status: 'SENT',
          providerMessageId: message.sid,
          sentAt: new Date(),
          providerStatusAt: new Date(),
          updatedAt: new Date(),
        },
      })
      return NextResponse.json({ success: true, message })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'WhatsApp send failed'
      await prisma.whatsAppMessage.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', errorMessage, updatedAt: new Date() },
      })
      throw error
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'WhatsApp send failed'
    const isAuthError = message.includes('Firebase ID token') || message.includes('auth/')
    console.error('[whatsapp/invite]', message)
    return NextResponse.json(
      { error: isAuthError ? 'Invalid authentication token' : message },
      { status: isAuthError ? 401 : 500 }
    )
  }
}
