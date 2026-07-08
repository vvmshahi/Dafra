import type { Branch, Tenant, UserProfile } from '@/types'

export type ReportPdfKind = 'sessions' | 'sales' | 'vat' | 'pl'

export interface ReportPdfContext {
  reportKind: ReportPdfKind
  reportTitle: string
  reportSlug: string
  startDate: string
  endDate: string
  dateRangeLabel: string
  generatedAt: Date
  generatedAtLabel: string
  companyName: string
  legalName: string | null
  branchName: string
  vatNumber: string | null
  crNumber: string | null
  address: string | null
  phone: string | null
  email: string | null
  generatedBy: string | null
}

export interface BuildReportPdfContextInput {
  reportKind: ReportPdfKind
  reportTitle: string
  reportSlug: string
  startDate: string
  endDate: string
  tenant: Tenant | null
  branch: Branch | null
  profile: UserProfile | null
  branchLabel?: string | null
}

export const PDF_THEME = {
  colors: {
    green: [15, 36, 25] as [number, number, number],
    green2: [24, 74, 52] as [number, number, number],
    gold: [190, 142, 55] as [number, number, number],
    goldSoft: [255, 247, 232] as [number, number, number],
    text: [31, 41, 55] as [number, number, number],
    muted: [107, 114, 128] as [number, number, number],
    lightText: [156, 163, 175] as [number, number, number],
    border: [223, 226, 221] as [number, number, number],
    soft: [250, 248, 242] as [number, number, number],
    softGreen: [235, 244, 238] as [number, number, number],
    warning: [146, 64, 14] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
  },
  layout: {
    marginLeft: 14,
    marginRight: 14,
    headerTop: 10,
    contentTop: 58,
    footerTopOffset: 15,
    pageBottom: 24,
  },
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  return text || fallback
}

export function isPdfLatinSafe(value: unknown): boolean {
  const text = safeText(value)
  if (!text) return true

  return Array.from(text).every(char => {
    const code = char.charCodeAt(0)
    return code === 10 || code === 13 || (code >= 32 && code <= 126)
  })
}

export function safeLatinPdfText(value: unknown, fallback = ''): string {
  const text = safeText(value)
  if (!text) return fallback
  return isPdfLatinSafe(text) ? text : fallback
}

export function safePdfText(value: unknown, fallback = ''): string {
  return safeText(value, fallback)
}

export function cleanPdfIdentityLine(value: unknown, fallback = ''): string {
  const text = safePdfText(value, '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

export function optionalText(value: unknown): string | null {
  const text = safeText(value)
  return text || null
}

const optionalPdfText = optionalText

export function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function intOrZero(value: unknown): number {
  return Math.trunc(numberOrZero(value))
}

export function formatCurrencyPdf(value: unknown): string {
  return `SAR ${numberOrZero(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatCurrencyAmountPdf(value: unknown): string {
  return numberOrZero(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatNumberPdf(value: unknown, digits = 0): string {
  return numberOrZero(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPercentPdf(value: unknown): string {
  return `${numberOrZero(value).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

export function formatSignedImpactPdf(value: unknown): string {
  const amount = numberOrZero(value)
  if (amount > 0) return `+ ${formatCurrencyPdf(amount)}`
  if (amount < 0) return `- ${formatCurrencyPdf(Math.abs(amount))}`
  return formatCurrencyPdf(0)
}

export function formatDatePdf(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Riyadh',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTimePdf(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Riyadh',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDateRangePdf(startDate: string, endDate: string): string {
  return `${formatDatePdf(`${startDate}T00:00:00+03:00`)} to ${formatDatePdf(`${endDate}T00:00:00+03:00`)}`
}

export function formatMonthPdf(value: string | null | undefined): string {
  if (!value) return '-'
  const [year, month] = value.split('-').map(part => Number(part))
  if (!year || !month) return safeText(value, '-')
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function buildReportPdfContext(input: BuildReportPdfContextInput): ReportPdfContext {
  const branch = input.branch
  const tenant = input.tenant
  const companyName = cleanPdfIdentityLine(
    branch?.display_name || branch?.business_name || branch?.name || tenant?.name,
    'Business',
  )
  const legalName = optionalPdfText(branch?.business_name || tenant?.name)
  const branchName = cleanPdfIdentityLine(input.branchLabel || branch?.name, branch ? 'Branch' : 'All Branches')
  const generatedAt = new Date()

  const address = optionalPdfText(
    branch?.address
    || [branch?.building_number, branch?.street, branch?.district, branch?.city, branch?.country]
      .filter(hasText)
      .join(', ')
    || tenant?.address
    || [tenant?.building_number, tenant?.street, tenant?.district, tenant?.city, tenant?.country]
      .filter(hasText)
      .join(', '),
  )

  return {
    reportKind: input.reportKind,
    reportTitle: input.reportTitle,
    reportSlug: input.reportSlug,
    startDate: input.startDate,
    endDate: input.endDate,
    dateRangeLabel: formatDateRangePdf(input.startDate, input.endDate),
    generatedAt,
    generatedAtLabel: formatDateTimePdf(generatedAt.toISOString()),
    companyName,
    legalName: legalName && legalName !== companyName ? legalName : null,
    branchName,
    vatNumber: optionalPdfText(branch?.vat_number || tenant?.vat_number),
    crNumber: optionalPdfText(branch?.cr_number || tenant?.cr_number),
    address,
    phone: optionalPdfText(branch?.phone || tenant?.phone),
    email: optionalPdfText(branch?.email || tenant?.email),
    generatedBy: optionalPdfText(input.profile?.full_name) || optionalPdfText(input.profile?.email),
  }
}

export function reportPdfFileName(context: ReportPdfContext): string {
  return `kubri-${context.reportSlug}-${context.startDate}-to-${context.endDate}.pdf`
}
