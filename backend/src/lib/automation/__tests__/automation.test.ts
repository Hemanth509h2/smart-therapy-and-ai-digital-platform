import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  profileTherapist: { findUnique: vi.fn(), findMany: vi.fn() },
  profileClient: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  session: { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
}))
vi.mock('@/lib/core/db', () => ({ prisma: prismaMock }))
const requireTherapist = vi.hoisted(() => vi.fn())
vi.mock('@/lib/http/progressAuth', () => ({ requireTherapist }))
vi.mock('@/lib/sessions/session-whatsapp', () => ({ getOrCreateGuestInvite: vi.fn().mockResolvedValue({ token: 'tok-1' }) }))

import { addDays, daysBetween, istDateString, istRange, isValidDateString } from '../time'
import { reminderMessage, dailyScheduleMessage } from '../messages'
import { GET as scheduleAll } from '@/app/api/automation/doctors/schedule/route'
import { GET as reminders } from '@/app/api/automation/reminders/route'
import { POST as joinLink } from '@/app/api/automation/sessions/[sessionId]/join-link/route'
import { GET as overview } from '@/app/api/automation/doctor/overview/route'
import { GET as docSchedule } from '@/app/api/automation/doctor/schedule/route'
import { GET as docClients } from '@/app/api/automation/doctor/clients/route'
import { GET as docClient } from '@/app/api/automation/doctor/client/route'
import { POST as sendPOST } from '@/app/api/whatsapp/send/route'

const KEY = { 'x-api-key': 'n8n-key' }
const req = (path: string, headers: Record<string, string> = KEY, init: RequestInit = {}) =>
  new Request(`http://x${path}`, { headers, ...init })

const DOCTOR = {
  id: 'd1', firstName: 'Meera', lastName: 'Rao', specialty: ['ADHD'], qualification: 'MA', experience: '8 yrs',
  bio: null, phoneNumber: '+919876543210',
}
const sess = (id: string, iso: string, first = 'Asha') => ({
  id, status: 'SCHEDULED', scheduledAt: new Date(iso),
  client: { id: `c-${id}`, firstName: first, lastName: 'K' },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AUTOMATION_API_KEY', 'n8n-key')
  prismaMock.profileTherapist.findUnique.mockResolvedValue(DOCTOR)
  prismaMock.session.findMany.mockResolvedValue([])
})

describe('time helpers (IST)', () => {
  it('uses the Indian calendar day', () => {
    expect(istDateString(new Date('2026-10-12T20:00:00Z'))).toBe('2026-10-13')
    expect(istRange('2026-10-13').start.toISOString()).toBe('2026-10-12T18:30:00.000Z')
    expect(istRange('2026-10-13', '2026-10-15').end.toISOString()).toBe('2026-10-15T18:30:00.000Z')
  })
  it('adds days and counts ranges', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(1)
    expect(daysBetween('2026-10-13', '2026-10-20')).toBe(8)
  })
  it('validates dates', () => {
    expect(isValidDateString('2026-10-13')).toBe(true)
    expect(['13-10-2026', '2026-13-45', '2026-02-31'].some(isValidDateString)).toBe(false)
  })
})

describe('messages', () => {
  it('builds the digest and the reminder', () => {
    const text = dailyScheduleMessage('Meera Rao', '2026-10-13', [
      { id: 's', status: 'SCHEDULED', scheduledAt: '', date: '2026-10-13', time: '09:30 am', client: { id: 'c', name: 'Asha K' } },
    ])
    expect(text).toContain('1. 09:30 am - Asha K')
    expect(text).toContain('1 session today')
    expect(reminderMessage('Asha', 'Meera Rao', new Date('2026-10-13T04:00:00Z'))).toContain('Meera Rao')
  })
})

describe('every automation endpoint is closed without the key', () => {
  const paths: Array<[string, (r: Request) => Promise<Response>, string]> = [
    ['schedule-all', scheduleAll, '/a'], ['reminders', reminders, '/a'], ['overview', overview, '/a?phone=9876543210'],
    ['doc-schedule', docSchedule, '/a?phone=9876543210'], ['clients', docClients, '/a?phone=9876543210'],
    ['client', docClient, '/a?phone=9876543210&clientId=c1'],
  ]
  it.each(paths)('%s', async (_n, handler, path) => {
    expect((await handler(req(path, {}))).status).toBe(401)
    expect((await handler(req(path, { 'x-api-key': 'wrong' }))).status).toBe(401)
  })
  it('join-link too, and the whole API stays closed if the env key is unset', async () => {
    expect((await joinLink(req('/a', {}, { method: 'POST' }), { params: { sessionId: 's1' } })).status).toBe(401)
    vi.stubEnv('AUTOMATION_API_KEY', '')
    expect((await scheduleAll(req('/a', { 'x-api-key': '' }))).status).toBe(401)
  })
})

