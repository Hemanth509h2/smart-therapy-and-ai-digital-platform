// Pure data for the themed social stories (no rendering): who stands where,
// what she and the cast do at each step, and what they say. Shared by the
// three.js and Babylon.js renderers.

export type V3 = [number, number, number]


/** One arm pose: [swing, out] per arm (right arm out + = away from the body,
    left arm out - = away), head nod/tilt and the little motions on top. */
export interface Pose {
  r?: [number, number]
  l?: [number, number]
  nod?: number
  tilt?: number
  /** A single hop as the step starts. */
  hop?: number
  /** Continuous bouncing / slow breathing / trembling. */
  bounce?: number
  breathe?: number
  jitter?: number
  /** Right hand waving (out swing) / shaking (forward swing), and head nodding. */
  waveR?: number
  shakeR?: number
  nodWob?: number
}

export function evalPose(p: Pose, t: number, since: number) {
  const r = p.r ?? [0, -0.08]
  const l = p.l ?? [0, 0.08]
  return {
    aR: r[0] + Math.sin(t * 10) * (p.shakeR ?? 0),
    oR: r[1] + Math.sin(t * 14) * (p.waveR ?? 0),
    aL: l[0],
    oL: l[1],
    nod: (p.nod ?? 0) + Math.sin(t * 3) * (p.nodWob ?? 0),
    tilt: p.tilt ?? 0,
    lift:
      (since < 0.4 ? Math.sin((since / 0.4) * Math.PI) * (p.hop ?? 0) : 0) +
      Math.abs(Math.sin(t * 5)) * (p.bounce ?? 0) +
      ((Math.sin(t * 1.6) + 1) / 2) * (p.breathe ?? 0) +
      Math.abs(Math.sin(t * 14)) * (p.jitter ?? 0),
  }
}

export const WAVE: Pose = { r: [-2.6, -0.25], l: [-0.2, 0.08], waveR: 0.3, tilt: 0.08 }
export const OPEN_HANDS: Pose = { r: [-1.1, -0.5], l: [-1.1, 0.5], tilt: 0.14, nodWob: 0.05 }
export const HAND_UP: Pose = { r: [-3.05, -0.12], l: [-0.2, 0.08] }
export const CHEER_ARMS: Pose = { r: [-2.9, -0.35], l: [-2.9, 0.35] }

/** What she does at each step (hand-tuned arm angles; the brush and spoon
    steps of the school story have their own, in Kid). */
export const KID_POSES: Record<string, Pose> = {
  // meeting someone new
  s2p1: { r: [-1.5, -0.12], l: [-0.2, 0.08], nod: 0.06, hop: 0.16 },
  s2p2: WAVE,
  s2p3: { r: [-1.45, -0.55], l: [-0.3, 0.08], shakeR: 0.1, nod: 0.1 },
  s2p4: OPEN_HANDS,
  // when I feel angry
  s3p1: { r: [-0.2, 0.35], l: [-0.2, -0.35], shakeR: 0.12, nod: 0.25, bounce: 0.05 },
  s3p2: { r: [-1.5, 0.05], l: [-1.5, -0.05], breathe: 0.07 },
  s3p3: { r: [-2.0, -0.55], l: [-0.2, 0.08], tilt: 0.12, nod: -0.05 },
  s3p4: OPEN_HANDS,
  s3p5: { r: [-0.1, -0.05], l: [-0.1, 0.05], breathe: 0.03, tilt: 0.05 },
  // going to the doctor
  s4p1: WAVE,
  s4p2: { r: [-0.9, -0.5], l: [-0.9, 0.5], breathe: 0.015 },
  s4p3: { ...HAND_UP, nod: 0.05, hop: 0.1 },
  s4p4: { r: [-0.3, 0.5], l: [-0.3, -0.5], breathe: 0.04 },
  s4p5: { ...WAVE, nod: 0.15 },
  // sharing with a friend
  s5p1: { r: [-1.2, -0.5], l: [-1.0, 0.4], bounce: 0.03 },
  s5p2: { r: [-1.2, -0.5], l: [-1.0, 0.4], tilt: 0.1, nod: 0.05 },
  s5p3: { r: [-1.5, -0.1], l: [-0.4, 0.1], nod: 0.08, hop: 0.08 },
  s5p4: { r: [-1.0, -0.3], l: [-0.9, 0.3], shakeR: 0.25, bounce: 0.08 },
  // asking for help
  s6p1: { r: [-2.9, -0.15], l: [-0.2, 0.08], waveR: 0.12, tilt: 0.12 },
  s6p2: { ...HAND_UP, hop: 0.06 },
  s6p3: OPEN_HANDS,
  s6p4: { r: [-2.9, 0.3], l: [-0.2, 0.08], waveR: 0.2, hop: 0.12, bounce: 0.05 },
  // handling disappointment
  s7p1: { ...CHEER_ARMS, bounce: 0.14 },
  s7p2: { r: [-0.1, 0.1], l: [-0.1, -0.1], nod: 0.3, tilt: 0.1 },
  s7p3: { r: [-2.0, -0.55], l: [-2.0, 0.55], nod: 0.25, jitter: 0.01 },
  s7p4: { r: [-1.3, -0.75], l: [-0.2, 0.08], tilt: 0.1, nod: 0.1, breathe: 0.04 },
  s7p5: { r: [-2.9, -0.35], l: [-0.2, 0.08], nod: -0.2, tilt: 0.05, bounce: 0.06 },
  // going to a birthday party
  s8p1: { r: [-1.4, -0.5], l: [-1.1, 0.4], nod: 0.3, hop: 0.1 },
  s8p2: { r: [-1.2, -0.5], l: [-0.2, 0.08], hop: 0.08 },
  s8p3: { r: [-1.2, -0.5], l: [-0.3, 0.08], bounce: 0.04 },
  s8p4: { r: [-1.45, -0.1], l: [-0.2, 0.08], hop: 0.1 },
  s8p5: { ...CHEER_ARMS, bounce: 0.12 },
  s8p6: WAVE,
}

