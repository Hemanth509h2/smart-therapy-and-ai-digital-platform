'use client'

// 3D room for Social Story Sequencing.
//
// Pure presentation: the game rules, the shared session state and the timers
// all live in SocialStorySequencing. This file is told which step spots exist,
// where the character should stand and what mood it is in, and draws that as a
// small three.js diorama. Taps on a spot go straight back up through onSpot.
//
// Everything is built from primitives (no downloaded models or HDRs), so it
// works offline and adds nothing to the asset budget. Loaded with
// next/dynamic + ssr:false, since WebGL only exists in the browser.

import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { AlarmClock as AlarmIcon, Backpack as BackpackIcon, Shirt, Toothbrush, Utensils, type LucideIcon } from 'lucide-react'

export type KidMood = 'idle' | 'walk' | 'act' | 'oops' | 'cheer'

export interface SceneSpot {
  id: string
  emoji: string
  caption: string
  color: string
  status: 'open' | 'done' | 'wrong' | 'placed'
  /** Small corner badge: ✓, ✗ or the step number. */
  badge: string | null
  /** Pulsing ring — the way is being shown to this spot. */
  ring: boolean
  /** The replay is on this step right now. */
  playing: boolean
  clickable: boolean
  /** The action is happening here: pop the step up with sparkles. */
  burst: boolean
  burstKey: string
}

export interface SocialStoryScene3DProps {
  storyId: string
  /** In on-screen order (the shuffled order, never the answer). */
  spots: SceneSpot[]
  /** The spot the character should stand at; null = the start of the room. */
  kidAt: string | null
  mood: KidMood
  kidSays: string
  /** Glowing footprints lead from the character to this spot. */
  guideId: string | null
  showCaptions: boolean
  walkMs: number
  onSpot: (id: string) => void
  /** Steps already done in the story, so the home and the character show them. */
  doneIds: string[]
  /** The step being acted out right now (arrival action or replay). */
  actionId: string | null
}

// --- Story themes ---------------------------------------------------------

interface Theme {
  outdoor: boolean
  wall: string
  floor: string
  trim: string
  sky: string
}

const THEMES: Record<string, Theme> = {
  'getting-ready-school': { outdoor: false, wall: '#cfe2f3', floor: '#d9a874', trim: '#f7f3ec', sky: '#e8f3fb' },
  'meeting-someone-new': { outdoor: true, wall: '#bfe3ff', floor: '#9fd17f', trim: '#e9d2a8', sky: '#bfe3ff' },
  'when-i-feel-angry': { outdoor: false, wall: '#f3dcc6', floor: '#c99a6b', trim: '#fbf6ee', sky: '#fbefe3' },
  'going-to-doctor': { outdoor: false, wall: '#d6efe9', floor: '#d3dcdf', trim: '#ffffff', sky: '#eaf7f4' },
  'sharing-with-friend': { outdoor: false, wall: '#fbe9bd', floor: '#e6b48a', trim: '#fffaf0', sky: '#fff6df' },
  'asking-for-help': { outdoor: false, wall: '#dcebc7', floor: '#cfa77a', trim: '#fbf8ef', sky: '#f0f7e6' },
  'handling-disappointment': { outdoor: true, wall: '#d5e1f3', floor: '#a9cf8c', trim: '#e9d2a8', sky: '#d5e1f3' },
  'birthday-party': { outdoor: false, wall: '#f8d6e5', floor: '#e6b994', trim: '#fff7fb', sky: '#fdeef5' },
  custom: { outdoor: false, wall: '#e3dcf5', floor: '#d3bf9f', trim: '#fbf9ff', sky: '#f3effc' },
}

const ROOM_W = 16
const BACK_Z = -3.6
const START = new THREE.Vector3(-6.6, 0, 0.2)

/** Where each step's prop stands, by on-screen position. */
function stationPos(i: number, n: number): THREE.Vector3 {
  const x = n <= 1 ? 0 : -5.6 + i * (11.2 / (n - 1))
  return new THREE.Vector3(x, 0, i % 2 ? -1.0 : -1.9)
}
/** Where the character stands to use that prop: just in front of it. */
function standPos(p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p.x, 0, p.z + 1.25)
}

// --- Small building blocks ------------------------------------------------

function Mat({ color, rough = 0.8, emissive, ei = 0 }: { color: string; rough?: number; emissive?: string; ei?: number }) {
  return <meshStandardMaterial color={color} roughness={rough} emissive={emissive ?? '#000000'} emissiveIntensity={ei} />
}

function Box({ size, pos, color, r = 0.06, rot }: { size: [number, number, number]; pos: [number, number, number]; color: string; r?: number; rot?: [number, number, number] }) {
  return (
    <RoundedBox args={size} radius={Math.min(r, Math.min(...size) / 2 - 0.001)} smoothness={3} position={pos} rotation={rot}>
      <Mat color={color} />
    </RoundedBox>
  )
}

/** Turns on shadows for every mesh inside, once, so each piece needn't say so. */
function Shadowed({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    ref.current?.traverse(o => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true }
    })
  })
  return <group ref={ref}>{children}</group>
}

function Plant({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.28, 0.22, 0.5, 20]} /><Mat color="#f1ece4" /></mesh>
      {[[0, 0.75, 0, 0.32], [0.18, 0.95, 0.05, 0.24], [-0.17, 0.9, -0.05, 0.26], [0.02, 1.15, 0, 0.2]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} scale={[1, 1.25, 1]}><sphereGeometry args={[r, 16, 12]} /><Mat color={i % 2 ? '#5fae6a' : '#4c9a5b'} /></mesh>
      ))}
    </group>
  )
}

function Window({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <Box size={[2.2, 1.7, 0.12]} pos={[0, 0, 0]} color="#ffffff" r={0.05} />
      <mesh position={[0, 0, 0.07]}><planeGeometry args={[1.95, 1.45]} /><Mat color="#bfe6ff" emissive="#d9f1ff" ei={0.6} /></mesh>
      <Box size={[0.07, 1.5, 0.05]} pos={[0, 0, 0.09]} color="#ffffff" r={0.02} />
      <Box size={[2, 0.07, 0.05]} pos={[0, 0, 0.09]} color="#ffffff" r={0.02} />
      <Box size={[2.4, 0.1, 0.3]} pos={[0, -0.9, 0.12]} color="#ffffff" r={0.03} />
    </group>
  )
}

function Frame({ pos, color = '#f4d6a0', art = '#7fb7d9', w = 0.9, h = 1.1 }: { pos: [number, number, number]; color?: string; art?: string; w?: number; h?: number }) {
  return (
    <group position={pos}>
      <Box size={[w, h, 0.06]} pos={[0, 0, 0]} color={color} r={0.03} />
      <mesh position={[0, 0, 0.035]}><planeGeometry args={[w - 0.18, h - 0.18]} /><Mat color={art} /></mesh>
    </group>
  )
}

function Rug({ pos, r = 1.6, color = '#8fb7dd', ring = '#c9dcef' }: { pos: [number, number, number]; r?: number; color?: string; ring?: string }) {
  return (
    <group position={pos}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} scale={[1.4, 1, 1]}><circleGeometry args={[r, 40]} /><Mat color={ring} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]} scale={[1.4, 1, 1]}><circleGeometry args={[r * 0.72, 40]} /><Mat color={color} /></mesh>
    </group>
  )
}

function Tree({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[0.16, 0.22, 1.6, 12]} /><Mat color="#9a6b44" /></mesh>
      <mesh position={[0, 2.1, 0]}><sphereGeometry args={[0.95, 20, 16]} /><Mat color="#5fae6a" /></mesh>
      <mesh position={[0.55, 1.75, 0.2]}><sphereGeometry args={[0.6, 16, 12]} /><Mat color="#6cbb74" /></mesh>
      <mesh position={[-0.5, 1.8, 0.1]}><sphereGeometry args={[0.62, 16, 12]} /><Mat color="#58a463" /></mesh>
    </group>
  )
}

function Cloud({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  return (
    <group position={pos} scale={s}>
      {[[0, 0, 0, 0.6], [0.6, -0.1, 0, 0.45], [-0.6, -0.1, 0, 0.45], [0.25, 0.3, 0, 0.42]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}><sphereGeometry args={[r, 16, 12]} /><Mat color="#ffffff" emissive="#ffffff" ei={0.25} /></mesh>
      ))}
    </group>
  )
}

function Balloon({ pos, color }: { pos: [number, number, number]; color: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0, 0]} scale={[1, 1.2, 1]}><sphereGeometry args={[0.32, 20, 16]} /><meshStandardMaterial color={color} roughness={0.35} /></mesh>
      <mesh position={[0, -0.75, 0]}><cylinderGeometry args={[0.006, 0.006, 1.1, 4]} /><Mat color="#888888" /></mesh>
    </group>
  )
}

function Gift({ pos, color, ribbon = '#ffffff', s = 1 }: { pos: [number, number, number]; color: string; ribbon?: string; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <Box size={[0.6, 0.5, 0.6]} pos={[0, 0.25, 0]} color={color} r={0.04} />
      <Box size={[0.1, 0.52, 0.62]} pos={[0, 0.25, 0]} color={ribbon} r={0.02} />
      <Box size={[0.62, 0.52, 0.1]} pos={[0, 0.25, 0]} color={ribbon} r={0.02} />
      <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.035, 8, 16]} /><Mat color={ribbon} /></mesh>
    </group>
  )
}

function Chair({ pos, color = '#c99a6b', rotY = 0 }: { pos: [number, number, number]; color?: string; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box size={[0.75, 0.08, 0.7]} pos={[0, 0.55, 0]} color={color} r={0.03} />
      <Box size={[0.75, 0.75, 0.08]} pos={[0, 0.95, -0.31]} color={color} r={0.03} />
      {[[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]].map(([x, z], i) => (
        <Box key={i} size={[0.07, 0.55, 0.07]} pos={[x, 0.27, z]} color={color} r={0.02} />
      ))}
    </group>
  )
}

function Table({ pos, w = 1.4, d = 0.9, color = '#e7d3b5' }: { pos: [number, number, number]; w?: number; d?: number; color?: string }) {
  return (
    <group position={pos}>
      <Box size={[w, 0.1, d]} pos={[0, 0.78, 0]} color={color} r={0.04} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} size={[0.08, 0.76, 0.08]} pos={[sx * (w / 2 - 0.1), 0.38, sz * (d / 2 - 0.1)]} color="#b8916a" r={0.02} />
      ))}
    </group>
  )
}

function Rainbow({ pos, s = 1 }: { pos: [number, number, number]; s?: number }) {
  const colors = ['#ef6b6b', '#f4a64a', '#f6d65a', '#7cc77a', '#5fa8e0', '#9a7fe0']
  return (
    <group position={pos} scale={s}>
      {colors.map((c, i) => (
        <mesh key={c}><torusGeometry args={[1.6 - i * 0.14, 0.07, 10, 48, Math.PI]} /><Mat color={c} emissive={c} ei={0.25} /></mesh>
      ))}
    </group>
  )
}

// --- Step props: what stands at each spot ---------------------------------

/* The built-in "Getting Ready for School" steps each get their own object, like
   the mockup. Any other step gets a little stand in its spot colour. */
