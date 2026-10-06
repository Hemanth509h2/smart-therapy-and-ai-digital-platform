'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadPraise, staadCancel } from '@/lib/voice/staadVoice'
import { useVoiceLanguage } from '@/lib/voice/useVoiceLanguage'

// Store-aisle backdrop for the shop canvas. Washed-out photography, so the
// product tiles and wallet sit on translucent white panels above it.
const VS_SCENE = `/assets/modules/Background/${encodeURIComponent('Virtual shop.png')}`

interface VirtualShopProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface ShopItem {
  id: string; emoji: string; name: string; price: number; aisle: string
}

interface BasketItem {
  itemId: string; quantity: number; price: number
}

interface ListItem {
  itemId: string; quantity: number
}

interface Receipt {
  items: BasketItem[]; total: number; paid: number; change: number; timestamp: number
}

/* ---------------------------------------------------------------------------
   Palette + shared button styles.

   This module was authored against the dark glass sidebar: its text was stated
   as rgba(0,0,0,0.35-0.5) and its buttons were transparent with a faint tint,
   which on ModuleStage's WHITE canvas reads as barely-there grey on white. The
   other modules state their ink literally and fill the selected control with
   solid green, so that is what is used here.
--------------------------------------------------------------------------- */
const GREEN = '#1F7A44'        // solid fills — the only place white text appears
const GREEN_LINE = 'rgba(31,122,68,0.34)'
const GREEN_SOFT = '#E8F4EC'
const INK = '#1F2A24'          // headings / primary copy
const INK_SOFT = '#48544D'     // secondary copy
const LINE = '#e7eaef'
const DANGER = '#B4432C'

/** Segmented control: mint tint + green type when selected, solid outline when not. */
const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 13px',
  borderRadius: 999,
  cursor: 'pointer',
  fontSize: 19,
  fontWeight: active ? 800 : 600,
  border: `1.5px solid ${active ? GREEN : LINE}`,
  background: active ? GREEN_SOFT : '#ffffff',
  color: active ? GREEN : INK_SOFT,
  transition: 'background .15s, border-color .15s, color .15s',
})

/** Secondary action — visible outline, never a bare transparent word. */
const outlineBtn: React.CSSProperties = {
  padding: '6px 13px',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 19,
  fontWeight: 700,
  border: `1.5px solid ${GREEN_LINE}`,
  background: GREEN_SOFT,
  color: GREEN,
}

const AISLES = [
  { id: 'all', label: 'All', emoji: '' },
  { id: 'fruits', label: 'Fruits & Veg', emoji: '🍎' },
  { id: 'dairy', label: 'Dairy', emoji: '🥛' },
  { id: 'snacks', label: 'Snacks & Drinks', emoji: '🍪' },
  { id: 'household', label: 'Household', emoji: '🧴' },
]

