import { useTranslation } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'

export function PublicLanguageToggle() {
  const { t } = useTranslation('settings')
  const { locale, setLocale } = useLocale()
  const nextLocale = locale === 'en' ? 'ar-SA' : 'en'
  const nextLabel = nextLocale === 'ar-SA' ? 'العربية' : 'English'

  return (
    <button
      type="button"
      lang={nextLocale === 'ar-SA' ? 'ar' : 'en'}
      dir={nextLocale === 'ar-SA' ? 'rtl' : 'ltr'}
      aria-label={nextLocale === 'ar-SA' ? t('switchToArabic') : t('switchToEnglish')}
      onClick={() => void setLocale(nextLocale)}
      className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.045] px-3 text-sm font-semibold text-white/80 transition-colors hover:border-white/35 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071510] active:bg-white/[0.12]"
    >
      {nextLabel}
    </button>
  )
}
