'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { MessageCircle, Lock, Unlock } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

/* ---------------------------------------------------------------------------
   Art assets. Both folder names contain spaces, so every segment is encoded
   individually — encodeURI() would have left the (legal but fragile) raw
   spaces in place.
--------------------------------------------------------------------------- */
const WV_ASSET = (file: string) =>
  `/assets/modules/${encodeURIComponent('Anxiety and depression')}/${encodeURIComponent('Asset Worry Vault')}/${encodeURIComponent(file)}`

const WV_VAULT_ART = WV_ASSET('ChatGPT Image Aug 13, 2026, 09_36_42 PM.png')
const WV_PADLOCK_LOCKED = WV_ASSET('worry_vault_padlock_icon.svg')
const WV_PADLOCK_UNLOCKED = WV_ASSET('worry_vault_UNLOCKED_padlock.svg')
const WV_NOTE_CARD = WV_ASSET('worry_vault_worry_note_card.svg')
const WV_LOCK_LOTTIE = WV_ASSET('worry_vault_lock_interaction.json')
const WV_CLUNK = WV_ASSET('worry_vault_clunk.wav')

/* The pastoral scene the mockup frames the module in — rolling hills, clouds
   and leafy foliage at the left/right edges. Painted as a cover background so
   the foliage always hugs the canvas edges however wide the stage gets. */
const WV_SCENE = `/assets/modules/Background/${encodeURIComponent('worry vault.png')}`

/* ---------------------------------------------------------------------------
   Palette — calm greens on white cards, dark ink on every pale surface.
   The stage canvas is WHITE, so nothing here is ever light-on-light.
--------------------------------------------------------------------------- */
const INK = '#1f3b2c'        // headings / body over pale surfaces
const INK_DEEP = '#16281e'   // the big count
const INK_BODY = '#2f4a3b'   // tagline over the scene
const ACCENT = '#2F7D5F'     // green text accent
const MUTED = '#6b7a72'      // helper copy
const GREEN = '#1F7A44'      // solid fills — the only place white text appears
const BORDER = '#e7eaef'
const MINT = '#eaf6ee'

/* The illustration PNG is a two-frame sprite sheet: closed vault on the left
   half, open vault on the right — and each frame is matted on black. Crop to
   the safe itself (dropping most of the matte) and `screen`-blend it over a
   deep-green plate, which turns the remaining matte into the plate colour
   instead of a black rectangle inside the white card.

   Crop geometry: x 2%..98% and y 20%..76% of one 50%-wide frame.
     size   = 100 / visibleFraction
     offset = cropStart / (1 - visibleFraction)          (CSS %-position rule)
   The plate is sized to the crop's 1.29 aspect so nothing is stretched. */
const WV_ART_ASPECT = '210 / 163'
const WV_ART_FRAME = (open: boolean): React.CSSProperties => ({
  backgroundImage: `url("${WV_VAULT_ART}")`,
  backgroundSize: '208.3% 178.6%',
  backgroundPosition: open ? '98.1% 45.5%' : '1.9% 45.5%',
  backgroundRepeat: 'no-repeat',
  mixBlendMode: 'screen',
})

/* One-shot clunk playback, lazily created so nothing touches window during SSR. */
let wvClunk: HTMLAudioElement | null = null
function playClunk() {
  try {
    if (typeof window === 'undefined') return
    if (!wvClunk) wvClunk = new Audio(WV_CLUNK)
    wvClunk.currentTime = 0
    void wvClunk.play()
  } catch {}
}

/* Plays the lock Lottie once while mounted. */
function LockLottie() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let anim: { destroy: () => void } | null = null
    let cancelled = false
    import('lottie-web').then(({ default: lottie }) => {
      if (cancelled || !host.current) return
      anim = lottie.loadAnimation({ container: host.current, renderer: 'svg', loop: false, autoplay: true, path: WV_LOCK_LOTTIE })
    }).catch(() => {})
    return () => { cancelled = true; anim?.destroy() }
  }, [])
  return <div ref={host} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }} />
}

interface WorryVaultProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface Worry { id: string; text: string; locked: boolean }

const MAX_CHARS = 120

