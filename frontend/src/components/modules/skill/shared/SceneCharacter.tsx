import type { Pose } from './sceneTypes'

/* Character pose lookup — each pose maps to eyebrow curve, eye size and mouth
   path. (Right-arm gesture stays fixed in the validated SVG.) */
export const POSE_CONFIG: Record<Pose, {
  browL: string; browR: string; eyeRy: number; mouth: string
}> = {
  neutral: { browL: 'M38 21 Q43 17 48 20', browR: 'M62 20 Q67 17 72 21', eyeRy: 5, mouth: 'M47 41 Q55 38 63 41' },
  worried: { browL: 'M38 18 Q43 13 48 18', browR: 'M62 18 Q67 13 72 18', eyeRy: 6.5, mouth: 'M51 39 Q55 44 59 39 Q55 42 51 39 Z' },
  happy: { browL: 'M38 21 Q43 17 48 20', browR: 'M62 20 Q67 17 72 21', eyeRy: 4.5, mouth: 'M46 38 Q55 47 64 38' },
  surprised: { browL: 'M38 16 Q43 11 48 16', browR: 'M62 16 Q67 11 72 16', eyeRy: 7, mouth: 'M51 40 Q55 45 59 40 Q55 43 51 40 Z' },
  sad: { browL: 'M38 22 Q43 19 48 23', browR: 'M62 23 Q67 19 72 22', eyeRy: 5, mouth: 'M47 42 Q55 38 63 42' },
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

export interface SceneCharacterProps { pose: Pose; shirtColor?: string; id: string }

export function SceneCharacter({ pose, shirtColor = '#4a7c6f', id }: SceneCharacterProps) {
  const p = POSE_CONFIG[pose]
  const shirtColorLight = shade(shirtColor, 26)
  const shirtColorDark = shade(shirtColor, -28)
  return (
    <svg viewBox="0 0 110 150" width="100%" height="100%" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`skinGrad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e8b088" />
          <stop offset="100%" stopColor="#d4956a" />
        </linearGradient>
        <linearGradient id={`shirtGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={shirtColorLight} />
          <stop offset="100%" stopColor={shirtColorDark} />
        </linearGradient>
        <linearGradient id={`hairGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4a3020" />
          <stop offset="100%" stopColor="#2e1c10" />
        </linearGradient>
        <radialGradient id={`cheekGrad-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8636b" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e8636b" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="55" cy="147" rx="30" ry="5" fill="#000" opacity="0.15" />
      <rect x="38" y="108" width="14" height="34" rx="6" fill="#3a4a5a" />
      <rect x="58" y="108" width="14" height="34" rx="6" fill="#3a4a5a" />
      <ellipse cx="45" cy="143" rx="9" ry="5" fill="#2a2420" />
      <ellipse cx="65" cy="143" rx="9" ry="5" fill="#2a2420" />

      <path d="M32 62 Q30 100 34 112 L76 112 Q80 100 78 62 Q78 52 55 50 Q32 52 32 62 Z" fill={`url(#shirtGrad-${id})`} />
      <path d="M46 52 L55 62 L64 52 L58 50 L52 50 Z" fill="#fff" opacity="0.85" />

      <path d="M33 60 Q22 68 20 88 Q19 96 22 100" stroke={`url(#shirtGrad-${id})`} strokeWidth="13" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="100" r="7" fill={`url(#skinGrad-${id})`} />

      <path d="M77 60 Q86 66 84 78 Q82 86 74 90" stroke={`url(#shirtGrad-${id})`} strokeWidth="13" fill="none" strokeLinecap="round" id={`rightArm-${id}`} />
      <circle cx="74" cy="90" r="7" fill={`url(#skinGrad-${id})`} id={`rightHand-${id}`} />

      <rect x="48" y="42" width="14" height="14" rx="4" fill={`url(#skinGrad-${id})`} />
      <ellipse cx="55" cy="28" rx="24" ry="26" fill={`url(#skinGrad-${id})`} />
      <ellipse cx="30" cy="29" rx="4" ry="6" fill={`url(#skinGrad-${id})`} />
      <ellipse cx="80" cy="29" rx="4" ry="6" fill={`url(#skinGrad-${id})`} />

      <path d="M30 22 Q28 4 55 3 Q82 4 80 22 Q80 12 68 10 Q60 8 55 10 Q50 8 42 10 Q30 12 30 22 Z" fill={`url(#hairGrad-${id})`} />
      <path d="M30 20 Q26 26 28 34 Q29 24 32 20 Z" fill={`url(#hairGrad-${id})`} />
      <path d="M80 20 Q84 26 82 34 Q81 24 78 20 Z" fill={`url(#hairGrad-${id})`} />

      <path d={p.browL} stroke="#3a2415" strokeWidth="2" fill="none" strokeLinecap="round" id={`browL-${id}`} />
      <path d={p.browR} stroke="#3a2415" strokeWidth="2" fill="none" strokeLinecap="round" id={`browR-${id}`} />

      <ellipse cx="43" cy="27" rx="4.2" ry={p.eyeRy} fill="#fff" id={`eyeL-${id}`} />
      <ellipse cx="67" cy="27" rx="4.2" ry={p.eyeRy} fill="#fff" id={`eyeR-${id}`} />
      <circle cx="43.5" cy="28" r="3" fill="#3a2415" />
      <circle cx="67.5" cy="28" r="3" fill="#3a2415" />
      <circle cx="44.5" cy="26.5" r="1" fill="#fff" />
      <circle cx="68.5" cy="26.5" r="1" fill="#fff" />

      <circle cx="37" cy="35" r="7" fill={`url(#cheekGrad-${id})`} />
      <circle cx="73" cy="35" r="7" fill={`url(#cheekGrad-${id})`} />

      <path d="M53 30 Q52 34 54 35 Q56 35 57 34" stroke="#c17f4f" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity="0.6" />

      <path d={p.mouth} stroke="#8a4a30" strokeWidth="2.2" fill="none" strokeLinecap="round" id={`mouth-${id}`} />
    </svg>
  )
}
