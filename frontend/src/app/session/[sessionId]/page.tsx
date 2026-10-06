'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  Mic, MicOff, Camera, CameraOff, PhoneOff, Settings, Smile,
  Maximize2, Minimize2,
} from 'lucide-react';
import AIConsentBanner from '@/components/session/AIConsentBanner';
import { AIErrorBoundary } from '@/components/session/AIErrorBoundary';
import { useSessionTranscription } from '@/hooks/useSessionTranscription';
import { useAttentionScoring, type AttentionState } from '@/hooks/useAttentionScoring';
import { useLocalParticipant } from '@livekit/components-react';
import StaadVideo, { useSessionRoom } from '@/components/StaadVideo';
import RemoteVideoArea from '@/components/RemoteVideoArea';
import LocalVideoPip from '@/components/LocalVideoPip';
import GlassModulePanel, { SkillModuleView } from '@/components/GlassModulePanel';
import SkillDevLayout from '@/components/session/SkillDevLayout';
import ReactionOverlay from '@/components/ReactionOverlay';
import { resolveAllowedModuleIds, isSkillModule, moduleName as moduleDisplayName } from '@/lib/modules';
import { RC, SIDEBAR_WIDTH } from '@/components/session/roomTheme';
import type { SidebarPanel } from '@/components/session/sessionPanels';
import CaptionOverlay from '@/components/session/CaptionOverlay';
import TranslationControl from '@/components/session/TranslationControl';
import { useTranslationSettings, pairForRole, writeTranslationSettings } from '@/lib/translation';
import SessionTopBar from '@/components/session/SessionTopBar';
import SessionBottomBar from '@/components/session/SessionBottomBar';
import AIAssistantPanel from '@/components/session/AIAssistantPanel';
import AINotesPanel from '@/components/session/AINotesPanel';
import TherapyModulesPanel from '@/components/session/TherapyModulesPanel';
import { ShareWhiteboardModal } from '@/components/session/WhiteboardStage';
import StaadWhiteboard from '@/components/session/StaadWhiteboard';
import ModuleStage from '@/components/session/ModuleStage';
import { ModuleContent } from '@/components/GlassModulePanel';
import { apiFetch } from '@/lib/api';

interface SessionState {
  sessionId: string;
  activeModuleId: string | null;
  participants: Record<string, { uid: string; name: string; role: string; isOnline: boolean }>;
  timestamps: { createdAt: string; updatedAt: string };
}

/* The room colour palette now lives in components/session/roomTheme.ts (same
   values) so the top bar, bottom bar and the swappable panels share one source. */

// Thin wrapper so the transcription hook runs INSIDE <StaadVideo>'s room
// context (it reads the LiveKit room via useSessionRoom). Renders nothing;
// it just relays the recording state up to the page for the status chip.
function TranscriptionBridge({
  sessionId,
  enabled,
  userRole,
  onState,
}: {
  sessionId: string;
  enabled: boolean;
  userRole: 'therapist' | 'client';
  onState: (s: { isRecording: boolean; chunkCount: number }) => void;
}) {
  const { isRecording, chunkCount } = useSessionTranscription({ sessionId, enabled, userRole });
  useEffect(() => {
    onState({ isRecording, chunkCount });
  }, [isRecording, chunkCount, onState]);
  return null;
}

// Attention scoring, alongside transcription and gated by the SAME consent
// signal. Like <TranscriptionBridge> it must live inside <StaadVideo> to reach
// the LiveKit room, and renders nothing.
//
// The hook itself enforces therapist-only + client-track-only; passing
// userRole through keeps that decision in one place rather than duplicating the
// gate at the call site.
function AttentionBridge({
  sessionId,
  enabled,
  userRole,
  onState,
}: {
  sessionId: string;
  enabled: boolean;
  userRole: 'therapist' | 'client';
  onState: (s: AttentionState) => void;
}) {
  const attention = useAttentionScoring({ sessionId, enabled, userRole });
  useEffect(() => {
    onState(attention);
  }, [attention, onState]);
  return null;
}

