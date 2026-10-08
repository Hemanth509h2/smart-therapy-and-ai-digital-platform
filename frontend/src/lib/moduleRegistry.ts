'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

// ============================================================================
// LAZY MODULE REGISTRY
// ============================================================================
// Each module is loaded on-demand via dynamic import. This keeps the initial
// bundle small — only the module the therapist launches gets downloaded.
// ============================================================================

interface ModuleComponentProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type ModuleLoader = () => Promise<{ default: ComponentType<ModuleComponentProps> }>

// Module loader map — add new modules here
// All modules use default export
const moduleLoaders: Record<string, ModuleLoader> = {
  // Core modules
  'maze': () => import('@/components/modules/MazeModule').then(m => ({ default: m.default })),
  'talking_calculator': () => import('@/components/modules/TalkingCalculatorModule').then(m => ({ default: m.default })),
  'memory_match': () => import('@/components/modules/MemoryMatchModule').then(m => ({ default: m.default })),
  'word-building': () => import('@/components/modules/sld/WordBuilding').then(m => ({ default: m.default })),
  'whack-a-mole-math': () => import('@/components/modules/sld/WhackAMoleMath').then(m => ({ default: m.default })),
  'pixel-art-coding': () => import('@/components/modules/sld/PixelArtCoding').then(m => ({ default: m.default })),
  'bubble-splash': () => import('@/components/modules/sld/BubbleSplash').then(m => ({ default: m.default })),
  'bubble-splash-sld': () => import('@/components/modules/sld/BubbleSplash').then(m => ({ default: m.default })),
  'bubble_splash': () => import('@/components/modules/sld/BubbleSplash').then(m => ({ default: m.default })),

  // ADHD modules
  'n-back-challenge': () => import('@/components/modules/adhd/NBackChallenge').then(m => ({ default: m.default })),
  'virtual-maze': () => import('@/components/modules/adhd/VirtualMaze').then(m => ({ default: m.default })),
  'simon-says': () => import('@/components/modules/adhd/SimonSays').then(m => ({ default: m.default })),

  // Anxiety modules
  'grounding-game': () => import('@/components/modules/anxiety/GroundingGame').then(m => ({ default: m.default })),
  '5-4-3-2-1-grounding': () => import('@/components/modules/anxiety/GroundingGame').then(m => ({ default: m.default })),
  'emotional-charades': () => import('@/components/modules/anxiety/EmotionalCharades').then(m => ({ default: m.default })),
  'virtual-box-popping': () => import('@/components/modules/anxiety/BoxPopping').then(m => ({ default: m.default })),
  'worry-box': () => import('@/components/modules/anxiety/WorryBox').then(m => ({ default: m.default })),

  // ID modules
  'drag-drop-sorting': () => import('@/components/modules/id/DragDropSorting').then(m => ({ default: m.default })),
  'social-story-sequencing': () => import('@/components/modules/id/SocialStorySequencing').then(m => ({ default: m.default })),
  'virtual-shop': () => import('@/components/modules/id/VirtualShop').then(m => ({ default: m.default })),

  // General/CBT modules
  'emotion-wheel': () => import('@/components/modules/general/EmotionWheel').then(m => ({ default: m.default })),
  'defusion-river': () => import('@/components/modules/general/DefusionRiver').then(m => ({ default: m.default })),
  'thought-challenger': () => import('@/components/modules/general/ThoughtChallenger').then(m => ({ default: m.default })),
  'micro-quest-board': () => import('@/components/modules/general/MicroQuestBoard').then(m => ({ default: m.default })),
  'values-card-sort': () => import('@/components/modules/general/ValuesCardSort').then(m => ({ default: m.default })),
  'worry-vault': () => import('@/components/modules/general/WorryVault').then(m => ({ default: m.default })),
  'facts-vs-feelings': () => import('@/components/modules/general/FactsVsFeelings').then(m => ({ default: m.default })),

  // Skill Development modules (full-canvas)
  'story-choice-adventure': () => import('@/components/modules/skill/StoryChoiceAdventure').then(m => ({ default: m.default })),
  'emotion-detective': () => import('@/components/modules/skill/EmotionDetective').then(m => ({ default: m.default })),
  'build-together': () => import('@/components/modules/skill/BuildTogether').then(m => ({ default: m.default })),
  'treasure-quest': () => import('@/components/modules/skill/TreasureQuest').then(m => ({ default: m.default })),
}