describe('doctors/schedule (7 AM digest data)', () => {
  it('returns each doctor with sessions, a message and shouldSend', async () => {
    prismaMock.profileTherapist.findMany.mockResolvedValue([DOCTOR, { ...DOCTOR, id: 'd2', phoneNumber: null }, { ...DOCTOR, id: 'd3' }])
    prismaMock.session.findMany
      .mockResolvedValueOnce([sess('s1', '2026-10-13T04:00:00Z')])
      .mockResolvedValueOnce([sess('s2', '2026-10-13T05:00:00Z')])
      .mockResolvedValueOnce([])
    const res = await scheduleAll(req('/a?date=2026-10-13'))
    const body = await res.json()
    expect(body.count).toBe(3)
    expect(body.doctors[0]).toMatchObject({ shouldSend: true, sessionCount: 1 })
    expect(body.doctors[0].message).toContain('Meera Rao')
    expect(body.doctors[0].sessions[0]).toMatchObject({ time: '09:30 am', date: '2026-10-13' })
    expect(body.doctors[1].shouldSend).toBe(false) // no phone
    expect(body.doctors[2]).toMatchObject({ shouldSend: false, message: null }) // no sessions
    const where = prismaMock.session.findMany.mock.calls[0][0].where
    expect(where.status).toEqual({ in: ['SCHEDULED', 'ACTIVE'] })
    expect(where.scheduledAt.gte.toISOString()).toBe('2026-10-12T18:30:00.000Z')
  })
  it('rejects a bad date', async () => {
    expect((await scheduleAll(req('/a?date=nope'))).status).toBe(400)
  })
})

describe('reminders', () => {
  it('queries the requested window for scheduled sessions with a client phone', async () => {
    prismaMock.session.findMany.mockResolvedValue([
      { id: 's1', scheduledAt: new Date(Date.now() + 3_700_000), client: { id: 'c1', firstName: 'Asha', lastName: 'K', phoneNumber: '+919000000001' }, therapist: { firstName: 'Meera', lastName: 'Rao' } },
    ])
    const res = await reminders(req('/a?fromMinutes=60&toMinutes=75'))
    const body = await res.json()
    expect(body).toMatchObject({ fromMinutes: 60, toMinutes: 75, count: 1 })
    expect(body.sessions[0]).toMatchObject({ sessionId: 's1', client: { phoneNumber: '+919000000001' }, doctorName: 'Meera Rao' })
    expect(body.sessions[0].message).toContain('Asha')
    const where = prismaMock.session.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ status: 'SCHEDULED', client: { phoneNumber: { not: null } } })
    expect(where.scheduledAt.lte.getTime() - where.scheduledAt.gt.getTime()).toBe(15 * 60_000)
  })
  it.each(['fromMinutes=10&toMinutes=5', 'fromMinutes=-1&toMinutes=5', 'fromMinutes=a&toMinutes=5', 'fromMinutes=0&toMinutes=99999'])(
    'rejects bad window %s', async (q) => {
      expect((await reminders(req(`/a?${q}`))).status).toBe(400)
    }
  )
})

describe('join-link', () => {
  it('returns the link and message without sending', async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      id: 's1', status: 'SCHEDULED', scheduledAt: new Date(), clientId: 'c1', therapistId: 'd1',
      client: { id: 'c1', firstName: 'Asha', lastName: 'K', phoneNumber: '+919000000001' },
      therapist: { firstName: 'Meera', lastName: 'Rao' },
    })
    vi.stubEnv('APP_URL', 'https://app.example.test')
    const body = await (await joinLink(req('/a', KEY, { method: 'POST' }), { params: { sessionId: 's1' } })).json()
    expect(body.link).toBe('https://app.example.test/join/tok-1')
    expect(body).toMatchObject({ shouldSend: true, client: { phoneNumber: '+919000000001' } })
    expect(body.message).toContain(body.link)
  })
  it('404 for an unknown session, 409 for a cancelled one', async () => {
    prismaMock.session.findUnique.mockResolvedValueOnce(null)
    expect((await joinLink(req('/a', KEY, { method: 'POST' }), { params: { sessionId: 'x' } })).status).toBe(404)
    prismaMock.session.findUnique.mockResolvedValueOnce({ id: 's', status: 'CANCELLED' })
    expect((await joinLink(req('/a', KEY, { method: 'POST' }), { params: { sessionId: 's' } })).status).toBe(409)
  })
})