export default function SessionRoomPage({ params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId;

  const { uid, role, profile } = useAuthStore();
  const { setActiveSessionId, setTherapistControl } = useSessionStore();
  const router = useRouter();

  const isTherapist = role === 'THERAPIST';

  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());
  const [showConfirm, setShowConfirm] = useState(false);
  const [isModuleActive, setIsModuleActive] = useState(false);

  /* ---- Swappable right sidebar: one of four panels, or none ---- */
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [shareWhiteboardAsk, setShareWhiteboardAsk] = useState(false);
  const whiteboardPromptedRef = useRef(false);

  /* Guest joining via an invite link (anonymous Firebase sign-in) has no
     profile row — the /join page stashed the invite's display name for us. */
  const [guestName, setGuestName] = useState<string | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('guest') === '1') {
      setGuestName(sessionStorage.getItem('guestName') || 'Guest');
    }
  }, []);
  const displayName = profile ? `${profile.firstName} ${profile.lastName}` : (guestName || 'User');
  // Whiteboard collaboration state lives in liveSessions alongside
  // activeModuleId/therapistControl, so the client can mirror the board the same
  // way it mirrors a launched module. `shared` is the "Share Whiteboard?" answer.
  const [whiteboardShared, setWhiteboardShared] = useState(false);
  const [whiteboardOpenRemote, setWhiteboardOpenRemote] = useState(false);

  const publishWhiteboardState = (active: boolean, shared: boolean) => {
    if (!isTherapist) return;
    updateDoc(doc(db, 'liveSessions', sessionId), {
      whiteboard: { active, shared },
      'timestamps.updatedAt': new Date().toISOString(),
    }).catch(() => {});
  };

  // Clicking the bar button for the open panel closes it; clicking a different
  // one swaps the content directly (no close-first step).
  const selectPanel = (panel: Exclude<SidebarPanel, null>) => {
    const next = activePanel === panel ? null : panel;
    setActivePanel(next);
    // First time the therapist opens the whiteboard, ask about collaboration.
    if (next === 'whiteboard' && !whiteboardPromptedRef.current) {
      whiteboardPromptedRef.current = true;
      setShareWhiteboardAsk(true);
    }
    // Opening or leaving the board changes what the client should see.
    const wasWhiteboard = activePanel === 'whiteboard';
    const isWhiteboard = next === 'whiteboard';
    if (isWhiteboard !== wasWhiteboard) publishWhiteboardState(isWhiteboard, whiteboardShared);
  };

  const closeWhiteboard = () => {
    setActivePanel(null);
    publishWhiteboardState(false, whiteboardShared);
  };
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const [aiInsight, setAiInsight] = useState<any>(null);
  const [analyseLoading, setAnalyseLoading] = useState(false);
  const [analyseCooldown, setAnalyseCooldown] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(true);
  const [consentStatus, setConsentStatus] = useState<{ therapist: boolean; client: boolean } | null>(null);
  const [myConsent, setMyConsent] = useState<boolean | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // The room should open in full screen. Browsers block programmatic fullscreen
  // without a user gesture, so we try immediately and also fall back to the first
  // interaction. The toggle button lets the user return to the normal view.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    const tryFs = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    tryFs();
    const onFirstGesture = () => tryFs();
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('pointerdown', onFirstGesture);
    };
  }, []);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const handleModuleLaunch = async (moduleId: string, moduleName: string) => {
    await handleModuleSwitch(moduleId);
    // Keep the sidebar on the Therapy Modules view so the launched activity
    // renders where the selector was — same behaviour as the old fixed panel.
    setActivePanel('modules');
    showToast(`${moduleName} launched`);
    // Log module usage for the admin dashboard (best-effort).
    if (isTherapist && profile?.id) {
      apiFetch('/api/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ therapistId: profile.id, type: 'MODULE_LAUNCH', label: moduleId, sessionId }),
      }).catch(() => {});
    }
  };

  const handleModuleClose = async () => {
    if (!isTherapist) return;
    await updateDoc(doc(db, 'liveSessions', sessionId), {
      activeModuleId: null,
      'timestamps.updatedAt': new Date().toISOString(),
    });
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!uid) {
      router.push('/auth');
      return;
    }

    setActiveSessionId(sessionId);

    // The room documents are provisioned SERVER-SIDE (see
    // src/lib/session-provisioning.ts, called from PATCH /api/sessions/{id}).
    //
    // They used to be created here, in the browser. They no longer can be:
    // security rules authorise every session read/write against
    // `liveSessions/{id}.allowedUids`, which is derived from Postgres and may
    // only be written by the server. A client that could create the document
    // could mint its own entitlement, so `allow create` is `false` for both
    // collections.
    //
    // Joining therefore means: ask the server to provision, THEN register
    // ourselves as a participant. The onSnapshot below is attached first and
    // simply fires once the documents appear.
    const joinSession = async () => {
      try {
        await apiFetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
      } catch {
        // Provisioning failure is surfaced by the participant write below
        // failing; the room simply stays in its loading state.
      }

      // Only after provisioning, so the document exists and we are entitled.
      await updateDoc(doc(db, 'liveSessions', sessionId), {
        [`participants.${uid}`]: {
          uid,
          name: displayName,
          role: isTherapist ? 'therapist' : 'client',
          isOnline: true,
          lastSeen: new Date().toISOString(),
        },
      }).catch(() => {});
    };

    const sessionRef = doc(db, 'liveSessions', sessionId);
    const unsubscribe = onSnapshot(
      sessionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as SessionState & { therapistControl?: boolean };
          setSessionState(data);
          setActiveModule(data.activeModuleId);
          if (typeof data.therapistControl === 'boolean') {
            setIsLocked(data.therapistControl);
          }
          const wb = (data as { whiteboard?: { active?: boolean; shared?: boolean } }).whiteboard;
          setWhiteboardShared(wb?.shared === true);
          setWhiteboardOpenRemote(wb?.active === true);
          if (!isTherapist && data.participants) {
            const therapist = Object.values(data.participants).find(p => p.role === 'therapist');
            setTherapistControl(therapist?.isOnline || false);
          }
        }
        setLoading(false);
      },
      // Firestore denial (rules/provisioning, e.g. no Google access from the
      // server on a broken network) must not wedge the room on the loading
      // screen — the LiveKit call itself doesn't depend on Firestore.
      (err) => {
        console.error('Live session listener failed:', err);
        setLoading(false);
      }
    );

    // Provision server-side, then register as a participant. This also
    // promotes the Prisma session SCHEDULED -> ACTIVE, which is why the
    // separate 'start' effect that used to live below is gone: it is the same
    // call, and firing it twice raced with provisioning.
    joinSession();

    return () => unsubscribe();
  }, [sessionId, uid, role, profile, router, setActiveSessionId, setTherapistControl, isTherapist, displayName]);

  useEffect(() => {
    setIsModuleActive(activeModule !== null);
  }, [activeModule]);

  // Deep link from the Therapy Modules page: /session/{id}?module={moduleId}
  // launches that module once the room document exists. Therapist-only, once.
  const autoLaunchedRef = useRef(false);
  useEffect(() => {
    if (!isTherapist || !sessionState || autoLaunchedRef.current) return;
    const requested = new URLSearchParams(window.location.search).get('module');
    if (!requested) return;
    autoLaunchedRef.current = true;
    if (!resolveAllowedModuleIds(profile).includes(requested)) {
      showToast('That module is not included in your plan');
      return;
    }
    handleModuleLaunch(requested, moduleDisplayName(requested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTherapist, sessionState, profile]);

  useEffect(() => {
    if (!uid) return;

    const sessionRef = doc(db, 'sessions', sessionId);

    getDoc(sessionRef).then((snap) => {
      if (snap.exists()) {
        const aiConsent = snap.data()?.aiConsent ?? {};
        const myKey = isTherapist ? 'therapist' : 'client';
        if (aiConsent[myKey] != null) {
          setShowConsentBanner(false);
          setMyConsent(aiConsent[myKey]);
        }
      }
    });

    const unsub = onSnapshot(sessionRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const aiConsent = data?.aiConsent ?? {};
        setConsentStatus(aiConsent);

        const myKey = isTherapist ? 'therapist' : 'client';
        if (aiConsent[myKey] != null) {
          setShowConsentBanner(false);
        }

        if (isTherapist && data?.aiInsight) {
          setAiInsight(data.aiInsight);
          // The floating insight bar used to pop itself open here; the AI
          // Assistant panel now takes that role. Only surface it when nothing
          // else is occupying the sidebar so it can't yank the therapist out of
          // an open module or the whiteboard.
          setActivePanel((current) => (current === null ? 'assistant' : current));
        }
      }
    });

    return () => unsub();
  }, [sessionId, uid, isTherapist]);

  const handleModuleSwitch = async (moduleId: string) => {
    if (!isTherapist) return;
    try {
      await updateDoc(doc(db, 'liveSessions', sessionId), {
        activeModuleId: moduleId,
        'timestamps.updatedAt': new Date().toISOString(),
      });
    } catch {
      setActiveModule(moduleId);
    }
  };

  const handleLockToggle = async () => {
    const next = !isLocked;
    setIsLocked(next);
    await updateDoc(doc(db, 'liveSessions', sessionId), {
      therapistControl: next,
      'timestamps.updatedAt': new Date().toISOString(),
    }).catch(() => {});
  };

  const handleAnalyse = async () => {
    if (analyseLoading || analyseCooldown) return;
    setAnalyseLoading(true);
    const clientParticipant = Object.values(participants).find((p) => p.role === 'client');
    try {
      const res = await apiFetch('/api/ai-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          therapistId: uid,
          // Route expects `clientProfile` (was `client` — the mismatch made the
          // copilot button 400 every time).
          clientProfile: {
            clientId: clientParticipant?.uid ?? '',
            name: clientParticipant?.name ?? 'Client',
            age: 0,
            conditions: [],
            sessionNumber: 1,
            therapistId: uid,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Analysis failed');
      }
      setAnalyseCooldown(true);
      setTimeout(() => setAnalyseCooldown(false), 30000);
      showToast('Analysis complete');
    } catch (e) {
      console.error('Analyse error:', e);
      showToast('Analysis failed. Try again.');
    } finally {
      setAnalyseLoading(false);
    }
  };

  const handleLaunchModule = (moduleSlug: string) => {
    handleModuleSwitch(moduleSlug);
    setActivePanel('modules');
    showToast(`Launching ${moduleSlug}`);
  };

  const handleConsent = async (given: boolean) => {
    setMyConsent(given);
    const roleKey = isTherapist ? 'therapist' : 'client';
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        [`aiConsent.${roleKey}`]: given,
      });
    } catch (e) {
      console.error('Consent write failed:', e);
    }
    setShowConsentBanner(false);
  };

  const handleCopySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleLeaveSession = async () => {
    if (uid) {
      try {
        await updateDoc(doc(db, 'liveSessions', sessionId), {
          [`participants.${uid}.isOnline`]: false,
          status: 'ended',
          'timestamps.updatedAt': new Date().toISOString(),
        });
      } catch {}
    }
    // Mark the scheduled session as COMPLETED in the database so it moves into
    // the client's session history once the call is cut.
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'end' }),
      });
    } catch {}
    // Log transcription volume for the admin dashboard (therapist side, best-effort).
    if (isTherapist && profile?.id && transcription.chunkCount > 0) {
      try {
        await apiFetch('/api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ therapistId: profile.id, type: 'TRANSCRIPTION', count: transcription.chunkCount, sessionId }),
        });
      } catch {}
    }
    // Kick off the end-of-session AI report while the transcript is still fresh
    // in Firestore (the cleanup cron clears transcripts after 24h). `keepalive`
    // lets the request outlive the imminent redirect; the server route runs the
    // LLM generation to completion independently of this page.
    if (isTherapist) {
      try {
        apiFetch('/api/session-report', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      } catch {}
    }
    setActiveSessionId(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const participants = sessionState?.participants || {};
  const onlineCount = Object.values(participants).filter((p) => p.isOnline).length;
  const clientParticipant = Object.values(participants).find((p) => p.role === 'client');
  const clientName = clientParticipant?.name || 'Client';

  const participantName = isTherapist ? clientName : (Object.values(participants).find((p) => p.role === 'therapist')?.name || 'Therapist');
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timerStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const userRole = isTherapist ? 'therapist' as const : 'client' as const;

  // Live-translation languages for this session. `source` is what this
  // participant speaks, `target` is what they read.
  const translationSettings = useTranslationSettings(sessionId);
  const translationPair = pairForRole(translationSettings, userRole);

  const therapistConsented = consentStatus?.therapist === true;
  const clientConsented = consentStatus?.client === true;
  const bothConsented = therapistConsented && clientConsented;
  // Dev test mode: let transcription run with just the therapist present+consented
  // so the pipeline can be verified solo (no second participant needed).
  // Solo-testing escape hatch: lets transcription run with only the therapist
  // present. It BYPASSES CLIENT CONSENT, so it is hard-gated to non-production
  // builds — leaving the flag set to true in a production environment must never
  // be able to start recording a child who has not consented.
  const sttTestMode =
    process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
    process.env.NODE_ENV !== 'production';
  const transcriptionEnabled = sttTestMode ? therapistConsented : bothConsented;
  // The transcription hook needs the LiveKit room from <StaadVideo>'s context,
  // so it must run INSIDE that provider — see <TranscriptionBridge> rendered in
  // the JSX below. We lift just the bits we display/use back up to here.
  const [transcription, setTranscription] = useState<{ isRecording: boolean; chunkCount: number }>({
    isRecording: false,
    chunkCount: 0,
  });
  // Attention scoring shares the transcription consent gate. NOTE: it does NOT
  // honour sttTestMode — that escape hatch bypasses client consent, and running
  // face tracking on someone who hasn't consented is not an acceptable
  // dev-convenience trade. Attention scoring therefore requires real consent
  // from both sides, in every environment.
  const attentionEnabled = bothConsented;
  const [attention, setAttention] = useState<AttentionState>({
    status: 'idle',
    score: null,
    faceDetected: false,
    analyzedIdentity: null,
    error: null,
  });

  // Observability for the attention feature. No UI surface is introduced here
  // (the session layout is deliberately untouched) — this just makes the score
  // and, crucially, WHICH feed produced it, visible while verifying.
  useEffect(() => {
    if (attention.status === 'idle') return;
    console.log(
      `[Attention] status=${attention.status} score=${attention.score ?? '—'} ` +
        `face=${attention.faceDetected} source=${attention.analyzedIdentity ?? 'none'}` +
        (attention.error ? ` error=${attention.error}` : '')
    );
  }, [attention]);

  // The therapist drives the sidebar from the bottom bar. The client has no
  // panel controls, so — exactly as before — the client's sidebar simply mirrors
  // whatever module the therapist has launched.
  // A SHARED board opens on the client too; a private one never does — that is
  // what "Keep Private" enforces, alongside StaadWhiteboard not syncing at all.
  const sidebarPanel: SidebarPanel = isTherapist
    ? activePanel
    : whiteboardOpenRemote && whiteboardShared
      ? 'whiteboard'
      : isModuleActive
        ? 'modules'
        : null;
  const whiteboardMode = sidebarPanel === 'whiteboard';
  // An active module now takes the wide canvas instead of the 420px sidebar, so
  // the therapist keeps the top bar, bottom bar and the other panels while it
  // runs. Skill Development modules are deliberately excluded — they use
  // SkillDevLayout's chrome-free full-screen space by design (handled above).
  const moduleMode = isModuleActive && !isSkillModule(activeModule) && !whiteboardMode;
  // Both canvas takeovers hide the thumbnail strip; the feeds move inside them.
  const canvasTakeover = whiteboardMode || moduleMode;
  const sidebarOpen = sidebarPanel !== null && !whiteboardMode;
  const selfName = profile || guestName ? displayName : 'You';

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#0d1614' }}>
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent mx-auto" style={{ borderColor: 'var(--sage-mid)', borderTopColor: 'transparent' }} />
          <p className="mt-4 font-medium" style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Joining session room...</p>
        </div>
      </div>
    );
  }

  return (
    <StaadVideo
      sessionId={sessionId}
      userName={displayName}
      role={isTherapist ? 'therapist' : 'client'}
      // Signed into the access token as participant attributes; this is how the
      // translation agent knows which STT model to run on this person's audio
      // and which language to caption them in.
      //
      // Omitted while captions are off, which is also the agent's off switch:
      // with no language attribute it skips the track entirely rather than
      // transcribing on a GPU for output nobody is showing.
      sourceLang={translationSettings.enabled ? translationPair.source : undefined}
      targetLang={translationSettings.enabled ? translationPair.target : undefined}
    >
      {/* Renders translated captions published by the translation agent on the
          lk.transcription topic. Inside the room provider, like the bridges. */}
      <CaptionOverlay enabled={translationSettings.enabled} />
      {/* Runs the Sarvam pipeline inside the room provider so it can access the
          LiveKit room; reports recording state up to this page for the chip. */}
      <TranscriptionBridge
        sessionId={sessionId}
        enabled={transcriptionEnabled}
        userRole={userRole}
        onState={setTranscription}
      />
      {/* Observes the CLIENT's incoming camera track only, in the therapist's
          browser only, and writes the score to sessions/{id}/rawSessionLog. */}
      <AttentionBridge
        sessionId={sessionId}
        enabled={attentionEnabled}
        userRole={userRole}
        onState={setAttention}
      />
      {/* Skill Development modules take over the whole room with their own
          full-canvas layout. Every other module falls through to the normal
          session room layout below, unchanged. */}
      {isSkillModule(activeModule) ? (
        <>
          <SkillDevLayout
            sessionId={sessionId}
            userRole={userRole}
            selfName={selfName}
            otherName={participantName}
            onExit={handleModuleClose}
            onEndCall={() => setShowConfirm(true)}
          >
            <SkillModuleView
              moduleId={activeModule}
              sessionId={sessionId}
              role={userRole}
              isLocked={isLocked}
            />
          </SkillDevLayout>
          {showConfirm && (
            <ConfirmEndDialog
              onCancel={() => setShowConfirm(false)}
              onConfirmed={handleLeaveSession}
            />
          )}
        </>
      ) : (
      <div style={{ width: '100vw', height: '100vh', background: RC.pageBg, overflow: 'hidden', position: 'relative', display: 'flex' }}>
        {/* ===== MAIN COLUMN ===== */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
          {/* ---- STEP 1: top bar — logo · E2E badge · spacer · timer · session info ---- */}
          <SessionTopBar
            timerStr={timerStr}
            startedAt={startTime.current}
            sessionId={sessionId}
            onlineCount={onlineCount}
            transcriptLine={
              isTherapist ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {transcriptionEnabled && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: transcription.isRecording ? RC.greenDark : RC.inkMuted,
                      }}
                    >
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: transcription.isRecording ? RC.green : RC.border, animation: transcription.isRecording ? 'pulse 1.4s ease infinite' : 'none' }} />
                      {transcription.isRecording ? `${transcription.chunkCount} lines` : 'transcript off'}
                    </div>
                  )}
                  {/* Therapist-only: turns captions on and sets who speaks what. */}
                  <TranslationControl
                    settings={translationSettings}
                    onChange={(patch) => writeTranslationSettings(sessionId, patch)}
                  />
                </div>
              ) : null
            }
          />

          {/* ---- Participant thumbnails. Hidden in whiteboard mode: both feeds
               move into the board itself as small side-by-side tiles. ---- */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {!canvasTakeover && (
              <div style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0, overflowX: 'auto', paddingBottom: 2 }}>
                {Object.values(participants).map((p) =>
                  p.uid === uid ? (
                    <LocalVideoPip key={p.uid} docked />
                  ) : (
                    <ParticipantThumb key={p.uid} name={p.name} online={p.isOnline} self={false} />
                  )
                )}
              </div>
            )}
            {canvasTakeover && <div style={{ flex: 1 }} />}

            {/* Full-screen toggle — stays at the far right regardless of mode */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, border: `1px solid ${RC.border}`, background: RC.panel, color: RC.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>

          {/* ---- Main canvas: patient video, or the whiteboard taking it over ---- */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {whiteboardMode ? (
                /* Excalidraw inside the whiteboard shell. Only the therapist can
                   close it; the client's view follows the therapist. */
                <StaadWhiteboard
                  sessionId={sessionId}
                  role={userRole}
                  isShared={whiteboardShared}
                  isLocked={isLocked}
                  selfName={selfName}
                  otherName={participantName}
                  onClose={isTherapist ? closeWhiteboard : () => {}}
                  onFullscreen={toggleFullscreen}
                />
              ) : moduleMode ? (
                <ModuleStage
                  activeModule={activeModule}
                  selfName={selfName}
                  otherName={participantName}
                  timerStr={timerStr}
                  onlineCount={onlineCount}
                  isTherapist={isTherapist}
                  isLocked={isLocked}
                  onLockToggle={handleLockToggle}
                  onClose={handleModuleClose}
                >
                  <ModuleContent
                    activeModule={activeModule}
                    sessionId={sessionId}
                    role={userRole}
                    isLocked={isLocked}
                    isTherapist={isTherapist}
                  />
                </ModuleStage>
              ) : (
                /* Rounded green video card */
                <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', background: RC.videoBg, border: `2px solid ${RC.green}`, boxShadow: `0 0 0 5px ${RC.greenSoft}, 0 18px 44px rgba(20,40,30,0.18)` }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <RemoteVideoArea participantName={participantName} />
                  </div>

                  {/* Timer pill (top-left over video) — timer + online count */}
                  <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 15, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: RC.red, display: 'inline-block' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: RC.ink, fontFamily: 'monospace' }}>{timerStr}</span>
                    <span style={{ width: 1, height: 12, background: 'rgba(0,0,0,0.12)', display: 'inline-block' }} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: RC.greenDark }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: RC.green, display: 'inline-block' }} />
                      {onlineCount} online
                    </span>
                  </div>

                  {/* Floating pill control bar — patient only. The therapist's
                      controls live in the restructured bottom bar (below). */}
                  {!isTherapist && (
                    <PillControls
                      onEndClick={() => setShowConfirm(true)}
                      reactionBarOpen={reactionBarOpen}
                      onToggleReactions={() => setReactionBarOpen((o) => !o)}
                    />
                  )}
                </div>
              )}

              <ReactionOverlay sessionId={sessionId} />

              {/* Toast notification */}
              {toast && (
                <div
                  key={toast}
                  style={{ position: 'absolute', bottom: 84, left: '50%', zIndex: 50, pointerEvents: 'none', animation: 'toastInOut 2.2s ease forwards' }}
                >
                  <div style={{ background: RC.green, color: '#fff', padding: '7px 16px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', transform: 'translateX(-50%)', boxShadow: '0 6px 18px rgba(63,174,106,0.35)' }}>
                    ✓ {toast}
                  </div>
                </div>
              )}
            </div>

            {/* ---- STEP 7: restructured bottom bar (therapist) ---- */}
            {isTherapist && (
              <SessionBottomBar
                activePanel={activePanel}
                onSelectPanel={selectPanel}
                onEndCall={() => setShowConfirm(true)}
                participantCount={onlineCount}
                reactionBarOpen={reactionBarOpen}
                onToggleReactions={() => setReactionBarOpen((o) => !o)}
                isLocked={isLocked}
                onToggleLock={handleLockToggle}
                screenSharing={screenSharing}
                onToggleScreenShare={() => setScreenSharing((s) => !s)}
              />
            )}
          </div>
        </div>

        {/* ---- STEP 2: swappable right sidebar — one of four panels, full height.
             Same 420px width for every panel type, so the Therapy Modules view
             needs no internal resizing. ---- */}
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
          {sidebarPanel === 'assistant' && (
            <AIErrorBoundary>
              <AIAssistantPanel
                insight={aiInsight}
                live={transcription.isRecording}
                analyseLoading={analyseLoading}
                analyseDisabled={!bothConsented || analyseCooldown || analyseLoading}
                onAnalyse={handleAnalyse}
                onLaunchModule={handleLaunchModule}
                onClose={() => setActivePanel(null)}
              />
            </AIErrorBoundary>
          )}

          {sidebarPanel === 'notes' && (
            <AINotesPanel
              sessionId={sessionId}
              sessionStartedAt={startTime.current}
              insight={aiInsight}
              onClose={() => setActivePanel(null)}
            />
          )}

          {/* Therapy Modules: the selector until something is launched, then the
              existing module panel — unchanged component, unchanged launch path. */}
          {/* With the live module on the canvas, the sidebar shows the selector so
              the therapist can switch activity without closing the current one.
              The old GlassModulePanel path still serves Skill Development and the
              client mirror. */}
          {sidebarPanel === 'modules' && (
            isModuleActive && !moduleMode ? (
              <GlassModulePanel
                sessionId={sessionId}
                activeModule={activeModule}
                isTherapist={isTherapist}
                isLocked={isLocked}
                onModuleSwitch={handleModuleSwitch}
                onLockToggle={handleLockToggle}
                onClose={handleModuleClose}
              />
            ) : isTherapist ? (
              <TherapyModulesPanel
                allowedModuleIds={resolveAllowedModuleIds(profile)}
                onLaunch={handleModuleLaunch}
                onClose={() => setActivePanel(null)}
              />
            ) : null
          )}
        </div>

        {/* Share Whiteboard? — first whiteboard activation */}
        {shareWhiteboardAsk && (
          <ShareWhiteboardModal
            onKeepPrivate={() => {
              setShareWhiteboardAsk(false);
              setWhiteboardShared(false);
              publishWhiteboardState(true, false);
            }}
            onShare={() => {
              setShareWhiteboardAsk(false);
              setWhiteboardShared(true);
              publishWhiteboardState(true, true);
            }}
          />
        )}

        {/* ===== AI CONSENT MODAL ===== */}
        <AIErrorBoundary>
          {showConsentBanner && (
            <AIConsentBanner
              userRole={userRole}
              onConsent={handleConsent}
              otherPartyConsented={
                userRole === 'therapist'
                  ? clientConsented
                  : therapistConsented
              }
            />
          )}
        </AIErrorBoundary>

        {/* Confirm dialog */}
        {showConfirm && (
          <ConfirmEndDialog
            onCancel={() => setShowConfirm(false)}
            onConfirmed={handleLeaveSession}
          />
        )}
      </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </StaadVideo>
  );
}

