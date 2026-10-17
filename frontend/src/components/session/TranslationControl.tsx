'use client'

// Therapist control for live translated captions, shown inside the Captions
// popup (dark glass card).
//
// Sets two languages, not one: who speaks what. The agent transcribes each
// participant in the language they speak and captions them in the language the
// other person reads.
//
// Changes apply live: the backend updates the participants' attributes in the
// room (see TranslationSync), so the call is not reconnected.

import { Languages, AlertTriangle } from 'lucide-react'
import { GLASS } from '@/components/session/roomTheme'
import { OnOffButton } from '@/components/ui/on-off-button'
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
  // IndicConformer covers the 22 scheduled Indic languages; English is not one
  // of them. Speaking English still produces captions, but unreliable ones.
  const unsupportedSpeakers = [
    settings.therapist && !sttSupported(settings.therapist) ? 'You' : null,
    settings.client && !sttSupported(settings.client) ? 'Client' : null,
  ].filter(Boolean) as string[]

  const select = (value: string, onPick: (v: string) => void, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: GLASS.inkMuted }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: `1px solid ${GLASS.fillBorder}`,
          background: '#222',
          color: GLASS.ink,
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 12,
        background: GLASS.fill,
        border: `1px solid ${GLASS.fillBorder}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Languages size={14} color={GLASS.accent} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: GLASS.ink }}>Live translated captions</span>
        <OnOffButton
          on={settings.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label="Live translated captions"
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {select(settings.therapist, (v) => onChange({ therapist: v }), 'You speak')}
        {select(settings.client, (v) => onChange({ client: v }), 'Client speaks')}
      </div>

      <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: GLASS.inkFaint }}>
        Each of you reads captions in your own language.
      </p>

      {unsupportedSpeakers.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(232,194,122,0.1)',
            border: '1px solid rgba(232,194,122,0.35)',
          }}
        >
          <AlertTriangle size={13} color="#E8C27A" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10.5, lineHeight: 1.45, color: '#E8C27A' }}>
            {unsupportedSpeakers.join(' and ')}{' '}
            {unsupportedSpeakers.length > 1 ? 'are' : 'is'} set to a language the
            speech model was not trained on. Captions for that side will be
            unreliable.
          </span>
        </div>
      )}
    </div>
  )
}
