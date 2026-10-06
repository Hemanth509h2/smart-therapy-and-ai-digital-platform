'use client'

import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import type { ObjectKey, SceneVerb, SceneMeta } from './sceneTypes'
import { SceneCharacter } from './SceneCharacter'
import { SceneBackground, BG_CFG } from './SceneBackground'
import { ThoughtBubble } from './ThoughtBubble'

/* ── object shapes for SPILL / ACCIDENT verbs ─────────────────────────── */
function ObjectShape({ kind }: { kind: ObjectKey }) {
  switch (kind) {
    case 'cup':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <path d="M11 12 H29 L27 32 Q27 34 25 34 H15 Q13 34 13 32 Z" fill="#eaf2f7" stroke="#9bb4c4" strokeWidth="1.5" />
          <ellipse cx="20" cy="12" rx="9" ry="2.6" fill="#cfe0ea" />
        </svg>
      )
    case 'bottle':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <rect x="17" y="4" width="6" height="8" rx="1" fill="#7fbfe0" />
          <path d="M14 12 H26 V32 Q26 34 24 34 H16 Q14 34 14 32 Z" fill="#bfe4f2" stroke="#7fbfe0" strokeWidth="1.5" />
        </svg>
      )
    case 'book':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <rect x="8" y="11" width="24" height="18" rx="2" fill="#c0504a" />
          <rect x="8" y="11" width="5" height="18" fill="#8a352f" />
          <line x1="17" y1="16" x2="29" y2="16" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
          <line x1="17" y1="20" x2="29" y2="20" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
        </svg>
      )
    case 'pencil':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <rect x="8" y="17" width="22" height="6" rx="1" fill="#f0c030" />
          <path d="M30 17 L36 20 L30 23 Z" fill="#e8b088" />
          <path d="M34 18.5 L36 20 L34 21.5 Z" fill="#3a281c" />
          <rect x="8" y="17" width="4" height="6" fill="#e07a7a" />
        </svg>
      )
    case 'tray':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <ellipse cx="20" cy="22" rx="16" ry="6" fill="#cfd6dc" stroke="#9aa4ac" strokeWidth="1.5" />
          <ellipse cx="20" cy="20" rx="16" ry="6" fill="#e4e9ee" stroke="#9aa4ac" strokeWidth="1.5" />
          <circle cx="15" cy="19" r="3" fill="#f0b878" />
          <circle cx="24" cy="20" r="3" fill="#8fce7a" />
        </svg>
      )
    case 'shoe':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <path d="M8 24 Q8 18 16 18 L24 18 Q32 18 34 24 Q34 27 30 27 L10 27 Q8 27 8 24 Z" fill="#4a6ea0" />
          <path d="M8 24 L34 24 Q34 27 30 27 L10 27 Q8 27 8 24 Z" fill="#33507a" />
          <line x1="16" y1="20" x2="24" y2="20" stroke="#fff" strokeWidth="1" opacity="0.7" />
        </svg>
      )
    case 'phone':
      return (
        <svg viewBox="0 0 40 40" width="38" height="38">
          <rect x="13" y="6" width="14" height="28" rx="3" fill="#2a2f38" />
          <rect x="15" y="9" width="10" height="20" rx="1" fill="#7fbfe0" />
          <circle cx="20" cy="31" r="1.4" fill="#8a929c" />
        </svg>
      )
  }
}

/* ── the 5 reusable animation verbs ───────────────────────────────────── */
const VERB_TIMING: Record<SceneVerb, { pose: number; bubble: number }> = {
  spill: { pose: 820, bubble: 1050 },
  social: { pose: 750, bubble: 1000 },
  achievement: { pose: 300, bubble: 900 },
  accident: { pose: 750, bubble: 1000 },
  waiting: { pose: 300, bubble: 800 },
}

function SpillFX({ kind }: { kind: ObjectKey }) {
  return (
    <>
      <motion.div
        initial={{ rotate: 0, y: 0 }} animate={{ rotate: 78, y: 26 }}
        transition={{ duration: 0.5, ease: 'easeIn' }}
        style={{ position: 'absolute', top: '12%', left: '43%', zIndex: 5, transformOrigin: 'bottom center' }}
      >
        <ObjectShape kind={kind} />
      </motion.div>
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], x: (i - 2.5) * 13, y: 42 + i * 3 }}
          transition={{ delay: 0.45 + i * 0.03, duration: 0.5, ease: 'easeOut' }}
          style={{ position: 'absolute', top: '32%', left: '50%', width: 6, height: 9, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%', background: '#7fbfe0', zIndex: 5 }}
        />
      ))}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 0.7 }}
        transition={{ delay: 0.85, duration: 0.9, ease: 'easeOut' }}
        style={{ position: 'absolute', bottom: '16%', left: '50%', marginLeft: -48, width: 96, height: 14, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(127,191,224,0.85), rgba(127,191,224,0.15))', zIndex: 2 }}
      />
    </>
  )
}

function AccidentFX({ kind }: { kind: ObjectKey }) {
  return (
    <>
      <motion.div
        initial={{ rotate: 0, y: 0, opacity: 1 }}
        animate={{ rotate: [0, -8, 8, -6, 22], y: [0, 0, 0, 0, 26], opacity: [1, 1, 1, 1, 0.85] }}
        transition={{ duration: 0.6, ease: 'easeIn' }}
        style={{ position: 'absolute', top: '18%', left: '44%', zIndex: 5 }}
      >
        <ObjectShape kind={kind} />
      </motion.div>
      {[...Array(5)].map((_, i) => {
        const a = (-60 + i * 30) * Math.PI / 180
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
            animate={{ opacity: [0, 1, 0], x: Math.cos(a) * 34, y: Math.sin(a) * -28 + 12, rotate: 140 }}
            transition={{ delay: 0.4, duration: 0.5, ease: 'easeOut' }}
            style={{ position: 'absolute', top: '32%', left: '50%', width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '9px solid #d8b04a', zIndex: 5 }}
          />
        )
      })}
    </>
  )
}

