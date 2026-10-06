'use client'

// DEV-ONLY diagnostics for the shared voice utility.
//
// Shows what the Web Speech API actually offers on THIS browser/OS and what
// staadVoice resolves for each language, so the accent question can be answered
// with evidence instead of assumption. 404s in production.

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  staadSpeak,
  staadCancel,
  randomPraise,
  getVoiceDiagnostics,
  PRAISE_PHRASES,
  type VoiceLanguage,
} from '@/lib/voice/staadVoice'
import WordBuilding from '@/components/modules/sld/WordBuilding'
import DragDropSorting from '@/components/modules/id/DragDropSorting'

const LANGS: VoiceLanguage[] = ['en-IN', 'hi-IN', 'te-IN']

export default function VoiceDiagnosticsPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [ready, setReady] = useState(false)

  /* --- Real-Firestore verification rig ---------------------------------------
     Earlier testing here used a session id with no document, so every module
     updateDoc() failed into an empty catch and the UI only ever showed local
     state. The doc is now created explicitly, the role is switchable, and the
     PERSISTED value is read back through an independent listener so a passing
     test cannot be faked by local state. */
  const [docReady, setDocReady] = useState(false)
  const [role, setRole] = useState<'therapist' | 'client'>('therapist')
  const [persisted, setPersisted] = useState<{ lang?: unknown; updatedAt?: unknown; exists: boolean }>({ exists: false })

  useEffect(() => {
    // Create ONLY if absent. `setDoc({ moduleState: {} }, { merge: true })` looks
    // harmless but an empty map REPLACES the field instead of deep-merging, so a
    // bootstrap like that wipes moduleState on every page load.
    ;(async () => {
      const ref = doc(db, 'liveSessions', 'dev-voice')
      try {
        const snap = await getDoc(ref)
        if (!snap.exists()) {
          await setDoc(ref, {
            sessionId: 'dev-voice',
            moduleState: {},
            timestamps: { updatedAt: new Date().toISOString() },
          })
        }
      } catch (err) {
        console.warn('[dev/voice] bootstrap failed', err)
      }
      setDocReady(true)
    })()
  }, [])

  useEffect(() => {
    return onSnapshot(doc(db, 'liveSessions', 'dev-voice'), (snap) => {
      setPersisted({
        exists: snap.exists(),
        lang: snap.data()?.moduleState?.voiceLanguage,
        updatedAt: snap.data()?.timestamps?.updatedAt,
      })
    })
  }, [])

  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis.getVoices()
      if (v.length) {
        setVoices(v)
        setReady(true)
      }
    }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    const t = setTimeout(load, 1500)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      clearTimeout(t)
    }
  }, [])

  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e7eaef', fontSize: 13, verticalAlign: 'top' }

  return (
    <div style={{ padding: 28, fontFamily: 'system-ui, sans-serif', color: '#2b2f33', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>staadVoice diagnostics</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Installed voices: <strong>{ready ? voices.length : 'loading…'}</strong>
      </p>

      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900, marginBottom: 28 }}>
        <thead>
          <tr style={{ textAlign: 'left', background: '#f3f5f8' }}>
            <th style={cell}>Language</th>
            <th style={cell}>Resolved voice</th>
            <th style={cell}>Genuine regional match?</th>
            <th style={cell}>Test</th>
          </tr>
        </thead>
        <tbody>
          {LANGS.map((lang) => {
            const d = ready ? getVoiceDiagnostics(lang) : null
            return (
              <tr key={lang}>
                <td style={{ ...cell, fontWeight: 700 }}>{lang}</td>
                <td style={cell}>
                  {d ? (d.voice ? `${d.voice.name} [${d.voice.lang}]` : '— none —') : '…'}
                  <div style={{ fontSize: 11, color: '#9aa0a6' }}>via {d?.via ?? '…'}</div>
                </td>
                <td style={{ ...cell, fontWeight: 700, color: d?.exact ? '#2f9457' : '#c2410c' }}>
                  {d ? (d.exact ? 'YES' : 'NO — falling back') : '…'}
                </td>
                <td style={cell}>
                  <button
                    onClick={() => { staadCancel(); staadSpeak({ text: randomPraise(lang), language: lang, type: 'praise' }) }}
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e7eaef', background: '#f3f5f8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >
                    Speak praise
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Praise bank</h2>
      <ul style={{ fontSize: 13, color: '#4b5563', marginBottom: 28, lineHeight: 1.7 }}>
        {LANGS.map((l) => (
          <li key={l}><strong>{l}</strong>: {PRAISE_PHRASES[l].join(' · ')}</li>
        ))}
      </ul>

      {/* The modules below write to the real liveSessions/dev-voice document that
          this page creates, so the toggle can be verified end to end. Open this
          page in two tabs and set one to therapist, one to client. */}
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        Firestore round-trip check (moduleState.voiceLanguage)
      </h2>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => setRole(role === 'therapist' ? 'client' : 'therapist')}
          style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #d8dce2', background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          this tab is: <strong>{role}</strong>
        </button>
        <span style={{ fontSize: 12, color: '#4b5563' }}>
          doc <code>liveSessions/dev-voice</code>:{' '}
          <strong style={{ color: persisted.exists ? '#2f9457' : '#b91c1c' }}>
            {persisted.exists ? 'exists' : 'missing'}
          </strong>
        </span>
      </div>
      <div style={{ marginBottom: 24, padding: '10px 12px', borderRadius: 10, background: '#f3f5f8', border: '1px solid #e7eaef', fontFamily: 'monospace', fontSize: 13 }}>
        persisted voiceLanguage ={' '}
        <strong style={{ color: '#2f6d5e' }}>{String(persisted.lang ?? '(unset)')}</strong>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          updatedAt = {String(persisted.updatedAt ?? '—')}
        </div>
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Migrated modules — toggle presence</h2>
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { name: 'Word Building', node: <WordBuilding sessionId="dev-voice" role={role} isLocked={false} /> },
          { name: 'Drag & Drop Sorting', node: <DragDropSorting sessionId="dev-voice" role={role} isLocked={false} /> },
        ].map(({ name, node }) => (
          <div key={name} style={{ width: 420 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{name}</div>
            <div style={{ height: 260, overflowY: 'auto', background: '#1c1c1c', borderRadius: 12, padding: 10 }}>
              {docReady ? node : <span style={{ fontSize: 12, color: '#888' }}>preparing doc…</span>}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>All installed voices</h2>
      <div style={{ fontSize: 12, color: '#4b5563', fontFamily: 'monospace', lineHeight: 1.6, maxHeight: 320, overflowY: 'auto', border: '1px solid #e7eaef', borderRadius: 8, padding: 12 }}>
        {voices.map((v) => (
          <div key={`${v.name}-${v.lang}`}>{v.lang} — {v.name}{v.default ? '  (browser default)' : ''}</div>
        ))}
      </div>
    </div>
  )
}
