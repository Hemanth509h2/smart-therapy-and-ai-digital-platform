'use client'

import { motion } from 'motion/react'
import type { Setting } from './sceneTypes'

/* Layered scene background — sky gradient → distant depth → midground detail →
   floor texture → classmate silhouettes. Themed per setting. */
export const BG_CFG: Record<Setting, { sky: [string, string]; floor: string; floorY: number }> = {
  classroom: { sky: ['#f4e8d2', '#e7d3ae'], floor: '#d7bf93', floorY: 132 },
  hallway: { sky: ['#e2e7ec', '#c8d0d9'], floor: '#b6bec8', floorY: 136 },
  playground: { sky: ['#c3e6f7', '#93d1ee'], floor: '#8ccd77', floorY: 130 },
  park: { sky: ['#c8ebfb', '#9ad4f0'], floor: '#84c568', floorY: 134 },
  home: { sky: ['#f7e6d2', '#f0cba8'], floor: '#c99b6e', floorY: 132 },
  canteen: { sky: ['#f4e4c8', '#e7cb9c'], floor: '#c8a069', floorY: 132 },
}

export function SceneBackground({ setting, timeOfDay = 'day' }: { setting: Setting; timeOfDay?: 'day' | 'afternoon' }) {
  const cfg = BG_CFG[setting]
  const fy = cfg.floorY
  const tile = setting === 'classroom' || setting === 'hallway' || setting === 'canteen'
  const grass = setting === 'playground' || setting === 'park'
  const wood = setting === 'home'
  return (
    <svg viewBox="0 0 420 190" width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id={`bg-${setting}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cfg.sky[0]} /><stop offset="1" stopColor={cfg.sky[1]} />
        </linearGradient>
      </defs>
      {/* background */}
      <rect x="0" y="0" width="420" height="190" fill={`url(#bg-${setting})`} />
      {/* depth layer — drifting clouds + distant hills (outdoor) */}
      {grass && (
        <>
          <motion.g animate={{ x: [0, 30, 0] }} transition={{ duration: 36, repeat: Infinity, ease: 'easeInOut' }}>
            <ellipse cx="90" cy="46" rx="26" ry="12" fill="#fff" opacity="0.7" />
            <ellipse cx="112" cy="42" rx="20" ry="14" fill="#fff" opacity="0.7" />
          </motion.g>
          <motion.g animate={{ x: [0, -24, 0] }} transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}>
            <ellipse cx="300" cy="38" rx="24" ry="11" fill="#fff" opacity="0.65" />
            <ellipse cx="320" cy="34" rx="18" ry="13" fill="#fff" opacity="0.65" />
          </motion.g>
          <ellipse cx="70" cy={fy} rx="110" ry="34" fill="#8bb896" opacity="0.6" />
          <ellipse cx="250" cy={fy} rx="130" ry="44" fill="#6d9b78" opacity="0.5" />
          <ellipse cx="400" cy={fy} rx="120" ry="30" fill="#8bb896" opacity="0.55" />
        </>
      )}
      {/* midground details */}
      {setting === 'classroom' && (
        <g>
          <rect x="36" y="34" width="70" height="52" rx="4" fill="#bcd4e6" stroke="#9fb6c6" strokeWidth="3" />
          <line x1="71" y1="34" x2="71" y2="86" stroke="#9fb6c6" strokeWidth="3" />
          <line x1="36" y1="60" x2="106" y2="60" stroke="#9fb6c6" strokeWidth="3" />
          <rect x="300" y="70" width="86" height="10" rx="2" fill="#a9814f" />
          <rect x="308" y="80" width="8" height="40" fill="#8a6a40" />
          <rect x="370" y="80" width="8" height="40" fill="#8a6a40" />
        </g>
      )}
      {setting === 'hallway' && (
        <g>
          <rect x="40" y="46" width="46" height="76" rx="3" fill="#a7b0ba" />
          <rect x="46" y="52" width="34" height="66" rx="2" fill="#8f99a4" />
          <circle cx="74" cy="86" r="2.5" fill="#e8c86a" />
          <rect x="330" y="46" width="46" height="76" rx="3" fill="#a7b0ba" />
          <rect x="336" y="52" width="34" height="66" rx="2" fill="#8f99a4" />
          <circle cx="342" cy="86" r="2.5" fill="#e8c86a" />
        </g>
      )}
      {(setting === 'playground' || setting === 'park') && (
        <g>
          <circle cx="360" cy="42" r="20" fill="#ffe07a" opacity="0.85" />
          <rect x="60" y="70" width="10" height="60" fill="#8a5a34" />
          <circle cx="65" cy="62" r="28" fill="#5faa54" />
          <circle cx="48" cy="70" r="18" fill="#68b95c" />
          <circle cx="84" cy="70" r="18" fill="#68b95c" />
          {setting === 'park' && (
            <g>
              <rect x="150" y="110" width="70" height="8" rx="2" fill="#9a6a3c" />
              <rect x="156" y="118" width="6" height="16" fill="#7a5230" />
              <rect x="208" y="118" width="6" height="16" fill="#7a5230" />
            </g>
          )}
        </g>
      )}
      {setting === 'home' && (
        <g>
          <rect x="40" y="44" width="48" height="80" rx="3" fill="#b98a5c" />
          <rect x="46" y="50" width="36" height="74" rx="2" fill="#a5794d" />
          <circle cx="76" cy="88" r="2.5" fill="#e8c86a" />
          <rect x="330" y="40" width="30" height="6" rx="3" fill="#d8b06a" />
          <path d="M338 46 L352 46 L358 66 L332 66 Z" fill="#ffe6a8" opacity="0.8" />
        </g>
      )}
      {setting === 'canteen' && (
        <g>
          <rect x="40" y="86" width="120" height="12" rx="3" fill="#b98a5c" />
          <rect x="46" y="98" width="108" height="22" fill="#a5794d" />
          <circle cx="300" cy="108" r="9" fill="#c98a52" />
          <circle cx="340" cy="108" r="9" fill="#c98a52" />
        </g>
      )}
      {/* background silhouette classmates — child proportions */}
      <g opacity="0.45">
        <circle cx="28" cy={fy - 30} r="8" fill="#8a7560" />
        <rect x="17" y={fy - 22} width="22" height="24" rx="6" fill="#8a7560" />
      </g>
      <g opacity="0.45">
        <circle cx="394" cy={fy - 30} r="8" fill="#8a7560" />
        <rect x="383" y={fy - 22} width="22" height="24" rx="6" fill="#8a7560" />
      </g>
      {/* foreground floor */}
      <rect x="0" y={fy} width="420" height={190 - fy} fill={cfg.floor} />
      {tile && [70, 140, 210, 280, 350].map((x) => (
        <line key={x} x1={x} y1={fy} x2={x} y2="190" stroke="#000" strokeWidth="1" opacity="0.08" />
      ))}
      {wood && [fy + 12, fy + 30].map((y) => (
        <line key={y} x1="0" y1={y} x2="420" y2={y} stroke="#000" strokeWidth="1" opacity="0.08" />
      ))}
      {grass && [30, 90, 150, 210, 270, 330, 390].map((x) => (
        <path key={x} d={`M${x} ${fy + 8} l3 -8 l3 8 z`} fill="#5fae52" opacity="0.5" />
      ))}
      {timeOfDay === 'afternoon' && (
        <rect x="0" y="0" width="420" height="190" fill="#ffb45a" opacity="0.12" />
      )}
    </svg>
  )
}
