import { NextResponse } from 'next/server'
import { appDb } from '@/lib/core/db'
import { errorResponse } from '@/lib/http/apiError'
import { rejectUnlessAutomation } from '@/lib/automation/auth'
import { dailyScheduleMessage } from '@/lib/automation/messages'
import { getDoctorSessions } from '@/lib/automation/sessions'
import { istDateString, isValidDateString } from '@/lib/automation/time'
import { doctorSummary } from '@/lib/automation/doctor'

export const dynamic = 'force-dynamic'

// GET /api/automation/doctors/schedule[?date=YYYY-MM-DD][&doctorId=...]
// Every doctor with their sessions for one IST day (default: today), plus a
// ready-to-send WhatsApp `message`. Built for an n8n "7 AM daily schedule"
// workflow: loop over `doctors`, send `message` to `doctor.phoneNumber`.
// Cancelled and completed sessions are left out.
export async function GET(request: Request) {
  try {
    const denied = rejectUnlessAutomation(request)
    if (denied) return denied

    const params = new URL(request.url).searchParams
    const date = params.get('date') ?? istDateString()
    if (!isValidDateString(date)) {
      return NextResponse.json({ error: 'Give the date in YYYY-MM-DD format.' }, { status: 400 })
    }
    const doctorId = params.get('doctorId') ?? undefined

    const doctors = await appDb.profileTherapist.findMany({
      where: doctorId ? { id: doctorId } : undefined,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true, firstName: true, lastName: true, specialty: true,
        qualification: true, experience: true, bio: true, phoneNumber: true,
      },
    })

    const result = []
    for (const d of doctors) {
      const sessions = await getDoctorSessions(d.id, date, date, ['SCHEDULED', 'ACTIVE'])
      const summary = doctorSummary(d)
      result.push({
        doctor: summary,
        date,
        sessionCount: sessions.length,
        sessions,
        // Only worth sending when there is something to say and a number to send to.
        shouldSend: sessions.length > 0 && Boolean(d.phoneNumber),
        message: sessions.length > 0 ? dailyScheduleMessage(summary.name, date, sessions) : null,
      })
    }
    return NextResponse.json({ date, count: result.length, doctors: result })
  } catch (error: any) {
    return errorResponse(error, 'automation doctors schedule')
  }
}
