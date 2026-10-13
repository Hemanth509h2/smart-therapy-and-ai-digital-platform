'use client'

// Babylon.js renderer for the themed social stories (everything except the
// getting-ready-for-school home, which still runs on three.js).
//
// Same contract as SocialStoryScene3D: it is told which step spots exist,
// where the character should stand and what mood it is in, and draws that.
// The scenery is a GLB per story (public/assets/story-worlds), lit with PBR
// materials, soft shadows and filmic tone mapping; the girl and the cast are
// built from primitives and animated procedurally with the shared pose data.

import { useEffect, useRef, useState } from 'react'
import {
  Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, HemisphericLight,
  Matrix, Mesh, MeshBuilder, PBRMaterial, PointerEventTypes, Scene, ShadowGenerator,
  TransformNode, UniversalCamera, Vector3, SceneLoader, AbstractMesh,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import type { SocialStoryScene3DProps, SceneSpot } from './SocialStoryScene3D'
import { evalPose, KID_POSES, HELD, STORY_DATA, PARK_FACING, type NpcDef, type Pose, type V3 } from './socialStoryShared'

/* ---------- small helpers ---------- */

const mats = new WeakMap<Scene, Map<string, PBRMaterial>>()
function pbr(scene: Scene, hex: string, rough = 0.65, emissive = 0, alpha = 1): PBRMaterial {
  let m = mats.get(scene)
  if (!m) { m = new Map(); mats.set(scene, m) }
  const key = `${hex}|${rough}|${emissive}|${alpha}`
  let mat = m.get(key)
  if (!mat) {
    mat = new PBRMaterial(`m-${key}`, scene)
    mat.albedoColor = Color3.FromHexString(hex)
    mat.metallic = 0
    mat.roughness = rough
    mat.environmentIntensity = 0.0
    if (emissive) mat.emissiveColor = Color3.FromHexString(hex).scale(emissive)
    if (alpha < 1) { mat.alpha = alpha }
    m.set(key, mat)
  }
  return mat
}

const SKIN = '#f3c6a2'
const HAIR = '#3a2a22'
const HOODIE = '#b99ce7'

type Part = Mesh
function add<T extends Part>(m: T, parent: TransformNode, pos: V3, mat: PBRMaterial, scale?: V3, rot?: V3): T {
  m.parent = parent
  m.position.set(...pos)
  if (scale) m.scaling.set(...scale)
  if (rot) m.rotation.set(...rot)
  m.material = mat
  m.receiveShadows = true
  return m
}

/* ---------- a person ---------- */

interface Human {
  root: TransformNode
  body: TransformNode
  head: TransformNode
  armL: TransformNode
  armR: TransformNode
  legL: TransformNode
  legR: TransformNode
  mouth: Mesh
  eyes: TransformNode
  held: { toy: TransformNode; gift: TransformNode; letter: TransformNode }
  meshes: AbstractMesh[]
  seat: number
}

interface HumanCfg {
  shirt: string
  pants?: string
  hair?: string
  bag?: string
  long?: boolean
  sit?: boolean
  accessory?: 'stethoscope' | 'hat'
  scrunchie?: string
  /** Which hand carries the toy / gift / letter (the camera-side hand shows it). */
  propHand?: 'L' | 'R'
}

function buildHuman(scene: Scene, name: string, c: HumanCfg): Human {
  const root = new TransformNode(`${name}-root`, scene)
  const body = new TransformNode(`${name}-body`, scene)
  body.parent = root
  const shirt = pbr(scene, c.shirt, 0.8)
  const pants = pbr(scene, c.pants ?? '#3b5d8f', 0.8)
  const skin = pbr(scene, SKIN, 0.55)
  const hair = pbr(scene, c.hair ?? '#4a3226', 0.5)
  const shoe = pbr(scene, '#f4f4f4', 0.5)
  // Sitting: hips drop to seat height, thighs point forward.
  const seat = c.sit ? -0.3 : 0

  const legs: TransformNode[] = []
  for (const x of [-0.11, 0.11]) {
    const leg = new TransformNode(`${name}-leg`, scene)
    leg.parent = body
    leg.position.set(x, 0.78, 0)
    leg.rotation.x = c.sit ? -Math.PI / 2 : 0
    add(MeshBuilder.CreateCapsule(`${name}-thigh`, { height: 0.59, radius: 0.085, tessellation: 16 }, scene), leg, [0, -0.32, 0], pants)
    add(MeshBuilder.CreateSphere(`${name}-shoe`, { diameter: 0.2, segments: 14 }, scene), leg, [0, -0.66, 0.06], shoe, [1, 0.6, 1.5])
    legs.push(leg)
  }
  add(MeshBuilder.CreateCapsule(`${name}-torso`, { height: 0.8, radius: 0.25, tessellation: 20 }, scene), body, [0, 0.98, 0], shirt, [1, 1, 0.78])
  if (c.accessory === 'stethoscope') {
    add(MeshBuilder.CreateTorus(`${name}-steth`, { diameter: 0.26, thickness: 0.044, tessellation: 20 }, scene), body, [0, 1.2, 0.1], pbr(scene, '#33414f', 0.4), undefined, [Math.PI / 2.4, 0, 0])
  }
  if (c.bag) {
    add(MeshBuilder.CreateBox(`${name}-bag`, { width: 0.34, height: 0.43, depth: 0.2 }, scene), body, [0, 0.92, -0.28], pbr(scene, c.bag, 0.7))
  }

  const arms: TransformNode[] = []
  for (const x of [-0.31, 0.31]) {
    const arm = new TransformNode(`${name}-arm`, scene)
    arm.parent = body
    arm.position.set(x, 1.17, 0)
    add(MeshBuilder.CreateCapsule(`${name}-sleeve`, { height: 0.464, radius: 0.072, tessellation: 14 }, scene), arm, [0, -0.22, 0], shirt)
    add(MeshBuilder.CreateSphere(`${name}-hand`, { diameter: 0.14, segments: 12 }, scene), arm, [0, -0.45, 0], skin)
    arms.push(arm)
  }
  const [armL, armR] = arms

  // Things she carries, hung on the right hand; shown only at the steps that need them.
  const hand = c.propHand === 'L' ? armL : armR
  const mk = (n: string) => { const g = new TransformNode(`${name}-${n}`, scene); g.parent = hand; g.setEnabled(false); return g }
  const toy = mk('toy'); toy.position.set(0, -0.55, 0.08)
  add(MeshBuilder.CreateBox('toy-a', { width: 0.2, height: 0.1, depth: 0.12 }, scene), toy, [0, 0, 0], pbr(scene, '#e45b5b', 0.5))
  add(MeshBuilder.CreateBox('toy-b', { width: 0.1, height: 0.08, depth: 0.1 }, scene), toy, [0.02, 0.08, 0], pbr(scene, '#f4a64a', 0.5))
  for (const x of [-0.07, 0.07]) add(MeshBuilder.CreateCylinder('toy-w', { height: 0.03, diameter: 0.08 }, scene), toy, [x, -0.05, 0.07], pbr(scene, '#33414f', 0.5), undefined, [0, 0, Math.PI / 2])
  const gift = mk('gift'); gift.position.set(0, -0.7, 0.12)
  add(MeshBuilder.CreateBox('gift-a', { width: 0.3, height: 0.25, depth: 0.3 }, scene), gift, [0, 0.12, 0], pbr(scene, '#e86a9a', 0.5))
  add(MeshBuilder.CreateBox('gift-b', { width: 0.05, height: 0.26, depth: 0.31 }, scene), gift, [0, 0.12, 0], pbr(scene, '#ffffff', 0.5))
  add(MeshBuilder.CreateBox('gift-c', { width: 0.31, height: 0.26, depth: 0.05 }, scene), gift, [0, 0.12, 0], pbr(scene, '#ffffff', 0.5))
  const letter = mk('letter'); letter.position.set(0, -0.52, 0.08)
  add(MeshBuilder.CreateBox('letter-a', { width: 0.2, height: 0.14, depth: 0.02 }, scene), letter, [0, 0, 0], pbr(scene, '#ffffff', 0.6))
  add(MeshBuilder.CreateSphere('letter-h', { diameter: 0.044, segments: 8 }, scene), letter, [0, 0, 0.012], pbr(scene, '#e45b87', 0.5))

  const head = new TransformNode(`${name}-head`, scene)
  head.parent = body
  head.position.set(0, 1.56, 0)
  head.scaling.setAll(1.22)
  add(MeshBuilder.CreateSphere(`${name}-skull`, { diameter: 0.54, segments: 28 }, scene), head, [0, 0, 0], skin)
  const cap = MeshBuilder.CreateSphere(`${name}-hair`, { diameter: 0.58, segments: 24, slice: 0.56, sideOrientation: Mesh.DOUBLESIDE }, scene)
  add(cap, head, [0, 0.07, -0.03], hair, undefined, [-0.85, 0, 0])
  if (c.long !== false) {
    add(MeshBuilder.CreateSphere(`${name}-tail`, { diameter: 0.4, segments: 14 }, scene), head, [0, -0.12, -0.2], hair, [0.9, 1.5, 0.45])
    if (c.scrunchie) add(MeshBuilder.CreateTorus(`${name}-scrunchie`, { diameter: 0.12, thickness: 0.04, tessellation: 14 }, scene), head, [0, 0.2, -0.26], pbr(scene, c.scrunchie, 0.7), undefined, [1.1, 0, 0])
  }
  if (c.accessory === 'hat') add(MeshBuilder.CreateCylinder(`${name}-hat`, { height: 0.4, diameterTop: 0, diameterBottom: 0.32, tessellation: 16 }, scene), head, [0, 0.38, 0], pbr(scene, '#ef6b6b', 0.5), undefined, [-0.1, 0, 0.1])
  const eyes = new TransformNode(`${name}-eyes`, scene)
  eyes.parent = head
  eyes.position.set(0, 0, 0.245)
  for (const x of [-0.09, 0.09]) {
    add(MeshBuilder.CreateSphere(`${name}-eye`, { diameter: 0.08, segments: 12 }, scene), eyes, [x, 0, 0], pbr(scene, '#2b2f33', 0.3), [1, 1.25, 0.6])
    add(MeshBuilder.CreateSphere(`${name}-glint`, { diameter: 0.022, segments: 6 }, scene), eyes, [x + 0.012, 0.015, 0.022], pbr(scene, '#ffffff', 0.2, 1))
  }
  for (const x of [-0.16, 0.16]) {
    add(MeshBuilder.CreateSphere(`${name}-cheek`, { diameter: 0.1, segments: 10 }, scene), head, [x, -0.07, 0.215], pbr(scene, '#f2a29a', 0.8, 0, 0.7), [1, 0.6, 0.3])
  }
  const path = Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI; return new Vector3(Math.cos(a) * 0.045, -Math.sin(a) * 0.045, 0) })
  const mouth = MeshBuilder.CreateTube(`${name}-mouth`, { path, radius: 0.011, tessellation: 6 }, scene)
  add(mouth, head, [0, -0.1, 0.255], pbr(scene, '#7a3b2e', 0.6))

  const meshes = root.getChildMeshes()
  return { root, body, head, armL, armR, legL: legs[0], legR: legs[1], mouth, eyes, held: { toy, gift, letter }, meshes, seat }
}

