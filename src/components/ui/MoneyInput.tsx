import { forwardRef, type InputHTMLAttributes, type KeyboardEvent } from 'react'

export function sanitizeMoneyValue(raw: string, previous = ''): string {
  const compact = raw.replace(/[\s,]/g, '')

  // Number inputs accept exponent notation; money never does. Keep the last
  // valid value rather than turning a pasted exponent into a different amount.
  if (/\d[eE][+-]?\d/.test(compact)) return previous

  const withoutCurrency = compact.replace(/SAR/gi, '').replace(/[^\d.]/g, '')
  const dotIndex = withoutCurrency.indexOf('.')

  if (dotIndex === -1) return withoutCurrency

  const whole = withoutCurrency.slice(0, dotIndex)
  const decimals = withoutCurrency.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)
  return `${whole}.${decimals}`
}

export function normalizeMoneyValue(value: string): string {
  if (value === '') return ''
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : ''
}

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'value' | 'onChange' | 'min' | 'max' | 'step'
> & {
  value: string
  onValueChange: (value: string, numericValue: number | null) => void
  min?: number
  max?: number
  normalizeOnBlur?: boolean
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput({
  value,
  onValueChange,
  min = 0,
  max,
  normalizeOnBlur = true,
  onBlur,
  onKeyDown,
  ...props
}, ref) {
  function publish(nextValue: string) {
    const numericValue = nextValue === '' || nextValue === '.' ? null : Number(nextValue)
    onValueChange(nextValue, Number.isFinite(numericValue) ? numericValue : null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault()
    onKeyDown?.(event)
  }

  return (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={event => publish(sanitizeMoneyValue(event.target.value, value))}
      onKeyDown={handleKeyDown}
      onBlur={event => {
        if (normalizeOnBlur) {
          const normalized = normalizeMoneyValue(value)
          if (normalized !== value) publish(normalized)
        }
        onBlur?.(event)
      }}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value === '' || value === '.' ? undefined : Number(value)}
    />
  )
})
