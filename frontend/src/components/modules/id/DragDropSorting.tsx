'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadSpeak, randomPraise } from '@/lib/voice/staadVoice'
import { useVoiceLanguage } from '@/lib/voice/useVoiceLanguage'
import VoiceLanguageToggle from '@/components/modules/VoiceLanguageToggle'

// Scene backdrop for the sorting canvas. Pale sky art with the decoration kept
// to the edges, so bins and item tiles stay readable over the middle.
const DD_SCENE = `/assets/modules/Background/${encodeURIComponent('Drag and drop sorting_.png')}`

/* ---------------------------------------------------------------------------
   Palette + shared controls. Like the other ID modules, this one was authored
   against the dark glass sidebar — its controls were transparent with
   rgba(0,0,0,0.35) text, which on the white ModuleStage canvas reads as grey on
   white. Stated ink and a solid green selected state bring it in line.
--------------------------------------------------------------------------- */
const GREEN = '#1F7A44'
const GREEN_SOFT = '#E8F4EC'
const INK = '#1F2A24'
const INK_SOFT = '#48544D'
const LINE = '#e7eaef'
const DANGER = '#B4432C'
/* Hover on a drop target is deliberately NEUTRAL slate, not the module's green.
   Green means "correct" everywhere else here — the ✓ badge, the sorted tile, the
   name pop — so a green highlight under the dragged item read as the app saying
   yes, and the child could find the answer by sweeping the bins and watching for
   it. Slate says only "you are over this bin". */
const HOVER_TINT = 'rgba(51,65,85,0.13)'
const HOVER_LINE = '#475569'

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
  fontSize: 14.5, fontWeight: active ? 800 : 600, textTransform: 'capitalize',
  border: `1.5px solid ${active ? GREEN : LINE}`,
  background: active ? GREEN_SOFT : '#ffffff',
  color: active ? GREEN : INK_SOFT,
  transition: 'background .15s, border-color .15s, color .15s',
})

const toolBtn: React.CSSProperties = {
  padding: '6px 13px', borderRadius: 10, cursor: 'pointer',
  fontSize: 14.5, fontWeight: 700,
  border: `1.5px solid ${LINE}`, background: '#ffffff', color: INK_SOFT,
}

/* ---------------------------------------------------------------------------
   Item artwork.

   Every item is drawn from Google's Noto emoji SVG set rather than left to the
   system font. Two reasons: the platform glyph differs on every machine (a
   Windows shark and an iPad shark are not the same picture, and the therapist
   and client see different art for the same card), and the system glyph is a
   FONT — it cannot be sized or styled like an image. These are real SVG images.

   Noto's filenames are the codepoints joined by '_', with the U+FE0F variation
   selector dropped: shark U+1F988 -> emoji_u1f988.svg.
--------------------------------------------------------------------------- */
const NOTO_BASE = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/svg'

function notoUrl(emoji: string): string {
  const cps = Array.from(emoji)
    .map(c => c.codePointAt(0) || 0)
    .filter(cp => cp !== 0xfe0f)
    .map(cp => cp.toString(16).padStart(4, '0'))
  return `${NOTO_BASE}/emoji_u${cps.join('_')}.svg`
}

/** The picture for one item. Falls back to the platform glyph if the image
    cannot load, so the activity still works offline or behind a proxy. */
function ItemArt({ emoji, size, alt }: { emoji: string; size: number; alt?: string }) {
  const [failed, setFailed] = useState(false)
  /* Numbers and letters are plain characters with no emoji image. Drawing them
     as type avoids a request that would always 404 before falling back. */
  const isPictorial = Array.from(emoji).some(c => (c.codePointAt(0) || 0) > 0x2000)
  if (!isPictorial) {
    return (
      <span style={{
        fontSize: size * 0.82, lineHeight: 1, fontWeight: 800, color: INK,
        fontFamily: '"DM Sans", sans-serif', display: 'block',
      }}>{emoji}</span>
    )
  }
  if (failed) {
    return <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={notoUrl(emoji)}
      alt={alt || ''}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', userSelect: 'none' }}
    />
  )
}

interface DragDropSortingProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface BinDef { id: string; emoji: string; label: string }
interface ItemDef { id: string; emoji: string; label: string; binId: string }
interface CategorySet { id: string; name: string; bins: BinDef[]; items: ItemDef[] }

const DIFF: Record<string, { total: number }> = { easy: { total: 6 }, medium: { total: 10 }, hard: { total: 14 } }

function buildPool(set: CategorySet, bins: BinDef[], difficulty: string, round: number): ItemDef[] {
  const total = DIFF[difficulty]?.total || 10
  const perBin = Math.ceil(total / Math.max(1, bins.length))
  const items: ItemDef[] = []
  for (const bin of bins) {
    const all = set.items.filter(i => i.binId === bin.id)
    if (!all.length) continue
    const start = (round * perBin) % all.length
    const take = Math.min(perBin, all.length)
    for (let k = 0; k < take; k++) items.push(all[(start + k) % all.length])
  }
  return items.slice(0, total)
}

/* Items are written as explicit [emoji, label] pairs.

   They used to be a run-on emoji string put through .split(''), which splits on
   UTF-16 code units — any emoji built from more than one unit was torn into
   pieces. Pairs cannot break that way, and they are far easier to extend. */
type ItemPair = [string, string]
function mk(prefix: string, binId: string, pairs: ItemPair[]): ItemDef[] {
  return pairs.map(([emoji, label], i) => ({ id: `${prefix}${i}`, emoji, label, binId }))
}

