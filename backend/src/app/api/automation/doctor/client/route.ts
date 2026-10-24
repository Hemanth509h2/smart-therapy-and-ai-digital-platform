import { NextResponse } from 'next/server'
import { prisma } from '@/lib/core/db'
import { errorResponse } from '@/lib/http/apiError'
import { ageFrom, doctorClientsWhere } from '@/lib/automation/sessions'
import { dateTimeLabel } from '@/lib/automation/time'
import { requireDoctorByPhone } from '@/lib/automation/doctor'

export const dynamic = 'force-dynamic'

// GET /api/automation/doctor/client?phone=...&clientId=...
// One of the calling doctor's clients: profile details and their session history
// with this doctor (latest 20). Clinical notes and reports are NOT included.
// A client that is not this doctor's is a 404, the same as one that doesn't exist.
export async function GET(request: Request) {
  try {
    const found = await requireDoctorByPhone(request)
    if (!found.ok) return found.response

    const clientId = new URL(request.url).searchParams.get('clientId')
    if (!clientId) return NextResponse.json({ error: 'Give the clientId of the client to look up.' }, { status: 400 })

    const client = await prisma.profileClient.findFirst({
      where: { AND: [{ id: clientId }, doctorClientsWhere(found.doctor.id)] },
      select: {
        id: true, firstName: true, lastName: true, dateOfBirth: true, gender: true,
        diagnosis: true, phoneNumber: true, parentEmail: true,
        sessions: {
          where: { therapistId: found.doctor.id },
          orderBy: { scheduledAt: 'desc' },
          take: 20,
          select: { id: true, status: true, scheduledAt: true },
        },
      },
    })
    if (!client) return NextResponse.json({ error: "We couldn't find that client. They may have been removed." }, { status: 404 })

    return NextResponse.json({
      client: {
        id: client.id,
        name: `${client.firstName} ${client.lastName}`.trim(),
        age: ageFrom(client.dateOfBirth),
        gender: client.gender,
        diagnosis: client.diagnosis,
        phoneNumber: client.phoneNumber,
        parentEmail: client.parentEmail,
      },
      sessions: client.sessions.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt.toISOString(),
        when: dateTimeLabel(s.scheduledAt),
      })),
    })
  } catch (error: any) {
    return errorResponse(error, 'automation doctor client')
  }
}
