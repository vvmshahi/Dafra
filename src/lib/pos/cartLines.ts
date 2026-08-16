import type { VatTreatment } from '@/types/database'

export const CUSTOM_LINE_UNIT_CODE = 'PCE' as const
export const CUSTOM_LINE_QUANTITY_SCALE = 3
export const CUSTOM_LINE_VAT_TREATMENTS = ['inherit', 'exclusive', 'inclusive'] as const

export type CustomLineVatTreatment = (typeof CUSTOM_LINE_VAT_TREATMENTS)[number]

/**
 * The catalogue variant intentionally retains the full Phase 4 cart shape.
 * It is the only cart variant that can be handed to the current checkout mapper.
 */
export interface CatalogueCartLine {
  source: 'catalogue'
  cartLineId: string
  productId: string
  productUnitId: string | null
  productUnitVersion: number | null
  pricingMethod: 'calculated' | 'custom' | 'legacy'
  conversionToBase: number
  quantityScale: number
  unitName: string
  unitNameAr: string | null
  unitCode: string | null
  baseUnitName: string
  baseUnitNameAr: string | null
  name: string
  nameAr: string | null
  price: number
  vatTreatment: VatTreatment
  unit: string
  quantity: number
  catColor: string | null
}

/**
 * Client-only Phase 5 shape. It deliberately has no product, stock, SKU,
 * barcode, or package identity and cannot be sent to the current checkout RPC.
 */
export interface CustomCartLine {
  source: 'custom'
  cartLineId: string
  description: string
  descriptionAr: string | null
  quantity: number
  unitPrice: number
  vatTreatment: CustomLineVatTreatment
  unitCode: typeof CUSTOM_LINE_UNIT_CODE
}

export type PosCartLine = CatalogueCartLine | CustomCartLine

export interface CustomCartLineInput {
  cartLineId?: string
  description: string
  descriptionAr?: string | null
  quantity: number
  unitPrice: number
  vatTreatment: CustomLineVatTreatment
}

export type CustomCartLineValidationIssue =
  | 'description'
  | 'quantity'
  | 'unitPrice'
  | 'vatTreatment'

export interface CustomLineDisplayPreview {
  lineAmount: number
  subtotal: number
  taxAmount: number
  total: number
  effectiveVatTreatment: 'exclusive' | 'inclusive'
}

const VAT_RATE = 0.15

function roundPreviewMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isCatalogueCartLine(line: PosCartLine): line is CatalogueCartLine {
  return line.source === 'catalogue'
}

export function isCustomCartLine(line: PosCartLine): line is CustomCartLine {
  return line.source === 'custom'
}

export function hasCustomCartLines(lines: PosCartLine[]): boolean {
  return lines.some(isCustomCartLine)
}

export function createCustomCartLineId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `custom:${crypto.randomUUID()}`
  }
  return `custom:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

export function isCustomLineVatTreatment(value: unknown): value is CustomLineVatTreatment {
  return typeof value === 'string'
    && (CUSTOM_LINE_VAT_TREATMENTS as readonly string[]).includes(value)
}

function hasPrecision(value: number, digits: number): boolean {
  return Number.isFinite(value) && Number(value.toFixed(digits)) === value
}

export function validateCustomCartLineInput(input: CustomCartLineInput): CustomCartLineValidationIssue | null {
  if (!input.description.trim()) return 'description'
  if (input.description.trim().length > 300) return 'description'
  if (!hasPrecision(input.quantity, CUSTOM_LINE_QUANTITY_SCALE) || input.quantity <= 0) return 'quantity'
  if (!hasPrecision(input.unitPrice, 2) || input.unitPrice <= 0) return 'unitPrice'
  if (!isCustomLineVatTreatment(input.vatTreatment)) return 'vatTreatment'
  return null
}

export function createCustomCartLine(input: CustomCartLineInput): CustomCartLine | null {
  if (validateCustomCartLineInput(input)) return null
  return {
    source: 'custom',
    cartLineId: input.cartLineId?.trim() || createCustomCartLineId(),
    description: input.description.trim(),
    descriptionAr: input.descriptionAr?.trim() || null,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    vatTreatment: input.vatTreatment,
    unitCode: CUSTOM_LINE_UNIT_CODE,
  }
}

/**
 * A non-authoritative browser preview only. Phase 6 will recompute and validate
 * custom-line tax on the server before any invoice can be issued.
 */
export function getCustomLineDisplayPreview(
  line: CustomCartLine,
  branchVatMode: 'exclusive' | 'inclusive',
): CustomLineDisplayPreview {
  const lineAmount = roundPreviewMoney(line.quantity * line.unitPrice)
  const effectiveVatTreatment = line.vatTreatment === 'inherit'
    ? branchVatMode
    : line.vatTreatment

  if (effectiveVatTreatment === 'inclusive') {
    const subtotal = roundPreviewMoney(lineAmount / (1 + VAT_RATE))
    return {
      lineAmount,
      subtotal,
      taxAmount: roundPreviewMoney(lineAmount - subtotal),
      total: lineAmount,
      effectiveVatTreatment,
    }
  }

  return {
    lineAmount,
    subtotal: lineAmount,
    taxAmount: roundPreviewMoney(lineAmount * VAT_RATE),
    total: roundPreviewMoney(lineAmount * (1 + VAT_RATE)),
    effectiveVatTreatment,
  }
}
