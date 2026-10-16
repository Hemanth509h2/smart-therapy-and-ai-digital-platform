import { NextResponse } from 'next/server'
import type { SessionStatus } from '@prisma/client'
import { errorResponse } from '@/lib/http/apiError'
import { getDoctorSessions } from '@/lib/automation/sessions'
import { daysBetween, istDateString, isValidDateString } from '@/lib/automation/time'
import { requireDoctorByPhone } from '@/lib/automation/doctor'

export const dynamic = 'force-dynamic'

const STATUSES: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']
const MAX_DAYS = 31

// GET /api/automation/doctor/schedule?phone=...[&from=YYYY-MM-DD][&to=YYYY-MM-DD][&status=SCHEDULED,COMPLETED]
// The calling doctor's sessions between two IST days (default: today only),
// oldest first. `status` defaults to SCHEDULED,ACTIVE,COMPLETED (cancelled are
// left out unless asked for). Ranges are limited to 31 days.
export async function GET(request: Request) {
  try {
    const found = await requireDoctorByPhone(request)
    if (!found.ok) return found.response

    const params = new URL(request.url).searchParams
    const from = params.get('from') ?? istDateString()
    const to = params.get('to') ?? from
    if (!isValidDateString(from) || !isValidDateString(to)) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 })
    }
    const days = daysBetween(from, to)
    if (days < 1 || days > MAX_DAYS) {
      return NextResponse.json({ error: `to must not be before from, and the range is at most ${MAX_DAYS} days` }, { status: 400 })
    }

    let statuses: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED']
    const status = params.get('status')
    if (status) {
      statuses = status.split(',').map((s) => s.trim().toUpperCase()) as SessionStatus[]
      if (statuses.length === 0 || statuses.some((s) => !STATUSES.includes(s))) {
        return NextResponse.json({ error: `status must be a comma-separated list of ${STATUSES.join(', ')}` }, { status: 400 })
      }
    }

    const sessions = await getDoctorSessions(found.doctor.id, from, to, statuses)
    return NextResponse.json({ from, to, count: sessions.length, sessions })
  } catch (error: any) {
    return errorResponse(error, 'automation doctor schedule')
  }
}
