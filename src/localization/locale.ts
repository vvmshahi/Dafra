import { SUPPORTED_LOCALES, type LocaleOption, type UiLocale } from './types'

export const UI_LOCALE_STORAGE_KEY = 'kubri.uiLocale'

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { value: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr' },
  { value: 'ar-SA', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl' },
]

export function normalizeLocale(value: unknown): UiLocale | null {
  if (typeof value !== 'string') return null
  if (SUPPORTED_LOCALES.includes(value as UiLocale)) return value as UiLocale
  const normalized = value.toLowerCase()
  if (normalized === 'ar' || normalized.startsWith('ar-')) return 'ar-SA'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

export function isRtlLocale(locale: UiLocale): boolean {
  return locale === 'ar-SA'
}

export function applyDocumentLocale(locale: UiLocale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr'
}

export function readSavedLocale(): UiLocale | null {
  try {
    const saved = localStorage.getItem(UI_LOCALE_STORAGE_KEY)
    return SUPPORTED_LOCALES.includes(saved as UiLocale) ? saved as UiLocale : null
  } catch {
    return null
  }
}

export function detectInitialLocale(): UiLocale {
  try {
    const savedValue = localStorage.getItem(UI_LOCALE_STORAGE_KEY)
    if (savedValue !== null) return readSavedLocale() ?? 'en'
  } catch {
    // Continue to browser detection when storage is unavailable.
  }
  if (typeof navigator !== 'undefined') {
    const detected = navigator.languages
      .map(normalizeLocale)
      .find((locale): locale is UiLocale => locale !== null)
    if (detected) return detected
  }
  return 'en'
}

export function persistUiLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale)
  } catch {
    // Persistence is optional; the active locale can still change.
  }
}
