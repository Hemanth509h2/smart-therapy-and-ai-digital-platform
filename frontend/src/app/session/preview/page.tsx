'use client';

// DEV-ONLY layout preview for the session room.
//
// The real room at /session/[sessionId] needs an authenticated therapist, a
// LiveKit token and live Firestore data, so the layout can't be inspected
// locally without credentials. This route mounts the SAME layout components
// (SessionTopBar, the four swappable panels, WhiteboardStage, SessionBottomBar)
// inside an unconnected LiveKit RoomContext with stub data, purely so the
// structure can be reviewed and screenshotted.
//
// It renders nothing in production.

import { useMemo, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import { Maximize2 } from 'lucide-react';
import { RC, SIDEBAR_WIDTH } from '@/components/session/roomTheme';
import type { SidebarPanel } from '@/components/session/sessionPanels';
import SessionTopBar from '@/components/session/SessionTopBar';
import SessionBottomBar from '@/components/session/SessionBottomBar';
import AIAssistantPanel from '@/components/session/AIAssistantPanel';
import AINotesPanel from '@/components/session/AINotesPanel';
import TherapyModulesPanel from '@/components/session/TherapyModulesPanel';
import { ShareWhiteboardModal } from '@/components/session/WhiteboardStage';
import StaadWhiteboard from '@/components/session/StaadWhiteboard';
import ModuleStage from '@/components/session/ModuleStage';
import { ModuleContent } from '@/components/GlassModulePanel';
import AIConsentBanner from '@/components/session/AIConsentBanner';
import RemoteVideoArea from '@/components/RemoteVideoArea';
import type { AIInsight } from '@/lib/rag/types';

const STUB_INSIGHT: AIInsight = {
  emotions: ['calm', 'engaged'],
  summary: 'Client is describing school-related worry with steady affect and good engagement.',
  steps: ['Reflect the worry back in their own words.', 'Offer a short grounding exercise.'],
  module: '5-4-3-2-1-grounding',
  riskFlag: false,
  generatedAt: Date.now(),
  transcriptWindowMinutes: 8,
};

export default function SessionLayoutPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const room = useMemo(() => new Room(), []);
  const startTime = useRef(Date.now() - 1000 * 155);

  const [activePanel, setActivePanel] = useState<SidebarPanel>('assistant');
  const [screenSharing, setScreenSharing] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [shareAsk, setShareAsk] = useState(false);
  const [shared, setShared] = useState(false);
  // Lets the harness exercise the client-side view (read-only board while the
  // therapist holds control) without a second logged-in browser.
  const [previewRole, setPreviewRole] = useState<'therapist' | 'client'>('therapist');
  // Launching from the Modules panel puts the module on the wide canvas, exactly
  // as the real room now does, so the layout can be checked without a session.
  const [previewModule, setPreviewModule] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const promptedRef = useRef(false);

  const selectPanel = (panel: Exclude<SidebarPanel, null>) => {
    const next = activePanel === panel ? null : panel;
    setActivePanel(next);
    if (next === 'whiteboard' && !promptedRef.current) {
      promptedRef.current = true;
      setShareAsk(true);
    }
  };

  const whiteboardMode = activePanel === 'whiteboard';
  const moduleMode = previewModule !== null && !whiteboardMode;
  const canvasTakeover = whiteboardMode || moduleMode;
  const sidebarOpen = activePanel !== null && !whiteboardMode;

  return (
    <RoomContext.Provider value={room}>
      <div style={{ width: '100vw', height: '100vh', background: RC.pageBg, overflow: 'hidden', position: 'relative', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
          <SessionTopBar
            timerStr="02:35"
            startedAt={startTime.current}
            sessionId="preview-session"
            onlineCount={2}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {!canvasTakeover ? (
              <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                {['You', 'Riya Sharma'].map((n) => (
                  <div
                    key={n}
                    style={{ position: 'relative', width: 132, height: 78, borderRadius: 14, background: RC.tile, border: `1px solid ${RC.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: RC.greenSoft, border: `2px solid ${RC.green}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: RC.greenDark, fontSize: 18, fontWeight: 600 }}>
                      {n.charAt(0)}
                    </div>
                    <div style={{ position: 'absolute', bottom: 6, left: 8, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', fontSize: 10, fontWeight: 600, color: RC.ink }}>
                      {n}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1 }} />
            )}
            <button
              onClick={() => setPreviewRole((r) => (r === 'therapist' ? 'client' : 'therapist'))}
              title="Toggle role (preview only)"
              style={{ flexShrink: 0, padding: '0 12px', height: 36, borderRadius: 10, border: `1px solid ${RC.border}`, background: RC.panel, color: RC.ink, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              as {previewRole}
            </button>
            <button
              onClick={() => setConsentOpen((o) => !o)}
              title="Toggle consent modal (preview only)"
              style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, border: `1px solid ${RC.border}`, background: RC.panel, color: RC.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Maximize2 size={16} />
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {whiteboardMode ? (
                /* isShared=false keeps the board entirely local, so the whole
                   drawing surface and toolbar can be exercised here without
                   Firestore auth. Sync itself needs a real session. */
                <StaadWhiteboard
                  sessionId="preview-session"
                  role={previewRole}
                  isShared={shared}
                  isLocked={isLocked}
                  selfName="You"
                  otherName="Riya Sharma"
                  onClose={() => setActivePanel(null)}
                />
              ) : moduleMode ? (
                <ModuleStage
                  activeModule={previewModule}
                  selfName="You"
                  otherName="Riya Sharma"
                  timerStr="02:35"
                  onlineCount={2}
                  isTherapist={previewRole === 'therapist'}
                  isLocked={isLocked}
                  onLockToggle={() => setIsLocked((l) => !l)}
                  onClose={() => setPreviewModule(null)}
                >
                  <ModuleContent
                    activeModule={previewModule}
                    sessionId="preview-session"
                    role={previewRole}
                    isLocked={isLocked}
                    isTherapist={previewRole === 'therapist'}
                  />
                </ModuleStage>
              ) : (
                <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', background: RC.videoBg, border: `2px solid ${RC.green}`, boxShadow: `0 0 0 5px ${RC.greenSoft}, 0 18px 44px rgba(20,40,30,0.18)` }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RemoteVideoArea participantName="Riya Sharma" />
                  </div>
                  <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 15, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.92)', boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: RC.red }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: RC.ink, fontFamily: 'monospace' }}>02:35</span>
                    <span style={{ width: 1, height: 12, background: 'rgba(0,0,0,0.12)' }} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: RC.greenDark }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: RC.green }} />
                      2 online
                    </span>
                  </div>
                </div>
              )}
            </div>

            <SessionBottomBar
              activePanel={activePanel}
              onSelectPanel={selectPanel}
              onEndCall={() => {}}
              participantCount={2}
              reactionBarOpen={reactionBarOpen}
              onToggleReactions={() => setReactionBarOpen((o) => !o)}
              isLocked={isLocked}
              onToggleLock={() => setIsLocked((l) => !l)}
              screenSharing={screenSharing}
              onToggleScreenShare={() => setScreenSharing((s) => !s)}
            />
          </div>
        </div>

        <div style={{
          width: sidebarOpen ? SIDEBAR_WIDTH : 0,
          minWidth: sidebarOpen ? SIDEBAR_WIDTH : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex',
          justifyContent: 'flex-end',
          padding: sidebarOpen ? '12px 16px 12px 0' : 0,
        }}>
          {activePanel === 'assistant' && (
            <AIAssistantPanel
              insight={STUB_INSIGHT}
              live
              analyseLoading={false}
              analyseDisabled={false}
              onAnalyse={() => {}}
              onLaunchModule={() => {}}
              onClose={() => setActivePanel(null)}
            />
          )}
          {activePanel === 'notes' && (
            <AINotesPanel
              sessionId="preview-session"
              sessionStartedAt={startTime.current}
              insight={STUB_INSIGHT}
              onClose={() => setActivePanel(null)}
            />
          )}
          {activePanel === 'modules' && (
            <TherapyModulesPanel
              allowedModuleIds={null}
              onLaunch={(id) => setPreviewModule(id)}
              onClose={() => setActivePanel(null)}
            />
          )}
        </div>

        {shareAsk && (
          <ShareWhiteboardModal
            onKeepPrivate={() => { setShareAsk(false); setShared(false); }}
            onShare={() => { setShareAsk(false); setShared(true); }}
          />
        )}
        {consentOpen && (
          <AIConsentBanner userRole="therapist" onConsent={() => setConsentOpen(false)} otherPartyConsented={false} />
        )}
      </div>
    </RoomContext.Provider>
  );
}
