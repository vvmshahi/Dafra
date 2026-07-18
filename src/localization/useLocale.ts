import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { currentUiLocale } from './i18n'
import { applyDocumentLocale, isRtlLocale, persistUiLocale } from './locale'
import type { UiLocale } from './types'

export function useLocale() {
  const { i18n } = useTranslation()
  const locale = currentUiLocale()
  const setLocale = useCallback(async (nextLocale: UiLocale) => {
    persistUiLocale(nextLocale)
    applyDocumentLocale(nextLocale)
    await i18n.changeLanguage(nextLocale)
  }, [i18n])

  return {
    locale,
    isRtl: isRtlLocale(locale),
    setLocale,
    ready: i18n.isInitialized,
  }
}
