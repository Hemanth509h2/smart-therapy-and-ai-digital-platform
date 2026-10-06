'use client'
import { useEffect, useRef } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { logModuleEvent } from '@/lib/sessionEvents'
import MazeModule from '@/components/modules/MazeModule'
import TalkingCalculatorModule from '@/components/modules/TalkingCalculatorModule'
import MemoryMatchModule from '@/components/modules/MemoryMatchModule'
import WordBuilding from '@/components/modules/sld/WordBuilding'
import WhackAMoleMath from '@/components/modules/sld/WhackAMoleMath'
import PixelArtCoding from '@/components/modules/sld/PixelArtCoding'
import BubbleSplash from '@/components/modules/sld/BubbleSplash'
import NBackChallenge from '@/components/modules/adhd/NBackChallenge'
import VirtualMaze from '@/components/modules/adhd/VirtualMaze'
import GroundingGame from '@/components/modules/anxiety/GroundingGame'
import EmotionalCharades from '@/components/modules/anxiety/EmotionalCharades'
import BoxPopping from '@/components/modules/anxiety/BoxPopping'
import WorryBox from '@/components/modules/anxiety/WorryBox'
import DragDropSorting from '@/components/modules/id/DragDropSorting'
import SocialStorySequencing from '@/components/modules/id/SocialStorySequencing'
import VirtualShop from '@/components/modules/id/VirtualShop'
import SimonSays from '@/components/modules/adhd/SimonSays'
import EmotionWheel from '@/components/modules/general/EmotionWheel'
import DefusionRiver from '@/components/modules/general/DefusionRiver'
import ThoughtChallenger from '@/components/modules/general/ThoughtChallenger'
import MicroQuestBoard from '@/components/modules/general/MicroQuestBoard'
import ValuesCardSort from '@/components/modules/general/ValuesCardSort'
import WorryVault from '@/components/modules/general/WorryVault'
import FactsVsFeelings from '@/components/modules/general/FactsVsFeelings'
import StoryChoiceAdventure from '@/components/modules/skill/StoryChoiceAdventure'
import EmotionDetective from '@/components/modules/skill/EmotionDetective'
import BuildTogether from '@/components/modules/skill/BuildTogether'
import TreasureQuest from '@/components/modules/skill/TreasureQuest'

const MODULES = [
  { id: 'maze', name: 'Maze', icon: '🌀', label: 'Maze' },
  { id: 'talking_calculator', name: 'Calculator', icon: '🔢', label: 'Calc' },
  { id: 'memory_match', name: 'Memory Match', icon: '🧩', label: 'Memory' },
  { id: 'word-building', name: 'Word Building', icon: '🔤', label: 'Word' },
  { id: 'whack-a-mole-math', name: 'Whack-a-Mole Math', icon: '🔨', label: 'Math' },
  { id: 'pixel-art-coding', name: 'Pixel Art Coding', icon: '🎨', label: 'Pixel Art' },
  { id: 'bubble-splash', name: 'Bubble Splash', icon: '🫧', label: 'Bubbles' },
  { id: 'n-back-challenge', name: 'N-Back Challenge', icon: '🧠', label: 'N-Back' },
  { id: 'grounding-game', name: 'Grounding Game', icon: '🌱', label: 'Grounding' },
  { id: 'emotional-charades', name: 'Emotional Charades', icon: '🎭', label: 'Charades' },
  { id: 'virtual-box-popping', name: 'Virtual Box Popping', icon: '📦', label: 'Box Pop' },
  { id: 'worry-box', name: 'Worry Box', icon: '🗃️', label: 'Worry Box' },
  { id: 'drag-drop-sorting', name: 'Drag & Drop Sorting', icon: '🗂️', label: 'Sorting' },
  { id: 'social-story-sequencing', name: 'Social Story Sequencing', icon: '📖', label: 'Stories' },
  { id: 'virtual-shop', name: 'Virtual Shop', icon: '🛒', label: 'Shop' },
  { id: 'simon-says', name: 'Simon Says', icon: '🎮', label: 'Simon' },
  { id: 'emotion-wheel', name: 'Emotion Wheel', icon: '🎡', label: 'Emotion' },
  { id: 'defusion-river', name: 'Defusion River', icon: '🌊', label: 'Defusion' },
  { id: 'thought-challenger', name: 'Thought Challenger', icon: '⚖️', label: 'Thoughts' },
  { id: 'micro-quest-board', name: 'Micro Quest Board', icon: '🗺️', label: 'Quests' },
  { id: 'values-card-sort', name: 'Values Card Sort', icon: '🃏', label: 'Values' },
  { id: 'worry-vault', name: 'Worry Vault', icon: '🗄️', label: 'Vault' },
  { id: 'facts-vs-feelings', name: 'Facts vs Feelings', icon: '🔍', label: 'Facts' },
  { id: 'story-choice-adventure', name: 'Story Choice Adventure', icon: '📖', label: 'Story' },
  { id: 'emotion-detective', name: 'Emotion Detective', icon: '🔍', label: 'Emotion' },
  { id: 'build-together', name: 'Build Together', icon: '🌉', label: 'Build' },
  { id: 'treasure-quest', name: 'Treasure Quest', icon: '🗺️', label: 'Quest' },
]

