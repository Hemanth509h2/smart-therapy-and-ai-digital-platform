// Canonical registry of the in-session therapy modules.
// Single source of truth for: the in-session module selector, per-therapist
// access control, and the admin access UI. Module ids here MUST match the ids
// that GlassModulePanel switches on / ModuleSelectorPanel launches.

export interface ModuleItem {
  id: string
  name: string
  emoji: string
  desc: string
}

export interface ModuleCategory {
  id: string
  name: string
  desc: string
  emoji: string
  iconBg: string
  iconBorder: string
  /** Solid title colour for the module header on the light stage canvas. */
  accent: string
  modules: ModuleItem[]
}

export const MODULE_CATEGORIES: ModuleCategory[] = [
  {
    id: 'sld',
    name: 'SLD',
    desc: 'Specific Learning Disorder',
    emoji: '📚',
    iconBg: 'rgba(120,90,220,0.25)',
    iconBorder: 'rgba(120,90,220,0.3)',
    accent: '#6D4AE0',
    modules: [
      { id: 'word-building', name: 'Word Building', emoji: '🔤', desc: 'Phonics · spelling · decoding' },
      { id: 'whack-a-mole-math', name: 'Whack-a-Mole Math', emoji: '🔨', desc: 'Math fluency · number recognition' },
      { id: 'pixel-art-coding', name: 'Pixel Art Coding', emoji: '🎨', desc: 'Sequential thinking · pattern recognition' },
      { id: 'bubble-splash', name: 'Bubble Splash', emoji: '🫧', desc: 'Sight words · reading fluency' },
    ],
  },
  {
    id: 'adhd',
    name: 'ADHD',
    desc: 'Attention Deficit Hyperactivity Disorder',
    emoji: '⚡',
    iconBg: 'rgba(220,150,40,0.22)',
    iconBorder: 'rgba(220,150,40,0.3)',
    accent: '#3730D8',
    modules: [
      { id: 'n-back-challenge', name: 'N-Back Challenge', emoji: '🧠', desc: 'Working memory · clinically validated' },
      { id: 'maze', name: 'Virtual Maze', emoji: '🌀', desc: 'Sustained attention · motor planning' },
      { id: 'simon-says', name: 'Simon Says', emoji: '🎮', desc: 'Executive function · inhibitory control' },
    ],
  },
  {
    id: 'anxiety-dep',
    name: 'Anxiety & Depression',
    desc: 'Anxiety and mood disorders',
    emoji: '🌿',
    iconBg: 'rgba(74,124,111,0.25)',
    iconBorder: 'rgba(74,124,111,0.3)',
    accent: '#2F7D5F',
    modules: [
      { id: '5-4-3-2-1-grounding', name: '5-4-3-2-1 Grounding', emoji: '🌱', desc: 'Sensory anchoring · anxiety reduction' },
      { id: 'emotional-charades', name: 'Emotional Charades', emoji: '🎭', desc: 'Emotion identification · social learning' },
      { id: 'virtual-box-popping', name: 'Virtual Box Popping', emoji: '📦', desc: 'Tension release · cognitive defusion' },
      { id: 'worry-box', name: 'Worry Box', emoji: '🗃️', desc: 'Worry containment · externalisation' },
    ],
  },
  {
    id: 'id',
    name: 'ID',
    desc: 'Intellectual Disability',
    emoji: '🌟',
    iconBg: 'rgba(40,130,210,0.22)',
    iconBorder: 'rgba(40,130,210,0.3)',
    accent: '#2563EB',
    modules: [
      { id: 'drag-drop-sorting', name: 'Drag & Drop Sorting', emoji: '🗂️', desc: 'Categorisation · concept formation' },
      { id: 'social-story-sequencing', name: 'Social Story Sequencing', emoji: '📖', desc: 'Narrative comprehension · social prep' },
      { id: 'virtual-shop', name: 'Virtual Shop', emoji: '🛒', desc: 'Money skills · daily living' },
    ],
  },
  {
    id: 'general',
    name: 'General',
    desc: 'General therapy & emotional regulation',
    emoji: '🧘',
    iconBg: 'rgba(100,100,100,0.22)',
    iconBorder: 'rgba(100,100,100,0.3)',
    accent: '#4C3FBF',
    modules: [
      { id: 'emotion-wheel', name: 'Emotion Wheel', emoji: '🎡', desc: 'Emotion identification · granular awareness' },
      { id: 'defusion-river', name: 'Defusion River', emoji: '🌊', desc: 'Cognitive defusion · thought observation' },
      { id: 'thought-challenger', name: 'Thought Challenger', emoji: '⚖️', desc: 'CBT · evidence-based thought restructuring' },
      { id: 'micro-quest-board', name: 'Micro Quest Board', emoji: '🗺️', desc: 'Behavioral activation · micro-goals' },
      { id: 'values-card-sort', name: 'Values Card Sort', emoji: '🃏', desc: 'ACT · values clarification & commitment' },
      { id: 'worry-vault', name: 'Worry Vault', emoji: '🗄️', desc: 'Worry containment · scheduled worry time' },
      { id: 'facts-vs-feelings', name: 'Facts vs Feelings', emoji: '🔍', desc: 'Reality testing · emotion-fact distinction' },
    ],
  },
  {
    id: 'skill',
    name: 'Skill Development',
    desc: 'Life skills for children aged 8–18',
    emoji: '🌱',
    iconBg: 'rgba(16,163,127,0.18)',
    iconBorder: 'rgba(16,163,127,0.28)',
    accent: '#10A37F',
    modules: [
      { id: 'story-choice-adventure', name: 'Story Choice Adventure', emoji: '📖', desc: 'Learn consequences through interactive choices' },
      { id: 'emotion-detective', name: 'Emotion Detective', emoji: '🔍', desc: 'Identify how others feel in real-life situations' },
      { id: 'build-together', name: 'Build Together', emoji: '🌉', desc: 'Combine what you know to build something together' },
      { id: 'treasure-quest', name: 'Treasure Quest', emoji: '🗺️', desc: 'Follow a chain of clues by sharing what you each know' },
    ],
  },
]

