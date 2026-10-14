'use client'
// TEMPORARY: exports one story's scenery to a GLB (read back over CDP).
import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Canvas, useThree } from '@react-three/fiber'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STORY_SCENES } from '@/components/modules/id/SocialStoryScene3D'

function Exporter() {
  const { scene } = useThree()
  useEffect(() => {
    const id = setTimeout(() => {
      new GLTFExporter().parse(
        scene,
        (res) => {
          const u = new Uint8Array(res as ArrayBuffer)
          let s = ''
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
          ;(window as unknown as { __glb: string }).__glb = btoa(s)
        },
        (e) => { (window as unknown as { __err: string }).__err = String(e) },
        { binary: true },
      )
    }, 3000)
    return () => clearTimeout(id)
  }, [scene])
  return null
}

function Inner() {
  const q = useSearchParams()
  const def = STORY_SCENES[q.get('story') ?? '']
  if (!def) return null
  const Env = def.env
  return (<Canvas><Env action={q.get('action')} mood="idle" /><Exporter /></Canvas>)
}
export default function Page() { return <Suspense fallback={null}><div style={{ width: 400, height: 300 }}><Inner /></div></Suspense> }
