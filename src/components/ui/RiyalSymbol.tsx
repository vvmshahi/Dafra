import { useLocale } from '@/localization/useLocale'
import { currentUiLocale } from '@/localization/i18n'
import { formatDisplayCurrency } from '@/lib/utils/localeFormat'

/**
 * Saudi Riyal Symbol — new official symbol announced Feb 20, 2025.
 * Font: SaudiRiyal.woff2 — maps U+00EA to the riyal glyph.
 */

const RIYAL_CHAR = 'ê'

export function RiyalSymbol({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ fontFamily: "'SaudiRiyal', serif", display: 'inline-block', verticalAlign: 'baseline', lineHeight: 1 }}
      className={className}
    >
      {RIYAL_CHAR}
    </span>
  )
}

/**
 * Currency display component — renders [RiyalSymbol] [formatted amount].
 * Use this everywhere money is shown in JSX.
 */
export function Rial({
  amount,
  decimals = 2,
  className,
}: {
  amount: number
  decimals?: number
  className?: string
}) {
  const { locale } = useLocale()
  const formatted = formatDisplayCurrency(amount, locale, decimals)
  return (
    <span className={`inline-flex items-baseline gap-0.5 tabular-nums ${className ?? ''}`}>
      <RiyalSymbol />
      <span>{formatted}</span>
    </span>
  )
}

/**
 * For string-only contexts (chart tooltips, aria-labels, etc.)
 * where JSX cannot be used — returns "SAR 1,234.00".
 */
export function sarStr(amount: number, decimals = 2, locale = currentUiLocale()): string {
  return `SAR ${formatDisplayCurrency(amount, locale, decimals)}`
}