const MODULE_INFO: Record<string, { title: string; subtitle: string }> = {
  maze: { title: 'Virtual Maze', subtitle: 'Sustained attention · motor planning' },
  talking_calculator: { title: 'Calculator', subtitle: 'Talk through it' },
  memory_match: { title: 'Memory Match', subtitle: 'Match & recall' },
  'word-building': { title: 'Word Building', subtitle: 'Phonics · spelling · decoding' },
  'whack-a-mole-math': { title: 'Whack-a-Mole Math', subtitle: 'Math fluency · number recognition' },
  'pixel-art-coding': { title: 'Pixel Art Coding', subtitle: 'Pattern recognition · sequencing' },
  // Title matches the registry entry; legacy keys kept so an in-flight session
  // with an old slug still shows a proper header.
  'bubble-splash': { title: 'Bubble Splash', subtitle: 'Sight words · reading fluency' },
  'bubble-splash-sld': { title: 'Bubble Splash', subtitle: 'Sight words · reading fluency' },
  'n-back-challenge': { title: 'N-Back Challenge', subtitle: 'Working memory · clinically validated' },
  'grounding-game': { title: 'Grounding Game', subtitle: 'Sensory anchoring · anxiety reduction' },
  '5-4-3-2-1-grounding': { title: 'Grounding Game', subtitle: 'Sensory anchoring · anxiety reduction' },
  'emotional-charades': { title: 'Emotional Charades', subtitle: 'Emotion identification · social learning' },
  'virtual-box-popping': { title: 'Virtual Box Popping', subtitle: 'Tension release · cognitive defusion' },
  'worry-box': { title: 'Worry Box', subtitle: 'Worry containment · externalisation' },
  'drag-drop-sorting': { title: 'Drag & Drop Sorting', subtitle: 'Categorisation · concept formation' },
  'social-story-sequencing': { title: 'Social Story Sequencing', subtitle: 'Narrative comprehension · social prep' },
  'virtual-shop': { title: 'Virtual Shop', subtitle: 'Money skills · daily living' },
  'simon-says': { title: 'Simon Says', subtitle: 'Executive function · inhibitory control' },
  'emotion-wheel': { title: 'Emotion Wheel', subtitle: 'Emotion identification · granular awareness' },
  'defusion-river': { title: 'Defusion River', subtitle: 'Cognitive defusion · thought observation' },
  'thought-challenger': { title: 'Thought Challenger', subtitle: 'CBT · evidence-based thought restructuring' },
  'micro-quest-board': { title: 'Micro Quest Board', subtitle: 'Behavioral activation · micro-goals' },
  'values-card-sort': { title: 'Values Card Sort', subtitle: 'ACT · values clarification & commitment' },
  'worry-vault': { title: 'Worry Vault', subtitle: 'Worry containment · scheduled worry time' },
  'facts-vs-feelings': { title: 'Facts vs Feelings', subtitle: 'Reality testing · emotion-fact distinction' },
  'story-choice-adventure': { title: 'Story Choice Adventure', subtitle: 'Consequential thinking · emotional intelligence' },
  'emotion-detective': { title: 'Emotion Detective', subtitle: 'Emotion identification · perspective taking' },
  'build-together': { title: 'Build Together', subtitle: 'Shared problem solving · communication' },
  'treasure-quest': { title: 'Treasure Quest', subtitle: 'Sequential clue chain · shared discovery' },
}