const SHOP_ITEMS: ShopItem[] = [
  { id: 'apple', emoji: '🍎', name: 'Apple', price: 10, aisle: 'fruits' },
  { id: 'banana', emoji: '🍌', name: 'Banana', price: 5, aisle: 'fruits' },
  { id: 'orange', emoji: '🍊', name: 'Orange', price: 12, aisle: 'fruits' },
  { id: 'carrot', emoji: '🥕', name: 'Carrot', price: 8, aisle: 'fruits' },
  { id: 'tomato', emoji: '🍅', name: 'Tomato', price: 6, aisle: 'fruits' },
  { id: 'broccoli', emoji: '🥦', name: 'Broccoli', price: 15, aisle: 'fruits' },
  { id: 'grapes', emoji: '🍇', name: 'Grapes', price: 20, aisle: 'fruits' },
  { id: 'potato', emoji: '🥔', name: 'Potato', price: 4, aisle: 'fruits' },
  { id: 'milk', emoji: '🥛', name: 'Milk', price: 25, aisle: 'dairy' },
  { id: 'butter', emoji: '🧈', name: 'Butter', price: 30, aisle: 'dairy' },
  { id: 'eggs', emoji: '🥚', name: 'Eggs', price: 20, aisle: 'dairy' },
  { id: 'cheese', emoji: '🧀', name: 'Cheese', price: 40, aisle: 'dairy' },
  { id: 'bread', emoji: '🍞', name: 'Bread', price: 18, aisle: 'dairy' },
  { id: 'cereal', emoji: '🥣', name: 'Cereal', price: 35, aisle: 'dairy' },
  { id: 'biscuits', emoji: '🍪', name: 'Biscuits', price: 15, aisle: 'snacks' },
  { id: 'chocolate', emoji: '🍫', name: 'Chocolate', price: 25, aisle: 'snacks' },
  { id: 'juice', emoji: '🧃', name: 'Juice', price: 20, aisle: 'snacks' },
  { id: 'popcorn', emoji: '🍿', name: 'Popcorn', price: 12, aisle: 'snacks' },
  { id: 'cold-drink', emoji: '🥤', name: 'Cold Drink', price: 18, aisle: 'snacks' },
  { id: 'donut', emoji: '🍩', name: 'Donut', price: 10, aisle: 'snacks' },
  { id: 'shampoo', emoji: '🧴', name: 'Shampoo', price: 50, aisle: 'household' },
  { id: 'toothbrush', emoji: '🪥', name: 'Toothbrush', price: 20, aisle: 'household' },
  { id: 'soap', emoji: '🧼', name: 'Soap', price: 15, aisle: 'household' },
  { id: 'tissue', emoji: '🧻', name: 'Tissue', price: 10, aisle: 'household' },
  { id: 'pen', emoji: '📎', name: 'Pen', price: 5, aisle: 'household' },
  { id: 'notebook', emoji: '📓', name: 'Notebook', price: 30, aisle: 'household' },
]

const ITEM_MAP = new Map(SHOP_ITEMS.map(i => [i.id, i]))

const DIFFICULTY_MAP: Record<string, { wallet: number; listCount: number }> = {
  easy: { wallet: 50, listCount: 2 },
  medium: { wallet: 100, listCount: 3 },
  hard: { wallet: 75, listCount: 4 },
}

const CURRENCIES: Record<string, string> = { rupee: '₹', dollar: '$', pound: '£' }

function fmtPrice(amt: number, cur: string): string {
  const s = CURRENCIES[cur] || '₹'
  return `${s}${amt}`
}

