// Shared illustrated-scene type definitions — single source of truth for the
// Skill Development modules (Story Choice Adventure, Emotion Detective, …).

export type Pose = 'neutral' | 'worried' | 'happy' | 'surprised' | 'sad'
export type Setting = 'classroom' | 'playground' | 'home' | 'hallway' | 'canteen' | 'park'
export type SceneVerb = 'spill' | 'social' | 'achievement' | 'accident' | 'waiting'
export type ObjectKey = 'bottle' | 'book' | 'pencil' | 'tray' | 'cup' | 'shoe' | 'phone'

export interface SceneMeta {
  verb: SceneVerb
  setting: Setting
  pose: Pose
  shirt: string
  friendShirt?: string
  object?: ObjectKey
  bubble: string
  time?: 'day' | 'afternoon'
}