/** Eases a node's rotation toward a target (the same damping the three.js renderer used). */
const damp = (cur: number, want: number, k: number) => cur + (want - cur) * k

/* ---------- the component ---------- */

const STORY_FRAMING = { halfW: 8.3, halfH: 3.1, z0: -0.9, baseY: 1.4, elev: 0.3, look: [-0.5, 1.7, -1.5] as V3, follow: 0.1 }
const DEFAULT_SHOT: V3 = [0.9, 1.6, 3.5]

export default function SocialStoryScene(props: SocialStoryScene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const bubbleEls = useRef(new Map<string, HTMLElement>())
  const kidSayEl = useRef<HTMLDivElement>(null)
  const npcSayEls = useRef(new Map<string, HTMLElement>())
  const [tickle, setTickle] = useState<string | null>(null)
  const tickleRef = useRef<(line: string) => void>(() => {})
  tickleRef.current = (line: string) => setTickle(line)
  useEffect(() => {
    if (!tickle) return
    const id = setTimeout(() => setTickle(null), 1400)
    return () => clearTimeout(id)
  }, [tickle])

  const story = STORY_DATA[props.storyId]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !story) return
    let disposed = false
    let engine: Engine
    try {
      engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, antialias: true }, true)
    } catch {
      setFailed(true)
      return
    }
    // ?q=low drops shadows and post-processing (software renderers, very weak devices).
    const low = typeof location !== 'undefined' && new URLSearchParams(location.search).get('q') === 'low'
    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    // Sky: the post-process gamma-encodes, so the clear colour goes in as linear.
    scene.clearColor = Color4.FromColor3(Color3.FromHexString(story.sky).toLinearSpace(), 1)
    scene.ambientColor = new Color3(1, 1, 1)

    // Light: soft sky fill plus a warm sun that casts soft shadows.
    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), scene)
    hemi.diffuse = Color3.FromHexString('#ffffff')
    hemi.groundColor = Color3.FromHexString('#e9dccb')
    hemi.intensity = 0.8
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -0.85, -0.55), scene)
    sun.position = new Vector3(4, 9, 6)
    sun.diffuse = Color3.FromHexString('#fff1da')
    sun.intensity = 1.9
    sun.autoUpdateExtends = false
    sun.orthoLeft = -13; sun.orthoRight = 13; sun.orthoTop = 9; sun.orthoBottom = -9
    sun.shadowMinZ = 1; sun.shadowMaxZ = 40
    const shadows = new ShadowGenerator(low ? 256 : 2048, sun)
    shadows.usePercentageCloserFiltering = !low
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
    shadows.bias = 0.0006
    shadows.normalBias = 0.02
    shadows.darkness = 0.35

    const camera = new UniversalCamera('cam', new Vector3(0, 3, 8), scene)
    camera.fov = (40 * Math.PI) / 180
    camera.minZ = 0.1
    camera.maxZ = 120
    camera.inputs.clear()
    camera.setTarget(new Vector3(0, 1.5, -1))

    const pipe = new DefaultRenderingPipeline('post', true, scene, [camera])
    pipe.fxaaEnabled = !low
    pipe.imageProcessingEnabled = true
    // No tone-mapping curve: the pastel sets and the sky keep their true colours.
    pipe.imageProcessing.toneMappingEnabled = false
    pipe.imageProcessing.exposure = 1.0
    pipe.imageProcessing.contrast = 1.12
    pipe.imageProcessing.vignetteEnabled = true
    pipe.imageProcessing.vignetteWeight = 1.4
    pipe.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0)
    pipe.bloomEnabled = !low
    pipe.bloomThreshold = 0.92
    pipe.bloomWeight = 0.18
    pipe.bloomKernel = 48

    // Scenery.
    SceneLoader.ImportMeshAsync('', `/assets/story-worlds/`, `${propsRef.current.storyId}.glb`, scene)
      .then(res => {
        if (disposed) return
        res.meshes.forEach(m => { m.receiveShadows = !low; m.freezeWorldMatrix(); if (!low && m.getTotalVertices() > 0) shadows.addShadowCaster(m) })
        setLoaded(true)
      })
      .catch(() => { if (!disposed) setFailed(true) })

    // The girl and the cast.
    const kid = buildHuman(scene, 'kid', { shirt: HOODIE, pants: '#353944', hair: HAIR, scrunchie: HOODIE, propHand: 'L' })
    kid.meshes.forEach(m => { m.receiveShadows = !low; if (!low) shadows.addShadowCaster(m) })
    const npcs = story.npcs.map((n: NpcDef) => {
      const h = buildHuman(scene, `npc-${n.key}`, { shirt: n.shirt, pants: n.pants, hair: n.hair, bag: n.bag, long: n.long, sit: n.sit, accessory: n.accessory })
      h.root.position.set(...n.pos)
      h.root.rotation.y = n.rotY ?? 0
      h.root.scaling.setAll(1.1)
      h.body.position.y = h.seat
      h.meshes.forEach(m => { m.receiveShadows = !low; if (!low) shadows.addShadowCaster(m) })
      return { def: n, h, t0: 0, last: null as string | null }
    })
    kid.root.scaling.setAll(1.1)

    // Footprint rings under each step.
    const rings = new Map<string, { disc: Mesh; mat: PBRMaterial }>()
    const ensureRings = () => {
      for (const s of propsRef.current.spots) {
        if (rings.has(s.id)) continue
        const d = story.spots[s.id]
        if (!d) continue
        const disc = MeshBuilder.CreateTorus(`ring-${s.id}`, { diameter: 1.15, thickness: 0.06, tessellation: 40 }, scene)
        disc.position.set(d.stand[0], 0.03, d.stand[2])
        disc.scaling.y = 0.05
        const mat = new PBRMaterial(`ringmat-${s.id}`, scene)
        mat.albedoColor = Color3.FromHexString(s.color)
        mat.emissiveColor = Color3.FromHexString(s.color)
        mat.metallic = 0; mat.roughness = 1
        mat.alpha = 0.85
        disc.material = mat
        rings.set(s.id, { disc, mat })
      }
    }

    // Garden weather and the toy are drawn here because they follow the step, not the scene.
    const weather = new TransformNode('weather', scene)
    const rain = new TransformNode('rain', scene); rain.parent = weather
    const cloudMat = pbr(scene, '#7d8794', 0.9)
    for (const [x, y, r] of [[0, 0, 0.6], [0.6, -0.1, 0.45], [-0.6, -0.1, 0.45], [0.25, 0.3, 0.42]] as number[][]) {
      add(MeshBuilder.CreateSphere('raincloud', { diameter: r * 2, segments: 16 }, scene), rain, [x, y + 4.2, -0.6], cloudMat).scaling.setAll(1.5)
    }
    const drops: Mesh[] = []
    for (let i = 0; i < 16; i++) {
      const d = MeshBuilder.CreateCylinder('drop', { height: 0.22, diameter: 0.025 }, scene)
      d.parent = rain
      d.material = pbr(scene, '#6fa8dc', 0.3, 0.6)
      d.position.set(-2.5 + (((i * 37) % 11) / 8 - 0.7), 2, -0.6 + (((i * 53) % 7) / 8 - 0.4))
      drops.push(d)
    }
    // Fair weather: a sun and a cloud (the scenery file has none, so the rain can replace them).
    const fair = new TransformNode('fair', scene)
    add(MeshBuilder.CreateSphere('sun', { diameter: 1.8, segments: 20 }, scene), fair, [-6, 6.4, -12], pbr(scene, '#ffe27a', 0.5, 1.2))
    for (const [x, y, r] of [[0, 0, 0.6], [0.6, -0.1, 0.45], [-0.6, -0.1, 0.45], [0.25, 0.3, 0.42]] as number[][]) {
      add(MeshBuilder.CreateSphere('fairc', { diameter: r * 2, segments: 16 }, scene), fair, [2 + x * 1.5, 6.2 + y * 1.5, -12], pbr(scene, '#ffffff', 0.9, 0.3)).scaling.setAll(1.5)
    }
    const rainbow = new TransformNode('rainbow', scene)
    ;['#ef6b6b', '#f4a64a', '#f6d65a', '#7cc77a', '#5fa8e0', '#9a7fe0'].forEach((hex, i) => {
      const arc = Array.from({ length: 33 }, (_, k) => { const a = (k / 32) * Math.PI; const R = (1.6 - i * 0.14) * 2.4; return new Vector3(Math.cos(a) * R, Math.sin(a) * R, 0) })
      const tube = MeshBuilder.CreateTube('rb', { path: arc, radius: 0.17, tessellation: 8 }, scene)
      tube.parent = rainbow
      tube.material = pbr(scene, hex, 0.6, 0.45)
    })
    rainbow.position.set(3.4, 0.2, -6.5)
    const toyFloor = new TransformNode('toyfloor', scene)
    add(MeshBuilder.CreateBox('t1', { width: 0.55, height: 0.22, depth: 0.28 }, scene), toyFloor, [0, 0.2, 0], pbr(scene, '#e45b5b', 0.5))
    add(MeshBuilder.CreateBox('t2', { width: 0.3, height: 0.18, depth: 0.26 }, scene), toyFloor, [0.05, 0.38, 0], pbr(scene, '#f4a64a', 0.5))
    toyFloor.position.set(-0.5, 0, -0.45)

    // Tap her for a giggle.
    scene.onPointerObservable.add(info => {
      if (info.type !== PointerEventTypes.POINTERPICK) return
      let n: { parent: unknown } | null = info.pickInfo?.pickedMesh ?? null
      while (n) { if (n === kid.root) { tickleT0 = clock; tickleRef.current(['Hehe! That tickles! 😆', 'Hee hee! 🤭', 'Oh! Hi there! 👋', 'Again! Again! 😄'][Math.floor(Math.random() * 4)]); break } n = n.parent as typeof n }
    })

    /* per-frame state */
    let clock = 0
    let tickleT0 = -10
    const pos = new Vector3(...story.start)
    const walk = { from: pos.clone(), to: pos.clone(), t0: 0, started: false }
    let lastTarget = pos.clone()
    let moodT0 = 0
    let lastMood = ''
    let lastAction: string | null = null
    const camPos = camera.position.clone()
    const camLook = new Vector3(0, 1.5, -1)
    let lastShot = ''
    let shotT0 = 0

    const framing = { ...STORY_FRAMING, halfW: story.halfW ?? STORY_FRAMING.halfW }
    const targetOf = (): Vector3 => {
      const at = propsRef.current.kidAt
      const d = at ? story.spots[at] : null
      return d ? new Vector3(...d.stand) : new Vector3(...story.start)
    }

    engine.runRenderLoop(() => {
      const dt = Math.min(0.05, engine.getDeltaTime() / 1000)
      clock += dt
      const t = clock
      const p = propsRef.current
      ensureRings()

      // ---- where she is going
      const target = targetOf()
      if (Vector3.Distance(target, lastTarget) > 0.01) {
        lastTarget = target.clone()
        if (Vector3.Distance(pos, target) > 0.01) { walk.from = pos.clone(); walk.to = target.clone(); walk.t0 = t; walk.started = true }
      }
      const dur = p.walkMs / 1000
      const k = walk.started ? (dur > 0 ? Math.min(1, (t - walk.t0) / dur) : 1) : 1
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      if (walk.started) { pos.copyFrom(Vector3.Lerp(walk.from, walk.to, e)) }
      const moving = walk.started && k < 1
      kid.root.position.copyFrom(pos)

      const acting = p.mood === 'act'
      const action = p.actionId
      if (p.mood !== lastMood || action !== lastAction) { lastMood = p.mood; lastAction = action; moodT0 = t }
      const since = t - moodT0
      const kd = Math.min(1, dt * 14)
      const tk = t - tickleT0
      const tickled = tk < 1.2

      // ---- facing
      const dir = walk.to.subtract(walk.from)
      const want = moving && dir.lengthSquared() > 0.0001 ? Math.atan2(dir.x, dir.z) : PARK_FACING
      let dy = want - kid.root.rotation.y
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      kid.root.rotation.y += dy * Math.min(1, dt * 10)

      // ---- pose
      let legSwing = 0, aL = 0, aR = 0, oL = 0.08, oR = -0.08, lift = 0, yaw = 0, tilt = 0, nod = 0
      let frown = p.mood === 'oops'
      if (moving) {
        const ph = t * 11
        legSwing = Math.sin(ph) * 0.65; aL = -Math.sin(ph) * 0.55; aR = Math.sin(ph) * 0.55
        lift = Math.abs(Math.sin(ph)) * 0.06
      } else if (acting) {
        const gp: Pose | undefined = action ? KID_POSES[action] : undefined
        const o = evalPose(gp ?? { r: [-2.6, -0.25], waveR: 0.3, hop: 0.38 }, t, since)
        aR = o.aR; oR = o.oR; aL = o.aL; oL = o.oL; nod = o.nod; tilt = o.tilt; lift = o.lift
      } else if (p.mood === 'oops') {
        yaw = Math.sin(t * 13) * 0.4 * Math.max(0, 1 - since / 1.2); tilt = 0.12; oL = 0.25; oR = -0.25
      } else if (p.mood === 'cheer') {
        const c = (t * 1.6) % 1
        lift = Math.sin(c * Math.PI) * 0.32
        aL = -2.9; aR = -2.9; oL = 0.35 + Math.sin(t * 10) * 0.1; oR = -0.35 - Math.sin(t * 10) * 0.1
      } else {
        lift = Math.sin(t * 2.4) * 0.012
        tilt = Math.sin(t * 0.9) * 0.05
        yaw = Math.sin(t * 0.7) * 0.25
      }
      if (tickled && !moving) {
        lift = Math.abs(Math.sin(tk * 11)) * 0.16; tilt = Math.sin(tk * 18) * 0.18; yaw = 0; nod = -0.1
        aL = -0.9; aR = -0.9; oL = -0.45; oR = 0.45
      }
      kid.legL.rotation.x = damp(kid.legL.rotation.x, legSwing, kd)
      kid.legR.rotation.x = damp(kid.legR.rotation.x, -legSwing, kd)
      // She faces right with her left side to the camera, so her poses (written for the
      // right arm) are mirrored onto the left: the arm doing the gesture is the one you see.
      kid.armL.rotation.x = damp(kid.armL.rotation.x, aR, kd)
      kid.armR.rotation.x = damp(kid.armR.rotation.x, aL, kd)
      kid.armL.rotation.z = damp(kid.armL.rotation.z, -oR, kd)
      kid.armR.rotation.z = damp(kid.armR.rotation.z, -oL, kd)
      kid.head.rotation.x = damp(kid.head.rotation.x, nod, kd)
      kid.head.rotation.y = damp(kid.head.rotation.y, yaw, kd)
      kid.head.rotation.z = damp(kid.head.rotation.z, tilt, kd)
      kid.body.position.y = damp(kid.body.position.y, lift, Math.min(1, dt * 20))
      kid.mouth.rotation.z = frown ? Math.PI : 0
      const blink = (t % 3.6) < 0.12 ? 0.15 : 1
      kid.eyes.scaling.y = blink
      const held = acting && action ? HELD[action] : undefined
      kid.held.toy.setEnabled(held === 'toy')
      kid.held.gift.setEnabled(held === 'gift')
      kid.held.letter.setEnabled(held === 'letter')

      // ---- the cast
      for (const n of npcs) {
        const h = n.h
        if (action !== n.last) { n.last = action; n.t0 = t }
        const nsince = t - n.t0
        let nL = n.def.sit ? -0.5 : 0, nR = n.def.sit ? -0.5 : 0, noL = 0.08, noR = -0.08, nn = 0, ny = Math.sin(t * 0.5 + n.def.pos[0]) * 0.25, nt = 0, nl = Math.sin(t * 2.2 + n.def.pos[0]) * 0.01
        const gp = acting && action ? n.def.poses?.[action] : undefined
        if (gp) {
          const o = evalPose(gp, t, nsince)
          ny = 0; nR = o.aR; noR = o.oR; nL = o.aL; noL = o.oL; nn = o.nod; nt = o.tilt; nl = o.lift
        } else if (p.mood === 'cheer' && n.def.cheerSays) {
          ny = 0; nl = Math.abs(Math.sin(t * 5)) * 0.14; nL = -2.8; nR = -2.8; noL = 0.35; noR = -0.35
        }
        const f = Math.min(1, dt * 12)
        h.armL.rotation.x = damp(h.armL.rotation.x, nL, f)
        h.armR.rotation.x = damp(h.armR.rotation.x, nR, f)
        h.armL.rotation.z = damp(h.armL.rotation.z, noL, f)
        h.armR.rotation.z = damp(h.armR.rotation.z, noR, f)
        h.head.rotation.x = damp(h.head.rotation.x, nn, f)
        h.head.rotation.y = damp(h.head.rotation.y, ny, f)
        h.head.rotation.z = damp(h.head.rotation.z, nt, f)
        h.body.position.y = damp(h.body.position.y, nl + h.seat, Math.min(1, dt * 20))
      }

      // ---- step props
      toyFloor.setEnabled(action === 's5p4' && acting)
      const sad = p.storyId === 'handling-disappointment' && acting && (action === 's7p2' || action === 's7p3' || action === 's7p4')
      const hope = p.storyId === 'handling-disappointment' && ((acting && action === 's7p5') || p.mood === 'cheer')
      rain.setEnabled(sad)
      fair.setEnabled(p.storyId === 'handling-disappointment' && !sad)
      rainbow.setEnabled(hope)
      if (sad) drops.forEach((d, i) => { d.position.y = 3.7 - ((t * 2.2 + i * 0.37) % 1) * 3.6 })

      // ---- rings
      for (const s of p.spots) {
        const r = rings.get(s.id)
        if (!r) continue
        const hex = s.status === 'done' ? '#2f9e62' : s.color
        r.mat.albedoColor = Color3.FromHexString(hex)
        r.mat.emissiveColor = Color3.FromHexString(hex).scale(s.ring ? 0.9 + Math.sin(t * 5) * 0.3 : 0.5)
        r.mat.alpha = s.status === 'done' ? 0.4 : 0.85
      }

      // ---- the camera: wide while choosing, tracking while she walks, close while she acts
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight())
      const half = Math.tan(camera.fov / 2)
      const narrow = Math.max(1, 1.9 / aspect)
      const shot = p.mood === 'walk' ? 'walk' : p.mood === 'act' || p.mood === 'oops' || p.mood === 'cheer' ? `close:${action ?? ''}:${p.mood}` : 'wide'
      if (shot !== lastShot) { lastShot = shot; shotT0 = t }
      const sshot = t - shotT0
      const want3 = new Vector3()
      const look3 = new Vector3()
      if (shot === 'walk') {
        want3.set(pos.x * 0.9, 2.5, pos.z + 6.0 * narrow)
        look3.set(pos.x, 1.15, pos.z - 1.2)
      } else if (shot !== 'wide') {
        const o = (action && story.shots?.[action]) || DEFAULT_SHOT
        const off = new Vector3(o[0] * 1.2, o[1] * 1.1, o[2] * narrow * 1.3).scale(1 - Math.min(0.12, sshot * 0.06))
        want3.copyFrom(pos).addInPlace(off)
        want3.x += story.focusDx
        look3.set(pos.x + story.focusDx, 1.25, pos.z - 0.3)
      } else {
        const dist = Math.max(framing.halfH / half, framing.halfW / (half * aspect))
        want3.set(pos.x * framing.follow, framing.baseY + dist * framing.elev, framing.z0 + dist)
        look3.set(framing.look[0] + pos.x * framing.follow * 0.8, framing.look[1], framing.look[2])
      }
      const ck = 1 - Math.exp(-dt * (shot === 'wide' ? 1.8 : 2.6))
      camPos.copyFrom(Vector3.Lerp(camPos, want3, ck))
      camLook.copyFrom(Vector3.Lerp(camLook, look3, ck))
      camera.position.copyFrom(camPos)
      camera.setTarget(camLook)

      // ---- DOM overlays follow their 3D anchors
      const cw = canvas.clientWidth, ch = canvas.clientHeight
      const rw = engine.getRenderWidth(), rh = engine.getRenderHeight()
      const tm = scene.getTransformMatrix()
      const proj = (v: Vector3) => {
        const s = Vector3.Project(v, Matrix.Identity(), tm, camera.viewport.toGlobal(rw, rh))
        return { x: (s.x / rw) * cw, y: (s.y / rh) * ch, z: s.z }
      }
      const place = (el: HTMLElement | null | undefined, v: Vector3, hide = false) => {
        if (!el) return
        const s = proj(v)
        el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`
        el.style.display = hide || s.z < 0 || s.z > 1 ? 'none' : 'block'
      }
      for (const s of p.spots) {
        const d = story.spots[s.id]
        const el = bubbleEls.current.get(s.id)
        if (!d) continue
        const hidden = p.mood === 'walk' || p.mood === 'act' || (s.id === p.kidAt && s.status === 'done')
        place(el, new Vector3(...d.bubble), hidden)
      }
      place(kidSayEl.current, new Vector3(pos.x, pos.y + 2.45 * 1.1, pos.z))
      for (const n of npcs) place(npcSayEls.current.get(n.def.key), new Vector3(n.def.pos[0], n.def.pos[1] + 2.5 * 1.1, n.def.pos[2]))

      scene.render()
    })
    const onResize = () => engine.resize()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas)
    ;(canvas as HTMLCanvasElement & { __bjs?: Scene }).__bjs = scene

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      scene.dispose()
      engine.dispose()
    }
    // The scene is built once per story; everything else flows in through propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storyId])

  if (failed || !story) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20, color: 'rgba(23,58,94,0.6)', fontSize: 14 }}>
        The 3D room can&apos;t run on this device. Use the step cards below to play.
      </div>
    )
  }

  const acting = props.mood === 'act' && !!props.actionId
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', outline: 'none', touchAction: 'none' }} />
      {!loaded && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(23,58,94,0.5)', fontSize: 14, pointerEvents: 'none' }}>Loading the scene…</div>}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {props.spots.map(s => (
          <div key={s.id} ref={el => { if (el) bubbleEls.current.set(s.id, el); else bubbleEls.current.delete(s.id) }} style={{ position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'auto' }}>
            <SpotButton spot={s} onSpot={props.onSpot} />
          </div>
        ))}
        <div ref={kidSayEl} style={{ position: 'absolute', left: 0, top: 0, display: 'none' }}>
          {(tickle || props.kidSays) && <Say text={tickle || props.kidSays} />}
        </div>
        {story.npcs.map(n => {
          const text = acting ? n.says?.[props.actionId!] ?? '' : props.mood === 'cheer' ? n.cheerSays ?? '' : ''
          return (
            <div key={n.key} ref={el => { if (el) npcSayEls.current.set(n.key, el); else npcSayEls.current.delete(n.key) }} style={{ position: 'absolute', left: 0, top: 0, display: 'none' }}>
              {text && <Say text={text} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Say({ text }: { text: string }) {
  return (
    <div key={text} style={{
      position: 'relative', background: '#fff', color: '#173a5e', fontSize: 13, fontWeight: 700, padding: '6px 11px', borderRadius: 12,
      boxShadow: '0 4px 12px rgba(23,58,94,.18)', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
      animation: 'ss-say3 .25s ease-out', marginBottom: 8,
    }}>
      {text}
      <span style={{ position: 'absolute', top: '100%', left: '50%', marginLeft: -6, borderWidth: 6, borderStyle: 'solid', borderColor: '#fff transparent transparent transparent' }} />
    </div>
  )
}

function SpotButton({ spot, onSpot }: { spot: SceneSpot; onSpot: (id: string) => void }) {
  const done = spot.status === 'done'
  const wrong = spot.status === 'wrong'
  const edge = done ? '#2f9e62' : wrong ? '#d4553a' : spot.color
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <button
        className="ss-spot3"
        disabled={!spot.clickable}
        onClick={() => spot.clickable && onSpot(spot.id)}
        aria-label={spot.caption}
        style={{
          ['--c' as string]: `${spot.color}aa`,
          position: 'relative', width: 62, height: 62, borderRadius: '50%', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
          background: done ? '#e9f7ef' : wrong ? '#fde3dd' : `radial-gradient(circle at 35% 30%, #fff, ${spot.color}40 78%)`,
          border: `3px solid ${edge}`, cursor: spot.clickable ? 'pointer' : 'default',
          opacity: done && !spot.playing ? 0.8 : 1,
          transform: spot.playing ? 'scale(1.18)' : undefined,
          animation: wrong ? 'ss-shake3 .45s ease 2' : done && !spot.playing ? undefined : 'ss-float3 2.6s ease-in-out infinite, ss-glow 2s ease-in-out infinite',
        }}
      >
        <span style={{ lineHeight: 1, pointerEvents: 'none' }}>{spot.emoji}</span>
        <span aria-hidden style={{ position: 'absolute', bottom: -7, left: '50%', width: 12, height: 12, marginLeft: -6, transform: 'rotate(45deg)', background: edge, borderRadius: 2, zIndex: -1 }} />
        {spot.badge && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, padding: '0 4px',
            background: wrong ? '#d4553a' : done ? '#2f9e62' : '#173a5e', color: '#fff', fontSize: 11.5, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.25)', animation: 'ss-chip .3s ease',
          }}>{spot.badge}</span>
        )}
      </button>
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
  )
}