const SETS: CategorySet[] = [
  {
    id: 'fruits-vs-veggies', name: 'Fruits vs Vegetables',
    bins: [{ id: 'fruits', emoji: '🍎', label: 'Fruits' }, { id: 'veggies', emoji: '🥦', label: 'Vegetables' }],
    items: [
      ...mk('f', 'fruits', [
        ['🍎', 'Apple'], ['🍊', 'Orange'], ['🍋', 'Lemon'], ['🍇', 'Grapes'], ['🍓', 'Strawberry'], ['🍌', 'Banana'],
        ['🍑', 'Peach'], ['🍒', 'Cherry'], ['🥭', 'Mango'], ['🍍', 'Pineapple'], ['🍉', 'Watermelon'], ['🍐', 'Pear'],
        ['🥝', 'Kiwi'], ['🥥', 'Coconut'], ['🫐', 'Blueberries'], ['🍈', 'Melon'], ['🍏', 'Green Apple'],
        ['🍅', 'Tomato'], ['🫒', 'Olive'], ['🥑', 'Avocado'],
      ]),
      ...mk('v', 'veggies', [
        ['🥦', 'Broccoli'], ['🥕', 'Carrot'], ['🧅', 'Onion'], ['🥔', 'Potato'], ['🌽', 'Corn'], ['🍆', 'Eggplant'],
        ['🥒', 'Cucumber'], ['🧄', 'Garlic'], ['🥬', 'Lettuce'], ['🫑', 'Pepper'], ['🍄', 'Mushroom'], ['🫛', 'Peas'],
        ['🌶️', 'Chilli'], ['🫚', 'Ginger'], ['🍠', 'Sweet Potato'], ['🥗', 'Salad'],
      ]),
    ],
  },
  {
    id: 'animals', name: 'Animals: Land·Water·Sky',
    bins: [{ id: 'land', emoji: '🦁', label: 'Land' }, { id: 'water', emoji: '🐠', label: 'Water' }, { id: 'sky', emoji: '🦅', label: 'Sky' }],
    items: [
      ...mk('l', 'land', [
        ['🦁', 'Lion'], ['🐘', 'Elephant'], ['🐶', 'Dog'], ['🐱', 'Cat'], ['🐸', 'Frog'], ['🐢', 'Turtle'], ['🦊', 'Fox'],
        ['🐺', 'Wolf'], ['🐴', 'Horse'], ['🐮', 'Cow'], ['🐷', 'Pig'], ['🐰', 'Rabbit'], ['🐻', 'Bear'], ['🐼', 'Panda'],
        ['🐯', 'Tiger'], ['🦓', 'Zebra'], ['🦌', 'Deer'], ['🐨', 'Koala'],
      ]),
      ...mk('w', 'water', [
        ['🐠', 'Fish'], ['🐳', 'Whale'], ['🦈', 'Shark'], ['🐙', 'Octopus'], ['🦑', 'Squid'], ['🐡', 'Pufferfish'],
        ['🦭', 'Seal'], ['🐬', 'Dolphin'], ['🦀', 'Crab'], ['🦞', 'Lobster'], ['🦐', 'Shrimp'], ['🐚', 'Shell'],
        ['🐋', 'Blue Whale'], ['🦦', 'Otter'], ['🐊', 'Crocodile'], ['🪼', 'Jellyfish'], ['🐟', 'Blue Fish'],
        ['🪸', 'Coral'],
      ]),
      ...mk('s', 'sky', [
        ['🦅', 'Eagle'], ['🦋', 'Butterfly'], ['🐦', 'Bird'], ['🦜', 'Parrot'], ['🦆', 'Duck'], ['🦉', 'Owl'],
        ['🐧', 'Penguin'], ['🦚', 'Peacock'], ['🕊️', 'Dove'], ['🦢', 'Swan'], ['🦇', 'Bat'], ['🐝', 'Bee'],
        ['🪰', 'Fly'], ['🦟', 'Mosquito'], ['🦩', 'Flamingo'], ['🐓', 'Rooster'],
      ]),
    ],
  },
  {
    id: 'big-vs-small', name: 'Big vs Small',
    bins: [{ id: 'big', emoji: '🐘', label: 'Big' }, { id: 'small', emoji: '🐭', label: 'Small' }],
    items: [
      ...mk('bg', 'big', [
        ['🐘', 'Elephant'], ['🦒', 'Giraffe'], ['🦛', 'Hippo'], ['🐋', 'Whale'], ['🦏', 'Rhino'], ['🦬', 'Buffalo'],
        ['🐊', 'Crocodile'], ['🦍', 'Gorilla'], ['🐻', 'Bear'], ['🐫', 'Camel'], ['🫎', 'Moose'], ['🦣', 'Mammoth'],
        ['🦈', 'Shark'], ['🐴', 'Horse'], ['🦌', 'Deer'], ['🐄', 'Cow'], ['🦧', 'Orangutan'], ['🐉', 'Dragon'],
      ]),
      ...mk('sm', 'small', [
        ['🐭', 'Mouse'], ['🐜', 'Ant'], ['🐝', 'Bee'], ['🐛', 'Caterpillar'], ['🦎', 'Lizard'], ['🐞', 'Ladybug'],
        ['🕷️', 'Spider'], ['🐿️', 'Squirrel'], ['🦗', 'Cricket'], ['🐌', 'Snail'], ['🦋', 'Butterfly'],
        ['🐹', 'Hamster'], ['🐣', 'Chick'], ['🪲', 'Beetle'], ['🦂', 'Scorpion'], ['🐸', 'Frog'], ['🪳', 'Cockroach'],
        ['🦠', 'Germ'],
      ]),
    ],
  },
  {
    id: 'clean-vs-dirty', name: 'Clean vs Dirty',
    bins: [{ id: 'clean', emoji: '✨', label: 'Clean' }, { id: 'dirty', emoji: '🧹', label: 'Needs Cleaning' }],
    items: [
      ...mk('cl', 'clean', [
        ['🛁', 'Bathtub'], ['🧼', 'Soap'], ['🪥', 'Toothbrush'], ['🧴', 'Lotion'], ['🚿', 'Shower'], ['🪒', 'Razor'],
        ['🧽', 'Sponge'], ['✨', 'Sparkle'], ['🧻', 'Tissue'], ['🚰', 'Clean Water'], ['🫧', 'Bubbles'],
        ['🪞', 'Mirror'], ['👕', 'Clean Shirt'], ['🪟', 'Window'],
      ]),
      ...mk('di', 'dirty', [
        ['🦷', 'Dirty Teeth'], ['🧺', 'Laundry'], ['👟', 'Dirty Shoes'], ['🍽️', 'Dirty Dishes'], ['🗑️', 'Trash'],
        ['🧹', 'Broom'], ['🪣', 'Bucket'], ['💧', 'Dirty Water'], ['🪰', 'Flies'], ['🧦', 'Dirty Socks'],
        ['🕸️', 'Cobweb'], ['🚮', 'Litter'], ['💩', 'Mess'], ['🧫', 'Germs'],
      ]),
    ],
  },
  {
    id: 'happy-vs-sad', name: 'Happy vs Sad',
    bins: [{ id: 'happy', emoji: '😊', label: 'Happy Things' }, { id: 'sad', emoji: '😢', label: 'Sad Things' }],
    items: [
      ...mk('h', 'happy', [
        ['🎂', 'Cake'], ['🎁', 'Gift'], ['🎠', 'Carousel'], ['🌈', 'Rainbow'], ['🎉', 'Party'], ['🌸', 'Flowers'],
        ['🎶', 'Music'], ['🏆', 'Trophy'], ['⭐', 'Star'], ['🎈', 'Balloon'], ['🍦', 'Ice Cream'],
        ['🎡', 'Ferris Wheel'], ['🥳', 'Celebrate'], ['😄', 'Smile'], ['☀️', 'Sunshine'], ['🤗', 'Hug'],
      ]),
      ...mk('sd', 'sad', [
        ['💔', 'Broken Heart'], ['🌧️', 'Rain'], ['😢', 'Sadness'], ['🤒', 'Sick'], ['🥀', 'Wilted Flower'],
        ['⛈️', 'Storm'], ['😞', 'Disappointed'], ['🚫', 'No Entry'], ['😭', 'Crying'], ['🩹', 'Hurt'], ['🌫️', 'Fog'],
        ['😔', 'Down'], ['🥺', 'Upset'], ['😟', 'Worried'], ['🌩️', 'Thunder'], ['💧', 'Tear'],
      ]),
    ],
  },
  {
    id: 'day-vs-night', name: 'Day vs Night',
    bins: [{ id: 'day', emoji: '☀️', label: 'Daytime' }, { id: 'night', emoji: '🌙', label: 'Nighttime' }],
    items: [
      ...mk('d', 'day', [
        ['☀️', 'Sun'], ['🌻', 'Sunflower'], ['🐓', 'Rooster'], ['🏫', 'School'], ['🌤️', 'Sunny'], ['🍳', 'Eggs'],
        ['🚌', 'School Bus'], ['🏃', 'Running'], ['🌅', 'Sunrise'], ['🪁', 'Kite'], ['⛱️', 'Parasol'],
        ['🚲', 'Cycling'], ['🌞', 'Bright Sun'], ['🥪', 'Lunch'], ['🏖️', 'Beach Day'], ['🧺', 'Picnic'],
      ]),
      ...mk('n', 'night', [
        ['🌙', 'Moon'], ['⭐', 'Stars'], ['🦉', 'Owl'], ['🛌', 'Bed'], ['🌃', 'Night Sky'], ['🌠', 'Shooting Star'],
        ['🦇', 'Bat'], ['🔦', 'Flashlight'], ['🌜', 'Crescent'], ['😴', 'Sleeping'], ['🕯️', 'Candle'],
        ['🛏️', 'Bedroom'], ['🌌', 'Milky Way'], ['🧸', 'Teddy'], ['🌛', 'Moon Face'], ['🦗', 'Cricket'],
      ]),
    ],
  },
  {
    id: 'hot-vs-cold', name: 'Hot vs Cold',
    bins: [{ id: 'hot', emoji: '🔥', label: 'Hot' }, { id: 'cold', emoji: '❄️', label: 'Cold' }],
    items: [
      ...mk('ho', 'hot', [
        ['🔥', 'Fire'], ['☀️', 'Sun'], ['🍵', 'Tea'], ['🌋', 'Volcano'], ['🏜️', 'Desert'], ['🌡️', 'Thermometer'],
        ['♨️', 'Steam'], ['🫖', 'Teapot'], ['🥵', 'Hot Face'], ['☕', 'Coffee'], ['🍲', 'Soup'], ['🕯️', 'Candle'],
        ['🌶️', 'Chilli'], ['🔆', 'Bright'],
      ]),
      ...mk('co', 'cold', [
        ['❄️', 'Snowflake'], ['🌨️', 'Snow'], ['🧊', 'Ice'], ['🏔️', 'Mountain'], ['🥶', 'Cold'], ['🍦', 'Ice Cream'],
        ['⛄', 'Snowman'], ['🌬️', 'Wind'], ['🧣', 'Scarf'], ['🧤', 'Gloves'], ['🐧', 'Penguin'], ['🎿', 'Skiing'],
        ['🍧', 'Shaved Ice'], ['☃️', 'Snow Person'],
      ]),
    ],
  },
  {
    id: 'school-vs-home', name: 'School vs Home',
    bins: [{ id: 'school', emoji: '🏫', label: 'School' }, { id: 'home', emoji: '🏠', label: 'Home' }],
    items: [
      ...mk('sc', 'school', [
        ['📚', 'Books'], ['✏️', 'Pencil'], ['📐', 'Set Square'], ['🎒', 'Backpack'], ['🖊️', 'Pen'], ['📏', 'Ruler'],
        ['🔬', 'Microscope'], ['🗂️', 'Folder'], ['🖍️', 'Crayon'], ['📝', 'Notebook'], ['🧮', 'Abacus'],
        ['🖇️', 'Paperclip'], ['🏫', 'School'], ['📔', 'Journal'], ['✂️', 'Scissors'], ['🗒️', 'Notepad'],
      ]),
      ...mk('hm', 'home', [
        ['🛋️', 'Couch'], ['🍳', 'Cooking'], ['🛁', 'Bathtub'], ['🛏️', 'Bed'], ['📺', 'TV'], ['🪴', 'Plant'],
        ['🧹', 'Broom'], ['🔑', 'Keys'], ['🚪', 'Door'], ['🪑', 'Chair'], ['🧺', 'Laundry'], ['🍽️', 'Dishes'],
        ['🪟', 'Window'], ['🧸', 'Toys'], ['🚿', 'Shower'], ['🕰️', 'Clock'],
      ]),
    ],
  },
  {
    id: 'healthy-vs-unhealthy', name: 'Healthy vs Unhealthy',
    bins: [{ id: 'healthy', emoji: '💚', label: 'Healthy' }, { id: 'unhealthy', emoji: '🚫', label: 'Unhealthy' }],
    items: [
      ...mk('hl', 'healthy', [
        ['🥦', 'Broccoli'], ['🍎', 'Apple'], ['🥕', 'Carrot'], ['🥗', 'Salad'], ['🫐', 'Blueberries'], ['🥑', 'Avocado'],
        ['🥚', 'Egg'], ['🐟', 'Fish'], ['🍌', 'Banana'], ['🥛', 'Milk'], ['🌽', 'Corn'], ['🍊', 'Orange'], ['🥜', 'Nuts'],
        ['🍠', 'Sweet Potato'], ['💧', 'Water'], ['🥒', 'Cucumber'],
      ]),
      ...mk('un', 'unhealthy', [
        ['🍔', 'Burger'], ['🍟', 'Fries'], ['🍕', 'Pizza'], ['🧁', 'Cupcake'], ['🍭', 'Candy'], ['🥤', 'Soda'],
        ['🍿', 'Popcorn'], ['🍩', 'Donut'], ['🍫', 'Chocolate'], ['🌭', 'Hot Dog'], ['🍪', 'Cookie'], ['🍰', 'Cake'],
        ['🥓', 'Bacon'], ['🍬', 'Sweets'], ['🧋', 'Bubble Tea'], ['🍦', 'Ice Cream'],
      ]),
    ],
  },
  {
    /* Rebuilt. The numbers were written as one run-on string of keycap emoji
       and split with .split(''), which splits on UTF-16 code units — '1️⃣' is
       three of them, so eight keycaps became twenty-four fragments and six of
       the eight numbers rendered as invisible combining marks. The letters were
       worse: ©️, 🆒, 🆓, 🆔 and 🆘 were labelled C, D, E, F and SOS, so the
       activity taught the wrong symbols.

       Both bins now carry plain characters. ItemArt draws non-emoji as text, so
       these render as clean glyphs — this category is symbol recognition, and
       there is no emoji for most letters anyway. */
    id: 'numbers-vs-letters', name: 'Numbers vs Letters',
    bins: [{ id: 'numbers', emoji: '🔢', label: 'Numbers' }, { id: 'letters', emoji: '🔤', label: 'Letters' }],
    items: [
      ...mk('num', 'numbers', [
        ['1', 'One'], ['2', 'Two'], ['3', 'Three'], ['4', 'Four'], ['5', 'Five'],
        ['6', 'Six'], ['7', 'Seven'], ['8', 'Eight'], ['9', 'Nine'], ['10', 'Ten'],
        ['11', 'Eleven'], ['12', 'Twelve'],
      ]),
      ...mk('let', 'letters', [
        ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E'], ['F', 'F'],
        ['G', 'G'], ['H', 'H'], ['I', 'I'], ['J', 'J'], ['K', 'K'], ['L', 'L'],
      ]),
    ],
  },
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export default function DragDropSorting({ sessionId, role, isLocked }: DragDropSortingProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [setId, setSetId] = useState('fruits-vs-veggies')
  const [difficulty, setDifficulty] = useState('medium')
  const [displayMode, setDisplayMode] = useState<'emoji+label' | 'emoji'>('emoji+label')
  /* The just-placed item's name, shown over the bin it landed in. */
  const [namePop, setNamePop] = useState<{ binId: string; label: string; k: number } | null>(null)
  const [itemOrder, setItemOrder] = useState<string[]>([])
  /* Which deal of the current category is in play. Shared so both screens draw
     the same cards. */
  const [setRound, setSetRound] = useState(0)
  const [sorted, setSorted] = useState<Record<string, string>>({})
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [completed, setCompleted] = useState(false)

  const [dragItem, setDragItem] = useState<string | null>(null)
  const [hoverBin, setHoverBin] = useState<string | null>(null)
  const [animBounce, setAnimBounce] = useState<Set<string>>(new Set())
  const [animShake, setAnimShake] = useState<Set<string>>(new Set())
  const [flashWrong, setFlashWrong] = useState<Set<string>>(new Set())
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [checkItems, setCheckItems] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string } | null>(null)

  const voiceLanguage = useVoiceLanguage(sessionId)
  // Ref so drop handlers can read the current language without gaining a new
  // dependency (their identity feeds the drag/drop logic).
  const voiceLangRef = useRef(voiceLanguage)
  voiceLangRef.current = voiceLanguage

  const cRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragId = useRef<string | null>(null)
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const ctr = useRef(0)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.ddSet === 'string') setSetId(s.ddSet)
      if (typeof s.ddDifficulty === 'string') setDifficulty(s.ddDifficulty)
      if (s.ddDisplayMode === 'emoji' || s.ddDisplayMode === 'emoji+label') setDisplayMode(s.ddDisplayMode)
      if (Array.isArray(s.ddItemOrder)) setItemOrder(s.ddItemOrder)
      if (typeof s.ddSetRound === 'number') setSetRound(s.ddSetRound)
      if (typeof s.ddSorted === 'object' && s.ddSorted !== null) setSorted(s.ddSorted as Record<string, string>)
      if (typeof s.ddCorrect === 'number') setCorrect(s.ddCorrect)
      if (typeof s.ddWrong === 'number') setWrong(s.ddWrong)
      if (typeof s.ddCompleted === 'boolean') setCompleted(s.ddCompleted)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current) }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), 2000)
  }, [])

  const currentSet = SETS.find(s => s.id === setId) || SETS[0]

  const usedBins = useMemo(() => {
    if (difficulty === 'easy') return currentSet.bins.slice(0, 2)
    return currentSet.bins
  }, [currentSet, difficulty])

  /* Which items this round draws. `slice(0, perBin)` always took the SAME first
     N of each bin, so "New Set" dealt the identical cards every time — it only
     cleared the score. The window now rotates by the round number, so each new
     set draws different items from the same category. The round is shared, so
     both screens deal the same cards. */
  const poolItems = useMemo(
    () => buildPool(currentSet, usedBins, difficulty, setRound),
    [currentSet, usedBins, difficulty, setRound],
  )

  const itemMap = useMemo(() => {
    const m = new Map<string, ItemDef>()
    for (const item of poolItems) m.set(item.id, item)
    return m
  }, [poolItems])

  const sortedCount = Object.keys(sorted).length
  const totalItems = itemOrder.length
  const remaining = totalItems - sortedCount
  const pct = totalItems > 0 ? Math.round((sortedCount / totalItems) * 100) : 0
  const allDone = completed || (totalItems > 0 && sortedCount >= totalItems)

  const resolvedItems = useMemo(() => {
    const fromStore = itemOrder.filter(id => itemMap.has(id))
    if (fromStore.length > 0) return fromStore
    return shuffle(Array.from(itemMap.keys()))
  }, [itemOrder, itemMap])

  const unsortedItems = resolvedItems.filter(id => !sorted[id])
  const sortedEntries = Object.entries(sorted).filter(([id]) => itemMap.has(id))

  const handleDrop = useCallback((itemId: string, binId: string) => {
    if (!canInteract) return
    const item = itemMap.get(itemId)
    if (!item || sorted[itemId]) return
    const correctBin = item.binId === binId
    if (correctBin) {
      setAnimBounce(prev => new Set(prev).add(itemId))
      setCheckItems(prev => new Set(prev).add(itemId))
      const n = ++ctr.current
      setTimeout(() => { setAnimBounce(prev => { const s = new Set(prev); s.delete(itemId); return s }); setCheckItems(prev => { const s = new Set(prev); s.delete(itemId); return s }) }, 450)
      write({ [`moduleState.ddSorted.${itemId}`]: binId, 'moduleState.ddCorrect': correct + 1 })
      if (sortedCount + 1 >= totalItems) {
        setTimeout(() => write({ 'moduleState.ddCompleted': true }), 300)
      }
      // Names the item just sorted, both ways: spoken, and shown over the bin
      // so it lands even with the sound off. Labels are English nouns, so the
      // speech stays 'en-IN' — only the praise follows the therapist's language.
      staadSpeak({ text: item.label, language: 'en-IN', type: 'feedback' })
      setNamePop({ binId, label: item.label, k: n })
      setTimeout(() => setNamePop(prev => (prev && prev.k === n ? null : prev)), 1500)
    } else {
      setAnimShake(prev => new Set(prev).add(itemId))
      setFlashWrong(prev => new Set(prev).add(binId))
      setTimeout(() => {
        setAnimShake(prev => { const s = new Set(prev); s.delete(itemId); return s })
        setFlashWrong(prev => { const s = new Set(prev); s.delete(binId); return s })
      }, 400)
      write({ 'moduleState.ddWrong': wrong + 1 })
    }
  }, [canInteract, itemMap, sorted, write, correct, wrong, sortedCount, totalItems])

  const loggedDoneRef = useRef(false)
  useEffect(() => {
    if (allDone && completed) {
      if (isT && !loggedDoneRef.current) {
        loggedDoneRef.current = true
        logModuleEvent(sessionId, {
          module: 'drag-drop-sorting',
          type: 'completed',
          detail: `Completed the "${currentSet.name}" sorting activity (${correct} correct, ${wrong} wrong attempt${wrong === 1 ? '' : 's'})`,
        })
      }
      const wc = wrong
      const star = wc === 0 ? '⭐⭐⭐ Perfect!' : wc <= 3 ? '⭐⭐ Great job!' : '⭐ Keep practising!'
      showToast(`All sorted! ${star}`)
      // Appreciation voice — shared phrase bank, therapist's chosen language.
      staadSpeak({ text: randomPraise(voiceLangRef.current), language: voiceLangRef.current, type: 'praise' })
    }
    if (!allDone) loggedDoneRef.current = false
  }, [allDone, completed, wrong, correct, showToast, isT, sessionId, currentSet.name])

  const handleReset = useCallback(() => {
    write({ 'moduleState.ddSorted': {}, 'moduleState.ddCorrect': 0, 'moduleState.ddWrong': 0, 'moduleState.ddCompleted': false })
    const fresh = shuffle(Array.from(itemMap.keys()))
    write({ 'moduleState.ddItemOrder': fresh })
  }, [write, itemMap])

  const handleShuffle = useCallback(() => {
    const fresh = shuffle(resolvedItems.filter(id => !sorted[id]).concat(sortedEntries.map(([id]) => id)))
    write({ 'moduleState.ddItemOrder': fresh })
  }, [write, resolvedItems, sorted, sortedEntries])

  /* New Set deals the NEXT window of the same category, jumbled. It used to
     only zero the counters, so the same cards came back in the same order and
     nothing about it was new. */
  const handleNewSet = useCallback(() => {
    const nextRound = setRound + 1
    const order = shuffle(buildPool(currentSet, usedBins, difficulty, nextRound).map(i => i.id))
    write({
      'moduleState.ddSetRound': nextRound,
      'moduleState.ddItemOrder': order,
      'moduleState.ddSorted': {},
      'moduleState.ddCorrect': 0,
      'moduleState.ddWrong': 0,
      'moduleState.ddCompleted': false,
    })
  }, [setRound, currentSet, usedBins, difficulty, write])

  const handleSetChange = useCallback((newSetId: string) => {
    const nextSet = SETS.find(x => x.id === newSetId) || SETS[0]
    const bins = difficulty === 'easy' ? nextSet.bins.slice(0, 2) : nextSet.bins
    // Same builder poolItems uses, so the written order can never disagree with
    // the items the board actually renders.
    const order = shuffle(buildPool(nextSet, bins, difficulty, 0).map(i => i.id))
    write({
      'moduleState.ddSet': newSetId,
      'moduleState.ddSetRound': 0,
      'moduleState.ddItemOrder': order,
      'moduleState.ddSorted': {}, 'moduleState.ddCorrect': 0, 'moduleState.ddWrong': 0,
      'moduleState.ddCompleted': false,
    })
  }, [difficulty, write])

  const handleDifficultyChange = useCallback((d: string) => {
    const bins = d === 'easy' ? currentSet.bins.slice(0, 2) : currentSet.bins
    const order = shuffle(buildPool(currentSet, bins, d, setRound).map(i => i.id))
    write({
      'moduleState.ddDifficulty': d,
      'moduleState.ddItemOrder': order,
      'moduleState.ddSorted': {}, 'moduleState.ddCorrect': 0, 'moduleState.ddWrong': 0,
      'moduleState.ddCompleted': false,
    })
  }, [currentSet, setRound, write])

  // --- HTML5 Drag Handlers ---
  const onDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    if (!canInteract) return
    isDragging.current = true
    dragId.current = itemId
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.effectAllowed = 'move'
  }, [canInteract])

  const onDragEnd = useCallback(() => {
    isDragging.current = false
    dragId.current = null
    setHoverBin(null)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDragEnter = useCallback((e: React.DragEvent, binId: string) => {
    e.preventDefault()
    setHoverBin(binId)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    /* dragleave also fires when the pointer crosses onto a child of the bin —
       its icon, its label, a tile already sorted into it — which switched the
       highlight off and straight back on, so it strobed while hovering. Ignore
       a leave that is really a move deeper inside the same bin. */
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setHoverBin(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent, binId: string) => {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('text/plain') || dragId.current
    setHoverBin(null)
    if (itemId) handleDrop(itemId, binId)
  }, [handleDrop])

  // --- Touch Drag Handlers ---
  useEffect(() => {
    const el = cRef.current
    if (!el) return
    const onTM = (e: TouchEvent) => {
      if (!isDragging.current || !dragId.current) return
      e.preventDefault()
      const touch = e.touches[0]
      setGhostPos({ x: touch.clientX, y: touch.clientY })
      const el2 = document.elementFromPoint(touch.clientX, touch.clientY)
      const binEl = el2?.closest('[data-bin]')
      setHoverBin(binEl ? binEl.getAttribute('data-bin')! : null)
    }
    const onTE = (e: TouchEvent) => {
      if (!isDragging.current || !dragId.current) return
      const touch = e.changedTouches[0]
      const el2 = document.elementFromPoint(touch.clientX, touch.clientY)
      const binEl = el2?.closest('[data-bin]')
      if (binEl) {
        const binId = binEl.getAttribute('data-bin')!
        handleDrop(dragId.current, binId)
      }
      isDragging.current = false
      dragId.current = null
      setGhostPos(null)
      setHoverBin(null)
    }
    el.addEventListener('touchmove', onTM, { passive: false })
    el.addEventListener('touchend', onTE)
    el.addEventListener('touchcancel', onTE)
    return () => { el.removeEventListener('touchmove', onTM); el.removeEventListener('touchend', onTE); el.removeEventListener('touchcancel', onTE) }
  }, [handleDrop])

  const onTouchStart = useCallback((itemId: string) => (e: React.TouchEvent) => {
    if (!canInteract) return
    e.preventDefault()
    isDragging.current = true
    dragId.current = itemId
    const touch = e.touches[0]
    setGhostPos({ x: touch.clientX, y: touch.clientY })
  }, [canInteract])

  const starText = wrong === 0 ? '⭐⭐⭐ Perfect!' : wrong <= 3 ? '⭐⭐ Great job!' : '⭐ Keep practising!'

  const gridCols = usedBins.length === 2 ? '1fr 1fr' : usedBins.length === 3 ? '1fr 1fr 1fr' : '1fr 1fr'

  return (
    <>
      <style>{`
        @keyframes bi {0%{transform:scale(.5);opacity:0}60%{transform:scale(1.15)}80%{transform:scale(.95)}100%{transform:scale(1);opacity:1}}
        @keyframes ws {0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
        @keyframes fb {0%{transform:scale(.8);opacity:.6}100%{transform:scale(1);opacity:1}}
        @keyframes cf {0%{opacity:0}100%{opacity:1}}
        /* The name of the item that was just placed correctly, popping up over
           the bin. The label was only ever SPOKEN, so with the volume down (or
           a client who reads better than they hear) nothing named the item at
           all — which is the vocabulary half of the exercise. */
        @keyframes dd-name {
          0%   {transform:translate(-50%,6px) scale(.8); opacity:0}
          18%  {transform:translate(-50%,-4px) scale(1.06); opacity:1}
          70%  {transform:translate(-50%,-8px) scale(1); opacity:1}
          100% {transform:translate(-50%,-26px) scale(.95); opacity:0}
        }
        .bi-a {animation:bi .4s ease forwards}
        .ws-a {animation:ws .35s ease}
        .fb-a {animation:fb .3s ease}
      `}</style>

      {/* Therapist controls */}
      {isT && (
        <div style={{ flexShrink: 0, padding: '6px 10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
          {/* Set selector */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'thin' }}>
            {SETS.map(s => (
              <button key={s.id} onClick={() => handleSetChange(s.id)}
                style={{
                  whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 13,
                  border: setId === s.id ? '1px solid rgba(74,124,111,0.6)' : '1px solid rgba(0,0,0,0.08)',
                  background: setId === s.id ? 'rgba(74,124,111,0.2)' : 'transparent',
                  color: setId === s.id ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)',
                }}
              >{s.name}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: INK_SOFT, fontWeight: 700 }}>Difficulty:</span>
            {['easy', 'medium', 'hard'].map(d => (
              <button key={d} onClick={() => handleDifficultyChange(d)} style={segBtn(difficulty === d)}>
                {d}
              </button>
            ))}
            {/* Two named options rather than one button that renames itself.
                The old control showed the CURRENT mode as its caption, so the
                other mode was invisible and clicking it was a guess. */}
            <span style={{ marginLeft: 4, color: INK_SOFT, fontWeight: 700 }}>Show:</span>
            <button
              onClick={() => write({ 'moduleState.ddDisplayMode': 'emoji' })}
              style={segBtn(displayMode === 'emoji')}
            >Picture only</button>
            <button
              onClick={() => write({ 'moduleState.ddDisplayMode': 'emoji+label' })}
              style={segBtn(displayMode === 'emoji+label')}
            >Picture + name</button>
            <button onClick={handleShuffle} style={{ ...toolBtn, marginLeft: 'auto' }}>🔀 Shuffle</button>
            <button onClick={handleReset} style={{ ...toolBtn, borderColor: 'rgba(180,67,44,0.45)', background: '#FDF1EE', color: DANGER }}>↺ Reset</button>
            <VoiceLanguageToggle sessionId={sessionId} language={voiceLanguage} />
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={cRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: 18,
          gap: 14,
          touchAction: 'none',
          borderRadius: 16,
          backgroundImage: `url('${DD_SCENE}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >

        {/* Item pool */}
        <div style={{
          background: 'rgba(255,255,255,0.78)', borderRadius: 14, padding: 16,
          minHeight: 104, border: '1px dashed rgba(0,0,0,0.14)',
          display: 'flex', flexWrap: 'wrap', gap: 12,
          /* Centred on both axes. With the default flex-start the tiles packed
             hard against the left edge, so the drag from pool to bin was long
             and lopsided — and as items were taken the rest stayed pinned left,
             leaving a growing empty gap. Centring means the remaining tiles
             close up around the middle after every pick, keeping the next drag
             short and the travel even to whichever bin. */
          justifyContent: 'center',
          alignContent: 'center',
          boxShadow: '0 4px 14px rgba(20,30,40,0.06)',
        }}>
          {unsortedItems.map(id => {
            const item = itemMap.get(id)
            if (!item) return null
            const isShaking = animShake.has(id)
            const isBouncing = animBounce.has(id)
            if (isBouncing) return null
            return (
              <div key={id} data-item-id={id}
                draggable={canInteract}
                onDragStart={e => onDragStart(e, id)}
                onDragEnd={onDragEnd}
                onTouchStart={onTouchStart(id)}
                className={isShaking ? 'ws-a fb-a' : ''}
                style={{
                  /* 60px with a 30px glyph was the size of a toolbar icon. These
                     are the things being identified, so they get a real tile and
                     a real picture. */
                  width: displayMode === 'emoji+label' ? 100 : 84,
                  height: displayMode === 'emoji+label' ? 100 : 84,
                  borderRadius: 16,
                  background: dragItem === id ? GREEN_SOFT : '#ffffff',
                  border: `2px solid ${dragItem === id ? GREEN : LINE}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  padding: '6px 5px',
                  cursor: canInteract ? 'grab' : 'default',
                  transition: 'all 0.15s',
                  boxShadow: dragItem === id ? '0 10px 22px rgba(31,122,68,0.28)' : '0 3px 10px rgba(20,30,40,0.10)',
                  opacity: dragItem === id ? 0.9 : 1,
                  transform: dragItem === id ? 'scale(1.12)' : 'scale(1)',
                  userSelect: 'none', WebkitUserSelect: 'none',
                }}
              >
                <ItemArt emoji={item.emoji} size={displayMode === 'emoji+label' ? 46 : 54} alt={item.label} />
                {displayMode === 'emoji+label' && (
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: INK, textAlign: 'center', lineHeight: 1.15,
                    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{item.label}</span>
                )}
              </div>
            )
          })}
          {unsortedItems.length === 0 && !allDone && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'rgba(0,0,0,0.2)', fontSize: 14 }}>
              {totalItems > 0 ? 'All items sorted!' : 'Loading items...'}
            </div>
          )}
        </div>

        {/* Bins */}
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {usedBins.map(bin => {
            const isHover = hoverBin === bin.id
            const isFlash = flashWrong.has(bin.id)
            // While anything is in hand, EVERY bin firms up equally, so no
            // single bin stands out until the item is actually over it.
            const isArmed = !!dragItem && !isHover && !isFlash
            const binItems = sortedEntries.filter(([, b]) => b === bin.id)
            return (
              <div key={bin.id} data-bin={bin.id}
                onDragOver={onDragOver}
                onDragEnter={e => onDragEnter(e, bin.id)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, bin.id)}
                style={{
                  flex: 1, borderRadius: 16, minHeight: 120, padding: 14,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  transition: 'all 0.2s', overflowY: 'auto',
                  boxShadow: '0 4px 14px rgba(20,30,40,0.06)',
                  background: isFlash ? 'rgba(200,96,42,0.2)'
                    : isHover ? HOVER_TINT
                    : isArmed ? 'rgba(255,255,255,0.92)'
                    : 'rgba(255,255,255,0.78)',
                  border: isFlash ? '1.5px solid rgba(200,96,42,0.5)'
                    : isHover ? `2px solid ${HOVER_LINE}`
                    : isArmed ? '1.5px dashed rgba(0,0,0,0.30)'
                    : '1.5px dashed rgba(0,0,0,0.18)',
                  borderStyle: isHover || isFlash ? 'solid' : 'dashed',
                  transform: isHover ? 'scale(1.02)' : 'scale(1)',
                  position: 'relative',
                }}
              >
                {/* "Apple!" pops over the bin the moment it lands correctly. */}
                {namePop && namePop.binId === bin.id && (
                  <div
                    key={namePop.k}
                    aria-live="polite"
                    style={{
                      position: 'absolute', left: '50%', top: 8, zIndex: 5, pointerEvents: 'none',
                      padding: '7px 16px', borderRadius: 999,
                      background: GREEN, color: '#ffffff',
                      fontSize: 19, fontWeight: 800, whiteSpace: 'nowrap',
                      boxShadow: '0 6px 18px rgba(31,122,68,0.38)',
                      animation: 'dd-name 1.5s ease forwards',
                    }}
                  >
                    {namePop.label}!
                  </div>
                )}
                <ItemArt emoji={bin.emoji} size={42} />
                <span style={{ fontSize: 19, fontWeight: 800, color: INK, textAlign: 'center', letterSpacing: -0.2 }}>{bin.label}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {binItems.map(([itemId]) => {
                    const item = itemMap.get(itemId)
                    if (!item) return null
                    return (
                      <div key={itemId} className="bi-a"
                        title={item.label}
                        style={{
                          width: 68, borderRadius: 12,
                          background: GREEN_SOFT, border: `1.5px solid rgba(31,122,68,0.30)`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          gap: 1, padding: '6px 4px', position: 'relative',
                          animation: 'bi 0.4s ease',
                        }}
                      >
                        <ItemArt emoji={item.emoji} size={32} alt={item.label} />
                        {/* The name stays on the tile after it lands, so the pairing
                            of picture and word is still readable at the end. */}
                        <span style={{
                          fontSize: 11.5, fontWeight: 700, color: GREEN, textAlign: 'center', lineHeight: 1.1,
                          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{item.label}</span>
                        <span style={{
                          position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                          background: GREEN, color: '#ffffff', fontSize: 11, fontWeight: 800,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 2px 5px rgba(31,122,68,0.35)',
                        }}>✓</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Score bar */}
        <div style={{ flexShrink: 0, background: 'rgba(255,255,255,0.82)', borderRadius: 12, padding: '12px 14px', boxShadow: '0 4px 14px rgba(20,30,40,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: 'rgba(0,0,0,0.62)', marginBottom: 8 }}>
            <span>✓ {correct} sorted correctly</span>
            <span>{remaining} left</span>
          </div>
          <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.10)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#4a7c6f', borderRadius: 2, transition: 'width 0.3s ease' }} />
          </div>
        </div>
      </div>

      {/* Touch ghost */}
      {ghostPos && dragId.current && itemMap.get(dragId.current) && (
        <div style={{
          position: 'fixed', left: ghostPos.x - 50, top: ghostPos.y - 84,
          width: 100, height: 100, borderRadius: 16, zIndex: 1000, pointerEvents: 'none',
          background: GREEN_SOFT, border: `2px solid ${GREEN}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          padding: '6px 5px',
          boxShadow: '0 12px 26px rgba(31,122,68,0.34)', transform: 'scale(1.12)',
          opacity: 0.92,
        }}>
          <ItemArt emoji={itemMap.get(dragId.current)!.emoji} size={46} />
          {displayMode === 'emoji+label' && (
            <span style={{
              fontSize: 14, fontWeight: 700, color: INK, textAlign: 'center', lineHeight: 1.15,
              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{itemMap.get(dragId.current)!.label}</span>
          )}
        </div>
      )}

      {/* Completion overlay */}
      {allDone && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: 'rgba(74,124,111,0.2)', backdropFilter: 'blur(6px)', zIndex: 50, padding: 20,
        }}>
          <div style={{ fontSize: 39, animation: 'cf 0.5s ease' }}>🎉</div>
          <div style={{ fontSize: 21, fontFamily: '"DM Serif Display", serif', color: '#2b2f33', textAlign: 'center' }}>All sorted! 🎉</div>
          <div style={{ fontSize: 16, color: 'rgba(0,0,0,0.6)', textAlign: 'center', lineHeight: 1.6 }}>
            Correct: {correct} | Wrong attempts: {wrong}
            <br />{starText}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleReset}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(0,0,0,0.07)', color: 'rgba(0,0,0,0.8)', cursor: 'pointer', fontSize: 16 }}
            >Same set again</button>
            <button onClick={handleNewSet}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(74,124,111,0.4)', background: 'rgba(74,124,111,0.2)', color: '#1F7A44', cursor: 'pointer', fontSize: 16 }}
            >New set</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 10,
          padding: '8px 16px', color: '#fff', fontSize: 16.5, zIndex: 100, pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
