'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  Mic, MicOff, Camera, CameraOff, PhoneOff, Settings, Smile,
  Maximize2, Minimize2, Users, X, GripHorizontal,
} from 'lucide-react';
import AIConsentBanner from '@/components/session/AIConsentBanner';
import { AIErrorBoundary } from '@/components/session/AIErrorBoundary';
import { useSessionTranscription } from '@/hooks/useSessionTranscription';
import { useAttentionScoring, type AttentionState } from '@/hooks/useAttentionScoring';
import { useVideoFrameStyle } from '@/hooks/useVideoTrackDimensions';
import { useLocalParticipant, useTracks, VideoTrack, type TrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import StaadVideo, { useSessionRoom } from '@/components/StaadVideo';
import RemoteVideoArea from '@/components/RemoteVideoArea';
import LocalVideoPip from '@/components/LocalVideoPip';
import ConnectionQualityBadge from '@/components/session/ConnectionQualityBadge';
import VideoStatsBadge from '@/components/session/VideoStatsBadge';
import { SkillModuleView } from '@/components/GlassModulePanel';
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
import AIAssistantPopup from '@/components/session/AIAssistantPopup';
import AINotesPopup from '@/components/session/AINotesPopup';
import TherapyModulesPanel from '@/components/session/TherapyModulesPanel';
import { ShareWhiteboardModal } from '@/components/session/WhiteboardStage';
import StaadWhiteboard from '@/components/session/StaadWhiteboard';
import ModuleStage from '@/components/session/ModuleStage';
import { ModuleContent } from '@/components/GlassModulePanel';
import { apiFetch } from '@/lib/api';

interface SessionState {
  sessionId: string;
  activeModuleId: string | null;
  status?: string;
  participants: Record<string, { uid: string; name: string; role: string; isOnline: boolean }>;
  timestamps: { createdAt: string; updatedAt: string };
}

/* The room colour palette now lives in components/session/roomTheme.ts (same
   values) so the top bar, bottom bar and the swappable panels share one source. */

// How long the client sees the session-ended details before the window closes.
const CLIENT_CLOSE_SECONDS = 10;

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
  const [sessionEnded, setSessionEnded] = useState(false);
  const [endedSession, setEndedSession] = useState<{
    clientName: string; therapistName: string; scheduledAt?: string; startedAt?: string; endedAt?: string;
  } | null>(null);
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());
  const [showConfirm, setShowConfirm] = useState(false);
  const [isModuleActive, setIsModuleActive] = useState(false);

  /* ---- Swappable right sidebar: one of four panels, or none ---- */
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [showModulesPopup, setShowModulesPopup] = useState(false);
  // AI Assistant & AI Notes are now floating popups instead of sidebar panels
  const [showAssistantPopup, setShowAssistantPopup] = useState(false);
  const [showNotesPopup, setShowNotesPopup] = useState(false);
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
    // Modules / Assistant / Notes clear activePanel, which hides the board
    // locally — tell the client too, or it stays stuck on the whiteboard.
    if (panel !== 'whiteboard' && activePanel === 'whiteboard') {
      publishWhiteboardState(false, whiteboardShared);
    }
    if (panel === 'modules') {
      setShowModulesPopup((open) => !open);
      setActivePanel(null);
      return;
    }
    setShowModulesPopup(false);

    // AI Assistant and Notes are now floating popups — toggle them independently.
    if (panel === 'assistant') {
      setShowAssistantPopup((open) => !open);
      setActivePanel(null);
      return;
    }
    if (panel === 'notes') {
      setShowNotesPopup((open) => !open);
      setActivePanel(null);
      return;
    }

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
  // Participant thumbnails live in a floating popup instead of a fixed strip.
  const [showParticipants, setShowParticipants] = useState(false);
  // Draggable popup position (viewport px). null = not placed yet; it gets a
  // default top-right spot the first time it opens, then remembers where it was dragged.
  const [participantsPos, setParticipantsPos] = useState<{ x: number; y: number } | null>(null);
  const participantsDrag = useRef<{ dx: number; dy: number } | null>(null);
  const participantsPanelRef = useRef<HTMLDivElement>(null);
  // Resizable popup: the tile width drives every tile (height keeps a 5:3 ratio).
  const [participantTileW, setParticipantTileW] = useState(200);
  const participantsResize = useRef<{ x: number; y: number; w: number } | null>(null);
  const PARTICIPANT_TILE_MIN = 140;
  const PARTICIPANT_TILE_MAX = 640;
  const participantTileH = Math.round(participantTileW * 0.6);

  // Client-side participants popup (mirrors doctor side but with swapped video roles):
  // - client's own video stays fixed; doctor's video is resizable.
  const [showParticipantsClient, setShowParticipantsClient] = useState(false);
  const [participantsPosClient, setParticipantsPosClient] = useState<{ x: number; y: number } | null>(null);
  const participantsDragClient = useRef<{ dx: number; dy: number } | null>(null);
  const participantsPanelRefClient = useRef<HTMLDivElement>(null);
  const [participantTileWClient, setParticipantTileWClient] = useState(200);
  const participantTileHClient = Math.round(participantTileWClient * 0.6);
  const PARTICIPANT_TILE_MIN_CLIENT = 140;
  const PARTICIPANT_TILE_MAX_CLIENT = 640;

  const onParticipantsResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    participantsResize.current = { x: e.clientX, y: e.clientY, w: participantTileW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onParticipantsResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = participantsResize.current;
    if (!r || !participantsPos) return;
    const dx = e.clientX - r.x;
    const dyAsW = (e.clientY - r.y) / 0.6; // vertical drag, converted to width
    const delta = Math.abs(dx) >= Math.abs(dyAsW) ? dx : dyAsW;
    // Don't let the popup grow past the right edge of the screen.
    const maxByViewport = window.innerWidth - participantsPos.x - 22 - 8;
    setParticipantTileW(
      Math.round(Math.min(Math.max(PARTICIPANT_TILE_MIN, r.w + delta), PARTICIPANT_TILE_MAX, maxByViewport))
    );
  };
  const onParticipantsResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    participantsResize.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Client-side resize handle start.
  const onParticipantsResizeStartClient = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    participantsResize.current = { x: e.clientX, y: e.clientY, w: participantTileWClient };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onParticipantsResizeMoveClient = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = participantsResize.current;
    if (!r || !participantsPosClient) return;
    const dx = e.clientX - r.x;
    const dyAsW = (e.clientY - r.y) / 0.6; // vertical drag, converted to width
    const delta = Math.abs(dx) >= Math.abs(dyAsW) ? dx : dyAsW;
    // Don't let the popup grow past the right edge of the screen.
    const maxByViewport = window.innerWidth - participantsPosClient.x - 22 - 8;
    setParticipantTileWClient(
      Math.round(Math.min(Math.max(PARTICIPANT_TILE_MIN_CLIENT, r.w + delta), PARTICIPANT_TILE_MAX_CLIENT, maxByViewport))
    );
  };
  const onParticipantsResizeEndClient = (e: React.PointerEvent<HTMLDivElement>) => {
    participantsResize.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Client-side drag handle start.
  const onParticipantsDragStartClient = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // let the close button click
    if (!participantsPosClient) return;
    participantsDragClient.current = { dx: e.clientX - participantsPosClient.x, dy: e.clientY - participantsPosClient.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onParticipantsDragMoveClient = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = participantsDragClient.current;
    if (!d) return;
    setParticipantsPosClient(clampToViewportClient(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onParticipantsDragEndClient = (e: React.PointerEvent<HTMLDivElement>) => {
    participantsDragClient.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const clampToViewportClient = (x: number, y: number) => {
    const el = participantsPanelRefClient.current;
    const w = el?.offsetWidth ?? participantTileWClient + 22;
    const h = el?.offsetHeight ?? 160;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  };

  const clampToViewport = (x: number, y: number) => {
    const el = participantsPanelRef.current;
    const w = el?.offsetWidth ?? participantTileW + 22;
    const h = el?.offsetHeight ?? 160;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  };

  const toggleParticipants = () => {
    if (!showParticipants && !participantsPos) {
      setParticipantsPos({ x: window.innerWidth - participantTileW - 22 - 24, y: 110 });
    }
    setShowParticipants((v) => !v);
  };

  const toggleParticipantsClient = () => {
    if (!showParticipantsClient && !participantsPosClient) {
      setParticipantsPosClient({ x: window.innerWidth - participantTileWClient - 22 - 24, y: 110 });
    }
    setShowParticipantsClient((v) => !v);
  };

  const onParticipantsDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // let the close button click
    if (!participantsPos) return;
    participantsDrag.current = { dx: e.clientX - participantsPos.x, dy: e.clientY - participantsPos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onParticipantsDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = participantsDrag.current;
    if (!d) return;
    setParticipantsPos(clampToViewport(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onParticipantsDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    participantsDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Keep the popup on-screen when the window is resized / full-screen toggles.
  useEffect(() => {
    if (!showParticipants) return;
    const onResize = () => setParticipantsPos((p) => (p ? clampToViewport(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showParticipants]);

  // Keep the client-side popup on-screen when the window is resized / full-screen toggles.
  useEffect(() => {
    if (!showParticipantsClient) return;
    const onResize = () => setParticipantsPosClient((p) => (p ? clampToViewport(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showParticipantsClient]);

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
    setShowModulesPopup(false);
    setActivePanel(null);
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
          // The other participant ended the call → leave the room and show details.
          if (data.status === 'ended' && !isTherapist) {
            setSessionEnded(true);
          }
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
        // The client shows the whiteboard ahead of any module, so launching a
        // module must also take the board down for them.
        whiteboard: { active: false, shared: whiteboardShared },
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
    setShowModulesPopup(false);
    setActivePanel(null);
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

  const handleLeaveSession = () => {
    // Leave FIRST, clean up in the background. Every call below is
    // fire-and-forget: on slow/offline networks awaiting them can hang for a
    // long time (Firestore queues writes while offline; the PATCH hits Prisma
    // + Google provisioning), which made the End call button look dead.
    if (uid) {
      updateDoc(doc(db, 'liveSessions', sessionId), {
        [`participants.${uid}.isOnline`]: false,
        status: 'ended',
        'timestamps.updatedAt': new Date().toISOString(),
      }).catch(() => {});
    }
    // Mark the scheduled session as COMPLETED in the database so it moves into
    // the client's session history once the call is cut. `keepalive` lets the
    // request finish even while the browser navigates away below.
    apiFetch(`/api/sessions/${sessionId}?action=end`, {
      method: 'PATCH',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end' }),
    }).catch(() => {});
    // Log transcription volume for the admin dashboard (therapist side, best-effort).
    if (isTherapist && profile?.id && transcription.chunkCount > 0) {
      apiFetch('/api/usage', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ therapistId: profile.id, type: 'TRANSCRIPTION', count: transcription.chunkCount, sessionId }),
      }).catch(() => {});
    }
    // Kick off the end-of-session AI report while the transcript is still fresh
    // in Firestore (the cleanup cron clears transcripts after 24h). `keepalive`
    // lets the request outlive the imminent redirect; the server route runs the
    // LLM generation to completion independently of this page.
    if (isTherapist) {
      apiFetch('/api/session-report', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    setActiveSessionId(null);
    if (typeof window !== 'undefined') {
      // Guests (anonymous sign-in via invite link) have no dashboard to go
      // back to — sign the throwaway account out and land on the login page.
      if (auth.currentUser?.uid?.startsWith('guest:')) {
        auth.signOut().catch(() => {});
        window.location.href = '/auth';
      } else {
        window.location.href = '/';
      }
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
  // The participants popup stays available in module mode (it is the only place
  // the feeds show there); whiteboard also keeps it available so participants
  // can be viewed in the draggable popup alongside the board.
  const participantsPopupAvailable = true;
  const sidebarOpen = sidebarPanel !== null && sidebarPanel !== 'modules' && sidebarPanel !== 'assistant' && sidebarPanel !== 'notes' && !whiteboardMode;
  const selfName = profile || guestName ? displayName : 'You';

  // Doctor side: auto-open the participants popup so the client's live video is
  // always in view: once when the room loads, and again whenever a module
  // starts (the module takes the main canvas, so the popup is the only place the
  // client's feed shows). The doctor can still move or close it.
  useEffect(() => {
    if (!isTherapist || loading || !participantsPopupAvailable) return;
    setParticipantsPos((p) => p ?? { x: window.innerWidth - participantTileW - 22 - 24, y: 110 });
    setShowParticipants(true);
  }, [isTherapist, loading, moduleMode, participantsPopupAvailable]);

  // Client side: auto-open the participants popup so the therapist's video is
  // always in view. The client can still move or close it.
  useEffect(() => {
    if (isTherapist || loading || !participantsPopupAvailable) return;
    setParticipantsPosClient((p) => p ?? { x: window.innerWidth - participantTileWClient - 22 - 24, y: 110 });
    setShowParticipantsClient(true);
  }, [isTherapist, loading, moduleMode, participantsPopupAvailable]);

  // When the doctor ends the session, pull the session row once to show details.
  useEffect(() => {
    if (!sessionEnded) return;
    apiFetch(`/api/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.session) return;
        const s = d.session;
        setEndedSession({
          clientName: s.client ? `${s.client.firstName ?? ''} ${s.client.lastName ?? ''}`.trim() : 'Client',
          therapistName: s.therapist ? `${s.therapist.firstName ?? ''} ${s.therapist.lastName ?? ''}`.trim() : 'Therapist',
          scheduledAt: s.scheduledAt,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        });
      })
      .catch(() => {});
  }, [sessionEnded, sessionId]);

  // For client: show the session details, then close the window after a
  // countdown. For therapist: the session-ended screen stays up until "Done".
  // Must sit above the early returns — hooks can't be called conditionally.
  const [closeIn, setCloseIn] = useState(CLIENT_CLOSE_SECONDS);
  useEffect(() => {
    if (!sessionEnded || isTherapist) return;
    const interval = setInterval(() => setCloseIn((s) => Math.max(0, s - 1)), 1000);
    const timer = setTimeout(() => {
      window.close();
      // Fallback if window.close() doesn't work (not opened by JS)
      if (auth.currentUser?.uid?.startsWith('guest:')) {
        auth.signOut().catch(() => {});
        window.location.href = '/auth';
      } else {
        window.location.href = '/';
      }
    }, CLIENT_CLOSE_SECONDS * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [sessionEnded, isTherapist]);

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

  if (sessionEnded) {
    const mins =
      endedSession?.startedAt && endedSession?.endedAt
        ? Math.max(0, Math.round((new Date(endedSession.endedAt).getTime() - new Date(endedSession.startedAt).getTime()) / 60000))
        : null;

    const done = () => {
      if (auth.currentUser?.uid?.startsWith('guest:')) {
        auth.signOut().catch(() => {});
        window.location.href = '/auth';
      } else {
        window.location.href = '/';
      }
    };

    return (
      <div className="flex h-screen w-screen items-center justify-center px-4" style={{ background: '#0d1614' }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h1 className="text-xl font-semibold" style={{ color: '#fff' }}>Session ended</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
            The therapist has ended the session. Here are the details:
          </p>
          {endedSession && (
            <dl className="mt-6 space-y-3 text-left text-sm" style={{ color: 'var(--ink-muted)' }}>
              <div className="flex justify-between"><dt>Client</dt><dd style={{ color: '#fff' }}>{endedSession?.clientName ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Therapist</dt><dd style={{ color: '#fff' }}>{endedSession?.therapistName ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Date</dt><dd style={{ color: '#fff' }}>{endedSession?.scheduledAt ? new Date(endedSession.scheduledAt).toLocaleString() : '—'}</dd></div>
              <div className="flex justify-between"><dt>Duration</dt><dd style={{ color: '#fff' }}>{mins != null ? `${mins} min` : '—'}</dd></div>
            </dl>
          )}
          <button
            onClick={done}
            className="mt-8 w-full rounded-xl py-3 font-semibold"
            style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}
          >
            {isTherapist ? 'Done' : 'Close'}
          </button>
          {!isTherapist && (
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
              This window will close in {closeIn}s
            </p>
          )}
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
            // Timer action handlers
            onToggleParticipants={isTherapist ? toggleParticipants : toggleParticipantsClient}
            showParticipants={isTherapist ? showParticipants : showParticipantsClient}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            isTherapist={isTherapist}
            participantsPopupAvailable={participantsPopupAvailable}
            participantsCount={Object.keys(participants).length}
          />

            {isTherapist && participantsPopupAvailable && showParticipants && participantsPos && (
              <div
                ref={participantsPanelRef}
                style={{ position: 'fixed', left: participantsPos.x, top: participantsPos.y, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, maxHeight: 'calc(100vh - 16px)', background: RC.panel, border: `1px solid ${RC.border}`, borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}
              >
                {/* Drag handle — grab the header to move the popup */}
                <div
                  onPointerDown={onParticipantsDragStart}
                  onPointerMove={onParticipantsDragMove}
                  onPointerUp={onParticipantsDragEnd}
                  onPointerCancel={onParticipantsDragEnd}
                  title="Drag to move"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: RC.ink, padding: '2px 2px', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GripHorizontal size={15} color={RC.inkMuted} />
                    Participants
                  </span>
                  <button
                    onClick={() => setShowParticipants(false)}
                    title="Close"
                    style={{ border: 'none', background: 'transparent', color: RC.inkMuted, cursor: 'pointer', display: 'flex', padding: 2 }}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto' }}>
                  {Object.values(participants).map((p) =>
                    p.uid === uid ? (
                      // Doctor: resizing only grows/shrinks the CLIENT's tile; the
                      // doctor's own self-view stays at the default small size.
                      <LocalVideoPip
                        key={p.uid}
                        docked
                        width={isTherapist ? 200 : participantTileW}
                        height={isTherapist ? 120 : participantTileH}
                      />
                    ) : (
                      <RemoteParticipantThumb key={p.uid} name={p.name} online={p.isOnline} width={participantTileW} height={participantTileH} />
                    )
                  )}
                </div>

                {/* Resize handle — drag the bottom-right corner to resize */}
                <div
                  onPointerDown={onParticipantsResizeStart}
                  onPointerMove={onParticipantsResizeMove}
                  onPointerUp={onParticipantsResizeEnd}
                  onPointerCancel={onParticipantsResizeEnd}
                  onDoubleClick={() => setParticipantTileW(200)}
                  title="Drag to resize (double-click to reset)"
                  style={{ position: 'absolute', right: 2, bottom: 2, width: 18, height: 18, cursor: 'nwse-resize', touchAction: 'none', zIndex: 2, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3 }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: 'block' }}>
                    <path d="M9 1L1 9M9 5L5 9" stroke={RC.inkMuted} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            )}

            {/* Client-side participants popup (mirrors doctor side but with swapped video roles):
               - client's own video stays fixed; doctor's video is resizable.
               - client can drag to move and resize the doctor's video tile. */}
            {(!isTherapist && participantsPopupAvailable && showParticipantsClient && participantsPosClient) && (
              <div
                ref={participantsPanelRefClient}
                style={{ position: 'fixed', left: participantsPosClient.x, top: participantsPosClient.y, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, maxHeight: 'calc(100vh - 16px)', background: RC.panel, border: `1px solid ${RC.border}`, borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}
              >
                {/* Drag handle — grab the header to move the popup */}
                <div
                  onPointerDown={onParticipantsDragStartClient}
                  onPointerMove={onParticipantsDragMoveClient}
                  onPointerUp={onParticipantsDragEndClient}
                  onPointerCancel={onParticipantsDragEndClient}
                  title="Drag to move"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: RC.ink, padding: '2px 2px', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GripHorizontal size={15} color={RC.inkMuted} />
                    Participants
                  </span>
                  <button
                    onClick={() => setShowParticipantsClient(false)}
                    title="Close"
                    style={{ border: 'none', background: 'transparent', color: RC.inkMuted, cursor: 'pointer', display: 'flex', padding: 2 }}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto' }}>
                  {Object.values(participants).map((p) =>
                    p.uid === uid ? (
                      // Client: own video stays fixed; doctor's video is resizable.
                      <LocalVideoPip
                        key={p.uid}
                        docked
                        width={200}
                        height={120}
                      />
                    ) : (
                      <RemoteParticipantThumb
                        key={p.uid}
                        name={p.name}
                        online={p.isOnline}
                        width={participantTileWClient}
                        height={participantTileHClient}
                      />
                    )
                  )}
                </div>

                {/* Resize handle — drag the bottom-right corner to resize doctor's video */}
                <div
                  onPointerDown={onParticipantsResizeStartClient}
                  onPointerMove={onParticipantsResizeMoveClient}
                  onPointerUp={onParticipantsResizeEndClient}
                  onPointerCancel={onParticipantsResizeEndClient}
                  title="Drag to resize doctor's video (double-click to reset)"
                  style={{ position: 'absolute', right: 2, bottom: 2, width: 18, height: 18, cursor: 'nwse-resize', touchAction: 'none', zIndex: 2, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3 }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: 'block' }}>
                    <path d="M9 1L1 9M9 5L5 9" stroke={RC.inkMuted} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            )}

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
                  onEndCall={() => setShowConfirm(true)}
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
                  onEndCall={() => setShowConfirm(true)}
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

              <ReactionOverlay sessionId={sessionId} open={reactionBarOpen} onOpenChange={setReactionBarOpen} />

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
                modulesOpen={showModulesPopup}
                onToggleModules={() => selectPanel('modules')}
                onEndCall={() => setShowConfirm(true)}
                reactionBarOpen={reactionBarOpen}
                onToggleReactions={() => setReactionBarOpen((o) => !o)}
                isLocked={isLocked}
                onToggleLock={handleLockToggle}
                screenSharing={screenSharing}
                onToggleScreenShare={() => setScreenSharing((s) => !s)}
                showBackToVideo={whiteboardMode || moduleMode}
                onBackToVideo={() => (whiteboardMode ? closeWhiteboard() : handleModuleClose())}
              />
            )}
          </div>
        </div>

        {/* ---- STEP 2: swappable right sidebar — now only used for whiteboard if needed ---- */}
        {/* AI Assistant Popup — floating, draggable */}
        {showAssistantPopup && (
          <AIErrorBoundary>
            <AIAssistantPopup
              insight={aiInsight}
              live={transcription.isRecording}
              analyseLoading={analyseLoading}
              analyseDisabled={!bothConsented || analyseCooldown || analyseLoading}
              onAnalyse={handleAnalyse}
              onLaunchModule={handleLaunchModule}
              onClose={() => setShowAssistantPopup(false)}
            />
          </AIErrorBoundary>
        )}

        {/* AI Notes Popup — floating, draggable */}
        {showNotesPopup && (
          <AINotesPopup
            sessionId={sessionId}
            sessionStartedAt={startTime.current}
            insight={aiInsight}
            initialPosition={{ x: 820, y: 140 }}
            onClose={() => setShowNotesPopup(false)}
          />
        )}

        {isTherapist && showModulesPopup && (
          <TherapyModulesPanel
            allowedModuleIds={resolveAllowedModuleIds(profile)}
            onLaunch={handleModuleLaunch}
            onClose={() => setShowModulesPopup(false)}
          />
        )}

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
function ParticipantThumb({ name, online, self, width = 200, height = 120 }: { name: string; online: boolean; self: boolean; width?: number; height?: number }) {
  return (
    <div style={{ position: 'relative', width, height, borderRadius: 14, flexShrink: 0, overflow: 'hidden', background: '#f3f5f8', border: `1px solid ${RC.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

/* ===== REMOTE PARTICIPANT TILE — participants popup =====
   Shows the participant's live camera when we can find it, otherwise falls back
   to the initial-letter thumbnail. LiveKit identities are display names (see
   backend /api/livekit-token), so we match on name; if that fails and there is
   exactly one remote camera (the normal 1:1 session), we use that one.
   Shows VideoStatsBadge (resolution, fps, bitrate) on hover — same as doctor side.
   Auto-resizes to match incoming video's actual aspect ratio. */
function RemoteParticipantThumb({ name, online, width = 200, height = 120 }: { name: string; online: boolean; width?: number; height?: number }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], { onlySubscribed: true });
  const remote = tracks.filter((t) => !t.participant.isLocal);
  const track =
    remote.find((t) => t.participant.identity === name || t.participant.name === name) ??
    (remote.length === 1 ? remote[0] : undefined);

  const [hover, setHover] = useState(false);
  
  // Auto-resize frame to match incoming video's actual aspect ratio
  const videoStyle = useVideoFrameStyle(track as TrackReference | undefined, width / height);

  if (!track) return <ParticipantThumb name={name} online={online} self={false} width={width} height={height} />;

  return (
    <div
      style={{ position: 'relative', width, flexShrink: 0, overflow: 'hidden', background: 'linear-gradient(135deg, #1a2e28, #142420)', border: `2px solid ${RC.green}`, borderRadius: 14 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={videoStyle}>
        <VideoTrack trackRef={track as TrackReference} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <ConnectionQualityBadge participant={track.participant} style={{ position: 'absolute', top: 6, right: 7 }} />
      {hover && (
        <VideoStatsBadge
          track={track.publication?.track}
          style={{ position: 'absolute', top: 6, right: 42, zIndex: 2 }}
        />
      )}
      <div style={{ position: 'absolute', bottom: 7, left: 9, display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: 600, color: RC.ink, maxWidth: 'calc(100% - 18px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? RC.green : RC.inkMuted }} />
        {name}
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
