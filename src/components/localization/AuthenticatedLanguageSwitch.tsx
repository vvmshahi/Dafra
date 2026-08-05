import { useLocale } from '@/localization/useLocale'

interface AuthenticatedLanguageSwitchProps {
  className?: string
  inverse?: boolean
  collapsed?: boolean
}

export function AuthenticatedLanguageSwitch({ className = '', inverse = false, collapsed = false }: AuthenticatedLanguageSwitchProps) {
  const { locale, setLocale } = useLocale()
  const targetLocale = locale === 'en' ? 'ar-SA' : 'en'
  const currentLabel = locale === 'en' ? 'EN' : 'العربية'
  const targetLabel = locale === 'en' ? 'العربية' : 'EN'
  const ariaLabel = locale === 'en' ? 'Switch interface language to Arabic' : 'Switch interface language to English'

  return (
    <button
      type="button"
      onClick={() => void setLocale(targetLocale)}
      aria-label={ariaLabel}
      title={ariaLabel}
      lang={targetLocale === 'ar-SA' ? 'ar' : 'en'}
      dir={targetLocale === 'ar-SA' ? 'rtl' : 'ltr'}
      aria-pressed="true"
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar ${collapsed ? 'w-10 px-0' : 'w-fit'} ${inverse ? 'border-white/15 bg-white/10 text-white hover:bg-white/15' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} ${className}`}
    >
      <span className={locale === 'en' ? 'font-black text-gold-300' : 'text-white/55'}>{collapsed && locale === 'ar-SA' ? 'ع' : currentLabel}</span>
      {!collapsed && <span className="text-white/30" aria-hidden="true">|</span>}
      {!collapsed && <span className={locale === 'en' ? 'text-white/60' : 'font-black text-gold-300'}>{targetLabel}</span>}
    </button>
  )
}