// Renders a Skill Development module on its own, for the full-canvas SkillDevLayout.
// The normal panel path below still routes every module (including these) through
// its own switch, so this is additive only.
export function SkillModuleView({
  moduleId,
  sessionId,
  role,
  isLocked,
}: {
  moduleId: string | null
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}) {
  switch (moduleId) {
    case 'story-choice-adventure':
      return <StoryChoiceAdventure sessionId={sessionId} role={role} isLocked={isLocked} />
    case 'emotion-detective':
      return <EmotionDetective sessionId={sessionId} role={role} isLocked={isLocked} />
    case 'build-together':
      return <BuildTogether sessionId={sessionId} role={role} isLocked={isLocked} />
    case 'treasure-quest':
      return <TreasureQuest sessionId={sessionId} role={role} isLocked={isLocked} />
    default:
      return null
  }
}

interface GlassModulePanelProps {
  sessionId: string
  activeModule: string | null
  isTherapist: boolean
  isLocked: boolean
  onModuleSwitch: (moduleId: string) => void
  onLockToggle: () => void
  onClose?: () => void
}

/**
 * The module tree itself, extracted so the two intentional layouts can render
 * exactly the same component with no duplicated switch:
 *   - GlassModulePanel  — the 420px sidebar (module selector / client mirror)
 *   - ModuleStage       — the wide session-room canvas used when a module is live
 *
 * Purely a move: no case was added, removed or altered.
 */
export interface ModuleContentProps {
  activeModule: string | null
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
  isTherapist: boolean
}

export function ModuleContent({
  activeModule,
  sessionId,
  role,
  isLocked,
  isTherapist,
}: ModuleContentProps) {
  const info = activeModule ? MODULE_INFO[activeModule] : null
    switch (activeModule) {
      case 'maze':
        return <VirtualMaze sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'talking_calculator':
        return <TalkingCalculatorModule sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'memory_match':
        return <MemoryMatchModule sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'word-building':
        return <WordBuilding sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'whack-a-mole-math':
        return <WhackAMoleMath sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'pixel-art-coding':
        return <PixelArtCoding sessionId={sessionId} role={role} isLocked={isLocked} />
      // Canonical slug plus the two legacy forms, so a session already holding
      // an old activeModuleId still resolves to the intended module.
      case 'bubble-splash':
      case 'bubble-splash-sld':
      case 'bubble_splash':
        return <BubbleSplash sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'n-back-challenge':
        return <NBackChallenge sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'grounding-game':
      case '5-4-3-2-1-grounding':
        return <GroundingGame sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'emotional-charades':
        return <EmotionalCharades sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'virtual-box-popping':
        return <BoxPopping sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'worry-box':
        return <WorryBox sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'drag-drop-sorting':
        return <DragDropSorting sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'social-story-sequencing':
        return <SocialStorySequencing sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'virtual-shop':
        return <VirtualShop sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'simon-says':
        return <SimonSays sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'emotion-wheel':
        return <EmotionWheel sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'defusion-river':
        return <DefusionRiver sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'thought-challenger':
        return <ThoughtChallenger sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'micro-quest-board':
        return <MicroQuestBoard sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'values-card-sort':
        return <ValuesCardSort sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'worry-vault':
        return <WorryVault sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'facts-vs-feelings':
        return <FactsVsFeelings sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'story-choice-adventure':
        return <StoryChoiceAdventure sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'emotion-detective':
        return <EmotionDetective sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'build-together':
        return <BuildTogether sessionId={sessionId} role={role} isLocked={isLocked} />
      case 'treasure-quest':
        return <TreasureQuest sessionId={sessionId} role={role} isLocked={isLocked} />
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <span style={{ fontSize: 36, marginBottom: 12 }}>🎯</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginBottom: 4 }}>
              {info?.title || 'Ready for Activity'}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
              {info?.subtitle || (isTherapist
                ? 'Select a module below to begin'
                : 'Your therapist will choose an activity soon.')}
            </span>
          </div>
        )
    }
}

