import { useTranslation } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'

interface CompactLanguageSelectorProps {
  className?: string
  inverse?: boolean
}

export function CompactLanguageSelector({ className = '', inverse = false }: CompactLanguageSelectorProps) {
  const { t } = useTranslation('settings')
  const { locale, setLocale } = useLocale()
  const choices = [
    { value: 'en' as const, label: 'English', lang: 'en', dir: 'ltr' as const, accessible: t('switchToEnglish') },
    { value: 'ar-SA' as const, label: 'العربية', lang: 'ar', dir: 'rtl' as const, accessible: t('switchToArabic') },
  ]

  return (
    <div
      role="group"
      aria-label={t('interfaceLanguage')}
      className={`inline-flex min-h-11 items-center whitespace-nowrap text-xs ${inverse ? 'text-white/55' : 'text-gray-400'} ${className}`}
      dir="ltr"
    >
      {choices.map((choice, index) => {
        const active = locale === choice.value
        return (
          <span key={choice.value} className="inline-flex items-center">
            {index > 0 && <span aria-hidden="true" className={`px-1.5 ${inverse ? 'text-white/25' : 'text-gray-300'}`}>|</span>}
            <button
              type="button"
              lang={choice.lang}
              dir={choice.dir}
              aria-label={active ? `${choice.accessible}. ${t('currentLanguage')}` : choice.accessible}
              aria-current={active ? 'true' : undefined}
              onClick={() => void setLocale(choice.value)}
              className={`min-h-11 rounded px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/80 focus-visible:ring-offset-2 ${
                active
                  ? inverse ? 'font-bold text-white' : 'font-bold text-gray-900'
                  : inverse ? 'font-medium hover:text-white' : 'font-medium hover:text-gray-700'
              }`}
            >
              {choice.label}
            </button>
          </span>
        )
      })}
    </div>
  )
}
