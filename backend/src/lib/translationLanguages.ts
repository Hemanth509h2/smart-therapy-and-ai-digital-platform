// Language table for live translation — shared by the client picker and the
// server-side token route, so both validate against the same allow-list.
//
// Deliberately free of 'use client' and of any Firebase import: the token route
// runs on the server and must be able to import this without pulling in the
// client SDK.
//
// Codes are the 2-letter form the translation agent expects; it maps them to
// IndicTrans2's FLORES codes internally.

export interface TranslationLanguage {
  code: string
  label: string
  native: string
  /** False means IndicConformer cannot transcribe speech in this language. */
  sttSupported: boolean
}

/**
 * English is offered because it is a valid language to READ captions in.
 * Speaking it is the unreliable case: IndicConformer is trained on the 22
 * scheduled Indic languages and English is not one of them.
 */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', label: 'English', native: 'English', sttSupported: false },
  { code: 'hi', label: 'Hindi', native: 'हिंदी', sttSupported: true },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', sttSupported: true },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', sttSupported: true },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', sttSupported: true },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', sttSupported: true },
  { code: 'mr', label: 'Marathi', native: 'मराठी', sttSupported: true },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', sttSupported: true },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', sttSupported: true },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', sttSupported: true },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ', sttSupported: true },
  { code: 'ur', label: 'Urdu', native: 'اردو', sttSupported: true },
]

const CODES = new Set(TRANSLATION_LANGUAGES.map((l) => l.code))

export function isTranslationLanguage(v: unknown): v is string {
  return typeof v === 'string' && CODES.has(v)
}

export function languageLabel(code: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.label ?? code
}

export function languageNative(code: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.native ?? code
}

export function sttSupported(code: string): boolean {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.sttSupported ?? false
}
