'use client'

/*
 * DEV-ONLY preview route for the Skill Development modules.
 *
 * Renders each module in isolation with mock props so the visuals can be
 * inspected/screenshotted without Firebase auth, a live session, or a peer.
 * Gated behind NODE_ENV === 'development' — it 404s in production builds and
 * is not linked from any navigation.
 *
 * The modules read their scenario/level from Firestore (liveSessions/<id>),
 * so the scenario picker writes to a throwaway 'preview-session' doc that the
 * mounted module listens to. Role and isLocked are plain React props.
 */

import { useEffect, useRef, useState } from 'react'
import { notFound } from 'next/navigation'
import { Room } from 'livekit-client'
import { RoomContext } from '@livekit/components-react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import SkillDevLayout from '@/components/session/SkillDevLayout'
import StoryChoiceAdventure from '@/components/modules/skill/StoryChoiceAdventure'
import BuildTogether from '@/components/modules/skill/BuildTogether'
import TreasureQuest from '@/components/modules/skill/TreasureQuest'
import EmotionDetective from '@/components/modules/skill/EmotionDetective'

const SESSION_ID = 'preview-session'

type Role = 'therapist' | 'client'
type ModuleDef = {
  key: string
  name: string
  prefix: string
  Comp: React.ComponentType<{ sessionId: string; role: Role; isLocked: boolean }>
}

const MODULES: ModuleDef[] = [
  { key: 'sca', name: 'Story Choice Adventure', prefix: 'sca', Comp: StoryChoiceAdventure },
  { key: 'bt', name: 'Build Together', prefix: 'bt', Comp: BuildTogether },
  { key: 'tq', name: 'Treasure Quest', prefix: 'tq', Comp: TreasureQuest },
  { key: 'ed', name: 'Emotion Detective', prefix: 'ed', Comp: EmotionDetective },
]

// All four modules share the same scenario id scheme.
const SCENARIO_IDS: string[] = [
  ...Array.from({ length: 10 }, (_, i) => `easy_${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `mod_${i + 11}`),
  ...Array.from({ length: 10 }, (_, i) => `adv_${i + 21}`),
]

const levelFor = (id: string) =>
  id.startsWith('easy') ? 'easy' : id.startsWith('mod') ? 'moderate' : 'advanced'

export default function SkillModulesPreviewPage() {
  // Dev-only gate — statically eliminated in production, so hook order stays stable.
  if (process.env.NODE_ENV !== 'development') notFound()

  const [mounted, setMounted] = useState(false)
  const roomRef = useRef<Room | null>(null)

  const [role, setRole] = useState<Role>('therapist')
  const [isLocked, setIsLocked] = useState(false)
  const [moduleKey, setModuleKey] = useState('sca')
  const [scenarioId, setScenarioId] = useState('easy_1')

  // Create the (never-connected) LiveKit Room client-side only, so SkillDevLayout's
  // useTracks()/useLocalParticipant() hooks have a context to read from.
  // Also seed initial module/scenario/role from URL params (for headless capture).
  useEffect(() => {
    if (!roomRef.current) roomRef.current = new Room()
    const q = new URLSearchParams(window.location.search)
    const m = q.get('module')
    const s = q.get('scenario')
    const r = q.get('role')
    if (m && MODULES.some((x) => x.key === m)) setModuleKey(m)
    if (s && SCENARIO_IDS.includes(s)) setScenarioId(s)
    if (r === 'therapist' || r === 'client') setRole(r)
    setMounted(true)
    return () => {
      roomRef.current?.disconnect()
    }
  }, [])

  // Drive the selected scenario into the preview Firestore doc so the mounted
  // module (which listens via onSnapshot) jumps straight to it.
  useEffect(() => {
    if (!mounted) return
    const mod = MODULES.find((m) => m.key === moduleKey)
    if (!mod) return
    const p = mod.prefix
    const state: Record<string, unknown> = {
      [`${p}CurrentScenarioId`]: scenarioId,
      [`${p}Level`]: levelFor(scenarioId),
      [`${p}Language`]: 'both',
    }
    // Reset per-module interaction flags so the fresh scenario shows cleanly.
    if (p === 'sca') { state.scaSelectedChoice = null; state.scaLevelComplete = false }
    if (p === 'ed') { state.edSelectedEmotion = null; state.edAnswerRevealed = false; state.edLevelComplete = false }
    if (p === 'bt') { state.btFilledSlots = {}; state.btCompleted = false }
    if (p === 'tq') { state.tqCompleted = false; state.tqRevealedHotspots = [] }

    setDoc(
      doc(db, 'liveSessions', SESSION_ID),
      { moduleState: state, timestamps: { updatedAt: new Date().toISOString() } },
      { merge: true }
    ).catch(() => {
      /* Firestore may be unreachable/unauthenticated in preview — the module
         still renders its default scenario, which is fine for inspection. */
    })
  }, [mounted, moduleKey, scenarioId])

  if (!mounted || !roomRef.current) {
    return <div style={{ padding: 24, fontFamily: 'system-ui', color: '#333' }}>Loading preview…</div>
  }

  const mod = MODULES.find((m) => m.key === moduleKey)!
  const Comp = mod.Comp

  const ctrlBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: '1px solid ' + (active ? '#4a7c6f' : 'rgba(255,255,255,0.25)'),
    background: active ? 'rgba(74,124,111,0.5)' : 'rgba(255,255,255,0.08)',
    color: '#fff',
  })

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Dev control bar */}
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100000,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
          padding: '6px 12px', background: 'rgba(12,20,18,0.92)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.12)', fontFamily: 'system-ui',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: '#ffcf7a', letterSpacing: 0.4 }}>
          DEV PREVIEW
        </span>

        {/* Module selector */}
        <select
          value={moduleKey}
          onChange={(e) => { setModuleKey(e.target.value); setScenarioId('easy_1') }}
          style={{ padding: '4px 8px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: '#1c2a26', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
        >
          {MODULES.map((m) => (
            <option key={m.key} value={m.key}>{m.name}</option>
          ))}
        </select>

        {/* Scenario picker */}
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Scenario</label>
        <select
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: '#1c2a26', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
        >
          {SCENARIO_IDS.map((id) => (
            <option key={id} value={id}>{id} ({levelFor(id)})</option>
          ))}
        </select>

        {/* Role toggle */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
          <button onClick={() => setRole('therapist')} style={ctrlBtn(role === 'therapist')}>Therapist</button>
          <button onClick={() => setRole('client')} style={ctrlBtn(role === 'client')}>Client</button>
        </div>

        {/* Locked toggle */}
        <button onClick={() => setIsLocked((v) => !v)} style={ctrlBtn(isLocked)}>
          {isLocked ? 'Locked' : 'Unlocked'}
        </button>
      </div>

      {/* Module rendered inside its real SkillDevLayout wrapper. The Room in
          context is never connected, so the video pills show name placeholders. */}
      <RoomContext.Provider value={roomRef.current}>
        <SkillDevLayout
          sessionId={SESSION_ID}
          userRole={role}
          selfName={role === 'therapist' ? 'Therapist' : 'Child'}
          otherName={role === 'therapist' ? 'Child' : 'Therapist'}
          onExit={() => {}}
          onEndCall={() => {}}
        >
          <Comp sessionId={SESSION_ID} role={role} isLocked={isLocked} />
        </SkillDevLayout>
      </RoomContext.Provider>
    </div>
  )
}