export default function VirtualShop({ sessionId, role, isLocked }: VirtualShopProps) {
  const voiceLanguage = useVoiceLanguage(sessionId)
  const voiceLangRef = useRef(voiceLanguage)
  voiceLangRef.current = voiceLanguage
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [difficulty, setDifficulty] = useState('medium')
  const [currency, setCurrency] = useState('rupee')
  const [aisle, setAisle] = useState('all')
  const [shoppingList, setShoppingList] = useState<ListItem[]>([])
  const [walletAmount, setWalletAmount] = useState(100)
  const [walletBalance, setWalletBalance] = useState(100)
  const [basket, setBasket] = useState<BasketItem[]>([])
  const [score, setScore] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [purchaseHistory, setPurchaseHistory] = useState<object[]>([])

  const [basketOpen, setBasketOpen] = useState(false)
  const [editList, setEditList] = useState(false)
  const [editQty, setEditQty] = useState<Record<string, number>>({})
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [floaters, setFloaters] = useState<{ id: string; x: number; y: number }[]>([])
  const [toast, setToast] = useState<{ msg: string } | null>(null)

  const cRef = useRef<HTMLDivElement>(null)
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const pk = useRef(0)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.vsDifficulty === 'string') setDifficulty(s.vsDifficulty)
      if (typeof s.vsCurrency === 'string') setCurrency(s.vsCurrency)
      if (typeof s.vsAisle === 'string') setAisle(s.vsAisle)
      if (Array.isArray(s.vsShoppingList)) setShoppingList(s.vsShoppingList as ListItem[])
      if (typeof s.vsWalletAmount === 'number') setWalletAmount(s.vsWalletAmount)
      if (typeof s.vsWalletBalance === 'number') setWalletBalance(s.vsWalletBalance)
      if (Array.isArray(s.vsBasket)) setBasket(s.vsBasket as BasketItem[])
      if (typeof s.vsScore === 'number') setScore(s.vsScore)
      if (typeof s.vsCompleted === 'boolean') setCompleted(s.vsCompleted)
      if (Array.isArray(s.vsPurchaseHistory)) setPurchaseHistory(s.vsPurchaseHistory)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); staadCancel() }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), 2000)
  }, [])

  const csym = CURRENCIES[currency] || '₹'

  const filteredItems = useMemo(() => {
    if (aisle === 'all') return SHOP_ITEMS
    return SHOP_ITEMS.filter(i => i.aisle === aisle)
  }, [aisle])

  const basketMap = useMemo(() => {
    const m = new Map<string, BasketItem>()
    for (const b of basket) m.set(b.itemId, b)
    return m
  }, [basket])

  const total = useMemo(() => basket.reduce((s, b) => s + b.price * b.quantity, 0), [basket])
  const itemCount = basket.reduce((s, b) => s + b.quantity, 0)
  const balanceRatio = walletAmount > 0 ? walletBalance / walletAmount : 1
  const balanceColor = balanceRatio > 0.5 ? '#1F7A44' : balanceRatio > 0.2 ? '#B45309' : '#c8602a'

  const listItemIds = useMemo(() => new Set(shoppingList.map(l => l.itemId)), [shoppingList])
  const listQuantities = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of shoppingList) m.set(l.itemId, l.quantity)
    return m
  }, [shoppingList])

  const allListItemsInBasket = useMemo(() => {
    for (const l of shoppingList) {
      const b = basketMap.get(l.itemId)
      if (!b || b.quantity < l.quantity) return false
    }
    return shoppingList.length > 0
  }, [shoppingList, basketMap])

  const canPay = basket.length > 0 && total <= walletAmount && (!shoppingList.length || allListItemsInBasket)

  // Maths helper terms
  const mathTerms = useMemo(() => {
    const terms: { label: string; price: number }[] = []
    for (const b of basket) {
      for (let i = 0; i < b.quantity; i++) {
        const item = ITEM_MAP.get(b.itemId)
        terms.push({ label: item?.emoji || b.itemId, price: b.price })
      }
    }
    return terms
  }, [basket])

  const addToBasket = useCallback((itemId: string, clientX: number, clientY: number) => {
    if (!canInteract || completed) return
    const item = ITEM_MAP.get(itemId)
    if (!item) return
    if (walletBalance < item.price) {
      showToast(`Not enough money! Need ${fmtPrice(item.price - walletBalance, currency)} more`)
      return
    }
    const k = ++pk.current
    setFloaters(prev => [...prev, { id: `fl${k}`, x: clientX, y: clientY }])
    setTimeout(() => setFloaters(prev => prev.filter(f => f.id === `fl${k}` ? false : true)), 600)

    const existing = basketMap.get(itemId)
    let newBasket: BasketItem[]
    if (existing) {
      newBasket = basket.map(b => b.itemId === itemId ? { ...b, quantity: b.quantity + 1 } : b)
    } else {
      newBasket = [...basket, { itemId, quantity: 1, price: item.price }]
    }
    const newBalance = walletBalance - item.price
    write({ 'moduleState.vsBasket': newBasket, 'moduleState.vsWalletBalance': newBalance })
  }, [canInteract, completed, walletBalance, currency, basketMap, basket, write, showToast])

  const removeFromBasket = useCallback((itemId: string) => {
    if (!canInteract || completed) return
    const existing = basketMap.get(itemId)
    if (!existing) return
    const item = ITEM_MAP.get(itemId)
    let newBasket: BasketItem[]
    if (existing.quantity > 1) {
      newBasket = basket.map(b => b.itemId === itemId ? { ...b, quantity: b.quantity - 1 } : b)
    } else {
      newBasket = basket.filter(b => b.itemId !== itemId)
    }
    const newBalance = walletBalance + (item?.price || existing.price)
    write({ 'moduleState.vsBasket': newBasket, 'moduleState.vsWalletBalance': newBalance })
  }, [canInteract, completed, basketMap, basket, walletBalance, write])

  const handlePay = useCallback(() => {
    if (!canPay || paying) return
    const change = walletBalance
    setPaying(true)
    setTimeout(() => {
      setPaying(false)
      const rc: Receipt = { items: [...basket], total, paid: walletAmount, change, timestamp: Date.now() }
      setReceipt(rc)
      write({
        'moduleState.vsCompleted': true,
        'moduleState.vsScore': score + 1,
        'moduleState.vsPurchaseHistory': arrayUnion(rc),
      })
      logModuleEvent(sessionId, {
        module: 'virtual-shop',
        type: 'purchase_completed',
        detail: `Bought ${itemCount} item${itemCount === 1 ? '' : 's'} for ${fmtPrice(total, currency)} (difficulty ${difficulty})${shoppingList.length ? ', shopping list complete' : ''}`,
      })
      staadPraise(voiceLangRef.current, 'Well done! You bought everything on your list!')
    }, 700)
  }, [canPay, paying, walletBalance, basket, total, walletAmount, score, write, sessionId, itemCount, currency, difficulty, shoppingList.length])

  const resetShop = useCallback(() => {
    if (!isT && completed) return
    setReceipt(null)
    setPaying(false)
    setBasketOpen(false)
    write({
      'moduleState.vsBasket': [],
      'moduleState.vsWalletBalance': walletAmount,
      'moduleState.vsCompleted': false,
    })
  }, [isT, completed, walletAmount, write])

  /* Full reset — every piece of shared state back to the values the module
     mounts with, plus the local view state.
     `resetShop` above deliberately stays a soft reset (empty the basket, refund
     the wallet, clear the receipt) because it is what "Shop again" runs: the
     therapist's shopping list and difficulty are meant to survive that. This one
     is the hard reset, for handing the module to a different client. */
  const resetEverything = useCallback(() => {
    if (!isT) return
    setReceipt(null)
    setPaying(false)
    setBasketOpen(false)
    setEditList(false)
    setEditQty({})
    setFloaters([])
    setToast(null)
    write({
      'moduleState.vsDifficulty': 'medium',
      'moduleState.vsCurrency': 'rupee',
      'moduleState.vsAisle': 'all',
      'moduleState.vsShoppingList': [],
      'moduleState.vsWalletAmount': DIFFICULTY_MAP.medium.wallet,
      'moduleState.vsWalletBalance': DIFFICULTY_MAP.medium.wallet,
      'moduleState.vsBasket': [],
      'moduleState.vsScore': 0,
      'moduleState.vsCompleted': false,
      'moduleState.vsPurchaseHistory': [],
    })
  }, [isT, write])

  const setDifficultyPreset = useCallback((d: string) => {
    const p = DIFFICULTY_MAP[d] || DIFFICULTY_MAP.medium
    setEditList(true)
    write({
      'moduleState.vsDifficulty': d,
      'moduleState.vsWalletAmount': p.wallet,
      'moduleState.vsWalletBalance': p.wallet,
      'moduleState.vsBasket': [],
      'moduleState.vsCompleted': false,
    })
  }, [write])

  const saveShoppingList = useCallback(() => {
    const list: ListItem[] = []
    for (const [itemId, qty] of Object.entries(editQty)) {
      if (qty > 0) list.push({ itemId, quantity: qty })
    }
    write({ 'moduleState.vsShoppingList': list })
    setEditList(false)
  }, [editQty, write])

  const toggleEditItem = useCallback((itemId: string) => {
    setEditQty(prev => {
      if (prev[itemId]) {
        const n = { ...prev }
        delete n[itemId]
        return n
      }
      return { ...prev, [itemId]: 1 }
    })
  }, [])

  const changeEditQty = useCallback((itemId: string, delta: number) => {
    setEditQty(prev => {
      const cur = prev[itemId] || 0
      const next = cur + delta
      if (next <= 0) {
        const n = { ...prev }; delete n[itemId]; return n
      }
      return { ...prev, [itemId]: Math.min(next, 5) }
    })
  }, [])

  return (
    <>
      <style>{`
        @keyframes flUp{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-30px);opacity:0}}
        @keyframes bi{0%{transform:scale(.9)}50%{transform:scale(1.1)}100%{transform:scale(1)}}
        @keyframes payF{0%{transform:translateX(0);opacity:1}100%{transform:translateX(100px);opacity:0}}
        @keyframes receiptUp{0%{transform:translateY(100px);opacity:0}100%{transform:translateY(0);opacity:1}}
      `}</style>

      {/* Therapist controls */}
      {isT && (
        <div style={{ flexShrink: 0, padding: '6px 10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 17 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#48544D' }}>Difficulty:</span>
            {['easy', 'medium', 'hard'].map(d => (
              <button key={d} onClick={() => setDifficultyPreset(d)}
                style={{ ...segBtn(difficulty === d), textTransform: 'capitalize' }}
              >{d === 'easy' ? 'Easy ₹50' : d === 'medium' ? 'Medium ₹100' : 'Hard ₹75'}</button>
            ))}
            <span style={{ color: '#48544D', marginLeft: 4 }}>Currency:</span>
            {['rupee', 'dollar', 'pound'].map(c => (
              <button key={c} onClick={() => write({ 'moduleState.vsCurrency': c })}
                style={segBtn(currency === c)}
              >{CURRENCIES[c]}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setEditList(!editList)}
              style={segBtn(editList)}
            >{editList ? 'Done editing list' : '📋 Edit shopping list'}</button>
            <span style={{ color: '#7C868F', fontSize: 17 }}>Wallet:</span>
            <input type="number" value={walletAmount} onChange={e => {
              const v = Math.max(10, parseInt(e.target.value) || 10)
              write({ 'moduleState.vsWalletAmount': v, 'moduleState.vsWalletBalance': v })
            }}
              style={{ width: 78, background: '#ffffff', border: `1.5px solid ${LINE}`, borderRadius: 8, padding: '6px 9px', color: INK, fontSize: 16, fontWeight: 700, outline: 'none' }}
            />
            {/* Always available: a half-set-up shop is exactly when you most
                want to start over, and the old button only appeared once the
                basket had something in it. */}
            <button
              onClick={() => { if (window.confirm('Reset the shop? This clears the shopping list, basket, wallet, score and history.')) resetEverything() }}
              title="Clear the shopping list, basket, wallet, score and history"
              style={{
                marginLeft: 'auto', padding: '6px 13px', borderRadius: 10, cursor: 'pointer',
                fontSize: 14.5, fontWeight: 800,
                border: `1.5px solid rgba(180,67,44,0.45)`, background: '#FDF1EE', color: DANGER,
              }}
            >↺ Reset all</button>
          </div>
          {/* Shopping list editor */}
          {editList && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto', padding: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 6 }}>
              <div style={{ fontSize: 17, color: '#48544D', marginBottom: 2 }}>Tap items to add to shopping list</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {SHOP_ITEMS.map(item => {
                  const qty = editQty[item.id] || 0
                  return (
                    <div key={item.id} onClick={() => toggleEditItem(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 3, padding: '3px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 17,
                        background: qty > 0 ? 'rgba(74,124,111,0.2)' : 'rgba(0,0,0,0.05)',
                        border: qty > 0 ? '1px solid rgba(74,124,111,0.4)' : '1px solid rgba(0,0,0,0.08)',
                        color: qty > 0 ? '#2b2f33' : 'rgba(0,0,0,0.5)',
                      }}
                    >
                      <span>{item.emoji}</span>
                      <span>{item.name}</span>
                      {qty > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 2 }}>
                          <span onClick={e => { e.stopPropagation(); changeEditQty(item.id, -1) }} style={{ cursor: 'pointer', color: '#48544D', fontSize: 19 }}>−</span>
                          <span style={{ color: '#1F7A44', fontWeight: 600 }}>{qty}</span>
                          <span onClick={e => { e.stopPropagation(); changeEditQty(item.id, 1) }} style={{ cursor: 'pointer', color: '#48544D', fontSize: 19 }}>+</span>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <button onClick={saveShoppingList}
                style={{ ...outlineBtn, width: '100%', padding: '9px 0' }}
              >Set shopping list ({Object.keys(editQty).length} items)</button>
            </div>
          )}
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
          borderRadius: 16,
          backgroundImage: `url('${VS_SCENE}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >

        {/* Wallet + List row */}
        <div style={{ display: 'flex', gap: 14, padding: '16px 16px 0', flexShrink: 0 }}>
          {/* Wallet */}
          <div style={{
            width: 178, flexShrink: 0,
            background: 'linear-gradient(135deg,rgba(74,124,111,0.3) 0%,rgba(74,124,111,0.15) 100%)',
            border: '1.5px solid rgba(74,124,111,0.4)', borderRadius: 12, padding: '8px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <span style={{ fontSize: 23 }}>👛</span>
              <span style={{ fontSize: 17, color: '#48544D' }}>My Wallet</span>
            </div>
            <div style={{ fontSize: 26, fontFamily: '"DM Serif Display", serif', color: balanceColor, transition: 'color 0.3s' }}>
              {fmtPrice(walletBalance, currency)}
            </div>
          </div>

          {/* Shopping list */}
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 14, padding: '14px 16px', minWidth: 0, boxShadow: '0 4px 14px rgba(20,30,40,0.06)' }}>
            <div style={{ fontSize: 17, color: '#48544D', marginBottom: 4 }}>Shopping List 📋</div>
            {shoppingList.length === 0 ? (
              <div style={{ fontSize: 17, color: '#9AA3AC', fontStyle: 'italic' }}>
                {isT ? 'Set shopping list above' : 'Waiting for shopping list...'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {shoppingList.map(l => {
                  const item = ITEM_MAP.get(l.itemId)
                  if (!item) return null
                  const inBasket = basketMap.get(l.itemId)
                  const fulfilled = inBasket && inBasket.quantity >= l.quantity
                  return (
                    <div key={l.itemId} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 17, color: fulfilled ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.85)', textDecoration: fulfilled ? 'line-through' : 'none' }}>
                      <span>{fulfilled ? '☑' : '☐'}</span>
                      <span>{item.emoji}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      {l.quantity > 1 && <span style={{ fontSize: 17, color: '#48544D' }}>×{l.quantity}</span>}
                    </div>
                  )
                })}
                {allListItemsInBasket && shoppingList.length > 0 && (
                  <div style={{ fontSize: 17, color: '#1F7A44', marginTop: 2 }}>Shopping list complete! 🎉</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Maths helper (Easy/Medium) */}
        {difficulty !== 'hard' && mathTerms.length > 0 && (
          <div style={{
            margin: '12px 16px 0', padding: '12px 14px', fontSize: 18, color: 'rgba(0,0,0,0.62)',
            background: 'rgba(255,255,255,0.82)', borderRadius: 12, boxShadow: '0 4px 14px rgba(20,30,40,0.06)',
            flexShrink: 0,
          }}>
            {mathTerms.map((t, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: '#9AA3AC', margin: '0 2px' }}>+</span>}
                <span>{fmtPrice(t.price, currency)}</span>
              </span>
            ))}
            <span style={{ marginLeft: 4, color: '#1F7A44' }}>= {fmtPrice(total, currency)}</span>
          </div>
        )}

        {/* Aisle tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 16px 0', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'thin' }}>
          {AISLES.map(a => (
            <button key={a.id} onClick={() => { if (isT) write({ 'moduleState.vsAisle': a.id }); else setAisle(a.id) }}
              style={{
                whiteSpace: 'nowrap', padding: '9px 16px', borderRadius: 999, cursor: 'pointer',
                fontSize: 19, fontWeight: aisle === a.id ? 800 : 600,
                // The selected aisle fills solid so it reads at a glance, the way
                // every other module marks its active segment.
                border: `1.5px solid ${aisle === a.id ? GREEN : LINE}`,
                background: aisle === a.id ? GREEN : '#ffffff',
                color: aisle === a.id ? '#ffffff' : INK_SOFT,
                boxShadow: aisle === a.id ? '0 4px 12px rgba(31,122,68,0.24)' : '0 1px 3px rgba(20,30,40,0.05)',
                transition: 'background .15s, border-color .15s, color .15s',
              }}
            >{a.emoji} {a.label}</button>
          ))}
        </div>

        {/* Shop grid */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 16px' }}>
          {/* Three columns instead of four: the item picture is the thing the
              client actually reads, and at four across it had no room. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {filteredItems.map(item => {
              const inBasket = basketMap.get(item.id)
              const qty = inBasket?.quantity || 0
              const onList = listItemIds.has(item.id) || editQty[item.id] > 0
              return (
                <div key={item.id}
                  onClick={e => {
                    const r = (e.target as HTMLElement).getBoundingClientRect()
                    addToBasket(item.id, r.left + r.width / 2, r.top)
                  }}
                  style={{
                    borderRadius: 16, padding: '18px 12px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, cursor: canInteract && !completed ? 'pointer' : 'default',
                    transition: 'all 0.15s', position: 'relative',
                    background: onList ? 'rgba(255,214,102,0.30)' : 'rgba(255,255,255,0.86)',
                    border: onList ? '1px solid rgba(214,158,20,0.55)' : '1px solid rgba(0,0,0,0.10)',
                    boxShadow: '0 3px 10px rgba(20,30,40,0.06)',
                  }}
                >
                  {onList && <span style={{ position: 'absolute', top: 5, right: 7, fontSize: 19 }}>📋</span>}
                  {qty > 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6, background: GREEN, color: '#fff', fontSize: 17.5,
                      borderRadius: 999, minWidth: 24, padding: '3px 8px', fontWeight: 800, zIndex: 2,
                      boxShadow: '0 3px 8px rgba(31,122,68,0.3)', textAlign: 'center',
                    }}>
                      {qty}
                    </span>
                  )}
                  <span style={{ fontSize: 48, lineHeight: 1 }}>{item.emoji}</span>
                  <span style={{ fontSize: 19, fontWeight: 600, color: INK, textAlign: 'center', lineHeight: 1.25 }}>{item.name}</span>
                  <span style={{ fontSize: 21, fontWeight: 800, color: walletBalance >= item.price ? GREEN : DANGER }}>
                    {fmtPrice(item.price, currency)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Basket */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--glass-border)' }}>
          <div onClick={() => setBasketOpen(!basketOpen)}
            style={{
              padding: '8px 12px', cursor: 'pointer',
              background: basketOpen ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 18, color: '#3A453F',
            }}
          >
            <span>🛒 Basket ({itemCount} item{itemCount !== 1 ? 's' : ''})</span>
            <span>{basketOpen ? '▲' : '▼'}</span>
          </div>
          {basketOpen && (
            <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.1)' }}>
              {basket.length === 0 ? (
                <div style={{ fontSize: 17, color: '#9AA3AC', fontStyle: 'italic' }}>Basket is empty</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 6 }}>
                  {basket.map(b => {
                    const item = ITEM_MAP.get(b.itemId)
                    if (!item) return null
                    return (
                      <div key={b.itemId} onClick={() => removeFromBasket(b.itemId)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: canInteract ? 'pointer' : 'default',
                          padding: '6px 8px', background: 'rgba(0,0,0,0.05)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
                          fontSize: 17, whiteSpace: 'nowrap', flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: 23 }}>{item.emoji}</span>
                        <span style={{ color: '#48544D' }}>×{b.quantity}</span>
                        <span style={{ color: '#1F7A44' }}>{fmtPrice(b.price * b.quantity, currency)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 19, marginBottom: 6 }}>
                <span style={{ color: total > walletAmount ? '#c8602a' : '#1F7A44', fontWeight: 600 }}>
                  Total: {fmtPrice(total, currency)}
                </span>
                <span style={{ fontSize: 17, color: '#48544D' }}>
                  Left: {fmtPrice(walletBalance, currency)}
                </span>
              </div>
              {difficulty === 'hard' && (
                <div style={{ fontSize: 17, color: '#48544D', marginBottom: 6 }}>
                  Change: {fmtPrice(walletBalance, currency)}
                </div>
              )}
              {!completed && (
                <button onClick={handlePay} disabled={!canPay || paying}
                  style={{
                    width: '100%', height: 50, borderRadius: 13, fontSize: 22.5, fontWeight: 800,
                    cursor: canPay && !paying ? 'pointer' : 'default',
                    background: canPay && !paying ? GREEN : '#F1F3F5',
                    border: canPay && !paying ? 'none' : `1.5px solid ${LINE}`,
                    color: canPay && !paying ? '#ffffff' : '#9AA3AC',
                    boxShadow: canPay && !paying ? '0 6px 16px rgba(31,122,68,0.28)' : 'none',
                    transition: 'background .15s, color .15s',
                  }}
                >Pay now 💳</button>
              )}
            </div>
          )}
        </div>

        {/* Floaters */}
        {floaters.map(f => (
          <div key={f.id} style={{
            position: 'absolute', left: f.x - 12, top: f.y - 16, fontSize: 20.5, pointerEvents: 'none', zIndex: 30,
            animation: 'flUp 0.5s ease forwards', color: '#1F7A44',
          }}>
            +1 🛒
          </div>
        ))}

        {/* Pay animation */}
        {paying && (
          <div style={{
            position: 'absolute', left: '40%', top: '40%', fontSize: 46, zIndex: 40, pointerEvents: 'none',
            animation: 'payF 0.6s ease forwards',
          }}>
            💳➡️🏪
          </div>
        )}

        {/* Receipt */}
        {receipt && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 50, padding: 20,
          }}>
            <div style={{
              background: 'rgba(255,255,240,0.1)', border: '1px solid rgba(255,255,200,0.2)', borderRadius: 8,
              padding: 20, width: '100%', maxWidth: 340, animation: 'receiptUp 0.4s ease',
            }}>
              <div style={{ fontFamily: '"DM Serif Display", serif', fontSize: 20.5, color: '#fff', textAlign: 'center', marginBottom: 8 }}>🏪 Staad Store</div>
              <div style={{ borderTop: '1px dashed rgba(0,0,0,0.15)', marginBottom: 8 }} />
              {receipt.items.map(b => {
                const item = ITEM_MAP.get(b.itemId)
                return (
                  <div key={b.itemId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, color: 'rgba(0,0,0,0.7)', marginBottom: 3 }}>
                    <span>{item?.emoji} {item?.name} ×{b.quantity}</span>
                    <span>{fmtPrice(b.price * b.quantity, currency)}</span>
                  </div>
                )
              })}
              <div style={{ borderTop: '1px dashed rgba(0,0,0,0.15)', margin: '6px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, color: '#fff', fontWeight: 600 }}>
                <span>Total</span><span>{fmtPrice(receipt.total, currency)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, color: '#48544D' }}>
                <span>Paid</span><span>{fmtPrice(receipt.paid, currency)}</span>
              </div>
              {difficulty === 'hard' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, color: '#48544D' }}>
                  <span>Change</span><span>{fmtPrice(receipt.change, currency)}</span>
                </div>
              )}
              <div style={{ borderTop: '1px dashed rgba(0,0,0,0.15)', margin: '6px 0' }} />
              <div style={{ fontSize: 18, color: '#3A453F', textAlign: 'center' }}>Thank you! 😊</div>
              <button onClick={resetShop}
                style={{ marginTop: 10, width: '100%', padding: '11px 0', borderRadius: 12, border: 'none', background: GREEN, color: '#ffffff', cursor: 'pointer', fontSize: 19, fontWeight: 800, boxShadow: '0 5px 14px rgba(31,122,68,0.26)' }}
              >Shop again</button>
            </div>
          </div>
        )}

        {/* Completion info on receipt closed */}
        {completed && !receipt && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'rgba(74,124,111,0.15)', backdropFilter: 'blur(4px)', zIndex: 45, padding: 20,
          }}>
            <div style={{ fontSize: 36.5 }}>🎉</div>
            <div style={{ fontSize: 20.5, color: '#2b2f33', textAlign: 'center' }}>Shopping complete!</div>
            <div style={{ fontSize: 18, color: '#48544D' }}>Score: {score}</div>
            <button onClick={resetShop}
              style={{ padding: '11px 26px', borderRadius: 12, border: 'none', background: GREEN, color: '#ffffff', cursor: 'pointer', fontSize: 19, fontWeight: 800, boxShadow: '0 5px 14px rgba(31,122,68,0.26)' }}
            >Shop again</button>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 10,
          padding: '8px 16px', color: '#fff', fontSize: 19.5, zIndex: 100, pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
