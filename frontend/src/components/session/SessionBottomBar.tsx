'use client'
import { useLocalParticipant } from '@livekit/components-react'
import {
  Mic, MicOff, Camera, CameraOff, PhoneOff, ChevronUp,
  MonitorUp, NotebookPen, PenTool, Blocks, Users, Settings,
  Smile, Lock, LockOpen, Sparkles,
} from 'lucide-react'
import { RC } from './roomTheme'
import type { SidebarPanel } from './sessionPanels'

// Therapist bottom bar.
//   [End Call] [Mic ▾] [Camera ▾]   ···   [Screen Share] [AI Assistant] [AI Notes]
//   [Whiteboard] [Therapy Modules] [Participants 2] [Reactions] [Control] [Settings]
//
// Mic/camera use the same LiveKit toggles as before; the dropdown chevrons are
// visual affordances only (device switching is not wired up). Screen share is a
// UI toggle placeholder — no screen-share implementation exists in the codebase
// to reuse. Reactions and Control (therapist lock) are carried over from the
// previous toolbar so no existing feature is lost.
export default function SessionBottomBar({
  activePanel,
  onSelectPanel,
  onEndCall,
  participantCount,
  reactionBarOpen,
  onToggleReactions,
  isLocked,
  onToggleLock,
  screenSharing,
  onToggleScreenShare,
}: {
  activePanel: SidebarPanel
  onSelectPanel: (panel: Exclude<SidebarPanel, null>) => void
  onEndCall: () => void
  participantCount: number
  reactionBarOpen: boolean
  onToggleReactions: () => void
  isLocked: boolean
  onToggleLock: () => void
  screenSharing: boolean
  onToggleScreenShare: () => void
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  const circle = (opts?: { danger?: boolean; off?: boolean }): React.CSSProperties => ({
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    background: opts?.danger ? RC.red : opts?.off ? RC.redSoft : RC.tile,
    color: opts?.danger ? '#fff' : opts?.off ? RC.red : RC.ink,
    transition: 'all 0.15s',
  })

  // Active = the panel this button controls is the one currently open.
  const item = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    minWidth: 62,
    padding: '7px 8px',
    borderRadius: 14,
    border: `1px solid ${active ? RC.green : RC.border}`,
    background: active ? RC.tileActive : RC.tile,
    color: active ? RC.greenDark : RC.ink,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  })

  const chevron = (
    <ChevronUp
      size={10}
      style={{ position: 'absolute', bottom: 2, right: 4, color: RC.inkMuted, pointerEvents: 'none' }}
    />
  )

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 18,
        background: RC.panel,
        border: `1px solid ${RC.border}`,
        boxShadow: '0 6px 18px rgba(20,30,40,0.05)',
        overflowX: 'auto',
      }}
    >
      {/* ---- LEFT: end call / mic / camera ---- */}
      <button title="End call" onClick={onEndCall} style={circle({ danger: true })}>
        <PhoneOff size={19} />
      </button>

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          onClick={() => localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
          style={circle({ off: !isMicrophoneEnabled })}
        >
          {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        {chevron}
      </div>

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          title={isCameraEnabled ? 'Stop camera' : 'Start camera'}
          onClick={() => localParticipant?.setCameraEnabled(!isCameraEnabled)}
          style={circle({ off: !isCameraEnabled })}
        >
          {isCameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}
        </button>
        {chevron}
      </div>

      <div style={{ width: 1, height: 30, background: RC.border, flexShrink: 0 }} />

      {/* ---- CENTRE/RIGHT: panel toggles + utilities ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' }}>
        <button
          onClick={onToggleScreenShare}
          title="Screen share (placeholder)"
          style={item(screenSharing)}
        >
          <MonitorUp size={17} /> Share
        </button>

        <button onClick={() => onSelectPanel('assistant')} style={item(activePanel === 'assistant')}>
          <Sparkles size={17} /> AI Assistant
        </button>

        <button onClick={() => onSelectPanel('notes')} style={item(activePanel === 'notes')}>
          <NotebookPen size={17} /> AI Notes
        </button>

        <button onClick={() => onSelectPanel('whiteboard')} style={item(activePanel === 'whiteboard')}>
          <PenTool size={17} /> Whiteboard
        </button>

        <button onClick={() => onSelectPanel('modules')} style={item(activePanel === 'modules')}>
          <Blocks size={17} /> Modules
        </button>

        <button title="Participants" style={item(false)}>
          <Users size={17} /> Participants
          <span
            style={{
              position: 'absolute',
              top: 3,
              right: 5,
              minWidth: 17,
              height: 17,
              padding: '0 4px',
              borderRadius: 9,
              background: RC.green,
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {participantCount}
          </span>
        </button>

        <button onClick={onToggleReactions} title="Reactions" style={item(reactionBarOpen)}>
          <Smile size={17} /> React
        </button>

        <button onClick={onToggleLock} title="Therapist control" style={item(isLocked)}>
          {isLocked ? <Lock size={17} /> : <LockOpen size={17} />} Control
        </button>

        <button title="Settings" style={item(false)}>
          <Settings size={17} /> Settings
        </button>
      </div>
    </div>
  )
}
