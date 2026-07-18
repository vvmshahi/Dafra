import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './locales/en/common.json'
import navigationEn from './locales/en/navigation.json'
import authEn from './locales/en/auth.json'
import settingsEn from './locales/en/settings.json'
import commonAr from './locales/ar-SA/common.json'
import navigationAr from './locales/ar-SA/navigation.json'
import authAr from './locales/ar-SA/auth.json'
import settingsAr from './locales/ar-SA/settings.json'
import { applyDocumentLocale, detectInitialLocale, normalizeLocale } from './locale'
import type { UiLocale } from './types'

const initialLocale = detectInitialLocale()

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: commonEn, navigation: navigationEn, auth: authEn, settings: settingsEn },
      'ar-SA': { common: commonAr, navigation: navigationAr, auth: authAr, settings: settingsAr },
    },
    lng: initialLocale,
    supportedLngs: ['en', 'ar-SA'],
    nonExplicitSupportedLngs: false,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'navigation', 'auth', 'settings'],
    returnEmptyString: false,
    initImmediate: false,
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_languages, namespace, key) => {
      if (import.meta.env.DEV) console.warn(`[i18n] Missing translation: ${namespace}.${key}`)
    },
  })
  .catch(error => {
    applyDocumentLocale('en')
    if (import.meta.env.DEV) console.error('[i18n] Initialization failed; using English document defaults.', error)
  })

applyDocumentLocale(initialLocale)

i18n.on('languageChanged', language => {
  applyDocumentLocale(normalizeLocale(language) ?? 'en')
})

export function currentUiLocale(): UiLocale {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language) ?? 'en'
}

export default i18n