// Cache for loaded modules
const moduleCache = new Map<string, ComponentType<ModuleComponentProps>>()

// Loading state for UI feedback
const loadingPromises = new Map<string, Promise<ComponentType<ModuleComponentProps> | null>>()

/**
 * Load a module dynamically. Returns the React component.
 * Caches the result so subsequent loads are instant.
 */
export async function loadModule(moduleId: string): Promise<ComponentType<ModuleComponentProps> | null> {
  // Check cache first
  if (moduleCache.has(moduleId)) {
    return moduleCache.get(moduleId)!
  }

  // Check if already loading
  if (loadingPromises.has(moduleId)) {
    return loadingPromises.get(moduleId)!
  }

  const loader = moduleLoaders[moduleId]
  if (!loader) {
    console.warn(`Module "${moduleId}" not found in registry`)
    return null
  }

  // Start loading
  const promise = loader()
    .then(mod => {
      const Component = mod.default
      moduleCache.set(moduleId, Component)
      loadingPromises.delete(moduleId)
      return Component
    })
    .catch(err => {
      loadingPromises.delete(moduleId)
      console.error(`Failed to load module "${moduleId}":`, err)
      return null
    })

  loadingPromises.set(moduleId, promise)
  return promise
}

/**
 * Preload a module (call when therapist hovers over module in panel)
 */
export function preloadModule(moduleId: string): void {
  if (moduleCache.has(moduleId) || loadingPromises.has(moduleId)) return
  const loader = moduleLoaders[moduleId]
  if (!loader) return

  const promise = loader()
    .then(mod => {
      moduleCache.set(moduleId, mod.default)
      loadingPromises.delete(moduleId)
      return mod.default
    })
    .catch(() => {
      loadingPromises.delete(moduleId)
      return null
    })

  loadingPromises.set(moduleId, promise)
}

/**
 * Check if module is already loaded
 */
export function isModuleLoaded(moduleId: string): boolean {
  return moduleCache.has(moduleId)
}

/**
 * Get all available module IDs
 */
export function getAvailableModuleIds(): string[] {
  return Object.keys(moduleLoaders)
}

/**
 * Module metadata for the panel UI
 */