function StepProp({ id, color }: { id: string; color: string }) {
  switch (id) {
    case 's1p1': // wake up: bed + nightstand with a ringing alarm clock
      return (
        <group>
          <group position={[-0.45, 0, -0.1]}>
            <Box size={[1.25, 0.42, 1.9]} pos={[0, 0.3, 0]} color="#b8875c" r={0.05} />
            <Box size={[1.2, 0.18, 1.82]} pos={[0, 0.58, 0]} color="#ffffff" r={0.08} />
            <Box size={[1.24, 0.14, 1.2]} pos={[0, 0.68, 0.32]} color="#7cc3d6" r={0.07} />
            <Box size={[0.7, 0.18, 0.4]} pos={[0, 0.78, -0.62]} color="#f7f7f7" r={0.08} />
            <Box size={[1.25, 0.95, 0.12]} pos={[0, 0.55, -0.95]} color="#a97a50" r={0.05} />
          </group>
          <group position={[0.65, 0, -0.55]}>
            <Box size={[0.6, 0.6, 0.5]} pos={[0, 0.3, 0]} color="#c99a6b" r={0.04} />
            <AlarmClock pos={[0, 0.76, 0.05]} />
          </group>
        </group>
      )
    case 's1p2': // brush teeth: sink, mirror, cup with toothbrush
      return (
        <group position={[0, 0, -0.35]}>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.14, 0.2, 0.8, 16]} /><Mat color="#ffffff" rough={0.4} /></mesh>
          <mesh position={[0, 0.86, 0]} scale={[1, 0.45, 0.8]}><sphereGeometry args={[0.45, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#ffffff" rough={0.35} /></mesh>
          <mesh position={[0, 0.9, -0.25]}><cylinderGeometry args={[0.03, 0.03, 0.2, 8]} /><Mat color="#c0c7cf" rough={0.2} /></mesh>
          <Box size={[0.75, 0.95, 0.06]} pos={[0, 1.65, -0.42]} color="#ffffff" r={0.04} />
          <mesh position={[0, 1.65, -0.385]}><planeGeometry args={[0.62, 0.82]} /><meshStandardMaterial color="#cfe9f7" roughness={0.1} metalness={0.3} /></mesh>
          <mesh position={[0.32, 0.98, -0.05]}><cylinderGeometry args={[0.06, 0.05, 0.16, 12]} /><Mat color="#7cc3d6" /></mesh>
          <Box size={[0.03, 0.26, 0.03]} pos={[0.32, 1.1, -0.05]} color="#f07fa0" r={0.01} rot={[0, 0, 0.2]} />
        </group>
      )
    case 's1p3': // get dressed: chair with school clothes
      return (
        <group position={[0, 0, -0.2]}>
          <Chair pos={[0, 0, 0]} color="#d4a676" />
          <Box size={[0.62, 0.42, 0.06]} pos={[0, 1.05, -0.24]} color="#f4f7fb" r={0.03} />
          <Box size={[0.66, 0.14, 0.07]} pos={[0, 1.24, -0.24]} color="#2f4f8a" r={0.03} />
          <Box size={[0.6, 0.08, 0.5]} pos={[0, 0.63, 0.02]} color="#3a4f7d" r={0.03} />
          <Box size={[0.25, 0.04, 0.05]} pos={[0, 1.18, -0.2]} color="#c43a3a" r={0.01} />
        </group>
      )
    case 's1p4': // breakfast: table with cereal bowl and juice
      return (
        <group position={[0, 0, -0.2]}>
          <Table pos={[0, 0, 0]} w={1.3} d={0.85} />
          <mesh position={[-0.2, 0.92, 0]} scale={[1, 0.6, 1]}><sphereGeometry args={[0.22, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><Mat color="#ffffff" rough={0.4} /></mesh>
          {[['#f2c94c', -0.27, 0.02], ['#e86a6a', -0.14, 0.05], ['#8e6bd8', -0.2, -0.07], ['#f29c50', -0.1, -0.04]].map(([c, x, z], i) => (
            <mesh key={i} position={[x as number, 0.95, z as number]}><sphereGeometry args={[0.05, 10, 8]} /><Mat color={c as string} /></mesh>
          ))}
          <mesh position={[0.3, 1.0, 0.02]}><cylinderGeometry args={[0.08, 0.07, 0.34, 16]} /><meshStandardMaterial color="#ffb347" roughness={0.2} transparent opacity={0.85} /></mesh>
        </group>
      )
    case 's1p5': // go to school: front door with a backpack
      return (
        <group position={[0, 0, -0.45]}>
          <Box size={[1.25, 2.3, 0.12]} pos={[0, 1.15, -0.1]} color="#a96f43" r={0.04} />
          <Box size={[1.4, 2.42, 0.08]} pos={[0, 1.2, -0.17]} color="#ffffff" r={0.03} />
          <mesh position={[0.42, 1.1, 0]}><sphereGeometry args={[0.05, 12, 10]} /><meshStandardMaterial color="#e3c26b" metalness={0.6} roughness={0.3} /></mesh>
          <Backpack pos={[0.1, 0, 0.35]} />
          <Box size={[1.1, 0.03, 0.6]} pos={[0, 0.02, 0.35]} color="#9a8f86" r={0.01} />
        </group>
      )
    default:
      return (
        <group>
          <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.55, 0.62, 0.44, 32]} /><Mat color="#ffffff" /></mesh>
          <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.5, 0.5, 0.04, 32]} /><Mat color={color} emissive={color} ei={0.35} /></mesh>
        </group>
      )
  }
}

/** Height of a step's prop, so its bubble floats just above it. */
function propTop(id: string): number {
  if (id === 's1p5') return 2.35
  if (id === 's1p2') return 2.05
  if (id === 's1p3') return 1.4
  if (id === 's1p1') return 1.25
  if (id === 's1p4') return 1.2
  return 0.55
}

function AlarmClock({ pos, ringing = true }: { pos: [number, number, number]; ringing?: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    // Rings in short bursts.
    const t = clock.elapsedTime % 2.2
    ref.current.rotation.z = ringing && t < 0.6 ? Math.sin(t * 60) * 0.12 : 0
  })
  return (
    <group ref={ref} position={pos}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.17, 0.17, 0.1, 24]} /><Mat color="#e25555" /></mesh>
      <mesh position={[0, 0, 0.052]}><circleGeometry args={[0.13, 24]} /><Mat color="#ffffff" /></mesh>
      {[-0.1, 0.1].map(x => (
        <mesh key={x} position={[x, 0.17, 0]}><sphereGeometry args={[0.06, 12, 10]} /><Mat color="#e25555" /></mesh>
      ))}
      <Box size={[0.015, 0.09, 0.01]} pos={[0, 0.03, 0.06]} color="#333333" r={0.004} />
      <Box size={[0.07, 0.015, 0.01]} pos={[0.03, 0, 0.06]} color="#333333" r={0.004} />
    </group>
  )
}

function Backpack({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <Box size={[0.55, 0.7, 0.32]} pos={[0, 0.36, 0]} color="#3f5fa8" r={0.14} />
      <Box size={[0.42, 0.3, 0.1]} pos={[0, 0.25, 0.18]} color="#5476c4" r={0.06} />
      <mesh position={[0, 0.5, 0.17]}><circleGeometry args={[0.08, 20]} /><Mat color="#f6d65a" /></mesh>
      <mesh position={[0, 0.74, 0]} rotation={[0, 0, 0]}><torusGeometry args={[0.1, 0.025, 8, 16, Math.PI]} /><Mat color="#2f4a86" /></mesh>
    </group>
  )
}

// --- Room per story -------------------------------------------------------

