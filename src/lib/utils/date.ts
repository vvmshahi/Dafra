export const SAUDI_TIME_ZONE = 'Asia/Riyadh'

export type SaudiDatePreset = 'today' | 'yesterday' | 'this_month' | 'last_month'

const saudiPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAUDI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function partsRecord(date: Date) {
  return Object.fromEntries(
    saudiPartsFormatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

function dateFromCalendarParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return dateFromCalendarParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/** Converts a Saudi calendar midnight to its exact UTC instant using the IANA zone. */
export function saudiCalendarMidnightUtc(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const localAsUtc = Date.UTC(year, month - 1, day)
  let candidate = localAsUtc

  // Two passes also handle zones whose offset changes near the target instant.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = partsRecord(new Date(candidate))
    const representedLocalTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    candidate -= representedLocalTime - localAsUtc
  }
  return new Date(candidate).toISOString()
}

/** UTC instants covering inclusive Saudi calendar dates. */
export function saudiDateRangeUtc(startDate: string, endDate: string) {
  return {
    start: saudiCalendarMidnightUtc(startDate),
    end: new Date(
      new Date(saudiCalendarMidnightUtc(shiftCalendarDate(endDate, 1))).getTime() - 1,
    ).toISOString(),
  }
}

/** YYYY-MM-DD in Saudi Arabia for an optional UTC date/string. */
export function saudiDateStr(value?: Date | string): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date()
  const parts = partsRecord(date)
  return dateFromCalendarParts(parts.year, parts.month, parts.day)
}

/** Returns a Date whose UTC calendar fields represent the current Saudi calendar. */
export function saudiNow(): Date {
  const parts = partsRecord(new Date())
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second))
}

export function saudiDatePresetRange(preset: SaudiDatePreset, now: Date | string = new Date()) {
  const today = saudiDateStr(now)
  const [year, month] = today.split('-').map(Number)
  if (preset === 'today') return { start: today, end: today }
  if (preset === 'yesterday') {
    const yesterday = shiftCalendarDate(today, -1)
    return { start: yesterday, end: yesterday }
  }
  if (preset === 'this_month') {
    return { start: dateFromCalendarParts(year, month, 1), end: today }
  }
  const previousMonthLastDay = shiftCalendarDate(dateFromCalendarParts(year, month, 1), -1)
  const [previousYear, previousMonth] = previousMonthLastDay.split('-').map(Number)
  return {
    start: dateFromCalendarParts(previousYear, previousMonth, 1),
    end: previousMonthLastDay,
  }
}

export function saudiTodayRange(): { start: string; end: string } {
  const today = saudiDatePresetRange('today')
  return saudiDateRangeUtc(today.start, today.end)
}

export function saudiTimeStr(utcDate: Date | string): string {
  const parts = partsRecord(utcDate instanceof Date ? utcDate : new Date(utcDate))
  return [parts.hour, parts.minute, parts.second].map(value => String(value).padStart(2, '0')).join(':')
}

export function formatSaudiDate(
  value: Date | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
    timeZone: SAUDI_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatSaudiTime(value: Date | string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
    timeZone: SAUDI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatSaudiDateTime(value: Date | string, locale: string): string {
  return `${formatSaudiDate(value, locale)}, ${formatSaudiTime(value, locale)}`
}

export function toSaudiDate(utcString: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SAUDI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcString))
}

export function toSaudiTime(utcString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SAUDI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(utcString))
}

export function toSaudiDateTime(utcString: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SAUDI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(utcString))
}
