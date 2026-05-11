// Saudi Arabia is UTC+3, no DST — all date/time operations for Meem use this offset.

const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000

/** Returns a Date whose getUTC* methods reflect Saudi local time */
export function saudiNow(): Date {
  return new Date(Date.now() + SAUDI_OFFSET_MS)
}

/** YYYY-MM-DD in Saudi timezone, from an optional UTC date/string (defaults to now) */
export function saudiDateStr(d?: Date | string): string {
  const ms = d instanceof Date ? d.getTime() : d ? new Date(d as string).getTime() : Date.now()
  return new Date(ms + SAUDI_OFFSET_MS).toISOString().split('T')[0]
}

/** HH:MM:SS in Saudi timezone from a UTC Date or ISO string */
export function saudiTimeStr(utcDate: Date | string): string {
  const ms = utcDate instanceof Date ? utcDate.getTime() : new Date(utcDate as string).getTime()
  return new Date(ms + SAUDI_OFFSET_MS).toISOString().slice(11, 19)
}

/**
 * UTC ISO range that covers Saudi "today" — use for created_at range queries.
 * e.g. Saudi 2026-05-03 → { start: "2026-05-02T21:00:00.000Z", end: "2026-05-03T20:59:59.999Z" }
 */
export function saudiTodayRange(): { start: string; end: string } {
  const d = saudiDateStr()
  return {
    start: new Date(`${d}T00:00:00+03:00`).toISOString(),
    end:   new Date(`${d}T23:59:59.999+03:00`).toISOString(),
  }
}

// ── Display helpers (for UI rendering) ───────────────────────────────────────

export function toSaudiDate(utcString: string): string {
  return new Date(utcString).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

export function toSaudiTime(utcString: string): string {
  return new Date(utcString).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export function toSaudiDateTime(utcString: string): string {
  return new Date(utcString).toLocaleString('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