/** What she carries in her right hand at a step. */
export const HELD: Record<string, 'toy' | 'gift' | 'letter'> = {
  s5p1: 'toy', s5p2: 'toy', s5p3: 'toy',
  s8p1: 'letter', s8p2: 'gift', s8p3: 'gift', s8p4: 'gift',
}

export interface NpcDef {
  key: string
  pos: V3
  rotY?: number
  shirt: string
  pants?: string
  hair?: string
  bag?: string
  long?: boolean
  sit?: boolean
  accessory?: 'stethoscope' | 'hat'
  /** How they react while she does each step, and what they say. */
  poses?: Record<string, Pose>
  says?: Record<string, string>
  /** Cheers along when the whole story is done. */
  cheerSays?: string
}

export interface SpotDef { bubble: V3; stand: V3 }
export interface StoryData {
  spots: Record<string, SpotDef>
  start: V3
  sky: string
  halfW?: number
  /** Close-ups aim this far to the side of her. */
  focusDx: number
  npcs: NpcDef[]
  /** Close-up camera offset per step; anything missing gets a friendly front shot. */
  shots?: Record<string, V3>
}

export const spotAt = (x: number, by: number): SpotDef => ({ stand: [x, 0, -0.45], bubble: [x, by, -0.45] })
/** She always walks along the path facing right (+x), toward whoever is there. */
export const PARK_FACING = Math.PI / 2
export const NPC_FACES_KID = -Math.PI / 2

const MUM_POSES: Record<string, Pose> = { s3p1: { tilt: 0.1 }, s3p4: { nod: 0.1, l: [-0.5, 0.3] }, s3p5: { tilt: 0.08, nodWob: 0.04 } }

