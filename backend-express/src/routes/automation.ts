import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { errorResponse } from '@/lib/http/apiError';
import { ageFrom, doctorClientsWhere, getDoctorSessions } from '@/lib/automation/sessions';
import { dateTimeLabel, addDays, istDateString, daysBetween, isValidDateString } from '@/lib/automation/time';
import { requireDoctorByPhone, doctorSummary } from '@/lib/automation/doctor';
import type { SessionStatus } from '@prisma/client';
import { rejectUnlessAutomation } from '@/lib/automation/auth';
import { dailyScheduleMessage, reminderMessage, joinLinkMessage } from '@/lib/automation/messages';
import { therapistsById } from '@/lib/core/links';
import { appUrl } from '@/lib/core/app-url';
import { getOrCreateGuestInvite } from '@/lib/sessions/guest-invite';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/automation/doctor/client ---------------------------------------------

// GET /api/automation/doctor/client?phone=...&clientId=...
// One of the calling doctor's clients: profile details and their session history
// with this doctor (latest 20). Clinical notes and reports are NOT included.
// A client that is not this doctor's is a 404, the same as one that doesn't exist.
router.get('/automation/doctor/client', handle(async (req, res) => {
  try {
    const found = await requireDoctorByPhone(req)
    if (!found.ok) return send(res, found.response)

    const clientId = queryParams(req).get('clientId')
    if (!clientId) return res.status(400).json({ error: 'Give the clientId of the client to look up.' })

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
    if (!client) return res.status(404).json({ error: "We couldn't find that client. They may have been removed." })

    return res.json({
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
    return send(res, errorResponse(error, 'automation doctor client'))
  }
}));

// ---- /api/automation/doctor/clients --------------------------------------------

const LIMIT = 50

// GET /api/automation/doctor/clients?phone=...[&q=name]
// The calling doctor's clients (added directly or linked through a session),
// optionally filtered by part of the name, with session count and last/next session.
router.get('/automation/doctor/clients', handle(async (req, res) => {
  try {
    const found = await requireDoctorByPhone(req)
    if (!found.ok) return send(res, found.response)
    const doctorId = found.doctor.id

    const q = queryParams(req).get('q')?.trim()
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
    return res.json({ count: items.length, clients: items })
  } catch (error: any) {
    return send(res, errorResponse(error, 'automation doctor clients'))
  }
}));

// ---- /api/automation/doctor/overview -------------------------------------------

// GET /api/automation/doctor/overview?phone=<sender's WhatsApp number>
// The chatbot's "who am I talking to": the doctor's profile, today's sessions,
// the next 7 days, and headline counts. 404 means the number is not a doctor.
router.get('/automation/doctor/overview', handle(async (req, res) => {
  try {
    const found = await requireDoctorByPhone(req)
    if (!found.ok) return send(res, found.response)
    const { doctor } = found

    const today = istDateString()
    const [todaySessions, upcoming, statusCounts, clientCount] = await Promise.all([
      getDoctorSessions(doctor.id, today, today, ['SCHEDULED', 'ACTIVE', 'COMPLETED']),
      getDoctorSessions(doctor.id, addDays(today, 1), addDays(today, 7), ['SCHEDULED']),
      prisma.session.groupBy({ by: ['status'], where: { therapistId: doctor.id }, _count: true }),
      prisma.profileClient.count({ where: doctorClientsWhere(doctor.id) }),
    ])

    const counts = Object.fromEntries(statusCounts.map((c) => [c.status, c._count]))
    return res.json({
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
    return send(res, errorResponse(error, 'automation doctor overview'))
  }
}));

// ---- /api/automation/doctor/schedule -------------------------------------------

const STATUSES: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']
const MAX_DAYS = 31

// GET /api/automation/doctor/schedule?phone=...[&from=YYYY-MM-DD][&to=YYYY-MM-DD][&status=SCHEDULED,COMPLETED]
// The calling doctor's sessions between two IST days (default: today only),
// oldest first. `status` defaults to SCHEDULED,ACTIVE,COMPLETED (cancelled are
// left out unless asked for). Ranges are limited to 31 days.
router.get('/automation/doctor/schedule', handle(async (req, res) => {
  try {
    const found = await requireDoctorByPhone(req)
    if (!found.ok) return send(res, found.response)

    const params = queryParams(req)
    const from = params.get('from') ?? istDateString()
    const to = params.get('to') ?? from
    if (!isValidDateString(from) || !isValidDateString(to)) {
      return res.status(400).json({ error: 'Give the from and to dates in YYYY-MM-DD format.' })
    }
    const days = daysBetween(from, to)
    if (days < 1 || days > MAX_DAYS) {
      return res.status(400).json({ error: `The to date can't be before the from date, and the range can be at most ${MAX_DAYS} days.` })
    }

    let statuses: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED']
    const status = params.get('status')
    if (status) {
      statuses = status.split(',').map((s) => s.trim().toUpperCase()) as SessionStatus[]
      if (statuses.length === 0 || statuses.some((s) => !STATUSES.includes(s))) {
        return res.status(400).json({ error: `Status must be a comma-separated list of: ${STATUSES.join(', ')}.` })
      }
    }

    const sessions = await getDoctorSessions(found.doctor.id, from, to, statuses)
    return res.json({ from, to, count: sessions.length, sessions })
  } catch (error: any) {
    return send(res, errorResponse(error, 'automation doctor schedule'))
  }
}));

// ---- /api/automation/doctors/schedule ------------------------------------------

// GET /api/automation/doctors/schedule[?date=YYYY-MM-DD][&doctorId=...]
// Every doctor with their sessions for one IST day (default: today), plus a
// ready-to-send WhatsApp `message`. Built for an n8n "7 AM daily schedule"
// workflow: loop over `doctors`, send `message` to `doctor.phoneNumber`.
// Cancelled and completed sessions are left out.
router.get('/automation/doctors/schedule', handle(async (req, res) => {
  try {
    const denied = rejectUnlessAutomation(req)
    if (denied) return send(res, denied)

    const params = queryParams(req)
    const date = params.get('date') ?? istDateString()
    if (!isValidDateString(date)) {
      return res.status(400).json({ error: 'Give the date in YYYY-MM-DD format.' })
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
    return res.json({ date, count: result.length, doctors: result })
  } catch (error: any) {
    return send(res, errorResponse(error, 'automation doctors schedule'))
  }
}));

// ---- /api/automation/reminders -------------------------------------------------

// GET /api/automation/reminders?fromMinutes=60&toMinutes=75
// Scheduled sessions that start between `fromMinutes` and `toMinutes` from now
// and whose client has a WhatsApp number, each with a ready-to-send `message`.
//
// Stateless on purpose: run the n8n workflow every N minutes and ask for a window
// exactly N minutes wide (e.g. every 15 min with 60->75 for a "1 hour before"
// reminder, 1440->1455 for "24 hours before"). Every session then falls into
// exactly one run, so nothing is sent twice and nothing needs to be stored.
router.get('/automation/reminders', handle(async (req, res) => {
  try {
    const denied = rejectUnlessAutomation(req)
    if (denied) return send(res, denied)

    const params = queryParams(req)
    const from = Number(params.get('fromMinutes') ?? 60)
    const to = Number(params.get('toMinutes') ?? 75)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > 7 * 24 * 60) {
      return res.status(400).json({ error: 'fromMinutes and toMinutes must be whole numbers, with fromMinutes from 0 up to (but less than) toMinutes, and toMinutes at most 10080 (7 days).' })
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
        therapistId: true,
        client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      },
    })
    const therapists = await therapistsById(sessions.map((s) => s.therapistId), { firstName: true, lastName: true })

    const items = sessions.map((s) => {
      const t = therapists.get(s.therapistId)
      const doctorName = t ? `${t.firstName} ${t.lastName}`.trim() : ''
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
    return res.json({ fromMinutes: from, toMinutes: to, count: items.length, sessions: items })
  } catch (error: any) {
    return send(res, errorResponse(error, 'automation reminders'))
  }
}));

// ---- /api/automation/sessions/:sessionId/join-link -----------------------------

// POST /api/automation/sessions/[sessionId]/join-link
// Creates (or reuses) the client's join link for this session and returns it
// with the client's number and a ready-to-send `message`. It does not send
// anything: n8n does that. POST because the first call creates the invite.
router.post('/automation/sessions/:sessionId/join-link', handle(async (req, res) => {
  try {
    const denied = rejectUnlessAutomation(req)
    if (denied) return send(res, denied)

    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      include: { client: true },
    })
    if (!session) return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' })
    if (session.status === 'CANCELLED' || session.status === 'COMPLETED') {
      return res.status(409).json({ error: `This session is ${session.status.toLowerCase()}, so it has no join link.` })
    }

    const invite = await getOrCreateGuestInvite(session)
    const link = `${appUrl(req)}/join/${invite.token}`
    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: session.therapistId },
      select: { firstName: true, lastName: true },
    })
    const doctorName = therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : ''

    return res.json({
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
    return send(res, errorResponse(error, 'automation join link'))
  }
}));