export default function WorryVault({ sessionId, role, isLocked }: WorryVaultProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [worries, setWorries] = useState<Worry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [vaultOpen, setVaultOpen] = useState(false)

  const [text, setText] = useState('')
  const [settling, setSettling] = useState<string | null>(null)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (Array.isArray(s.wvWorries)) setWorries(s.wvWorries)
      setSelected(typeof s.wvSelectedWorry === 'string' ? s.wvSelectedWorry : null)
      if (typeof s.wvVaultOpen === 'boolean') setVaultOpen(s.wvVaultOpen)
    })
    return () => unsub()
  }, [sessionId])

  const addWorry = useCallback(() => {
    const t = text.trim()
    if (!t || !canInteract) return
    const w: Worry = { id: `wv${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, locked: false }
    write({ 'moduleState.wvWorries': [...worries, w] })
    logModuleEvent(sessionId, {
      module: 'worry-vault',
      type: 'worry_locked',
      detail: `Locked a worry in the vault for later: "${t}"`,
    })
    setText('')
    playClunk()
    // timed delay — worry "settles in" then locks
    setSettling(w.id)
    setTimeout(() => {
      setSettling(null)
      const updated = [...worries, w].map(x => x.id === w.id ? { ...x, locked: true } : x)
      write({ 'moduleState.wvWorries': updated })
    }, 1600)
  }, [text, canInteract, worries, write, sessionId])

  const reopenWorry = useCallback((id: string) => {
    if (!isT) return
    write({ 'moduleState.wvSelectedWorry': id, 'moduleState.wvVaultOpen': true })
  }, [isT, write])

  const closeVault = useCallback(() => {
    if (!isT) return
    write({ 'moduleState.wvSelectedWorry': null, 'moduleState.wvVaultOpen': false })
  }, [isT, write])

  const releaseSelected = useCallback(() => {
    if (!isT || !selected) return
    const releasedText = worries.find(w => w.id === selected)?.text
    write({ 'moduleState.wvWorries': worries.filter(w => w.id !== selected), 'moduleState.wvSelectedWorry': null, 'moduleState.wvVaultOpen': false })
    if (releasedText) {
      logModuleEvent(sessionId, {
        module: 'worry-vault',
        type: 'worry_released',
        detail: `Let go of a vaulted worry: "${releasedText}"`,
      })
    }
  }, [isT, selected, worries, write, sessionId])

  const selectedWorry = worries.find(w => w.id === selected)
  const lockedWorries = worries.filter(w => w.locked && w.id !== selected)
  const canSubmit = canInteract && !!text.trim()

  return (
    /* Root fills the stage and never scrolls itself — ModuleStage's body is
       overflow:hidden and expects `height:100%` + an internal flex:1 region.
       The pastoral scene is full-bleed; the content column is centred inside
       it, staying clear of the foliage that frames the left/right edges. */
    <div style={{
      height: '100%', minHeight: 0, maxWidth: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"DM Sans", sans-serif', position: 'relative', borderRadius: 18,
      overflow: 'hidden', overflowX: 'clip',
      /* Gradient underneath is the fallback if the scene PNG is slow or missing —
         the copy stays dark-on-pale either way. */
      backgroundColor: '#f1f8f3',
      backgroundImage: `url("${WV_SCENE}"), linear-gradient(170deg, #f4fbf6 0%, #e9f6ed 60%, #dff1e6 100%)`,
      backgroundSize: 'cover, cover',
      backgroundPosition: 'center center, center center',
      backgroundRepeat: 'no-repeat, no-repeat',
    }}>
      <style>{`
        @keyframes wv-glow { 0%,100%{box-shadow:0 4px 18px rgba(31,59,44,0.07)} 50%{box-shadow:0 0 0 1px rgba(31,122,68,0.22), 0 10px 26px rgba(31,122,68,0.16)} }
        @keyframes wv-settle { 0%{transform:translateY(-30px) scale(1);opacity:1} 100%{transform:translateY(0) scale(0.85);opacity:0.7} }
        @keyframes wv-float { 0%{transform:translateY(20px);opacity:0} 100%{transform:translateY(0);opacity:1} }
        .wv-input::placeholder { color: #8d9c94; }
        .wv-input:focus { border-color: ${GREEN}; box-shadow: 0 0 0 3px rgba(31,122,68,0.14); }
        .wv-cta:not(:disabled):hover { background: #1a6b3b; }
        .wv-ghost:hover { border-color: ${GREEN}; color: ${GREEN}; }
        /* The worry text is the variable part of the row, so the action word is
           what has to carry. "Reopen:" used to sit in the same body weight and
           colour as the worry after it and read as part of the sentence. */
        .wv-reopen-word {
          background: ${MINT}; color: ${GREEN}; font-weight: 800;
          padding: 2px 8px; border-radius: 8px;
          border: 1px solid rgba(31,122,68,0.30);
        }
        .wv-ghost:hover .wv-reopen-word { background: ${GREEN}; color: #ffffff; border-color: ${GREEN}; }
        .wv-scroll { scrollbar-width: thin; scrollbar-color: rgba(31,122,68,0.30) transparent; }
        .wv-scroll::-webkit-scrollbar { width: 8px; }
        .wv-scroll::-webkit-scrollbar-thumb { background: rgba(31,122,68,0.30); border-radius: 8px; }
      `}</style>

      {/* The only scrolling region: overflow stays inside the module, never the page. */}
      <div className="wv-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '18px 16px 22px' }}>
        {/* Contained, centred content column — the mockup's layout width. */}
        <div style={{ width: '100%', maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

          {/* ---- Vault mark in a pale circular badge ----
              No hero title here: ModuleStage already prints "Worry Vault" and
              the category line directly above this body. The tagline stays. */}
          <div
            role="img"
            aria-label={vaultOpen ? 'Vault unlocked' : 'Vault locked'}
            style={{
              width: 74, height: 74, flexShrink: 0, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `radial-gradient(circle at 50% 40%, #ffffff 0%, ${MINT} 100%)`,
              border: '1px solid rgba(31,122,68,0.14)',
              boxShadow: '0 4px 16px rgba(31,59,44,0.08)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={vaultOpen ? WV_PADLOCK_UNLOCKED : WV_PADLOCK_LOCKED}
              alt="" aria-hidden width={46} height={46}
              style={{ display: 'block' }}
            />
          </div>

          <div style={{ textAlign: 'center', fontSize: 18.5, lineHeight: 1.5, color: INK_BODY, maxWidth: 560, fontWeight: 500 }}>
            Not ignoring — just not now. Lock worries away and return later.
          </div>

          {/* ---- Capture: wide rounded field + solid-green pill ---- */}
          {!vaultOpen && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginTop: 2 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <MessageCircle size={20} color={ACCENT} strokeWidth={1.9} style={{ position: 'absolute', left: 22, top: 21, pointerEvents: 'none' }} />
                <textarea
                  className="wv-input"
                  value={text}
                  onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
                  placeholder="What's on your mind?"
                  disabled={!canInteract}
                  maxLength={MAX_CHARS}
                  style={{
                    width: '100%', boxSizing: 'border-box', minHeight: 64,
                    background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 20,
                    padding: '20px 22px 20px 56px', fontSize: 18.5, lineHeight: 1.35, color: INK,
                    resize: 'none', outline: 'none', fontFamily: '"DM Sans", sans-serif',
                    boxShadow: '0 2px 12px rgba(31,59,44,0.06)',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                />
              </div>

              <button
                className="wv-cta"
                onClick={addWorry}
                disabled={!canSubmit}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  padding: '13px 30px', borderRadius: 999, border: 'none',
                  background: GREEN, color: '#ffffff', fontSize: 18.5, fontWeight: 600,
                  fontFamily: '"DM Sans", sans-serif',
                  cursor: canSubmit ? 'pointer' : 'default',
                  opacity: canSubmit ? 1 : 0.5,
                  boxShadow: '0 6px 16px rgba(31,122,68,0.28)',
                  transition: 'background .15s, opacity .15s',
                }}
              >
                <Lock size={17} color="#ffffff" strokeWidth={2.2} />
                Lock it in the vault
              </button>
            </div>
          )}

          {/* ---- Locked-away card: safe illustration left, status right ---- */}
          <div style={{
            width: '100%', borderRadius: 20, padding: 14,
            background: '#ffffff', border: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', gap: 20,
            boxShadow: '0 4px 18px rgba(31,59,44,0.07)',
            animation: lockedWorries.length ? 'wv-glow 3.2s ease-in-out infinite' : 'none',
          }}>
            {/* Art plate: deep green so the sprite's black matte `screen`-blends
                into the plate instead of showing as a black box. */}
            <div aria-hidden style={{
              position: 'relative', flex: '0 0 210px', width: 210, aspectRatio: WV_ART_ASPECT,
              borderRadius: 14, overflow: 'hidden', background: '#123324', isolation: 'isolate',
            }}>
              <div style={{ ...WV_ART_FRAME(vaultOpen), position: 'absolute', inset: 0 }} />
              {settling && <LockLottie />}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{
                  width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: GREEN,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 3px 8px rgba(31,122,68,0.30)',
                }}>
                  {vaultOpen
                    ? <Unlock size={17} color="#ffffff" strokeWidth={2.3} />
                    : <Lock size={17} color="#ffffff" strokeWidth={2.3} />}
                </span>
                <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.15, color: INK_DEEP }}>
                  {lockedWorries.length} worr{lockedWorries.length === 1 ? 'y' : 'ies'} locked away
                </span>
              </div>
              <div style={{ fontSize: 18.5, fontWeight: 500, lineHeight: 1.4, color: ACCENT, paddingLeft: 45 }}>
                {lockedWorries.length === 0 ? 'The vault is empty.' : 'Sealed and safe until you’re ready.'}
              </div>
              <div style={{ fontSize: 17.5, lineHeight: 1.45, color: MUTED, paddingLeft: 45 }}>
                {lockedWorries.length === 0
                  ? <>When you lock worries, they&apos;ll appear here.</>
                  : <>Reopen one when you&apos;re ready to work on it.</>}
              </div>
            </div>
          </div>

          {/* Locked worries as note cards */}
          {(lockedWorries.length > 0 || settling) && (
            <div style={{
              width: '100%', borderRadius: 18, background: 'rgba(255,255,255,0.72)',
              border: `1px solid ${BORDER}`, padding: 12,
              display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(31,59,44,0.05)',
            }}>
              {lockedWorries.map(w => (
                <div key={w.id} style={{
                  position: 'relative', flex: '1 1 132px', maxWidth: 180, aspectRatio: '720 / 430',
                  backgroundImage: `url("${WV_NOTE_CARD}")`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                  userSelect: 'none',
                }}>
                  {/* worry text sits in the note card's writing area */}
                  <div style={{
                    position: 'absolute', left: '12.1%', top: '31.4%', width: '75.8%', height: '43%',
                    borderRadius: 4, background: '#FFFFFF', padding: '3px 5px', overflow: 'hidden',
                    fontSize: 12, lineHeight: 1.25, color: '#5D7168', filter: 'blur(2.5px)',
                  }}>{w.text}</div>
                </div>
              ))}
              {settling && (
                <div style={{
                  alignSelf: 'center', padding: '7px 14px', borderRadius: 999,
                  background: MINT, border: `1px solid rgba(31,122,68,0.28)`,
                  fontSize: 16.5, fontWeight: 600, color: GREEN, animation: 'wv-settle 1.6s ease forwards',
                }}>
                  settling in…
                </div>
              )}
            </div>
          )}

          {/* Therapist reopen controls */}
          {isT && !vaultOpen && lockedWorries.length > 0 && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ ...labelStyle, textAlign: 'center' }}>Reopen one worry</div>
              {lockedWorries.map(w => (
                <button key={w.id} className="wv-ghost" onClick={() => reopenWorry(w.id)}
                  style={{ ...btnStyle, width: '100%', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left' }}>
                  <span className="wv-reopen-word" style={{ flexShrink: 0 }}>Reopen</span>
                  {/* minWidth:0 is what lets the flex child actually ellipsize. */}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.text}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Reopened worry floats out */}
          {vaultOpen && selectedWorry && (
            <div style={{
              width: '100%', background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 20,
              padding: '18px 20px', animation: 'wv-float 0.6s ease', textAlign: 'center',
              boxShadow: '0 4px 18px rgba(31,59,44,0.07)',
            }}>
              <div style={{ fontSize: 13.5, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: MUTED, marginBottom: 8 }}>
                Working on this one now
              </div>
              <div style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', fontSize: 22.5, lineHeight: 1.4, color: INK }}>
                {selectedWorry.text}
              </div>
              {isT && (
                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center' }}>
                  <button className="wv-ghost" onClick={closeVault} style={{ ...btnStyle, minWidth: 150, textAlign: 'center' }}>Put back</button>
                  <button onClick={releaseSelected}
                    style={{ ...btnStyle, minWidth: 150, textAlign: 'center', background: GREEN, borderColor: GREEN, color: '#ffffff', fontWeight: 600, boxShadow: '0 4px 12px rgba(31,122,68,0.26)' }}>
                    Let it go 🌬️
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '11px 16px', borderRadius: 14, border: `1px solid ${BORDER}`,
  background: '#ffffff', color: '#244a35', fontSize: 17, fontWeight: 500,
  cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
  boxShadow: '0 1px 4px rgba(31,59,44,0.05)', transition: 'border-color .15s, color .15s',
}
const labelStyle: React.CSSProperties = {
  fontSize: 13.5, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700,
  color: MUTED, marginBottom: 2,
}