function Room({ storyId, theme }: { storyId: string; theme: Theme }) {
  const floor = (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 1]}>
      <planeGeometry args={[ROOM_W + 8, 13]} />
      <Mat color={theme.floor} rough={0.9} />
    </mesh>
  )

  if (theme.outdoor) {
    return (
      <group>
        {floor}
        <mesh position={[0, 4, BACK_Z - 3]}><planeGeometry args={[40, 14]} /><meshBasicMaterial color={theme.sky} /></mesh>
        {/* a path across the grass */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.4]}><planeGeometry args={[ROOM_W, 1.4]} /><Mat color="#e9d8b4" /></mesh>
        <Tree pos={[-7.2, 0, -2.6]} s={1.3} />
        <Tree pos={[7.3, 0, -2.4]} s={1.2} />
        <Tree pos={[-2.5, 0, -4.4]} s={0.9} />
        <Tree pos={[3.2, 0, -4.6]} s={1} />
        <Cloud pos={[-4, 5.4, BACK_Z - 2]} s={1.2} />
        <Cloud pos={[4.5, 5.8, BACK_Z - 2]} s={0.9} />
        {/* fence */}
        {Array.from({ length: 17 }, (_, i) => (
          <Box key={i} size={[0.12, 0.8, 0.08]} pos={[-8 + i, 0.4, BACK_Z]} color="#f3e6cf" r={0.03} />
        ))}
        <Box size={[16.5, 0.1, 0.06]} pos={[0, 0.6, BACK_Z + 0.06]} color="#f3e6cf" r={0.02} />
        {storyId === 'handling-disappointment' && <Rainbow pos={[2.5, 3.2, BACK_Z - 1.5]} s={1.4} />}
        {storyId === 'handling-disappointment' && <Cloud pos={[-5.5, 4.6, BACK_Z - 1]} s={0.8} />}
        {[-6.5, -3.4, 0.5, 4.2, 6.6].map((x, i) => (
          <group key={i} position={[x, 0, 3.4 + (i % 2) * 0.6]}>
            <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.015, 0.015, 0.36, 4]} /><Mat color="#4c9a5b" /></mesh>
            <mesh position={[0, 0.38, 0]}><sphereGeometry args={[0.08, 10, 8]} /><Mat color={['#f6d65a', '#f07fa0', '#ffffff', '#9a7fe0', '#f4a64a'][i]} /></mesh>
          </group>
        ))}
      </group>
    )
  }

  return (
    <group>
      {floor}
      {/* floorboards */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-ROOM_W / 2 - 4 + i * 2, 0.004, 1]}><planeGeometry args={[0.02, 13]} /><meshBasicMaterial color="#000000" transparent opacity={0.06} /></mesh>
      ))}
      {/* walls */}
      <mesh position={[0, 2.8, BACK_Z]} receiveShadow><planeGeometry args={[ROOM_W + 8, 5.6]} /><Mat color={theme.wall} rough={0.95} emissive={theme.wall} ei={0.35} /></mesh>
      <mesh position={[-ROOM_W / 2 - 0.4, 2.8, -1.6]} rotation={[0, Math.PI / 2, 0]} receiveShadow><planeGeometry args={[4, 5.6]} /><Mat color={theme.wall} rough={0.95} emissive={theme.wall} ei={0.35} /></mesh>
      <mesh position={[ROOM_W / 2 + 0.4, 2.8, -1.6]} rotation={[0, -Math.PI / 2, 0]} receiveShadow><planeGeometry args={[4, 5.6]} /><Mat color={theme.wall} rough={0.95} emissive={theme.wall} ei={0.35} /></mesh>
      <Box size={[ROOM_W + 8, 0.22, 0.08]} pos={[0, 0.11, BACK_Z + 0.04]} color={theme.trim} r={0.02} />

      {storyId === 'getting-ready-school' && (
        <>
          <Window pos={[0.2, 3.1, BACK_Z + 0.07]} />
          <Frame pos={[-5.4, 3.5, BACK_Z + 0.05]} color="#f3e1c7" art="#f6efe2" w={1.1} h={1.3} />
          <Frame pos={[-3.6, 3.2, BACK_Z + 0.05]} color="#9cc7e3" art="#ffe07a" w={0.8} h={0.9} />
          <Frame pos={[5.6, 3.4, BACK_Z + 0.05]} color="#f3e1c7" art="#fdeacc" w={1} h={1.2} />
          <Box size={[1.6, 0.08, 0.35]} pos={[3.1, 3.4, BACK_Z + 0.2]} color="#c99a6b" r={0.02} />
          <Plant pos={[3.4, 3.44, BACK_Z + 0.2]} s={0.45} />
          <Box size={[0.3, 0.4, 0.25]} pos={[2.7, 3.64, BACK_Z + 0.2]} color="#7cc3d6" r={0.03} />
          <Plant pos={[-7.4, 0, -1.8]} s={1} />
          <Plant pos={[7.3, 0, 0.2]} s={1.1} />
          <Rug pos={[-0.6, 0, 0.9]} r={1.1} color="#8fb7dd" ring="#d7e6f3" />
        </>
      )}
      {storyId === 'when-i-feel-angry' && (
        <>
          <group position={[-6.4, 0, -2.6]}>
            <Box size={[2.6, 0.55, 1]} pos={[0, 0.45, 0]} color="#8fb7dd" r={0.15} />
            <Box size={[2.6, 0.9, 0.3]} pos={[0, 0.9, -0.4]} color="#7aa6cf" r={0.15} />
            <Box size={[0.3, 0.7, 1]} pos={[-1.3, 0.6, 0]} color="#7aa6cf" r={0.12} />
            <Box size={[0.3, 0.7, 1]} pos={[1.3, 0.6, 0]} color="#7aa6cf" r={0.12} />
          </group>
          <Window pos={[0, 3.1, BACK_Z + 0.07]} />
          <Frame pos={[-4, 3.3, BACK_Z + 0.05]} color="#e8c39b" art="#f7d9b0" />
          <group position={[6.6, 0, -2.8]}>
            <Box size={[1.8, 0.7, 0.5]} pos={[0, 0.35, 0]} color="#c99a6b" r={0.04} />
            <Box size={[1.6, 0.95, 0.08]} pos={[0, 1.25, 0]} color="#2b2f36" r={0.03} />
          </group>
          <Plant pos={[7.4, 0, 1.4]} s={1.2} />
          <Rug pos={[0, 0, 0.9]} r={1.1} color="#e9a87c" ring="#f5d4bd" />
        </>
      )}
      {storyId === 'going-to-doctor' && (
        <>
          <Chair pos={[-7, 0, -2.5]} color="#7cc3b6" />
          <Chair pos={[-6.1, 0, -2.5]} color="#7cc3b6" />
          <Chair pos={[-5.2, 0, -2.5]} color="#7cc3b6" />
          <group position={[0, 3.6, BACK_Z + 0.06]}>
            <Box size={[0.9, 0.9, 0.06]} pos={[0, 0, 0]} color="#ffffff" r={0.06} />
            <Box size={[0.6, 0.18, 0.05]} pos={[0, 0, 0.04]} color="#e25555" r={0.02} />
            <Box size={[0.18, 0.6, 0.05]} pos={[0, 0, 0.04]} color="#e25555" r={0.02} />
          </group>
          <group position={[4, 3.3, BACK_Z + 0.06]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.4, 0.4, 0.06, 32]} /><Mat color="#ffffff" /></mesh>
            <Box size={[0.03, 0.25, 0.02]} pos={[0, 0.1, 0.04]} color="#333333" r={0.01} />
          </group>
          <Plant pos={[7.3, 0, -1.5]} s={1.2} />
        </>
      )}
      {storyId === 'sharing-with-friend' && (
        <>
          {[['#e86a6a', -6.8, -2.6], ['#5fa8e0', -6.2, -2.5], ['#f6d65a', -6.5, -2.55]].map(([c, x, z], i) => (
            <Box key={i} size={[0.45, 0.45, 0.45]} pos={[x as number, 0.23 + (i === 2 ? 0.45 : 0), z as number]} color={c as string} r={0.06} />
          ))}
          <mesh position={[6.6, 0.35, 1.8]}><sphereGeometry args={[0.35, 24, 16]} /><Mat color="#f4a64a" /></mesh>
          <group position={[7, 0, -2.6]}>
            <mesh position={[0, 0.45, 0]}><sphereGeometry args={[0.42, 20, 16]} /><Mat color="#c99a6b" /></mesh>
            <mesh position={[0, 1.05, 0]}><sphereGeometry args={[0.3, 20, 16]} /><Mat color="#c99a6b" /></mesh>
            {[-0.22, 0.22].map(x => <mesh key={x} position={[x, 1.3, 0]}><sphereGeometry args={[0.1, 12, 10]} /><Mat color="#b8875c" /></mesh>)}
          </group>
          <Window pos={[0, 3.1, BACK_Z + 0.07]} />
          <Frame pos={[-4, 3.3, BACK_Z + 0.05]} color="#f6d65a" art="#9fd17f" />
          <Rug pos={[0, 0, 0.9]} r={1.1} color="#f2b4c4" ring="#fbe0e7" />
        </>
      )}
      {storyId === 'asking-for-help' && (
        <>
          <group position={[0, 3.1, BACK_Z + 0.06]}>
            <Box size={[5, 1.8, 0.08]} pos={[0, 0, 0]} color="#c99a6b" r={0.03} />
            <mesh position={[0, 0, 0.05]}><planeGeometry args={[4.75, 1.58]} /><Mat color="#2f5d4a" /></mesh>
          </group>
          <group position={[-6.8, 0, -2.6]}>
            <Box size={[1.3, 2.2, 0.5]} pos={[0, 1.1, 0]} color="#c99a6b" r={0.03} />
            {[0.5, 1.2, 1.85].map((y, i) => (
              <Box key={i} size={[1, 0.4, 0.3]} pos={[0, y, 0.08]} color={['#e86a6a', '#5fa8e0', '#f6d65a'][i]} r={0.03} />
            ))}
          </group>
          <group position={[6.8, 0, -2.4]}>
            <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.05, 0.25, 0.9, 12]} /><Mat color="#c99a6b" /></mesh>
            <mesh position={[0, 1.2, 0]}><sphereGeometry args={[0.42, 24, 16]} /><Mat color="#5fa8e0" /></mesh>
          </group>
          <Plant pos={[7.4, 0, 1.6]} s={1.1} />
        </>
      )}
      {storyId === 'birthday-party' && (
        <>
          <Balloon pos={[-6.8, 2.6, -2.6]} color="#ef6b6b" />
          <Balloon pos={[-6.2, 2.9, -2.8]} color="#5fa8e0" />
          <Balloon pos={[6.6, 2.7, -2.6]} color="#f6d65a" />
          <Balloon pos={[7.1, 2.4, -2.4]} color="#9a7fe0" />
          {Array.from({ length: 11 }, (_, i) => (
            <mesh key={i} position={[-5 + i, 4.4 - Math.sin((i / 10) * Math.PI) * 0.4, BACK_Z + 0.08]} rotation={[0, 0, Math.PI]}>
              <coneGeometry args={[0.2, 0.4, 3]} /><Mat color={['#ef6b6b', '#f6d65a', '#5fa8e0', '#7cc77a'][i % 4]} />
            </mesh>
          ))}
          <Gift pos={[6.8, 0, 1.6]} color="#9a7fe0" />
          <Gift pos={[-7, 0, 1.4]} color="#f07fa0" s={0.8} />
          <Rug pos={[0, 0, 0.9]} r={1.1} color="#f7c3d6" ring="#fde3ed" />
        </>
      )}
      {(storyId === 'custom' || !THEMES[storyId]) && (
        <>
          <Window pos={[0, 3.1, BACK_Z + 0.07]} />
          <Frame pos={[-4.5, 3.3, BACK_Z + 0.05]} color="#d9cdf2" art="#f6efe2" />
          <Plant pos={[-7.3, 0, -0.5]} s={1.1} />
          <Plant pos={[7.3, 0, 1.4]} s={1.2} />
          <Rug pos={[0, 0, 0.9]} r={1.1} color="#c7b8ec" ring="#e9e3f8" />
        </>
      )}
    </group>
  )
}

// --- The character --------------------------------------------------------

const SKIN = '#f3c6a2'
const HAIR = '#3a2a22'
const HOODIE = '#b99ce7'
const BLAZER = '#2f4f8a'

/** Lying in bed, head on the pillow (school home only). */
const BED_POSE = new THREE.Vector3(-6.78, 1.05, -2.45)

/** What the story has changed about the character so far. */
export interface KidLook {
  asleep: boolean
  dressed: boolean
  backpack: boolean
}