export default function GlassModulePanel({
  sessionId,
  activeModule,
  isTherapist,
  isLocked,
  onModuleSwitch,
  onLockToggle,
  onClose,
}: GlassModulePanelProps) {
  const isActive = activeModule !== null
  const info = activeModule ? MODULE_INFO[activeModule] : null

  const role = isTherapist ? 'therapist' : 'client'

  // Record a "module opened" event whenever the therapist launches/switches a
  // module. Logged from the therapist browser only (the actor) to avoid the
  // synced client duplicating it, and once per distinct open. This guarantees
  // every module appears in the session report's activity log even if the module
  // itself logs no finer-grained actions.
  const loggedModuleRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isTherapist || !activeModule) {
      loggedModuleRef.current = null
      return
    }
    if (loggedModuleRef.current === activeModule) return
    loggedModuleRef.current = activeModule
    const name = MODULE_INFO[activeModule]?.title || MODULES.find(m => m.id === activeModule)?.name || activeModule
    logModuleEvent(sessionId, {
      module: activeModule,
      type: 'module_opened',
      detail: `Opened the "${name}" activity`,
    })
  }, [activeModule, isTherapist, sessionId])

  const renderModule = () => (
    <ModuleContent
      activeModule={activeModule}
      sessionId={sessionId}
      role={role}
      isLocked={isLocked}
      isTherapist={isTherapist}
    />
  )
  return (
    <div
      style={{
        width: 420,
        height: '100%',
        background: 'rgba(28, 28, 28, 0.55)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 20,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .gm-canvas::-webkit-scrollbar {
          width: 4px;
        }
        .gm-canvas::-webkit-scrollbar-track {
          background: transparent;
        }
        .gm-canvas::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.12);
          border-radius: 4px;
        }
      `}</style>
      {/* Module Header */}
      <div
        style={{
          height: 56,
          padding: '0 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#A8C9BE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
            }}
          >
            {activeModule ? MODULES.find(m => m.id === activeModule)?.icon || '🎯' : '🎯'}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>
              {info?.title || 'No activity'}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
              {info?.subtitle || 'Waiting for selection'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isTherapist && isActive && (
            <button
              onClick={onLockToggle}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: `1px solid ${isLocked ? '#EFC93D' : 'rgba(255,255,255,0.14)'}`,
                background: isLocked ? '#EFC93D' : 'transparent',
                color: isLocked ? '#2C2C2C' : 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
              }}
            >
              {isLocked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
          )}
          {isTherapist && isActive && (
            <button
              onClick={onClose}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: '1px solid #E8897A',
                background: '#E8897A',
                color: '#FFFFFF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Module Canvas — scrollable if content overflows */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="gm-canvas" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px 10px 10px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.12) transparent' }}>
          {renderModule()}
        </div>
        {isLocked && !isTherapist && isActive && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.35)',
              backdropFilter: 'blur(2px)',
              zIndex: 40,
              pointerEvents: 'all',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 10,
                background: 'rgba(28, 28, 28, 0.55)',
                backdropFilter: 'blur(20px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <Lock size={13} style={{ color: '#EFC93D' }} />
              Therapist is controlling
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
