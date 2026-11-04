// Everything STAAD holds about one account, for GET /api/users/export (the
// right of access under the DPDP Act). Mirrors the data map in
// deleteAccount.ts: the same rows that deletion removes are exported here,
// plus the payments and consent history that deletion keeps.
//
// Not included: Firestore live-session documents (live captions are cleared
// after the retention window and module state is transient), server logs and
// the admin audit log. The security access log is included: your own entries,
// newest first, capped at ACCESS_LOG_EXPORT_LIMIT rows.
import { prisma, appDb } from '@/lib/core/db';
import { LEGAL_VERSION } from '@/lib/core/legal';

const ACCESS_LOG_EXPORT_LIMIT = 20_000;

export async function exportAccount(uid: string) {
  const [user, therapist, admin, consents, payments, tickets, accessLog] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, include: { client: true } }),
    appDb.profileTherapist.findUnique({
      where: { userId: uid },
      include: { subscriptions: true, subscriptionRequests: true, coupons: true },
    }),
    appDb.profileAdmin.findUnique({ where: { userId: uid } }),
    appDb.consentRecord.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
    appDb.payment.findMany({ where: { userId: uid }, orderBy: { createdAt: 'asc' } }),
    prisma.supportTicket.findMany({ where: { userId: uid }, include: { replies: true }, orderBy: { createdAt: 'asc' } }),
    prisma.accessLog.findMany({
      where: { uid },
      orderBy: { createdAt: 'desc' },
      take: ACCESS_LOG_EXPORT_LIMIT,
      select: { createdAt: true, method: true, route: true, resourceId: true, status: true, ip: true, userAgent: true },
    }),
  ]);
  if (!user && !therapist && !admin) return null;

  const base = {
    exportedAt: new Date().toISOString(),
    legalVersion: LEGAL_VERSION,
    about:
      'All personal data STAAD holds for your account. Payment records and consent history are kept after account deletion where the law requires it.',
    account: user ? { id: user.id, email: user.email, role: user.role, status: user.status, createdAt: user.createdAt, lastSeenAt: user.lastSeenAt } : null,
    clientProfile: user?.client ?? null,
    adminProfile: admin,
    consents,
    payments,
    supportTickets: tickets,
    securityAccessLog: accessLog,
  };
  if (!therapist) return base;

  const therapistId = therapist.id;
  const { subscriptions, subscriptionRequests, coupons, ...profile } = therapist;

  const [sessions, bookings, invites, therapistNotes, progressMetrics, progressNotes, progressReports, riskFlags, messages, usage] =
    await Promise.all([
      prisma.session.findMany({ where: { therapistId }, include: { report: true }, orderBy: { scheduledAt: 'asc' } }),
      prisma.booking.findMany({ where: { therapistId }, orderBy: { dateTime: 'asc' } }),
      prisma.invite.findMany({ where: { therapistId }, orderBy: { createdAt: 'asc' } }),
      prisma.therapistNote.findMany({ where: { therapistId }, orderBy: { createdAt: 'asc' } }),
      prisma.progressMetric.findMany({ where: { therapistId } }),
      prisma.progressNote.findMany({ where: { therapistId }, orderBy: { createdAt: 'asc' } }),
      prisma.progressReport.findMany({ where: { therapistId } }),
      prisma.riskFlag.findMany({ where: { therapistId } }),
      prisma.whatsAppMessage.findMany({ where: { therapistId } }),
      appDb.usageEvent.findMany({ where: { therapistId } }),
    ]);

  // The therapist's clients: added directly or seen in one of their sessions.
  const sessionClientIds = [...new Set(sessions.map((s) => s.clientId))];
  const clients = await prisma.profileClient.findMany({
    where: { OR: [{ therapistId }, { id: { in: sessionClientIds } }] },
    orderBy: { createdAt: 'asc' },
  });

  return {
    ...base,
    therapistProfile: profile,
    subscriptions,
    subscriptionRequests,
    personalCoupons: coupons,
    usageEvents: usage,
    clients,
    sessions,
    bookings,
    invites,
    therapistNotes,
    progressMetrics,
    progressNotes,
    progressReports,
    riskFlags,
    whatsAppMessages: messages,
  };
}