// Skill Development modules render in the dedicated full-canvas SkillDevLayout
// instead of the normal session room layout. Every other module is unaffected.
export const SKILL_MODULE_IDS: string[] =
  MODULE_CATEGORIES.find((c) => c.id === 'skill')?.modules.map((m) => m.id) ?? []

export const isSkillModule = (id: string | null | undefined): boolean =>
  !!id && SKILL_MODULE_IDS.includes(id)

export const ALL_MODULES: ModuleItem[] = MODULE_CATEGORIES.flatMap((c) => c.modules)
export const ALL_MODULE_IDS: string[] = ALL_MODULES.map((m) => m.id)

const MODULE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  ALL_MODULES.map((m) => [m.id, m.name])
)

/**
 * Slugs that no longer exist in the registry but may still appear in historical
 * session records (moduleEvents, usage rows, reports). Without these, past
 * sessions render the raw slug — e.g. "digital-sand-tray" — in the notes
 * timeline. Nothing here is launchable; this is display only.
 */
const RETIRED_MODULE_NAMES: Record<string, string> = {
  // Removed entirely — concept judged wrong for the category.
  'digital-sand-tray': 'Digital Sand Tray',
  // Pre-unification slugs for what is now 'bubble-splash'.
  bubble_splash: 'Bubble Splash',
  'bubble-splash-sld': 'Bubble Splash',
  // Removed — testers did not understand either activity.
  'urge-surfing': 'Urge Surfing',
  'safe-space-builder': 'Safe Space Builder',
}

export const moduleName = (id: string): string =>
  MODULE_NAME_BY_ID[id] ?? RETIRED_MODULE_NAMES[id] ?? id

// Resolve a therapist's effective allowed module ids.
// `allModulesAllowed` true (default) means unrestricted -> every module.
export function resolveAllowedModuleIds(therapist: {
  allModulesAllowed?: boolean
  moduleAccess?: string[]
} | null | undefined): string[] {
  if (!therapist) return ALL_MODULE_IDS
  if (therapist.allModulesAllowed !== false) return ALL_MODULE_IDS
  return therapist.moduleAccess ?? []
}