function Kid({ target, start, scale = 1, mood, says, walkMs, look, action, posOut }: {
  target: THREE.Vector3; start: THREE.Vector3; scale?: number; mood: KidMood; says: string; walkMs: number
  look: KidLook
  /** The step being acted out right now, for its own animation. */
  action: string | null
  /** Where she is right now, written every frame for the camera to follow. */
  posOut: React.MutableRefObject<THREE.Vector3>
}) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const eyes = useRef<THREE.Group>(null)
  const mouth = useRef<THREE.Mesh>(null)
  const yawn = useRef<THREE.Mesh>(null)
  const anchor = useRef<THREE.Group>(null)
  const brush = useRef<THREE.Group>(null)
  const foam = useRef<THREE.Group>(null)
  const bowl = useRef<THREE.Group>(null)
  const spoon = useRef<THREE.Group>(null)

  // The current walk: from where to where, started when, and whether it began
  // in bed (then it is a getting-up, not a walk). Kept in refs so the frame
  // loop never re-renders React.
  const walk = useRef({ from: start.clone(), to: start.clone(), t0: 0, started: false, rising: false })
  const moodT0 = useRef(0)
  const clockRef = useRef(0)
  // The last move we set up, so running the effect twice (React StrictMode in
  // dev) repeats nothing.
  const lastMove = useRef<{ to: THREE.Vector3 | null; asleep: boolean }>({ to: null, asleep: look.asleep })

  // Tap her, like a Talking Tom poke: she giggles (or grumbles, if asleep).
  const tickleT0 = useRef(-10)
  const [tickle, setTickle] = useState<string | null>(null)
  useEffect(() => {
    if (!tickle) return
    const id = setTimeout(() => setTickle(null), 1400)
    return () => clearTimeout(id)
  }, [tickle])
  const poke = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    tickleT0.current = clockRef.current
    const lines = look.asleep
      ? ['Five more minutes… 😴', 'Mmm… so sleepy… 💤']
      : ['Hehe! That tickles! 😆', 'Hee hee! 🤭', 'Oh! Hi there! 👋', 'Again! Again! 😄']
    setTickle(lines[Math.floor(Math.random() * lines.length)])
  }

  useEffect(() => {
    const w = walk.current
    const prev = lastMove.current
    if (look.asleep) {
      // Back to bed (the replay starts the morning over): no walk, just there.
      lastMove.current = { to: null, asleep: true }
      w.started = false
      return
    }
    if (prev.to && prev.to.equals(target) && !prev.asleep) return
    const rising = prev.asleep
    lastMove.current = { to: target.clone(), asleep: false }
    const here = rising ? BED_POSE.clone() : root.current ? root.current.position.clone() : start.clone()
    if (here.distanceTo(target) < 0.01) return
    w.from = here
    w.to = target.clone()
    w.t0 = clockRef.current
    w.started = true
    w.rising = rising
  }, [target, look.asleep, start])

  useEffect(() => { moodT0.current = clockRef.current }, [mood, action])

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.elapsedTime
    clockRef.current = t
    const r = root.current
    if (!r || !body.current || !head.current || !legL.current || !legR.current || !armL.current || !armR.current) return
    posOut.current.copy(r.position)
    const damp = Math.min(1, dt * 14)
    const since = t - moodT0.current
    const acting = mood === 'act' && !look.asleep
    const tickled = t - tickleT0.current < 1.2
    const tk = t - tickleT0.current

    // Props in hand only while that step is being done.
    if (brush.current) brush.current.visible = acting && action === 's1p2'
    if (foam.current) {
      foam.current.visible = acting && action === 's1p2' && since > 0.3
      foam.current.children.forEach((c, i) => { c.position.y = Math.sin(t * 9 + i) * 0.015 })
    }
    if (bowl.current) bowl.current.visible = acting && action === 's1p4'
    if (spoon.current) spoon.current.visible = acting && action === 's1p4'

    // Asleep: lying in bed, eyes shut, breathing.
    if (look.asleep) {
      r.position.copy(BED_POSE)
      r.rotation.set(0, 0, Math.PI / 2)
      body.current.position.y = 0
      body.current.scale.set(1, 1, 1 + Math.sin(t * 1.8) * 0.02)
      legL.current.rotation.set(0, 0, 0)
      legR.current.rotation.set(0, 0, 0)
      armL.current.rotation.set(0, 0, 0.1)
      armR.current.rotation.set(0, 0, -0.1)
      head.current.rotation.set(0, mood === 'oops' || tickled ? Math.sin(t * 8) * 0.15 : 0, 0)
      if (tickled) body.current.position.y = Math.abs(Math.sin(tk * 12)) * 0.04
      if (eyes.current) eyes.current.scale.y = 0.12
      if (mouth.current) mouth.current.rotation.z = Math.PI
      if (yawn.current) yawn.current.visible = false
      // Above the covers, well inside the frame (her head is near the left edge).
      anchor.current?.position.set(BED_POSE.x - 0.2, BED_POSE.y + 1.25, BED_POSE.z)
      return
    }
    body.current.scale.set(1, 1, 1)

    // Position along the current walk (or getting out of bed), eased.
    const w = walk.current
    const dur = walkMs / 1000
    const k = w.started ? Math.min(1, (t - w.t0) / dur) : 1
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    if (w.started) r.position.lerpVectors(w.from, w.to, e)
    const moving = w.started && k < 1

    if (w.rising && moving) {
      // Sit up and swing out of bed: tip from lying to standing over the first part.
      const up = Math.min(1, k / 0.6)
      r.rotation.z = (Math.PI / 2) * (1 - up * up * (3 - 2 * up))
      r.position.y = THREE.MathUtils.lerp(BED_POSE.y, 0, e) + Math.sin(k * Math.PI) * 0.25
    } else {
      r.rotation.z += (0 - r.rotation.z) * damp
    }

    // Face the way we're walking; otherwise turn back toward the camera. The
    // uniform spin overrides this while it plays.
    const dir = new THREE.Vector3().subVectors(w.to, w.from)
    const walkingNotRising = moving && !(w.rising && k < 0.6)
    let want = walkingNotRising && dir.lengthSq() > 0.0001 ? Math.atan2(dir.x, dir.z) : 0
    if (acting && action === 's1p5' && since > 1.0) want = Math.PI * 0.85 // turn to the door and go
    if (acting && action === 's1p3' && since < 0.9) {
      r.rotation.y = (since / 0.9) * Math.PI * 2
    } else {
      let dy = want - r.rotation.y
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      r.rotation.y += dy * Math.min(1, dt * 10)
    }

    let legSwing = 0, armSwingL = 0, armSwingR = 0, armOutL = 0.08, armOutR = -0.08, lift = 0, headYaw = 0, headTilt = 0, headNod = 0
    let yawning = false

    if (moving && !(w.rising && k < 0.6)) {
      const ph = t * 11
      legSwing = Math.sin(ph) * 0.65
      armSwingL = -Math.sin(ph) * 0.55
      armSwingR = Math.sin(ph) * 0.55
      lift = Math.abs(Math.sin(ph)) * 0.06
    } else if (acting) {
      switch (action) {
        case 's1p1': // big morning stretch and a yawn
          armSwingL = -2.9; armSwingR = -2.9
          armOutL = 0.35 + Math.sin(t * 3) * 0.08; armOutR = -0.35 - Math.sin(t * 3) * 0.08
          headNod = -0.18
          lift = Math.sin(Math.min(1, since / 0.6) * Math.PI) * 0.06
          yawning = since > 0.2 && since < 1.3
          break
        case 's1p2': // brush, brush, brush
          // Hand beside her mouth, brush held level and pointing in at her
          // teeth, scrubbing side to side.
          armSwingR = -2.1 + Math.sin(t * 28) * 0.05
          armOutR = Math.sin(t * 28) * 0.08
          armSwingL = -0.3
          break
        case 's1p3': // spin into the uniform
          armOutL = 0.6; armOutR = -0.6
          lift = since < 0.9 ? Math.sin((since / 0.9) * Math.PI) * 0.25 : 0
          break
        case 's1p4': { // bowl in one hand, spoon to mouth with the other
          armSwingL = -1.25; armOutL = 0.4
          const bite = (Math.sin(t * 6.5) + 1) / 2
          armSwingR = -1.5 - bite * 0.6; armOutR = 0
          headNod = bite * 0.08
          break
        }
        case 's1p5': // backpack on, wave goodbye, head for the door
          armSwingR = -2.7
          armOutR = -0.3 + Math.sin(t * 14) * 0.35
          lift = since < 0.5 ? Math.sin((since / 0.5) * Math.PI) * 0.2 : 0
          break
        default:
          lift = since < 0.55 ? Math.sin((since / 0.55) * Math.PI) * 0.38 : 0
          armSwingR = -2.6
          armOutR = -0.25 + Math.sin(t * 16) * 0.3
          armSwingL = since < 0.55 ? -0.6 : 0
      }
    } else if (mood === 'oops') {
      headYaw = Math.sin(t * 13) * 0.4 * Math.max(0, 1 - since / 1.2)
      headTilt = 0.12
      armOutL = 0.25
      armOutR = -0.25
    } else if (mood === 'cheer') {
      const c = (t * 1.6) % 1
      lift = Math.sin(c * Math.PI) * 0.32
      armSwingL = -2.9
      armSwingR = -2.9
      armOutL = 0.35 + Math.sin(t * 10) * 0.1
      armOutR = -0.35 - Math.sin(t * 10) * 0.1
    } else {
      lift = Math.sin(t * 2.4) * 0.012
      // Watches your finger / mouse, like a Talking Tom.
      headYaw = THREE.MathUtils.clamp(pointer.x, -1, 1) * 0.55
      headNod = -THREE.MathUtils.clamp(pointer.y, -1, 1) * 0.22
      headTilt = Math.sin(t * 0.9) * 0.05
    }
    if (tickled && !(moving && !(w.rising && k < 0.6))) {
      // Giggle: little hops, wiggling head, hands to tummy.
      lift = Math.abs(Math.sin(tk * 11)) * 0.16
      headTilt = Math.sin(tk * 18) * 0.18
      headYaw = 0
      headNod = -0.1
      armSwingL = -0.9; armSwingR = -0.9
      armOutL = -0.45; armOutR = 0.45
      yawning = true
    }

    legL.current.rotation.x += (legSwing - legL.current.rotation.x) * damp
    legR.current.rotation.x += (-legSwing - legR.current.rotation.x) * damp
    armL.current.rotation.x += (armSwingL - armL.current.rotation.x) * damp
    armR.current.rotation.x += (armSwingR - armR.current.rotation.x) * damp
    armL.current.rotation.z += (armOutL - armL.current.rotation.z) * damp
    armR.current.rotation.z += (armOutR - armR.current.rotation.z) * damp
    body.current.position.y += (lift - body.current.position.y) * Math.min(1, dt * 20)
    head.current.rotation.y += (headYaw - head.current.rotation.y) * damp
    head.current.rotation.z += (headTilt - head.current.rotation.z) * damp
    head.current.rotation.x += (headNod - head.current.rotation.x) * damp

    // Blink every few seconds (eyes squeezed shut mid-yawn).
    if (eyes.current) eyes.current.scale.y = yawning ? 0.2 : (t % 3.6) < 0.12 ? 0.15 : 1
    // Smile, or a small frown when it's not the right step.
    if (mouth.current) {
      mouth.current.visible = !yawning
      mouth.current.rotation.z = mood === 'oops' ? 0 : Math.PI
    }
    if (yawn.current) yawn.current.visible = yawning

    // Speech bubble stays above the head, whatever the body is doing.
    anchor.current?.position.set(r.position.x, r.position.y + 2.45 * scale, r.position.z)
  })

  return (
    <>
      <group
        ref={root}
        position={look.asleep ? BED_POSE.toArray() : start.toArray()}
        scale={scale}
        onPointerDown={poke}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <group ref={body}>
          {/* legs, pivoting at the hips */}
          {[[-0.12, legL], [0.12, legR]].map(([x, ref]) => (
            <group key={x as number} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 0.72, 0]}>
              <mesh position={[0, -0.32, 0]}><capsuleGeometry args={[0.085, 0.42, 6, 12]} /><Mat color={look.dressed ? '#2b2f3a' : '#353944'} /></mesh>
              {look.dressed && <mesh position={[0, -0.5, 0]}><cylinderGeometry args={[0.092, 0.092, 0.16, 12]} /><Mat color="#ffffff" /></mesh>}
              <mesh position={[0, -0.66, 0.06]} scale={[1, 0.6, 1.5]}><sphereGeometry args={[0.1, 14, 10]} /><Mat color={look.dressed ? '#1d1f26' : '#ffffff'} rough={0.5} /></mesh>
            </group>
          ))}
          {look.dressed ? (
            <>
              {/* school uniform: navy blazer over a white shirt, red tie, plaid skirt */}
              <mesh position={[0, 0.98, 0]} scale={[1, 1, 0.78]}><capsuleGeometry args={[0.25, 0.3, 8, 16]} /><Mat color={BLAZER} /></mesh>
              <mesh position={[0, 1.06, 0.17]} scale={[0.55, 1, 0.35]}><sphereGeometry args={[0.2, 14, 10]} /><Mat color="#ffffff" /></mesh>
              <Box size={[0.06, 0.24, 0.03]} pos={[0, 1.02, 0.235]} color="#c43a3a" r={0.012} />
              <mesh position={[0, 0.66, 0]}><cylinderGeometry args={[0.24, 0.34, 0.26, 20]} /><Mat color="#33467a" /></mesh>
              {[-0.6, 0, 0.6, 1.2, 1.8, 2.4].map(a => (
                <mesh key={a} position={[Math.sin(a) * 0.29, 0.66, Math.cos(a) * 0.29]} rotation={[0, a, 0.08]}><boxGeometry args={[0.025, 0.26, 0.01]} /><Mat color="#6c82bd" /></mesh>
              ))}
            </>
          ) : (
            <>
              {/* hoodie */}
              <mesh position={[0, 0.98, 0]} scale={[1, 1, 0.78]}><capsuleGeometry args={[0.25, 0.3, 8, 16]} /><Mat color={HOODIE} /></mesh>
              <mesh position={[0, 1.22, -0.02]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.15, 0.05, 8, 20]} /><Mat color="#a88ad8" /></mesh>
              <mesh position={[0, 0.86, 0.19]} scale={[1, 0.6, 0.4]}><sphereGeometry args={[0.15, 14, 10]} /><Mat color="#a88ad8" /></mesh>
            </>
          )}
          {/* backpack, once it's packed and on */}
          {look.backpack && (
            <group position={[0, 0.68, -0.28]} scale={0.62}>
              <Box size={[0.55, 0.7, 0.32]} pos={[0, 0.36, 0]} color="#3f5fa8" r={0.14} />
              <Box size={[0.42, 0.3, 0.1]} pos={[0, 0.25, -0.18]} color="#5476c4" r={0.06} />
              <mesh position={[0, 0.5, -0.17]} rotation={[0, Math.PI, 0]}><circleGeometry args={[0.08, 20]} /><Mat color="#f6d65a" /></mesh>
              {[-0.18, 0.18].map(x => <Box key={x} size={[0.06, 0.6, 0.05]} pos={[x, 0.42, 0.42]} color="#2f4a86" r={0.02} />)}
            </group>
          )}
          {/* arms, pivoting at the shoulders */}
          {[[-0.31, armL], [0.31, armR]].map(([x, ref]) => (
            <group key={x as number} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 1.17, 0]}>
              <mesh position={[0, -0.22, 0]}><capsuleGeometry args={[0.072, 0.32, 6, 12]} /><Mat color={look.dressed ? BLAZER : HOODIE} /></mesh>
              <mesh position={[0, -0.45, 0]}><sphereGeometry args={[0.07, 12, 10]} /><Mat color={SKIN} /></mesh>
              {(x as number) > 0 ? (
                <>
                  {/* toothbrush */}
                  <group ref={brush} position={[0, -0.5, 0.05]} rotation={[-0.8, 0, -1.6]} visible={false}>
                    <Box size={[0.035, 0.3, 0.035]} pos={[0, -0.1, 0]} color="#5fa8e0" r={0.012} />
                    <Box size={[0.05, 0.07, 0.06]} pos={[0, -0.26, 0.03]} color="#ffffff" r={0.015} />
                  </group>
                  {/* spoon */}
                  <group ref={spoon} position={[0, -0.5, 0.04]} rotation={[-0.3, 0, -1.6]} visible={false}>
                    <Box size={[0.025, 0.24, 0.02]} pos={[0, -0.08, 0]} color="#c9ced4" r={0.008} />
                    <mesh position={[0, -0.22, 0.01]} scale={[1, 1.3, 0.5]}><sphereGeometry args={[0.04, 10, 8]} /><meshStandardMaterial color="#c9ced4" metalness={0.6} roughness={0.3} /></mesh>
                  </group>
                </>
              ) : (
                <group ref={bowl} position={[0.06, -0.5, 0.1]} rotation={[1.25, 0, 0]} visible={false}>
                  {/* a shallow cereal bowl, open side up toward her */}
                  <mesh scale={[1, 0.45, 1]}><sphereGeometry args={[0.12, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color="#7cc3d6" roughness={0.4} side={THREE.DoubleSide} /></mesh>
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}><circleGeometry args={[0.115, 18]} /><Mat color="#fff4dc" /></mesh>
                  {[['#f2c94c', -0.04, 0.02], ['#e86a6a', 0.035, -0.03], ['#8e6bd8', 0.01, 0.045]].map(([c, bx, bz], i) => (
                    <mesh key={i} position={[bx as number, 0.01, bz as number]}><sphereGeometry args={[0.025, 8, 6]} /><Mat color={c as string} /></mesh>
                  ))}
                </group>
              )}
            </group>
          ))}
          {/* head */}
          <group ref={head} position={[0, 1.56, 0]} scale={1.22}>
            <mesh><sphereGeometry args={[0.27, 28, 22]} /><Mat color={SKIN} rough={0.7} /></mesh>
            <mesh position={[0, 0.04, -0.02]} rotation={[-0.45, 0, 0]}><sphereGeometry args={[0.29, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56]} /><Mat color={HAIR} rough={0.6} /></mesh>
            <mesh position={[0, 0.12, -0.28]} rotation={[0.5, 0, 0]} scale={[0.55, 1.15, 0.55]}><sphereGeometry args={[0.16, 16, 12]} /><Mat color={HAIR} rough={0.6} /></mesh>
            <mesh position={[0, 0.0, -0.4]} scale={[0.5, 1.3, 0.5]}><sphereGeometry args={[0.13, 14, 10]} /><Mat color={HAIR} rough={0.6} /></mesh>
            <mesh position={[0, 0.2, -0.26]} rotation={[1.1, 0, 0]}><torusGeometry args={[0.06, 0.02, 8, 16]} /><Mat color={look.dressed ? '#c43a3a' : HOODIE} /></mesh>
            <group ref={eyes} position={[0, 0.0, 0.245]}>
              {[-0.09, 0.09].map(x => (
                <group key={x} position={[x, 0, 0]}>
                  <mesh scale={[1, 1.25, 0.6]}><sphereGeometry args={[0.04, 14, 10]} /><Mat color="#2b2f33" rough={0.3} /></mesh>
                  <mesh position={[0.012, 0.015, 0.02]}><sphereGeometry args={[0.011, 8, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
                </group>
              ))}
            </group>
            {[-0.16, 0.16].map(x => (
              <mesh key={x} position={[x, -0.07, 0.215]} scale={[1, 0.6, 0.3]}><sphereGeometry args={[0.05, 12, 8]} /><meshStandardMaterial color="#f2a29a" transparent opacity={0.7} /></mesh>
            ))}
            <mesh ref={mouth} position={[0, -0.1, 0.255]} rotation={[0, 0, Math.PI]}><torusGeometry args={[0.045, 0.012, 6, 16, Math.PI]} /><Mat color="#7a3b2e" /></mesh>
            <mesh ref={yawn} position={[0, -0.11, 0.25]} scale={[0.8, 1.1, 0.4]} visible={false}><sphereGeometry args={[0.055, 14, 10]} /><Mat color="#7a3b2e" /></mesh>
            {/* toothpaste foam while brushing */}
            <group ref={foam} position={[0, -0.13, 0.26]} visible={false}>
              {[[-0.05, 0], [0.03, 0.01], [0.07, -0.02], [-0.01, -0.03]].map(([fx, fy], i) => (
                <mesh key={i} position={[fx, fy, 0]}><sphereGeometry args={[0.028, 8, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
              ))}
            </group>
          </group>
        </group>
      </group>
      {look.asleep && (
        <group position={[BED_POSE.x - 0.9, BED_POSE.y + 0.55, BED_POSE.z]}>
          <Html center zIndexRange={[24, 20]} style={{ pointerEvents: 'none' }}>
            <div style={{ position: 'relative', width: 60, height: 70, fontWeight: 800, color: '#4a6fa5', fontFamily: 'inherit' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ position: 'absolute', left: 8 + i * 14, bottom: 0, fontSize: 16 + i * 6, animation: `ss-zzz 2.4s ease-in-out ${i * 0.8}s infinite`, opacity: 0 }}>Z</span>
              ))}
            </div>
          </Html>
        </group>
      )}
      <group ref={anchor}>
        {(tickle || says) && (
          <Html center zIndexRange={[25, 20]} style={{ pointerEvents: 'none' }}>
            <div key={tickle || says} style={{
              position: 'relative', background: '#fff', color: '#173a5e', fontSize: 13, fontWeight: 700, padding: '6px 11px', borderRadius: 12,
              boxShadow: '0 4px 12px rgba(23,58,94,.18)', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
              animation: 'ss-say3 .25s ease-out',
            }}>
              {tickle || says}
              <span style={{ position: 'absolute', top: '100%', left: '50%', marginLeft: -6, borderWidth: 6, borderStyle: 'solid', borderColor: '#fff transparent transparent transparent' }} />
            </div>
          </Html>
        )}
      </group>
    </>
  )
}

