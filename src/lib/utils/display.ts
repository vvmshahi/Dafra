/**
 * Prefer Arabic name when available, fall back to English.
 * Use for product names, category names, branch names, business names.
 */
export function displayName(nameEn: string | null, nameAr: string | null): string {
  if (nameAr && nameAr.trim()) return nameAr
  return nameEn ?? ''
}

/**
 * Format a date string to a readable local date.
 */
export function fmtDate(iso: string, locale = 'en-SA'): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

/**
 * Format a datetime string to time only.
 */
export function fmtTime(iso: string, locale = 'en-SA'): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit',
  })
}
