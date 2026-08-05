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
      className={`inline-flex min-h-11 items-center overflow-hidden rounded-xl border p-1 text-xs ${inverse ? 'border-white/15 bg-white/10' : 'border-[#D9CBAA] bg-white/70'} ${className}`}
      dir="ltr"
    >
      {choices.map(choice => {
        const active = locale === choice.value
        return (
          <button
            key={choice.value}
            type="button"
            lang={choice.lang}
            dir={choice.dir}
            aria-label={active ? `${choice.accessible}. ${t('currentLanguage')}` : choice.accessible}
            aria-pressed={active}
            onClick={() => void setLocale(choice.value)}
            className={`min-h-9 min-w-[88px] rounded-lg px-3 py-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/80 focus-visible:ring-offset-1 ${
              active
                ? inverse ? 'bg-[#D8B76A] text-[#10291E] shadow-sm' : 'bg-[#D8B76A] text-[#10291E] shadow-sm'
                : inverse ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-gray-600 hover:bg-white hover:text-gray-900'
            }`}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