// --- "Getting Ready for School": the full home, laid out like the mockup ----
//
// Bedroom on the left (bed, nightstand with the alarm clock, chair with the
// uniform, wardrobe), the bathroom through a doorway, the kitchen through an
// opening, and the front door with the backpack on the right. Each step lives
// where it would in a real home, rather than on a row of stands.

const SCHOOL_WALL = '#bcd8ec'
const SCHOOL_BACK = -3.6

interface SchoolSpot { bubble: [number, number, number]; stand: [number, number, number] }
const SCHOOL_SPOTS: Record<string, SchoolSpot> = {
  s1p1: { bubble: [-5.4, 1.85, -3.1], stand: [-5.0, 0, -1.9] },  // alarm clock on the nightstand
  s1p3: { bubble: [-3.4, 2.15, -2.5], stand: [-3.0, 0, -1.2] },  // uniform on the chair
  s1p2: { bubble: [0.4, 2.15, -5.5], stand: [0.4, 0, -4.5] },    // bathroom sink
  s1p4: { bubble: [3.9, 2.05, -4.6], stand: [3.6, 0, -3.5] },    // kitchen island
  s1p5: { bubble: [7.35, 1.75, -3.15], stand: [6.6, 0, -2.3] },  // backpack by the front door
}
const SCHOOL_START = new THREE.Vector3(0.3, 0, -0.5)

function useCanvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 512, repeat?: [number, number]) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d')!, w, h)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repeat[0], repeat[1])
    }
    return t
    // Drawn once per mount; the draw functions are static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** A poster with hand-lettered text, drawn to a canvas (no font downloads). */
function Poster({ pos, size, lines, bg = '#f4ead8', ink = '#2f5d8a', rot }: { pos: [number, number, number]; size: [number, number]; lines: string[]; bg?: string; ink?: string; rot?: [number, number, number] }) {
  const tex = useCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fs = Math.floor(h / (lines.length + 1.6))
    ctx.font = `600 ${fs}px "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive`
    lines.forEach((l, i) => ctx.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)))
  }, 256, Math.round(256 * (size[1] / size[0])))
  return (
    <group position={pos} rotation={rot}>
      <Box size={[size[0] + 0.08, size[1] + 0.08, 0.04]} pos={[0, 0, 0]} color="#ffffff" r={0.02} />
      <mesh position={[0, 0, 0.025]}><planeGeometry args={size} /><meshStandardMaterial map={tex} roughness={0.9} /></mesh>
    </group>
  )
}