/* ===== PILL CONTROLS — mic / camera / end / react / settings =====
   The patient's floating control cluster over the video. The therapist's
   controls now live in <SessionBottomBar>. */
function PillControls({
  onEndClick,
  reactionBarOpen,
  onToggleReactions,
}: {
  onEndClick: () => void;
  reactionBarOpen: boolean;
  onToggleReactions: () => void;
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const toggleMic = () => {
    if (!localParticipant) return;
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCam = () => {
    if (!localParticipant) return;
    localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const circle = (active = false): React.CSSProperties => ({
    width: 46,
    height: 46,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    background: active ? RC.tileActive : RC.tile,
    color: active ? RC.greenDark : RC.ink,
    transition: 'all 0.15s',
  });

  const containerStyle: React.CSSProperties = { position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', boxShadow: '0 10px 30px rgba(0,0,0,0.22)' };

  return (
    <div style={containerStyle}>
      <button
        title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
        onClick={toggleMic}
        style={{ ...circle(), background: !isMicrophoneEnabled ? RC.redSoft : RC.tile, color: !isMicrophoneEnabled ? RC.red : RC.ink }}
      >
        {isMicrophoneEnabled ? <Mic size={19} /> : <MicOff size={19} />}
      </button>
      <button
        title={isCameraEnabled ? 'Stop camera' : 'Start camera'}
        onClick={toggleCam}
        style={{ ...circle(), background: !isCameraEnabled ? RC.redSoft : RC.tile, color: !isCameraEnabled ? RC.red : RC.ink }}
      >
        {isCameraEnabled ? <Camera size={19} /> : <CameraOff size={19} />}
      </button>
      <button title="Reactions" onClick={onToggleReactions} style={circle(reactionBarOpen)}>
        <Smile size={19} />
      </button>
      <button title="End call" onClick={onEndClick} style={{ ...circle(), width: 54, height: 54, background: RC.red, color: '#fff', boxShadow: '0 6px 16px rgba(255,90,95,0.4)' }}>
        <PhoneOff size={21} />
      </button>
      <button title="Settings" style={circle(false)}>
        <Settings size={19} />
      </button>
    </div>
  );
}

/* ===== PARTICIPANT THUMBNAIL — top strip ===== */
function ParticipantThumb({ name, online, self }: { name: string; online: boolean; self: boolean }) {
  return (
    <div style={{ position: 'relative', width: 200, height: 120, borderRadius: 14, flexShrink: 0, overflow: 'hidden', background: '#f3f5f8', border: `1px solid ${RC.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: RC.greenSoft, border: `2px solid ${RC.green}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: RC.greenDark, fontSize: 24, fontWeight: 600 }}>
        {name?.charAt(0)?.toUpperCase() || '?'}
      </div>
      <div style={{ position: 'absolute', bottom: 7, left: 9, display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: 600, color: RC.ink, maxWidth: 'calc(100% - 18px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? RC.green : RC.inkMuted }} />
        {self ? 'You' : name}
      </div>
    </div>
  );
}

/* ===== CONFIRM END DIALOG ===== */
function ConfirmEndDialog({
  onCancel,
  onConfirmed,
}: {
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const { disconnect } = useSessionRoom();

  const handleEnd = () => {
    disconnect();
    onConfirmed();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--glass-strong)',
          backdropFilter: 'blur(20px)',
          borderRadius: 16,
          padding: '24px 28px',
          border: '1px solid var(--glass-border)',
          maxWidth: 320,
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
          End this session?
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid var(--glass-border)',
              background: 'transparent',
              color: 'var(--ink-muted)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleEnd}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            End
          </button>
        </div>
      </div>
    </div>
  );
}