function AchievementFX() {
  return (
    <>
      <motion.div
        initial={{ scale: 0.4, opacity: 0.6 }} animate={{ scale: 1.6, opacity: 0 }}
        transition={{ delay: 0.3, duration: 0.6, ease: 'easeOut' }}
        style={{ position: 'absolute', bottom: '22%', left: '50%', marginLeft: -60, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,214,120,0.6), transparent 70%)', zIndex: 2 }}
      />
      {[...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
            animate={{ opacity: [0, 1, 0], x: Math.cos(a) * 46, y: Math.sin(a) * -40, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ position: 'absolute', top: '20%', left: '50%', zIndex: 5 }}
          >
            <StarBit />
          </motion.div>
        )
      })}
      {[...Array(4)].map((_, i) => (
        <motion.div
          key={`d${i}`}
          initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 0.9, 0], y: -26 }}
          transition={{ delay: 0.9 + i * 0.2, duration: 1.4, repeat: Infinity, repeatDelay: 0.3 }}
          style={{ position: 'absolute', top: '18%', left: `${40 + i * 6}%`, zIndex: 5 }}
        >
          <StarBit small />
        </motion.div>
      ))}
    </>
  )
}

function StarBit({ small = false }: { small?: boolean }) {
  const s = small ? 9 : 13
  return (
    <svg viewBox="0 0 10 10" width={s} height={s}>
      <path d="M5 0 L6.2 3.4 L9.8 3.6 L6.9 5.8 L8 9.4 L5 7.2 L2 9.4 L3.1 5.8 L0.2 3.6 L3.8 3.4 Z" fill="#ffd24a" stroke="#e8a820" strokeWidth="0.4" />
    </svg>
  )
}

function WaitingFX() {
  return (
    <div style={{ position: 'absolute', top: '12%', left: '57%', display: 'flex', gap: 4, zIndex: 5 }}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0.2, scale: 0.7 }}
          animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1, 0.7] }}
          transition={{ delay: 0.8 + i * 0.15, duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
        />
      ))}
    </div>
  )
}

function SceneRun({ meta }: { meta: SceneMeta }) {
  const [pose, setPose] = useState<SceneMeta['pose']>('neutral')
  const [bubble, setBubble] = useState(false)
  const timing = VERB_TIMING[meta.verb]
  useEffect(() => {
    const t1 = setTimeout(() => setPose(meta.pose), timing.pose)
    const t2 = setTimeout(() => setBubble(true), timing.bubble)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [meta, timing])

  const headTilt = meta.verb === 'waiting'
  return (
    <>
      <SceneBackground setting={meta.setting} timeOfDay={meta.time} />
      {meta.verb === 'spill' && <SpillFX kind={meta.object ?? 'cup'} />}
      {meta.verb === 'accident' && <AccidentFX kind={meta.object ?? 'book'} />}
      {meta.verb === 'achievement' && <AchievementFX />}
      {meta.verb === 'waiting' && <WaitingFX />}

      {/* main character */}
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: headTilt ? [0, -3, 0, -3, 0] : 0 }}
        transition={{
          opacity: { duration: 0.4 }, y: { duration: 0.4 }, scale: { duration: 0.4 },
          rotate: headTilt ? { delay: 0.4, duration: 1.6, ease: 'easeInOut' } : { duration: 0 },
        }}
        style={{ position: 'absolute', bottom: 0, left: '50%', marginLeft: -80, width: 160, height: 220, zIndex: 4 }}
      >
        <SceneCharacter pose={pose} shirtColor={meta.shirt} id="scene-main" />
      </motion.div>

      {/* friend / sibling for SOCIAL verb */}
      {meta.verb === 'social' && meta.friendShirt && (
        <motion.div
          initial={{ x: 70, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 14 }}
          style={{ position: 'absolute', bottom: 0, right: '6%', width: 120, height: 165, zIndex: 3 }}
        >
          <motion.div
            animate={{ rotate: [0, -14, 4, -10, 0] }}
            transition={{ delay: 0.4, duration: 0.6, ease: 'easeInOut' }}
            style={{ width: '100%', height: '100%', transformOrigin: 'bottom center' }}
          >
            <SceneCharacter pose="happy" shirtColor={meta.friendShirt} id="scene-friend" />
          </motion.div>
        </motion.div>
      )}

      {bubble && <ThoughtBubble text={meta.bubble} triggerAt={0} position={{ top: '6%', right: '12%' }} />}
    </>
  )
}

/* Full illustrated scene — background + verb FX + character(s) + bubble, with a
   replay control. Driven by a SceneMeta so each module supplies its own mapping. */
export function AnimatedScene({ meta }: { meta: SceneMeta }) {
  const [runId, setRunId] = useState(0)
  return (
    <div style={{ position: 'relative', width: '100%', height: 380, borderRadius: '14px 14px 0 0', overflow: 'hidden', background: BG_CFG[meta.setting].floor }}>
      <SceneRun key={runId} meta={meta} />
      <button
        onClick={() => setRunId((n) => n + 1)}
        title="Replay"
        style={{
          position: 'absolute', top: 8, left: 8, zIndex: 8, width: 26, height: 26, borderRadius: 8, cursor: 'pointer',
          background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.15)', color: '#5a4632',
          fontSize: 16.5, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ↺
      </button>
    </div>
  )
}
