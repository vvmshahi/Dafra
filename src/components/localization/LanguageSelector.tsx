import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LOCALE_OPTIONS } from '@/localization/locale'
import { useLocale } from '@/localization/useLocale'

interface LanguageSelectorProps {
  compact?: boolean
  className?: string
}

export function LanguageSelector({ compact = false, className = '' }: LanguageSelectorProps) {
  const { t } = useTranslation('settings')
  const { locale, setLocale } = useLocale()

  return (
    <div className={className}>
      {!compact && (
        <div className="mb-3 flex items-center gap-2">
          <Languages size={15} className="text-primary-500" aria-hidden="true" />
          <div>
            <p id="interface-language-label" className="text-sm font-semibold text-gray-900">{t('interfaceLanguage')}</p>
            <p className="text-xs text-gray-400">{t('changesApplyImmediately')}</p>
          </div>
        </div>
      )}
      <div
        role="group"
        aria-labelledby={compact ? undefined : 'interface-language-label'}
        aria-label={compact ? t('interfaceLanguage') : undefined}
        className={`inline-flex rounded-xl border p-1 ${compact ? 'border-[#D9CBAA] bg-white/70' : 'border-gray-200 bg-gray-50'}`}
      >
        {LOCALE_OPTIONS.map(option => {
          const selected = locale === option.value
          const translatedLabel = option.value === 'en' ? t('english') : t('arabic')
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              lang={option.value}
              dir={option.dir}
              onClick={() => void setLocale(option.value)}
              className={`min-w-[88px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 ${
                selected
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900'
              }`}
            >
              {option.nativeLabel}
              <span className="sr-only"> — {translatedLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

