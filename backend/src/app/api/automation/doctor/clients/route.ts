import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errorResponse } from '@/lib/apiError'
import { ageFrom, doctorClientsWhere } from '@/lib/automation/sessions'
import { requireDoctorByPhone } from '@/lib/automation/doctor'

export const dynamic = 'force-dynamic'

const LIMIT = 50

// GET /api/automation/doctor/clients?phone=...[&q=name]
// The calling doctor's clients (added directly or linked through a session),
// optionally filtered by part of the name, with session count and last/next session.
export async function GET(request: Request) {
  try {
    const found = await requireDoctorByPhone(request)
    if (!found.ok) return found.response
    const doctorId = found.doctor.id

    const q = new URL(request.url).searchParams.get('q')?.trim()
    const clients = await prisma.profileClient.findMany({
      where: {
        AND: [
          doctorClientsWhere(doctorId),
          ...(q
            ? [{ OR: [{ firstName: { contains: q, mode: 'insensitive' as const } }, { lastName: { contains: q, mode: 'insensitive' as const } }] }]
            : []),
        ],
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: LIMIT,
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, gender: true, diagnosis: true, phoneNumber: true },
    })

    const sessions = clients.length
      ? await prisma.session.findMany({
          where: { therapistId: doctorId, clientId: { in: clients.map((c) => c.id) } },
          orderBy: { scheduledAt: 'asc' },
          select: { clientId: true, scheduledAt: true, status: true },
        })
      : []

    const now = new Date()
    const items = clients.map((c) => {
      const mine = sessions.filter((s) => s.clientId === c.id)
      const held = mine.filter((s) => s.status === 'COMPLETED' || (s.status !== 'CANCELLED' && s.scheduledAt <= now))
      const next = mine.find((s) => s.status === 'SCHEDULED' && s.scheduledAt > now)
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        age: ageFrom(c.dateOfBirth, now),
        gender: c.gender,
        diagnosis: c.diagnosis,
        phoneNumber: c.phoneNumber,
        sessionCount: mine.filter((s) => s.status !== 'CANCELLED').length,
        lastSession: held.at(-1)?.scheduledAt.toISOString() ?? null,
        nextSession: next?.scheduledAt.toISOString() ?? null,
      }
    })
    return NextResponse.json({ count: items.length, clients: items })
  } catch (error: any) {
    return errorResponse(error, 'automation doctor clients')
  }
}