function SchoolRoom({ look, ate }: { look: KidLook; ate: boolean }) {
  const frontDoor = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    // The front door swings open once she heads off to school.
    const d = frontDoor.current
    if (d) d.rotation.y += ((look.backpack ? -1.35 : 0) - d.rotation.y) * Math.min(1, dt * 3)
  })
  const planks = useCanvasTexture((ctx, w, h) => {
    const rows = 8
    const rh = h / rows
    const tones = ['#d9a36b', '#cf9861', '#e0ad77', '#c98f5a', '#d6a06a']
    for (let r = 0; r < rows; r++) {
      let x = -((r * 97) % 180)
      let k = r
      while (x < w) {
        const len = 160 + ((k * 53) % 140)
        ctx.fillStyle = tones[k % tones.length]
        ctx.fillRect(x, r * rh, len, rh)
        ctx.fillStyle = 'rgba(90,50,20,0.10)'
        for (let g = 0; g < 4; g++) ctx.fillRect(x + 8, r * rh + 8 + g * (rh / 4.5), len - 16, 1.5)
        ctx.fillStyle = 'rgba(70,40,15,0.35)'
        ctx.fillRect(x, r * rh, 2, rh)
        x += len
        k++
      }
      ctx.fillStyle = 'rgba(70,40,15,0.35)'
      ctx.fillRect(0, r * rh, w, 2)
    }
  }, 512, 512, [5, 3])

  const tiles = useCanvasTexture((ctx, w, h) => {
    const n = 8
    const s = w / n
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#7fbfe3' : '#9ccfec'
      ctx.fillRect(i * s, j * s, s, s)
    }
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke() }
  }, 256, 256, [2, 1])

  const rugTex = useCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#9fbfe0'
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#c9dcef'
    ctx.lineWidth = 14
    for (let r = w * 0.18; r < w / 2; r += w * 0.09) { ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke() }
    ctx.fillStyle = '#efe4cf'
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * w * 0.09, h / 2 + Math.sin(a) * w * 0.09, w * 0.075, 0, Math.PI * 2); ctx.fill()
    }
  }, 256, 256)

  const wallMat = <Mat color={SCHOOL_WALL} rough={0.95} emissive={SCHOOL_WALL} ei={0.28} />
  const wallH = 4.8
  // The back wall, with a doorway (bathroom) and a wide opening (kitchen).
  const segments: [number, number][] = [[-9.6, -0.75], [1.55, 2.35], [5.35, 9.6]]
  const lintels: [number, number][] = [[-0.75, 1.55], [2.35, 5.35]]

  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[22, 9]} />
        <meshStandardMaterial map={planks} roughness={0.55} />
      </mesh>

      {/* back wall */}
      {segments.map(([a, b]) => (
        <group key={a}>
          <mesh position={[(a + b) / 2, wallH / 2, SCHOOL_BACK]}><boxGeometry args={[b - a, wallH, 0.12]} />{wallMat}</mesh>
          <Box size={[b - a, 0.2, 0.06]} pos={[(a + b) / 2, 0.1, SCHOOL_BACK + 0.08]} color="#ffffff" r={0.02} />
        </group>
      ))}
      {lintels.map(([a, b]) => (
        <group key={a}>
          <mesh position={[(a + b) / 2, 2.7 + (wallH - 2.7) / 2, SCHOOL_BACK]}><boxGeometry args={[b - a, wallH - 2.7, 0.12]} />{wallMat}</mesh>
          {/* white trim around the opening */}
          <Box size={[b - a + 0.24, 0.14, 0.18]} pos={[(a + b) / 2, 2.72, SCHOOL_BACK + 0.04]} color="#ffffff" r={0.03} />
          <Box size={[0.14, 2.72, 0.18]} pos={[a - 0.05, 1.36, SCHOOL_BACK + 0.04]} color="#ffffff" r={0.03} />
          <Box size={[0.14, 2.72, 0.18]} pos={[b + 0.05, 1.36, SCHOOL_BACK + 0.04]} color="#ffffff" r={0.03} />
        </group>
      ))}

      {/* ===== Bedroom (left) ===== */}
      <Poster pos={[-8.3, 3.05, SCHOOL_BACK + 0.08]} size={[1.15, 1.5]} lines={['Big', 'Dreams', '♥']} />
      <Poster pos={[-6.9, 2.7, SCHOOL_BACK + 0.08]} size={[0.75, 0.95]} lines={['✿']} bg="#cfe6f2" ink="#f2b84b" />
      {/* cork board with photos */}
      <group position={[-3.6, 2.85, SCHOOL_BACK + 0.08]}>
        <Box size={[1.15, 0.95, 0.05]} pos={[0, 0, 0]} color="#c99a6b" r={0.02} />
        {[[-0.28, 0.15, '#9cc7e3'], [0.2, 0.18, '#f4c6a0'], [-0.2, -0.2, '#bfe3b0'], [0.27, -0.18, '#f7e3a1']].map(([x, y, c], i) => (
          <mesh key={i} position={[x as number, y as number, 0.03]} rotation={[0, 0, (i - 1.5) * 0.08]}><planeGeometry args={[0.32, 0.28]} /><Mat color={c as string} /></mesh>
        ))}
      </group>
      {/* shelf with books and a plant */}
      <Box size={[1.4, 0.08, 0.34]} pos={[-5.9, 3.2, SCHOOL_BACK + 0.2]} color="#c99a6b" r={0.02} />
      <Plant pos={[-6.3, 3.24, SCHOOL_BACK + 0.2]} s={0.4} />
      {[['#4f7fbf', 0], ['#7cc3d6', 0.14], ['#3a5f9a', 0.26]].map(([c, dx]) => (
        <Box key={c as string} size={[0.11, 0.42, 0.26]} pos={[-5.6 + (dx as number), 3.45, SCHOOL_BACK + 0.2]} color={c as string} r={0.02} />
      ))}

      {/* bed, side-on like the mockup */}
      <group position={[-7.55, 0, -2.45]}>
        <Box size={[3.3, 0.45, 2.0]} pos={[0, 0.3, 0]} color="#b8875c" r={0.06} />
        <Box size={[3.2, 0.26, 1.92]} pos={[0, 0.62, 0]} color="#ffffff" r={0.1} />
        <Box size={[2.3, 0.18, 2.0]} pos={[0.5, 0.78, 0.02]} color="#6fb8c9" r={0.09} />
        <Box size={[2.3, 0.05, 0.2]} pos={[0.5, 0.86, 1.0]} color="#5aa6b8" r={0.02} />
        <Box size={[0.75, 0.24, 1.3]} pos={[-1.15, 0.86, -0.1]} color="#f7f7f7" r={0.1} />
        {/* the flower pillow */}
        <group position={[-1.05, 1.05, 0.55]} rotation={[-0.25, 0.5, 0]}>
          {Array.from({ length: 6 }, (_, k) => {
            const a = (k / 6) * Math.PI * 2
            return <mesh key={k} position={[Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0]} scale={[1, 1, 0.5]}><sphereGeometry args={[0.14, 14, 10]} /><Mat color="#ffffff" /></mesh>
          })}
          <mesh scale={[1, 1, 0.6]}><sphereGeometry args={[0.12, 14, 10]} /><Mat color="#f6c445" /></mesh>
        </group>
        <Box size={[0.14, 1.35, 2.05]} pos={[-1.68, 0.68, 0]} color="#a97a50" r={0.05} />
        <Box size={[0.12, 0.85, 2.05]} pos={[1.68, 0.43, 0]} color="#a97a50" r={0.05} />
      </group>

      {/* tucked in under the covers while asleep */}
      {look.asleep && <Box size={[2.25, 0.32, 1.55]} pos={[-7.0, 1.12, -2.45]} color="#6fb8c9" r={0.14} />}

      {/* nightstand with the ringing alarm clock and a lamp */}
      <group position={[-5.4, 0, -3.1]}>
        <Box size={[0.85, 0.72, 0.6]} pos={[0, 0.36, 0]} color="#c99a6b" r={0.04} />
        <Box size={[0.7, 0.22, 0.04]} pos={[0, 0.45, 0.31]} color="#d8ab7d" r={0.02} />
        <mesh position={[0, 0.45, 0.34]}><sphereGeometry args={[0.03, 8, 6]} /><Mat color="#8a6a48" /></mesh>
        <AlarmClock pos={[-0.12, 0.89, 0.08]} ringing={look.asleep} />
        <mesh position={[0.25, 0.8, -0.08]}><cylinderGeometry args={[0.07, 0.1, 0.16, 12]} /><Mat color="#f1ece4" /></mesh>
        <mesh position={[0.25, 1.0, -0.08]}><cylinderGeometry args={[0.1, 0.18, 0.24, 16, 1, true]} /><meshStandardMaterial color="#fff4dc" emissive="#ffe8b8" emissiveIntensity={0.8} side={THREE.DoubleSide} /></mesh>
      </group>
      <pointLight position={[-5.15, 1.1, -2.9]} intensity={0.6} distance={3} color="#ffd9a0" />

      {/* chair with the school uniform */}
      <group position={[-3.4, 0, -2.5]} rotation={[0, 0.35, 0]}>
        <Chair pos={[0, 0, 0]} color="#d4a676" />
        {/* the uniform waits on the chair until she puts it on */}
        {!look.dressed && (
          <>
            <Box size={[0.64, 0.5, 0.07]} pos={[0, 1.08, -0.25]} color="#f4f7fb" r={0.03} />
            <Box size={[0.2, 0.12, 0.05]} pos={[0, 1.27, -0.2]} color="#f4f7fb" r={0.02} />
            <Box size={[0.72, 0.6, 0.1]} pos={[0, 1.0, -0.32]} color="#2f4f8a" r={0.04} />
            <Box size={[0.66, 0.4, 0.42]} pos={[0, 0.72, 0.0]} color="#33467a" r={0.04} />
            {[-0.2, 0, 0.2].map(x => <Box key={x} size={[0.03, 0.41, 0.43]} pos={[x, 0.72, 0.0]} color="#5d72a8" r={0.01} />)}
          </>
        )}
      </group>

      {/* wardrobe */}
      <group position={[-1.95, 0, -3.15]}>
        <Box size={[1.45, 2.95, 0.72]} pos={[0, 1.48, 0]} color="#f6f6f3" r={0.05} />
        <Box size={[0.02, 2.6, 0.02]} pos={[0, 1.5, 0.37]} color="#d9d9d4" r={0.005} />
        {[-0.12, 0.12].map(x => <Box key={x} size={[0.05, 0.5, 0.05]} pos={[x, 1.5, 0.39]} color="#c8c8c2" r={0.02} />)}
      </group>
      <Plant pos={[-4.35, 0, -3.15]} s={1.15} />

      {/* rug and beanbag */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.0, 0.012, 0.3]} scale={[1.5, 1, 1]}>
        <circleGeometry args={[1.25, 48]} />
        <meshStandardMaterial map={rugTex} roughness={1} />
      </mesh>
      <mesh position={[-7.7, 0.45, 0.7]} scale={[1.2, 0.75, 1.1]}><sphereGeometry args={[0.7, 24, 18]} /><Mat color="#7fb7c9" /></mesh>

      {/* ===== Bathroom (through the doorway) ===== */}
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.4, 0.003, -4.8]}><planeGeometry args={[2.3, 2.4]} /><meshStandardMaterial map={tiles} roughness={0.4} /></mesh>
        <mesh position={[0.4, 0.7, -5.98]}><planeGeometry args={[2.3, 1.4]} /><meshStandardMaterial map={tiles} roughness={0.4} /></mesh>
        <mesh position={[0.4, 3.0, -5.98]}><planeGeometry args={[2.3, 3.2]} /><Mat color="#d8ecf7" emissive="#d8ecf7" ei={0.3} /></mesh>
        <mesh position={[-0.75, 2.4, -4.8]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.4, 4.8]} /><Mat color="#cfe6f4" emissive="#cfe6f4" ei={0.3} /></mesh>
        <mesh position={[1.55, 2.4, -4.8]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[2.4, 4.8]} /><Mat color="#cfe6f4" emissive="#cfe6f4" ei={0.3} /></mesh>
        {/* sink, mirror, toothbrush cup */}
        <group position={[0.4, 0, -5.55]}>
          <mesh position={[0, 0.42, 0]}><cylinderGeometry args={[0.13, 0.19, 0.84, 18]} /><Mat color="#ffffff" rough={0.35} /></mesh>
          <Box size={[0.95, 0.2, 0.6]} pos={[0, 0.92, 0.02]} color="#ffffff" r={0.08} />
          <mesh position={[0, 1.0, 0.04]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 0.65, 1]}><circleGeometry args={[0.32, 24]} /><Mat color="#e3eef5" rough={0.2} /></mesh>
          <mesh position={[0, 1.12, -0.22]} rotation={[0.6, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.24, 8]} /><meshStandardMaterial color="#c0c7cf" metalness={0.6} roughness={0.2} /></mesh>
          <Box size={[0.85, 1.0, 0.05]} pos={[0, 1.9, -0.4]} color="#ffffff" r={0.04} />
          <mesh position={[0, 1.9, -0.37]}><planeGeometry args={[0.72, 0.86]} /><meshStandardMaterial color="#e5f3fb" roughness={0.05} metalness={0.4} /></mesh>
          <mesh position={[0.36, 1.1, 0.08]}><cylinderGeometry args={[0.06, 0.05, 0.16, 12]} /><Mat color="#7cc3d6" /></mesh>
          <Box size={[0.03, 0.26, 0.03]} pos={[0.36, 1.24, 0.08]} color="#f07fa0" r={0.01} rot={[0, 0, 0.2]} />
          <Box size={[0.03, 0.26, 0.03]} pos={[0.39, 1.23, 0.06]} color="#5fa8e0" r={0.01} rot={[0, 0, -0.15]} />
        </group>
        <Box size={[0.08, 0.7, 0.42]} pos={[1.5, 1.2, -5.2]} color="#ffffff" r={0.03} />
        <Plant pos={[1.2, 0, -5.7]} s={0.55} />
        <Box size={[0.9, 0.02, 0.55]} pos={[0.4, 0.012, -4.5]} color="#4f7fbf" r={0.01} />
        {/* the door, swung open into the bathroom */}
        <group position={[-0.68, 0, -3.66]} rotation={[0, 1.25, 0]}>
          <Box size={[1.12, 2.55, 0.07]} pos={[0.56, 1.28, 0]} color="#6fa2cf" r={0.03} />
          <mesh position={[0.98, 1.15, 0.05]}><sphereGeometry args={[0.045, 10, 8]} /><meshStandardMaterial color="#e3c26b" metalness={0.6} roughness={0.3} /></mesh>
        </group>
        <pointLight position={[0.4, 2.3, -4.7]} intensity={0.9} distance={4} color="#ffffff" />
      </group>

      {/* ===== Kitchen (through the opening) ===== */}
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.85, 0.003, -5.0]}><planeGeometry args={[3.0, 2.8]} /><meshStandardMaterial map={planks} roughness={0.55} /></mesh>
        <mesh position={[3.85, 2.4, -6.38]}><planeGeometry args={[3.0, 4.8]} /><Mat color="#d6e9f5" emissive="#d6e9f5" ei={0.3} /></mesh>
        <mesh position={[2.35, 2.4, -5.0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.8, 4.8]} /><Mat color="#cfe3f2" emissive="#cfe3f2" ei={0.3} /></mesh>
        <mesh position={[5.35, 2.4, -5.0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[2.8, 4.8]} /><Mat color="#cfe3f2" emissive="#cfe3f2" ei={0.3} /></mesh>
        <Window pos={[4.35, 2.15, -6.33]} />
        {/* fridge */}
        <Box size={[0.8, 2.15, 0.7]} pos={[2.85, 1.08, -5.95]} color="#d3d9de" r={0.06} />
        <Box size={[0.04, 0.5, 0.04]} pos={[3.18, 1.4, -5.58]} color="#9aa3aa" r={0.015} />
        {/* counter along the back */}
        <Box size={[2.05, 0.9, 0.6]} pos={[4.3, 0.45, -6.05]} color="#ffffff" r={0.03} />
        <Box size={[2.15, 0.07, 0.66]} pos={[4.3, 0.93, -6.03]} color="#cfc7ba" r={0.02} />
        <Plant pos={[5.0, 0.96, -6.1]} s={0.38} />
        <Plant pos={[3.7, 0.96, -6.1]} s={0.32} />
        {/* island with breakfast: fruit bowl and orange juice */}
        <group position={[3.9, 0, -4.6]}>
          <Box size={[1.7, 0.9, 0.85]} pos={[0, 0.45, 0]} color="#ffffff" r={0.04} />
          <Box size={[1.82, 0.08, 0.95]} pos={[0, 0.94, 0]} color="#cfc7ba" r={0.03} />
          <mesh position={[-0.3, 1.04, 0]} scale={[1, 0.55, 1]}><sphereGeometry args={[0.26, 22, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><Mat color="#ffffff" rough={0.4} /></mesh>
          {!ate && [['#f2c94c', -0.38, 0.03], ['#e86a6a', -0.24, 0.06], ['#8e6bd8', -0.31, -0.08], ['#f29c50', -0.2, -0.05], ['#7cc77a', -0.42, -0.06]].map(([c, x, z], i) => (
            <mesh key={i} position={[x as number, 1.09, z as number]}><sphereGeometry args={[0.065, 10, 8]} /><Mat color={c as string} /></mesh>
          ))}
          {/* juice glass: full, then empty after breakfast */}
          <mesh position={[0.32, ate ? 1.03 : 1.15, 0.05]} scale={[1, ate ? 0.3 : 1, 1]}><cylinderGeometry args={[0.09, 0.08, 0.36, 18]} /><meshStandardMaterial color="#ffad3b" roughness={0.2} transparent opacity={0.9} /></mesh>
          <mesh position={[0.32, 1.15, 0.05]}><cylinderGeometry args={[0.095, 0.085, 0.37, 18, 1, true]} /><meshStandardMaterial color="#ffffff" transparent opacity={0.25} roughness={0.1} /></mesh>
        </group>
        <pointLight position={[3.85, 2.4, -4.8]} intensity={0.8} distance={4.5} color="#fff6e6" />
      </group>

      {/* ===== Front door with the backpack (right) ===== */}
      <group position={[6.75, 0, SCHOOL_BACK + 0.08]}>
        <Box size={[1.42, 2.62, 0.08]} pos={[0, 1.31, 0]} color="#ffffff" r={0.03} />
        {/* sunny outside, seen when the door opens */}
        <mesh position={[0, 1.24, 0.045]}><planeGeometry args={[1.2, 2.48]} /><meshBasicMaterial color="#fff6cf" /></mesh>
        <mesh position={[0, 0.35, 0.05]}><planeGeometry args={[1.2, 0.7]} /><meshBasicMaterial color="#a9dc8f" /></mesh>
        <group ref={frontDoor} position={[-0.6, 0, 0.1]}>
          <Box size={[1.2, 2.48, 0.08]} pos={[0.6, 1.24, 0]} color="#a8693f" r={0.03} />
          {[[0.6, 1.75], [0.6, 0.65]].map(([x, y], i) => <Box key={i} size={[0.85, 0.8, 0.04]} pos={[x, y, 0.05]} color="#b97a4c" r={0.03} />)}
          <mesh position={[1.03, 1.2, 0.09]}><sphereGeometry args={[0.055, 12, 10]} /><meshStandardMaterial color="#e3c26b" metalness={0.6} roughness={0.3} /></mesh>
        </group>
      </group>
      <Box size={[1.5, 0.03, 0.75]} pos={[6.75, 0.015, -2.95]} color="#9a8f86" r={0.01} />
      <group position={[7.4, 0, -3.15]} scale={1.25} visible={!look.backpack}>
        <Backpack pos={[0, 0, 0]} />
        <mesh position={[0, 0.5, 0.17]}><circleGeometry args={[0.07, 20]} /><Mat color="#f6d65a" /></mesh>
      </group>
      {/* coat hook with a green jacket */}
      <Box size={[0.3, 0.05, 0.1]} pos={[5.75, 2.25, SCHOOL_BACK + 0.12]} color="#8a6a48" r={0.02} />
      <Box size={[0.32, 0.65, 0.12]} pos={[5.75, 1.9, SCHOOL_BACK + 0.15]} color="#4f8a5e" r={0.06} />
      <Poster pos={[8.65, 2.9, SCHOOL_BACK + 0.08]} size={[1.0, 1.35]} lines={['You', 'got', 'this!', '♥']} />

      {/* foreground plants framing the room */}
      <Plant pos={[-9.0, 0, 0.8]} s={1.5} />
      <Plant pos={[8.9, 0, 0.6]} s={1.6} />
    </group>
  )
}

// --- Spots, footprints, camera --------------------------------------------

function FloorGlow({ pos, color, dim }: { pos: THREE.Vector3; color: string; dim: boolean }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.opacity = dim ? 0.25 : 0.4 + Math.sin(clock.elapsedTime * 3) * 0.15
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pos.x, 0.02, pos.z]}>
      <ringGeometry args={[0.32, 0.55, 40]} />
      <meshStandardMaterial ref={ref} color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.4} depthWrite={false} />
    </mesh>
  )
}

