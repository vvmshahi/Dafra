import { useLocale } from '@/localization/useLocale'

interface AuthenticatedLanguageSwitchProps {
  className?: string
  inverse?: boolean
}

export function AuthenticatedLanguageSwitch({ className = '', inverse = false }: AuthenticatedLanguageSwitchProps) {
  const { locale, setLocale } = useLocale()
  const targetLocale = locale === 'en' ? 'ar-SA' : 'en'
  const label = locale === 'en' ? 'العربية' : 'English'
  const ariaLabel = locale === 'en' ? 'Switch interface language to Arabic' : 'Switch interface language to English'

  return (
    <button
      type="button"
      onClick={() => void setLocale(targetLocale)}
      aria-label={ariaLabel}
      title={ariaLabel}
      lang={targetLocale === 'ar-SA' ? 'ar' : 'en'}
      dir={targetLocale === 'ar-SA' ? 'rtl' : 'ltr'}
      className={`inline-flex items-center justify-center rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${inverse ? 'border-white/15 bg-white/10 text-white hover:bg-white/15' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} ${className}`}
    >
      {label}
    </button>
  )
}
