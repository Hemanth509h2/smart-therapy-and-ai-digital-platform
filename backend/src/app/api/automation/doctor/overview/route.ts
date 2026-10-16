import { NextResponse } from 'next/server'
import { prisma } from '@/lib/core/db'
import { errorResponse } from '@/lib/http/apiError'
import { doctorClientsWhere, getDoctorSessions } from '@/lib/automation/sessions'
import { addDays, istDateString } from '@/lib/automation/time'
import { doctorSummary, requireDoctorByPhone } from '@/lib/automation/doctor'

export const dynamic = 'force-dynamic'

// GET /api/automation/doctor/overview?phone=<sender's WhatsApp number>
// The chatbot's "who am I talking to": the doctor's profile, today's sessions,
// the next 7 days, and headline counts. 404 means the number is not a doctor.
export async function GET(request: Request) {
  try {
    const found = await requireDoctorByPhone(request)
    if (!found.ok) return found.response
    const { doctor } = found

    const today = istDateString()
    const [todaySessions, upcoming, statusCounts, clientCount] = await Promise.all([
      getDoctorSessions(doctor.id, today, today, ['SCHEDULED', 'ACTIVE', 'COMPLETED']),
      getDoctorSessions(doctor.id, addDays(today, 1), addDays(today, 7), ['SCHEDULED']),
      prisma.session.groupBy({ by: ['status'], where: { therapistId: doctor.id }, _count: true }),
      prisma.profileClient.count({ where: doctorClientsWhere(doctor.id) }),
    ])

    const counts = Object.fromEntries(statusCounts.map((c) => [c.status, c._count]))
    return NextResponse.json({
      doctor: { ...doctorSummary(doctor), bio: doctor.bio },
      today: { date: today, sessions: todaySessions },
      next7Days: { from: addDays(today, 1), to: addDays(today, 7), sessions: upcoming },
      stats: {
        clients: clientCount,
        sessionsScheduled: counts.SCHEDULED ?? 0,
        sessionsCompleted: counts.COMPLETED ?? 0,
        sessionsCancelled: counts.CANCELLED ?? 0,
      },
    })
  } catch (error: any) {
    return errorResponse(error, 'automation doctor overview')
  }
}