function Footprints({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const group = useRef<THREE.Group>(null)
  const prints = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(to, from)
    const len = dir.length()
    const n = Math.max(3, Math.min(9, Math.floor(len / 0.7)))
    const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize().multiplyScalar(0.13)
    const ang = Math.atan2(dir.x, dir.z)
    return Array.from({ length: n }, (_, i) => {
      const p = from.clone().lerp(to, (i + 0.5) / (n + 0.5)).add(side.clone().multiplyScalar(i % 2 ? 1 : -1))
      return { p, ang }
    })
  }, [from, to])
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.children.forEach((c, i) => {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial
      const ph = (clock.elapsedTime * 1.4 - i * 0.18) % 1.6
      m.opacity = 0.3 + Math.max(0, Math.sin(Math.max(0, ph) * Math.PI)) * 0.7
    })
  })
  return (
    <group ref={group}>
      {prints.map(({ p, ang }, i) => (
        <mesh key={i} position={[p.x, 0.025, p.z]} rotation={[-Math.PI / 2, 0, -ang]} scale={[0.8, 1.3, 1]}>
          <circleGeometry args={[0.11, 16]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/* The school steps get the mockup's solid icon bubbles; other steps show their emoji. */
const SPOT_ICONS: Partial<Record<string, LucideIcon>> = { s1p1: AlarmIcon, s1p2: Toothbrush, s1p3: Shirt, s1p4: Utensils, s1p5: BackpackIcon }

function SpotBubble({ spot, at, showCaption, onSpot }: { spot: SceneSpot; at: THREE.Vector3; showCaption: boolean; onSpot: (id: string) => void }) {
  const done = spot.status === 'done'
  const wrong = spot.status === 'wrong'
  const edge = done ? '#2f9e62' : wrong ? '#d4553a' : spot.color
  const Icon = SPOT_ICONS[spot.id]
  return (
    <Html position={at.toArray()} center zIndexRange={[19, 10]}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {spot.ring && (
          <span aria-hidden style={{ position: 'absolute', left: '50%', top: 31, width: 62, height: 62, borderRadius: '50%', border: `3px solid ${spot.color}`, animation: 'ss-ring3 1.4s ease-out infinite', pointerEvents: 'none' }} />
        )}
        <button
          className="ss-spot3"
          disabled={!spot.clickable}
          onClick={() => spot.clickable && onSpot(spot.id)}
          aria-label={spot.caption}
          style={{
            ['--c' as string]: `${spot.color}aa`,
            position: 'relative', width: 62, height: 62, borderRadius: '50%', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
            background: Icon
              ? `radial-gradient(circle at 35% 30%, ${edge}cc, ${edge} 70%)`
              : done ? '#e9f7ef' : wrong ? '#fde3dd' : `radial-gradient(circle at 35% 30%, #fff, ${spot.color}40 78%)`,
            border: Icon ? '4px solid #ffffff' : `3px solid ${edge}`, cursor: spot.clickable ? 'pointer' : 'default',
            opacity: done && !spot.playing ? 0.8 : 1,
            transform: spot.playing ? 'scale(1.18)' : undefined,
            animation: wrong ? 'ss-shake3 .45s ease 2' : done && !spot.playing ? undefined : 'ss-float3 2.6s ease-in-out infinite, ss-glow 2s ease-in-out infinite',
          }}
        >
          {Icon
            ? <Icon size={30} color="#ffffff" strokeWidth={2.4} style={{ pointerEvents: 'none' }} />
            : <span style={{ lineHeight: 1, pointerEvents: 'none' }}>{spot.emoji}</span>}
          <span aria-hidden style={{ position: 'absolute', bottom: -7, left: '50%', width: 12, height: 12, marginLeft: -6, transform: 'rotate(45deg)', background: edge, borderRadius: 2, zIndex: -1 }} />
          {spot.badge && (
            <span style={{
              position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, padding: '0 4px',
              background: wrong ? '#d4553a' : done ? '#2f9e62' : '#173a5e', color: '#fff', fontSize: 11.5, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.25)', animation: 'ss-chip .3s ease',
            }}>{spot.badge}</span>
          )}
        </button>
        {showCaption && (
          <span style={{ marginTop: 9, fontSize: 11, fontWeight: 700, color: '#173a5e', background: 'rgba(255,255,255,0.88)', borderRadius: 8, padding: '1px 7px', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
            {spot.caption}
          </span>
        )}
        {spot.burst && (
          <span aria-hidden key={spot.burstKey} style={{ position: 'absolute', left: '50%', top: 0, pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: 0, bottom: 0, fontSize: 38, animation: 'ss-burst .9s ease-out forwards' }}>{spot.emoji}</span>
            {Array.from({ length: 8 }, (_, k) => {
              const a = (k / 8) * Math.PI * 2
              return <span key={k} style={{
                position: 'absolute', left: 0, top: 30, width: 8, height: 8, borderRadius: '50%', background: k % 2 ? spot.color : '#ffd34d',
                ['--dx' as string]: `${Math.cos(a) * 52}px`, ['--dy' as string]: `${Math.sin(a) * 52 - 18}px`,
                animation: 'ss-spark .7s ease-out forwards',
              }} />
            })}
          </span>
        )}
      </div>
    </Html>
  )
}

/** Keeps the whole room in frame at any aspect ratio, drifting a little with the character. */
interface Framing {
  /** Half the width / height that must stay in view, in world units. */
  halfW: number
  halfH: number
  /** The camera sits `dist` back from z0, raised by baseY + dist * elev. */
  z0: number
  baseY: number
  elev: number
  look: [number, number, number]
  /** How much the camera drifts with the character, 0–1. */
  follow: number
}
const ROW_FRAMING: Framing = { halfW: 7.6, halfH: 2.9, z0: -0.9, baseY: 1.3, elev: 0.36, look: [0, 1.55, -1.2], follow: 0.12 }
const SCHOOL_FRAMING: Framing = { halfW: 8.7, halfH: 2.55, z0: -2.2, baseY: 1.35, elev: 0.17, look: [0.2, 1.6, -2.6], follow: 0.05 }

/* Close-up angles for each school action: offset from her, so the camera
   comes round to watch her do it. Anything else gets a friendly front shot. */
const ACTION_SHOTS: Record<string, [number, number, number]> = {
  s1p1: [1.3, 1.7, 3.0],   // waking: from the foot of the bed
  s1p2: [0.2, 1.6, 3.0],   // brushing: through the bathroom door
  s1p3: [0.6, 1.5, 3.1],   // dressing: slow orbit round the spin
  s1p4: [-0.9, 1.6, 2.9],  // breakfast: across the kitchen island
  s1p5: [-1.5, 1.8, 3.4],  // leaving: wide enough to see the door open
}
const DEFAULT_SHOT: [number, number, number] = [0.3, 1.7, 3.3]

/** A little film director: wide shot while choosing, tracking shot while she
    walks, close-up while she does the step, then back out to the whole room. */
function CameraRig({ kidPos, framing, mood, action, asleep }: {
  kidPos: React.MutableRefObject<THREE.Vector3>; framing: Framing; mood: KidMood; action: string | null; asleep: boolean
}) {
  const { camera, size } = useThree()
  const look = useRef(new THREE.Vector3(...framing.look))
  const shotT0 = useRef(0)
  const lastShot = useRef('')
  useFrame(({ clock }, dt) => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const kp = kidPos.current
    const want = new THREE.Vector3()
    const wantLook = new THREE.Vector3()
    // Close shots back off a little on narrow screens so she stays in frame.
    const narrow = Math.max(1, 1.9 / aspect)
    const shot = mood === 'walk' ? 'walk' : mood === 'act' || mood === 'oops' || mood === 'cheer' ? `close:${action ?? ''}:${mood}` : 'wide'
    if (shot !== lastShot.current) { lastShot.current = shot; shotT0.current = clock.elapsedTime }
    const since = clock.elapsedTime - shotT0.current
    const eyeY = asleep ? kp.y + 0.25 : kp.y + 1.25

    if (shot === 'walk') {
      want.set(kp.x * 0.9, 2.5, kp.z + 6.0 * narrow)
      wantLook.set(kp.x, eyeY - 0.1, kp.z - 1.2)
    } else if (shot !== 'wide') {
      const o = (mood === 'act' && action && ACTION_SHOTS[action]) || DEFAULT_SHOT
      const off = new THREE.Vector3(o[0], o[1], o[2] * narrow)
      if (asleep) off.set(1.6, 1.4, 2.6 * narrow)
      // The dressing spin gets a slow orbit; everything else a gentle push-in.
      if (mood === 'act' && action === 's1p3') off.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(since * 1.2) * 0.5)
      else off.multiplyScalar(1 - Math.min(0.12, since * 0.06))
      want.copy(kp).add(off)
      wantLook.set(kp.x, eyeY, kp.z - 0.3)
    } else {
      const dist = Math.max(framing.halfH / half, framing.halfW / (half * aspect))
      want.set(kp.x * framing.follow, framing.baseY + dist * framing.elev, framing.z0 + dist)
      wantLook.set(framing.look[0] + kp.x * framing.follow * 0.8, framing.look[1], framing.look[2])
    }
    // Ease rather than cut, a bit quicker going in than coming back out.
    const k = 1 - Math.exp(-dt * (shot === 'wide' ? 1.8 : 2.6))
    cam.position.lerp(want, k)
    look.current.lerp(wantLook, k)
    cam.lookAt(look.current)
  })
  return null
}

// --- The scene ------------------------------------------------------------

function Scene({ storyId, spots, kidAt, mood, kidSays, guideId, showCaptions, walkMs, onSpot, doneIds, actionId }: SocialStoryScene3DProps) {
  const theme = THEMES[storyId] ?? THEMES.custom
  // The school story is a whole home with each step in its real place; the
  // others put their steps on a row of stands in a themed room.
  const isHome = storyId === 'getting-ready-school' && spots.length > 0 && spots.every(s => SCHOOL_SPOTS[s.id])

  const layout = useMemo(() => {
    const station = new Map<string, THREE.Vector3>()
    const stand = new Map<string, THREE.Vector3>()
    const bubble = new Map<string, THREE.Vector3>()
    spots.forEach((s, i) => {
      if (isHome) {
        const h = SCHOOL_SPOTS[s.id]
        stand.set(s.id, new THREE.Vector3(...h.stand))
        bubble.set(s.id, new THREE.Vector3(...h.bubble))
      } else {
        const p = stationPos(i, spots.length)
        station.set(s.id, p)
        stand.set(s.id, standPos(p))
        // Back-row bubbles float a little higher, so neighbouring captions don't collide.
        bubble.set(s.id, new THREE.Vector3(p.x, propTop(s.id) + (i % 2 ? 0 : 0.55) + 0.75, p.z))
      }
    })
    return { station, stand, bubble }
    // Positions depend on which steps exist and their order, not their status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHome, spots.map(s => s.id).join('|')])

  const start = isHome ? SCHOOL_START : START

  /* What the story has changed so far. Waking up counts at once (getting out of
     bed IS the walk over); the rest show once she has arrived to do them, so the
     uniform isn't on before she reaches the chair. */
  const doneKey = doneIds.join('|')
  const [shown, setShown] = useState<string[]>(doneIds)
  useEffect(() => {
    if (mood !== 'walk') setShown(doneIds)
    else setShown(prev => prev.filter(id => doneIds.includes(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, mood])
  const look: KidLook = {
    asleep: isHome && !doneIds.includes('s1p1'),
    dressed: isHome && shown.includes('s1p3'),
    backpack: isHome && shown.includes('s1p5'),
  }
  const ate = isHome && shown.includes('s1p4')

  const kidTarget = useMemo(() => (look.asleep ? BED_POSE : (kidAt && layout.stand.get(kidAt)) || start), [look.asleep, kidAt, layout, start])
  const kidPos = useRef(start.clone())
  const guideTo = guideId ? layout.stand.get(guideId) ?? null : null

  return (
    <>
      <color attach="background" args={[isHome ? '#e8f3fb' : theme.sky]} />
      <fog attach="fog" args={[isHome ? '#e8f3fb' : theme.sky, 22, 40]} />
      <hemisphereLight args={['#ffffff', '#f3e7d6', 1.1]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[0, 4, 12]} intensity={0.55} />
      <directionalLight
        position={isHome ? [-5, 9, 7] : [4, 9, 6]} intensity={1.5} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={9} shadow-camera-bottom={-7} shadow-bias={-0.0004}
      />
      <pointLight position={[0, 3.5, 2]} intensity={0.4} color="#fff3dc" />

      <Shadowed>
        {isHome ? <SchoolRoom look={look} ate={ate} /> : <Room storyId={storyId} theme={theme} />}
        {!isHome && spots.map(s => (
          <group key={s.id} position={layout.station.get(s.id)!}>
            <StepProp id={s.id} color={s.color} />
          </group>
        ))}
        <Kid key={isHome ? 'home' : 'row'} target={kidTarget} start={start} scale={isHome ? 1.2 : 1} mood={mood} says={kidSays} walkMs={walkMs} look={look} action={actionId} posOut={kidPos} />
      </Shadowed>

      {spots.map(s => (
        <FloorGlow key={`g-${s.id}`} pos={layout.stand.get(s.id)!} color={s.status === 'done' ? '#2f9e62' : s.color} dim={s.status === 'done'} />
      ))}
      {guideTo && mood !== 'walk' && <Footprints from={kidTarget} to={guideTo} />}
      {/* Bubbles step aside while the camera is in close on her (walking or
          acting): nothing can be picked then anyway, and they'd cover her face. */}
      {mood !== 'walk' && mood !== 'act' && spots.filter(s => !(s.id === kidAt && s.status === 'done')).map(s => (
        <SpotBubble key={`b-${s.id}`} spot={s} at={layout.bubble.get(s.id)!} showCaption={showCaptions && !isHome} onSpot={onSpot} />
      ))}

      <ContactShadows position={[0, 0.015, 0]} scale={24} blur={2.4} opacity={0.35} far={4} resolution={512} />
      <CameraRig kidPos={kidPos} framing={isHome ? SCHOOL_FRAMING : ROW_FRAMING} mood={mood} action={actionId} asleep={look.asleep} />
    </>
  )
}

/** No WebGL (old tablet, blocked GPU): say so — the cards below still play the game. */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20, color: 'rgba(23,58,94,0.6)', fontSize: 14 }}>
          The 3D room can&apos;t run on this device. Use the step cards below to play.
        </div>
      )
    }
    return this.props.children
  }
}

export default function SocialStoryScene3D(props: SocialStoryScene3DProps) {
  return (
    <WebGLBoundary>
      <Canvas
        shadows
        flat
        dpr={[1, 1.75]}
        camera={{ fov: 40, position: [0, 3, 8], near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Scene {...props} />
      </Canvas>
    </WebGLBoundary>
  )
}
