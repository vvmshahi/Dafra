import documentsEn from './locales/en/documents.json'
import documentsAr from './locales/ar-SA/documents.json'

export type DocumentLanguage = 'en' | 'ar' | 'both'
export type DocumentTextKey = keyof typeof documentsEn

export function normalizeDocumentLanguage(value: unknown): DocumentLanguage {
  return value === 'en' || value === 'ar' || value === 'both' ? value : 'both'
}

export function parseDocumentLanguage(value: unknown): DocumentLanguage | null {
  return value === 'en' || value === 'ar' || value === 'both' ? value : null
}

export function resolveInvoiceDocumentLanguage(invoiceValue: unknown, branchValue: unknown): DocumentLanguage {
  return parseDocumentLanguage(invoiceValue) ?? parseDocumentLanguage(branchValue) ?? 'both'
}

export function resolveCreditNoteDocumentLanguage(creditNoteValue: unknown, originalInvoiceValue: unknown, branchValue: unknown): DocumentLanguage {
  return parseDocumentLanguage(creditNoteValue) ?? parseDocumentLanguage(originalInvoiceValue) ?? parseDocumentLanguage(branchValue) ?? 'both'
}

export function documentDirection(language: DocumentLanguage): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr'
}

export function documentFontFamily(language: DocumentLanguage): string {
  return language === 'en'
    ? "'Inter', Arial, sans-serif"
    : "'KubriArabic', 'Noto Naskh Arabic', Tahoma, Arial, sans-serif"
}

export function documentLabel(language: DocumentLanguage, key: DocumentTextKey): string {
  if (language === 'ar') return documentsAr[key]
  if (language === 'both') return `${documentsEn[key]} / ${documentsAr[key]}`
  return documentsEn[key]
}

export function documentLabelLines(language: DocumentLanguage, key: DocumentTextKey): string[] {
  if (language === 'ar') return [documentsAr[key]]
  if (language === 'both') return [documentsEn[key], documentsAr[key]]
  return [documentsEn[key]]
}

export function documentNames(
  language: DocumentLanguage,
  englishValue: string | null | undefined,
  arabicValue: string | null | undefined,
): string[] {
  const english = englishValue?.trim() ?? ''
  const arabic = arabicValue?.trim() ?? ''
  if (language === 'en') return english ? [english] : arabic ? [arabic] : []
  if (language === 'ar') return arabic ? [arabic] : english ? [english] : []
  if (!english) return arabic ? [arabic] : []
  if (!arabic || arabic.localeCompare(english, undefined, { sensitivity: 'base' }) === 0) return [english]
  return [english, arabic]
}

export function documentDate(
  value: string | number | Date,
  language: DocumentLanguage,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(value).toLocaleDateString(language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Riyadh',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...options,
  })
}

export function documentDateTime(value: string | number | Date, language: DocumentLanguage): string {
  return new Date(value).toLocaleString(language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function documentPaymentLabel(language: DocumentLanguage, method: string): string {
  if (method === 'cash') return documentLabel(language, 'cash')
  if (method === 'card') return documentLabel(language, 'card')
  if (method === 'split') return documentLabel(language, 'split')
  if (method === 'bank_transfer') return documentLabel(language, 'bankTransfer')
  return documentLabel(language, 'other')
}