describe('chatbot endpoints identify the doctor by phone', () => {
  it('needs a phone, rejects a malformed one, 404s an unknown one', async () => {
    expect((await overview(req('/a'))).status).toBe(400)
    expect((await overview(req('/a?phone=abc'))).status).toBe(400)
    prismaMock.profileTherapist.findUnique.mockResolvedValue(null)
    expect((await overview(req('/a?phone=919999999999'))).status).toBe(404)
  })
  it.each(['919876543210', '+91 98765 43210', '9876543210'])('accepts the number as "%s"', async (phone) => {
    prismaMock.session.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: 4 }])
    prismaMock.profileClient.count.mockResolvedValue(7)
    const res = await overview(req(`/a?phone=${encodeURIComponent(phone)}`))
    expect(res.status).toBe(200)
    expect(prismaMock.profileTherapist.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { phoneNumber: '+919876543210' } }))
    const body = await res.json()
    expect(body.doctor.name).toBe('Meera Rao')
    expect(body.stats).toMatchObject({ clients: 7, sessionsCompleted: 4, sessionsScheduled: 0 })
  })
  it('every query is scoped to the identified doctor', async () => {
    prismaMock.session.groupBy.mockResolvedValue([])
    prismaMock.profileClient.count.mockResolvedValue(0)
    await overview(req('/a?phone=919876543210'))
    for (const [args] of prismaMock.session.findMany.mock.calls) expect(args.where.therapistId).toBe('d1')
  })
  it('schedule validates dates, range and status', async () => {
    const p = '&phone=919876543210'
    expect((await docSchedule(req(`/a?from=nope${p}`))).status).toBe(400)
    expect((await docSchedule(req(`/a?from=2026-10-20&to=2026-10-13${p}`))).status).toBe(400)
    expect((await docSchedule(req(`/a?from=2026-10-01&to=2026-12-01${p}`))).status).toBe(400)
    expect((await docSchedule(req(`/a?status=BOGUS${p}`))).status).toBe(400)
    const ok = await docSchedule(req(`/a?from=2026-10-13&to=2026-10-14&status=scheduled,cancelled${p}`))
    expect(ok.status).toBe(200)
    expect(prismaMock.session.findMany.mock.calls[0][0].where.status).toEqual({ in: ['SCHEDULED', 'CANCELLED'] })
  })
  it('a client that is not this doctor\'s is a 404, and notes are never selected', async () => {
    prismaMock.profileClient.findFirst.mockResolvedValue(null)
    expect((await docClient(req('/a?phone=919876543210&clientId=other'))).status).toBe(404)
    const select = JSON.stringify(prismaMock.profileClient.findFirst.mock.calls[0][0].select)
    expect(select).not.toMatch(/notes|report/i)
    expect(JSON.stringify(prismaMock.profileClient.findFirst.mock.calls[0][0].where)).toContain('"therapistId":"d1"')
  })
  it('clients list is scoped to the doctor and filters by name', async () => {
    prismaMock.profileClient.findMany.mockResolvedValue([])
    await docClients(req('/a?phone=919876543210&q=asha'))
    const where = JSON.stringify(prismaMock.profileClient.findMany.mock.calls[0][0].where)
    expect(where).toContain('"therapistId":"d1"')
    expect(where).toContain('asha')
  })
})

describe('/api/whatsapp/send', () => {
  const body = JSON.stringify({ to: '+919876543210', type: 'text', body: 'hi' })
  it('is closed to anonymous callers', async () => {
    requireTherapist.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
    expect((await sendPOST(new Request('http://x', { method: 'POST', body }))).status).toBe(401)
  })
  it('a therapist cannot log a send against another therapist', async () => {
    requireTherapist.mockResolvedValue({ ok: true, uid: 'u', therapist: { id: 'd1' } })
    const res = await sendPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ to: '+919876543210', type: 'text', body: 'hi', therapistId: 'd2' }) }))
    expect(res.status).toBe(403)
  })
})