export const STORY_DATA: Record<string, StoryData> = {
  'meeting-someone-new': {
    spots: { s2p1: spotAt(-4.2, 2.7), s2p2: spotAt(-2.4, 3.3), s2p3: spotAt(-1.0, 2.7), s2p4: spotAt(-1.3, 3.3) },
    start: [-6.4, 0, -0.45], sky: '#bfe3ff', focusDx: 0.7,
    shots: { s2p1: [1.4, 1.7, 4.4], s2p2: [1.2, 1.6, 3.8], s2p3: [0.7, 1.5, 3.1], s2p4: [0.8, 1.6, 3.3] },
    npcs: [
      { key: 'reader', pos: [5.9, 0, -1.4], shirt: '#3d5a99', pants: '#2f3b55', hair: '#2a1d17', long: false, sit: true },
      { key: 'g1', pos: [-6.0, 0, -2.9], rotY: 0.7, shirt: '#5d6b86', pants: '#3a4f7a', hair: '#2a1d17', long: false, bag: '#27344f' },
      { key: 'g2', pos: [-5.0, 0, -2.9], rotY: -0.7, shirt: '#e8dccb', pants: '#3b5d8f', hair: '#3a2a22' },
      { key: 'g3', pos: [-4.0, 0, -3.0], rotY: -1.0, shirt: '#6fa06a', pants: '#3a4f7a', hair: '#2a1d17', long: false, bag: '#27344f' },
      {
        key: 'friend', pos: [0.1, 0, -0.45], rotY: NPC_FACES_KID, shirt: '#f4ede0', hair: '#5a3a2a', bag: '#4b7d6a',
        poses: { s2p1: { tilt: 0.1, hop: 0.1 }, s2p2: WAVE, s2p3: { r: [-1.45, -0.55], shakeR: 0.1, nod: 0.1 }, s2p4: { nodWob: 0.08, l: [-0.9, 0.4], r: [-0.7, -0.4] } },
        says: { s2p2: 'Hello! 😊', s2p3: 'Nice to meet you! 🤝', s2p4: "I'm Riya! 🌸" },
        cheerSays: "Let's be friends! 💛",
      },
    ],
  },
  'when-i-feel-angry': {
    spots: { s3p1: spotAt(-5.2, 2.8), s3p2: spotAt(-3.8, 3.4), s3p3: spotAt(-2.4, 2.8), s3p4: spotAt(1.2, 3.4), s3p5: spotAt(-0.2, 2.8) },
    start: [-7.2, 0, -0.45], sky: '#f3dcc6', focusDx: 0.4,
    npcs: [
      { key: 'sofa', pos: [-4.2, 0, -2.8], rotY: 0.3, shirt: '#3b3b46', pants: '#c9b79a', hair: '#1f1812', long: false, sit: true },
      { key: 'laptop', pos: [5.2, 0, -3.5], rotY: 0, shirt: '#2f3b55', pants: '#2f3b55', hair: '#1f1812', long: false, sit: true },
      {
        key: 'helper', pos: [2.4, 0, -0.45], rotY: NPC_FACES_KID, shirt: '#e0e6f2', pants: '#6b7a8f', hair: '#3a2a22', bag: '#3b4252',
        poses: MUM_POSES, says: { s3p4: 'Thank you for telling me 💛', s3p5: "I'm proud of you! 🌟" }, cheerSays: "I'm proud of you! 🌟",
      },
    ],
  },
  'going-to-doctor': {
    spots: { s4p1: spotAt(-4.9, 2.8), s4p2: spotAt(-2.8, 3.4), s4p3: spotAt(-0.6, 2.8), s4p4: spotAt(0.6, 3.4), s4p5: spotAt(3.3, 2.8) },
    start: [-7.2, 0, -0.45], sky: '#d6efe9', focusDx: 0.6,
    npcs: [
      {
        key: 'reception', pos: [-3.8, 0, -3.5], rotY: 0, shirt: '#58b5a6', hair: '#2a1d17',
        poses: { s4p1: WAVE }, says: { s4p1: 'Welcome! Please take a seat 😊' },
      },
      { key: 'patient', pos: [-1.1, 0, -2.9], rotY: 0, shirt: '#c9a0dc', pants: '#4a5a7a', hair: '#2a1d17', long: false, sit: true },
      {
        key: 'doctor', pos: [1.7, 0, -0.45], rotY: NPC_FACES_KID, shirt: '#ffffff', pants: '#58b5a6', hair: '#2a1d17', long: false, accessory: 'stethoscope',
        poses: { s4p3: { ...WAVE, waveR: 0.2 }, s4p4: { r: [-1.3, -0.5], nodWob: 0.04 }, s4p5: WAVE },
        says: { s4p3: 'Maya? Come in please!', s4p4: 'Deep breath… good!', s4p5: 'Bye, take care! 👋' }, cheerSays: 'Well done! 🌟',
      },
    ],
  },
  'sharing-with-friend': {
    spots: { s5p1: spotAt(-4.8, 2.8), s5p2: spotAt(-2.2, 3.4), s5p3: spotAt(-1.0, 2.8), s5p4: spotAt(-1.2, 3.4) },
    start: [-7.2, 0, -0.45], sky: '#fff6df', focusDx: 0.7,
    npcs: [{
      key: 'friend', pos: [0.2, 0, -0.45], rotY: NPC_FACES_KID, shirt: '#5aa6d6', pants: '#3a4f7a', hair: '#2a1d17', long: false,
      poses: {
        s5p1: { tilt: 0.1 },
        s5p2: { r: [-2.8, -0.3], waveR: 0.25, bounce: 0.06 },
        s5p3: { r: [-1.4, -0.1], hop: 0.1 },
        s5p4: { bounce: 0.1, l: [-1.0, 0.3], r: [-1.0, -0.3], shakeR: 0.2 },
      },
      says: { s5p2: 'Can I play too? 🙋', s5p3: 'Thank you! 🤗', s5p4: 'This is fun! 🎉' }, cheerSays: 'Best friends! 💛',
    }],
  },
  'asking-for-help': {
    spots: { s6p1: spotAt(-4.4, 2.8), s6p2: spotAt(-3.9, 3.4), s6p3: spotAt(-0.8, 2.8), s6p4: spotAt(-0.3, 3.4) },
    start: [-7.0, 0, -0.45], sky: '#f0f7e6', focusDx: 0.6,
    npcs: [
      { key: 's1', pos: [-3.6, 0, -3.0], rotY: 2.7, shirt: '#e8b98a', hair: '#2a1d17', sit: true },
      { key: 's2', pos: [-1.8, 0, -3.0], rotY: 2.7, shirt: '#7cc77a', pants: '#3a4f7a', hair: '#3a2a22', long: false, sit: true },
      {
        key: 'teacher', pos: [1.3, 0, -0.5], rotY: NPC_FACES_KID, shirt: '#8e6bd8', pants: '#3a3f55', hair: '#3a2a22',
        poses: { s6p2: { r: [-1.5, -0.1], nod: 0.1 }, s6p3: { nodWob: 0.06, l: [-0.8, 0.4], tilt: 0.1 }, s6p4: { r: [-2.9, 0.3], bounce: 0.05 } },
        says: { s6p2: 'Yes? Do you have a question?', s6p3: 'Of course, let me help!', s6p4: 'Great job asking! ⭐' }, cheerSays: 'Great job! ⭐',
      },
    ],
  },
  'handling-disappointment': {
    spots: { s7p1: spotAt(-4.6, 2.8), s7p2: spotAt(-3.0, 3.4), s7p3: spotAt(-2.5, 2.8), s7p4: spotAt(-1.0, 3.4), s7p5: spotAt(1.0, 2.8) },
    start: [-7.2, 0, -0.45], sky: '#d5e1f3', focusDx: 0.4,
    npcs: [
      { key: 'p1', pos: [6.0, 0, -3.0], rotY: -2.2, shirt: '#f6c445', pants: '#3b5d8f', hair: '#2a1d17' },
      { key: 'p2', pos: [7.4, 0, -3.2], rotY: 2.2, shirt: '#5aa6d6', pants: '#3a4f7a', hair: '#2a1d17', long: false },
      { key: 'p3', pos: [-6.8, 0, -3.3], rotY: 0.6, shirt: '#ef8fb0', pants: '#3b5d8f', hair: '#5a3a2a' },
    ],
  },
  'birthday-party': {
    spots: {
      s8p1: spotAt(-5.9, 2.8), s8p2: spotAt(-3.5, 3.4), s8p3: spotAt(-1.0, 2.8),
      s8p4: spotAt(0.5, 3.4), s8p5: spotAt(2.9, 2.8), s8p6: spotAt(5.5, 3.4),
    },
    start: [-7.8, 0, -0.45], sky: '#bfe3ff', focusDx: 0.6, halfW: 8.6,
    npcs: [
      {
        key: 'shop', pos: [-2.8, 0, -3.5], rotY: 0, shirt: '#f4a64a', hair: '#3a2a22', long: false,
        poses: { s8p2: { ...WAVE, waveR: 0.2 } }, says: { s8p2: "Here's a present for you! 🎁" },
      },
      {
        key: 'birthday', pos: [1.7, 0, -0.45], rotY: NPC_FACES_KID, shirt: '#f6c445', pants: '#b36ac8', hair: '#2a1d17', accessory: 'hat',
        poses: { s8p3: WAVE, s8p4: { ...CHEER_ARMS, hop: 0.2 }, s8p5: { ...CHEER_ARMS, bounce: 0.12 }, s8p6: WAVE },
        says: { s8p3: 'Welcome to my party! 🎉', s8p4: 'Thank you! 🎁', s8p5: 'Cake time! 🎂', s8p6: 'Bye! Thanks for coming! 👋' }, cheerSays: 'Best party ever! 🎉',
      },
      { key: 'guest1', pos: [4.9, 0, -2.7], rotY: 0.3, shirt: '#7cc77a', pants: '#3a4f7a', hair: '#2a1d17', long: false },
      { key: 'guest2', pos: [3.3, 0, -2.9], rotY: -0.3, shirt: '#ef8fb0', pants: '#3b5d8f', hair: '#5a3a2a' },
    ],
  },
}