export const MODULE_METADATA: Record<string, { 
  title: string
  subtitle: string
  icon: string
  label: string
  category: 'core' | 'adhd' | 'anxiety' | 'id' | 'general' | 'skill'
}> = {
  'maze': { title: 'Virtual Maze', subtitle: 'Sustained attention · motor planning', icon: '🌀', label: 'Maze', category: 'core' },
  'talking_calculator': { title: 'Calculator', subtitle: 'Talk through it', icon: '🔢', label: 'Calc', category: 'core' },
  'memory_match': { title: 'Memory Match', subtitle: 'Match & recall', icon: '🧩', label: 'Memory', category: 'core' },
  'word-building': { title: 'Word Building', subtitle: 'Phonics · spelling · decoding', icon: '🔤', label: 'Word', category: 'core' },
  'whack-a-mole-math': { title: 'Whack-a-Mole Math', subtitle: 'Math fluency · number recognition', icon: '🔨', label: 'Math', category: 'core' },
  'pixel-art-coding': { title: 'Pixel Art Coding', subtitle: 'Pattern recognition · sequencing', icon: '🎨', label: 'Pixel Art', category: 'core' },
  'bubble-splash': { title: 'Bubble Splash', subtitle: 'Sight words · reading fluency', icon: '🫧', label: 'Bubbles', category: 'core' },
  'bubble-splash-sld': { title: 'Bubble Splash', subtitle: 'Sight words · reading fluency', icon: '🫧', label: 'Bubbles', category: 'core' },
  'bubble_splash': { title: 'Bubble Splash', subtitle: 'Sight words · reading fluency', icon: '🫧', label: 'Bubbles', category: 'core' },

  'n-back-challenge': { title: 'N-Back Challenge', subtitle: 'Working memory · clinically validated', icon: '🧠', label: 'N-Back', category: 'adhd' },
  'virtual-maze': { title: 'Virtual Maze', subtitle: 'Spatial navigation · attention', icon: '🧭', label: 'V-Maze', category: 'adhd' },
  'simon-says': { title: 'Simon Says', subtitle: 'Executive function · inhibitory control', icon: '🎮', label: 'Simon', category: 'adhd' },

  'grounding-game': { title: 'Grounding Game', subtitle: 'Sensory anchoring · anxiety reduction', icon: '🌱', label: 'Grounding', category: 'anxiety' },
  '5-4-3-2-1-grounding': { title: 'Grounding Game', subtitle: 'Sensory anchoring · anxiety reduction', icon: '🌱', label: 'Grounding', category: 'anxiety' },
  'emotional-charades': { title: 'Emotional Charades', subtitle: 'Emotion identification · social learning', icon: '🎭', label: 'Charades', category: 'anxiety' },
  'virtual-box-popping': { title: 'Virtual Box Popping', subtitle: 'Tension release · cognitive defusion', icon: '📦', label: 'Box Pop', category: 'anxiety' },
  'worry-box': { title: 'Worry Box', subtitle: 'Worry containment · externalisation', icon: '🗃️', label: 'Worry Box', category: 'anxiety' },

  'drag-drop-sorting': { title: 'Drag & Drop Sorting', subtitle: 'Categorisation · concept formation', icon: '🗂️', label: 'Sorting', category: 'id' },
  'social-story-sequencing': { title: 'Social Story Sequencing', subtitle: 'Narrative comprehension · social prep', icon: '📖', label: 'Stories', category: 'id' },
  'virtual-shop': { title: 'Virtual Shop', subtitle: 'Money skills · daily living', icon: '🛒', label: 'Shop', category: 'id' },

  'emotion-wheel': { title: 'Emotion Wheel', subtitle: 'Emotion identification · granular awareness', icon: '🎡', label: 'Emotion', category: 'general' },
  'defusion-river': { title: 'Defusion River', subtitle: 'Cognitive defusion · thought observation', icon: '🌊', label: 'Defusion', category: 'general' },
  'thought-challenger': { title: 'Thought Challenger', subtitle: 'CBT · evidence-based thought restructuring', icon: '⚖️', label: 'Thoughts', category: 'general' },
  'micro-quest-board': { title: 'Micro Quest Board', subtitle: 'Behavioral activation · micro-goals', icon: '🗺️', label: 'Quests', category: 'general' },
  'values-card-sort': { title: 'Values Card Sort', subtitle: 'ACT · values clarification & commitment', icon: '🃏', label: 'Values', category: 'general' },
  'worry-vault': { title: 'Worry Vault', subtitle: 'Worry containment · scheduled worry time', icon: '🗄️', label: 'Vault', category: 'general' },
  'facts-vs-feelings': { title: 'Facts vs Feelings', subtitle: 'Reality testing · emotion-fact distinction', icon: '🔍', label: 'Facts', category: 'general' },

  'story-choice-adventure': { title: 'Story Choice Adventure', subtitle: 'Consequential thinking · emotional intelligence', icon: '📖', label: 'Story', category: 'skill' },
  'emotion-detective': { title: 'Emotion Detective', subtitle: 'Emotion identification · perspective taking', icon: '🔍', label: 'Detective', category: 'skill' },
  'build-together': { title: 'Build Together', subtitle: 'Shared problem solving · communication', icon: '🌉', label: 'Build', category: 'skill' },
  'treasure-quest': { title: 'Treasure Quest', subtitle: 'Sequential clue chain · shared discovery', icon: '🗺️', label: 'Quest', category: 'skill' },
}

// Category display order and labels
export const MODULE_CATEGORIES = [
  { id: 'core', label: 'Core Activities', icon: '🎯' },
  { id: 'adhd', label: 'ADHD & Attention', icon: '🧠' },
  { id: 'anxiety', label: 'Anxiety & Regulation', icon: '🌿' },
  { id: 'id', label: 'Intellectual Disability', icon: '🧩' },
  { id: 'general', label: 'CBT & General', icon: '💭' },
  { id: 'skill', label: 'Skill Development', icon: '🚀' },
] as const

// Skill development modules (use full-canvas SkillDevLayout)
export const SKILL_MODULE_IDS = new Set([
  'story-choice-adventure',
  'emotion-detective',
  'build-together',
  'treasure-quest',
])

export function isSkillModule(moduleId: string): boolean {
  return SKILL_MODULE_IDS.has(moduleId)
}