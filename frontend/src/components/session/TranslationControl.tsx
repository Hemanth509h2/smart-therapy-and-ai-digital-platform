'use client'

// Therapist control for live translated captions.
//
// Sets two languages, not one: who speaks what. The agent transcribes each
// participant in the language they speak and captions them in the language the
// other person reads.
//
// Changing a language re-mints the access token (the languages are signed into
// it as participant attributes), which reconnects the room — so the control
// warns before it does that mid-session.

import { useState } from 'react'
import { Languages, ChevronDown, AlertTriangle } from 'lucide-react'
import { RC } from '@/components/session/roomTheme'
import {
  TRANSLATION_LANGUAGES,
  sttSupported,
  type TranslationSettings,
} from '@/lib/translation'

export default function TranslationControl({
  settings,
  onChange,
}: {
  settings: TranslationSettings
  onChange: (patch: Partial<TranslationSettings>) => void
}) {
  const [open, setOpen] = useState(false)

  // IndicConformer covers the 22 scheduled Indic languages; English is not one
  // of them. Speaking English still produces captions, but unreliable ones.
  const unsupportedSpeakers = [
    settings.therapist && !sttSupported(settings.therapist) ? 'You' : null,
    settings.client && !sttSupported(settings.client) ? 'Client' : null,
  ].filter(Boolean) as string[]

  const select = (value: string, onPick: (v: string) => void, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: RC.inkMuted }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: `1px solid ${RC.border}`,
          background: RC.panel,
          color: RC.ink,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {TRANSLATION_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
            {lang.sttSupported ? '' : ' (speech not supported)'}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Live translation"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 20,
          border: `1px solid ${settings.enabled ? RC.green : RC.border}`,
          background: settings.enabled ? RC.tileActive : RC.tile,
          color: settings.enabled ? RC.greenDark : RC.ink,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Languages size={13} />
        {settings.enabled ? 'Captions on' : 'Captions off'}
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 34,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 80,
            width: 300,
            padding: 14,
            borderRadius: 14,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 12px 32px rgba(20,30,40,0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              style={{ accentColor: RC.green }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: RC.ink }}>
              Show live translated captions
            </span>
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            {select(settings.therapist, (v) => onChange({ therapist: v }), 'You speak')}
            {select(settings.client, (v) => onChange({ client: v }), 'Client speaks')}
          </div>

          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: RC.inkMuted }}>
            Each of you reads captions in your own language. Changing a language
            reconnects the call.
          </p>

          {unsupportedSpeakers.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(180,83,9,0.08)',
                border: '1px solid rgba(180,83,9,0.28)',
              }}
            >
              <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 11, lineHeight: 1.45, color: '#7C3D08' }}>
                {unsupportedSpeakers.join(' and ')}{' '}
                {unsupportedSpeakers.length > 1 ? 'are' : 'is'} set to a language the
                speech model was not trained on. Captions for that side will be
                unreliable.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
