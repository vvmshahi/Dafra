export const SUPPORTED_LOCALES = ['en', 'ar-SA'] as const

export type UiLocale = (typeof SUPPORTED_LOCALES)[number]

export interface LocaleOption {
  value: UiLocale
  label: string
  nativeLabel: string
  dir: 'ltr' | 'rtl'
}

