import type { UiLocale } from '@/localization/types'

export const SAUDI_DISPLAY_TIME_ZONE = 'Asia/Riyadh'

export function displayLocale(locale?: string | null): 'en-SA' | 'ar-SA' {
  return locale?.startsWith('ar') ? 'ar-SA' : 'en-SA'
}

export function formatDisplayNumber(
  value: number,
  locale?: string | null,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(displayLocale(locale), options).format(value)
}

export function formatDisplayCurrency(value: number, locale?: UiLocale | string | null, decimals = 2): string {
  return formatDisplayNumber(value, locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatDisplayInteger(value: number, locale?: string | null): string {
  return formatDisplayNumber(value, locale, { maximumFractionDigits: 0 })
}

export function formatDisplayPercent(value: number, locale?: string | null, decimals = 0): string {
  return formatDisplayNumber(value / 100, locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatDisplayDate(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: SAUDI_DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatDisplayDashboardDate(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: SAUDI_DISPLAY_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatDisplayTime(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: SAUDI_DISPLAY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatDisplayDateTime(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: SAUDI_DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(value instanceof Date ? value : new Date(value))
}
