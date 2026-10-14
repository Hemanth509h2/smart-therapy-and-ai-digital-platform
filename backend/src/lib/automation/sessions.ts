import { prisma } from '@/lib/db'
import type { SessionStatus } from '@prisma/client'
import { istRange, timeLabel } from './time'

export interface SessionRow {
  id: string
  status: SessionStatus
  scheduledAt: string // ISO, UTC
  date: string // IST day, YYYY-MM-DD
  time: string // IST, e.g. "09:30 am"
  client: { id: string; name: string }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** One doctor's sessions between two IST days (inclusive), oldest first. */
export async function getDoctorSessions(
  doctorId: string,
  from: string,
  to: string,
  statuses: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED']
): Promise<SessionRow[]> {
  const { start, end } = istRange(from, to)
  const rows = await prisma.session.findMany({
    where: { therapistId: doctorId, status: { in: statuses }, scheduledAt: { gte: start, lt: end } },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      client: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  return rows.map((s) => ({
    id: s.id,
    status: s.status,
    scheduledAt: s.scheduledAt.toISOString(),
    date: new Date(s.scheduledAt.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10),
    time: timeLabel(s.scheduledAt),
    client: { id: s.client.id, name: `${s.client.firstName} ${s.client.lastName}`.trim() },
  }))
}

/** Clients that belong to a doctor: added directly, or linked through a session. */
export const doctorClientsWhere = (doctorId: string) => ({
  OR: [{ therapistId: doctorId }, { sessions: { some: { therapistId: doctorId } } }],
})

export const ageFrom = (dob: Date, now = new Date()): number => {
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const before = now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  if (before) age--
  return age
}
