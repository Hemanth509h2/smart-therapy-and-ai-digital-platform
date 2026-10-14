'use client'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { SceneSpot, KidMood } from '@/components/modules/id/SocialStoryScene3D'
import { STORY_DATA } from '@/components/modules/id/socialStoryShared'
const Scene = dynamic(() => import('@/components/modules/id/SocialStoryScene.babylon'), { ssr: false })
function Inner() {
  const q = useSearchParams()
  const story = q.get('story') ?? 'meeting-someone-new'
  const mood = (q.get('mood') ?? 'idle') as KidMood
  const at = q.get('at') || null
  const spots: SceneSpot[] = Object.keys(STORY_DATA[story]?.spots ?? {}).map(id => ({ id, emoji: '⭐', caption: id, color: '#5fa8e0', status: 'open', badge: null, ring: false, playing: false, clickable: false, burst: false, burstKey: id }))
  return (<div style={{ width: 1280, height: 720, position: 'relative' }}><Scene storyId={story} spots={spots} kidAt={at} mood={mood} kidSays="" guideId={null} showCaptions={false} walkMs={0} onSpot={() => {}} doneIds={[]} actionId={mood === 'act' ? at : null} /></div>)
}
export default function Page() { return <Suspense fallback={null}><Inner /></Suspense> }
