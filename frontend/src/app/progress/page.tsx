'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { apiFetch } from '@/lib/api';

interface SessionData {
  id: string;
  scheduledAt: string;
  status: string;
  therapist?: { firstName: string; lastName: string };
}

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] animate-fade-up';
const GLASS_CARD = `${CARD_BASE} hover-lift`;
const STAT_CARD = `${CARD_BASE} stat-hover`;

export default function ProgressPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role === 'THERAPIST') { router.push('/'); return; }
    fetchSessions();
  }, [uid, role, profile]);

  const fetchSessions = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/sessions?clientId=${profile.id}`);
      if (res.ok) { const d = await res.json(); setSessions(d.sessions || []); }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const completedSessions = sessions.filter((s) => s.status === 'COMPLETED');
  const totalCompleted = completedSessions.length;
  const currentStreak = 0; // Placeholder for Phase 2
  const conditions = profile?.diagnosis || [];

  return (
    <DashboardLayout role={role} profile={profile}>
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="blob animate-blob" style={{ top: '-10%', right: '-5%', width: '30vw', height: '30vw', background: 'radial-gradient(circle at 70% 30%, rgba(200, 96, 42, 0.08), transparent 70%)' }} />
        <div className="blob animate-blob" style={{ bottom: '-15%', left: '-8%', width: '35vw', height: '35vw', background: 'radial-gradient(circle at 30% 70%, rgba(156, 125, 89, 0.10), transparent 70%)', animationDelay: '-9s' }} />
      </div>

      <div className="relative z-10 space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>My Progress</h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
            Every session is a step forward
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent"></div>
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`${STAT_CARD} p-5 stagger-1 text-center`}>
                <div className="text-3xl mb-2">📊</div>
                <p className="font-heading text-4xl" style={{ color: 'var(--ink)' }}>{totalCompleted}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>Sessions Completed</p>
              </div>
              <div className={`${STAT_CARD} p-5 stagger-2 text-center`}>
                <div className="text-3xl mb-2">🔥</div>
                <p className="font-heading text-4xl" style={{ color: 'var(--ink)' }}>{currentStreak}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>Day Streak</p>
                <p className="text-xs mt-1" style={{ color: 'var(--sage)' }}>Coming in Phase 2</p>
              </div>
              <div className={`${STAT_CARD} p-5 stagger-3 text-center`}>
                <div className="text-3xl mb-2">🏷️</div>
                <p className="font-heading text-4xl" style={{ color: 'var(--ink)' }}>{conditions.length}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>Conditions</p>
                <div className="flex flex-wrap justify-center gap-1 mt-2">
                  {conditions.length === 0 ? (
                    <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>None listed</span>
                  ) : (
                    conditions.map((c: string) => (
                      <span key={c} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>
                        {c}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Timeline */}
            {completedSessions.length > 0 ? (
              <div className={`${GLASS_CARD} p-6`}>
                <h2 className="font-heading text-lg mb-6" style={{ color: 'var(--ink)' }}>Session History</h2>
                <div className="relative pl-8 space-y-0">
                  {/* Vertical line */}
                  <div className="absolute left-[11px] top-2 bottom-2 w-0.5" style={{ background: 'var(--glass-border)' }} />

                  {completedSessions.map((s, i) => {
                    const sessionNum = totalCompleted - i;
                    const isMilestone = sessionNum % 5 === 0;
                    return (
                      <div key={s.id} className="relative pb-6 last:pb-0">
                        {/* Dot */}
                        <div
                          className="absolute -left-[19px] top-1 h-[18px] w-[18px] rounded-full border-2 flex items-center justify-center"
                          style={{
                            background: 'var(--page-bg)',
                            borderColor: isMilestone ? 'var(--c-accent)' : 'var(--sage)',
                          }}
                        >
                          {isMilestone ? (
                            <span className="text-[10px]">🎉</span>
                          ) : (
                            <div className="h-2 w-2 rounded-full" style={{ background: 'var(--sage)' }} />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Session {sessionNum}
                          </p>
                          <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                            {new Date(s.scheduledAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            {' with '}
                            {s.therapist?.firstName || 'therapist'}
                          </p>
                          {isMilestone && (
                            <span className="inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>
                              🎉 {sessionNum} sessions milestone!
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={`${GLASS_CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                <div className="text-5xl">🌟</div>
                <p className="font-heading text-lg" style={{ color: 'var(--ink)' }}>No sessions completed yet</p>
                <p className="text-sm font-medium text-center max-w-xs" style={{ color: 'var(--ink-muted)' }}>
                  Your progress timeline will appear here after your first session.
                </p>
              </div>
            )}

            {/* Encouragement card */}
            <div
              className="rounded-[14px] p-8 text-center"
              style={{
                background: 'var(--sage-light)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <p className="font-heading text-lg italic" style={{ color: 'var(--ink)' }}>
                "You're doing great. Keep showing up."
              </p>
            </div>
          </>
        )}
      </div>
    </div>
    </DashboardLayout>
  );
}
