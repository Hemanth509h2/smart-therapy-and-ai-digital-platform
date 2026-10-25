'use client';

// Admin "Try module": opens one module on its own, in the same stage the
// session room uses, so admins can test it without a client, a session or a
// plan. The backend gives each admin a private Firestore room
// (POST /api/admin/modules/preview) because modules keep their state there.
// The LiveKit room is never connected: there is no call, only the module.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import { ChevronLeft, Lock, LockOpen } from 'lucide-react';
import { RC } from '@/components/session/roomTheme';
import ModuleStage from '@/components/session/ModuleStage';
import { ModuleContent, SkillModuleView } from '@/components/GlassModulePanel';
import { EmptyState, Spinner, useAdmin } from '@/components/admin/kit';
import { adminFetch } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { ALL_MODULES, isSkillModule } from '@/lib/modules';

type Role = 'therapist' | 'client';

export default function TryModulePage({ params }: { params: { moduleId: string } }) {
  const { moduleId } = params;
  const { uid, role, can } = useAdmin();
  const router = useRouter();
  const room = useMemo(() => new Room(), []);
  const mod = ALL_MODULES.find((m) => m.id === moduleId);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewAs, setViewAs] = useState<Role>('therapist');
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!uid) router.push('/auth');
    else if (role && role !== 'ADMIN') router.push('/');
  }, [uid, role, router]);

  const allowed = role === 'ADMIN' && can('content');

  useEffect(() => {
    if (!allowed || !mod) return;
    let cancelled = false;
    adminFetch<{ sessionId: string }>('/api/admin/modules/preview', { method: 'POST', action: 'open the module preview' })
      .then((data) => !cancelled && setSessionId(data.sessionId))
      .catch((e) => !cancelled && setError(caughtErrorMessage(e, 'open the module preview')));
    return () => {
      cancelled = true;
    };
  }, [allowed, mod]);

  useEffect(() => () => void room.disconnect(), [room]);

  const back = () => router.push('/admin/modules');

  if (role !== 'ADMIN') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!allowed || !mod || error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-4" style={{ background: RC.pageBg }}>
        <EmptyState
          title={!allowed ? 'No access' : !mod ? 'Module not found' : "Couldn't open the module"}
          body={
            !allowed
              ? "Your admin role doesn't include the module library. Ask a super admin if you need it."
              : !mod
                ? 'This module does not exist. It may have been renamed or removed.'
                : error ?? undefined
          }
        />
        <Link href="/admin/modules" className="text-sm font-semibold" style={{ color: RC.greenDark }}>
          Back to Module library
        </Link>
      </div>
    );
  }

  const toolBtn = (active = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 12px',
    borderRadius: 10,
    border: `1px solid ${active ? RC.green : RC.border}`,
    background: active ? RC.tileActive : RC.panel,
    color: active ? RC.greenDark : RC.ink,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  // The role and lock change how most modules behave: the therapist drives,
  // the patient follows and is read-only while locked.
  const dark = isSkillModule(moduleId);
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
      <button onClick={back} style={toolBtn()}>
        <ChevronLeft size={16} /> Module library
      </button>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: dark ? '#fff' : RC.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mod.emoji} {mod.name}
        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: dark ? 'rgba(255,255,255,0.65)' : RC.inkMuted }}>Preview</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="View as">
        {(['therapist', 'client'] as const).map((r) => (
          <button key={r} onClick={() => setViewAs(r)} style={toolBtn(viewAs === r)} aria-pressed={viewAs === r}>
            {r === 'therapist' ? 'As therapist' : 'As patient'}
          </button>
        ))}
      </div>
      <button onClick={() => setIsLocked((l) => !l)} style={toolBtn(isLocked)} title="Therapist control: the patient can only watch while locked">
        {isLocked ? <Lock size={15} /> : <LockOpen size={15} />} {isLocked ? 'Locked' : 'Unlocked'}
      </button>
    </div>
  );

  return (
    <RoomContext.Provider value={room}>
      {!sessionId ? (
        <div className="flex h-screen items-center justify-center" style={{ background: RC.pageBg }}>
          <Spinner />
        </div>
      ) : isSkillModule(moduleId) ? (
        /* Skill modules get the dark full canvas of SkillDevLayout, minus its
           video bubbles and call controls (there is no call here). */
        <div style={{ width: '100vw', height: '100vh', background: '#101b18', display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
          {toolbar}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <SkillModuleView key={viewAs} moduleId={moduleId} sessionId={sessionId} role={viewAs} isLocked={isLocked} />
          </div>
        </div>
      ) : (
        <div style={{ width: '100vw', height: '100vh', background: RC.pageBg, display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
          {toolbar}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <ModuleStage
              activeModule={moduleId}
              timerStr="Preview"
              onlineCount={1}
              isTherapist={viewAs === 'therapist'}
              isLocked={isLocked}
              onLockToggle={() => setIsLocked((l) => !l)}
              onClose={back}
            >
              <ModuleContent
                key={viewAs}
                activeModule={moduleId}
                sessionId={sessionId}
                role={viewAs}
                isLocked={isLocked}
                isTherapist={viewAs === 'therapist'}
              />
            </ModuleStage>
          </div>
        </div>
      )}
    </RoomContext.Provider>
  );
}
