import { documentLabel } from '@/localization/documents'
import type { DocumentViewModel } from './documentViewModel'

export interface VisibleTotalRow {
  key: string
  label: string
  value: number
  emphasized?: boolean
}

export interface TaxBreakdownRow {
  key: string
  rate: number
  category: string | null
  taxable: number
  vat: number
}

export function buildTaxBreakdown(model: DocumentViewModel): TaxBreakdownRow[] {
  const groups = new Map<string, TaxBreakdownRow>()
  for (const item of model.items) {
    const rate = Number.isFinite(item.vatRate) ? item.vatRate : 0
    const category = item.vatCategory ?? null
    const key = `${rate.toFixed(4)}|${category ?? ''}`
    const current = groups.get(key) ?? { key: `tax-${key}`, rate, category, taxable: 0, vat: 0 }
    current.taxable += item.taxableAmount
    current.vat += item.vatAmount
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => left.rate - right.rate || left.key.localeCompare(right.key))
}

export function formatTaxRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function buildVisibleTotals(model: DocumentViewModel): VisibleTotalRow[] {
  const { totals } = model
  const rows: VisibleTotalRow[] = [{ key: 'subtotal', label: documentLabel(model.identity.language, 'amountBeforeVat'), value: totals.subtotal }]
  if (totals.discount > 0.005) rows.push({ key: 'discount', label: documentLabel(model.identity.language, 'discount'), value: totals.discount })
  if (Math.abs(totals.taxableAmount - totals.subtotal) > 0.005) rows.push({ key: 'taxable', label: documentLabel(model.identity.language, 'taxableAmount'), value: totals.taxableAmount })
  const taxBreakdown = buildTaxBreakdown(model)
  if (taxBreakdown.length > 1) {
    for (const group of taxBreakdown) {
      rows.push({ key: `${group.key}-taxable`, label: `${documentLabel(model.identity.language, 'taxableAmount')} — ${formatTaxRate(group.rate)}%`, value: group.taxable })
      rows.push({ key: `${group.key}-vat`, label: `${documentLabel(model.identity.language, 'vatAmount')} — ${formatTaxRate(group.rate)}%`, value: group.vat })
    }
  } else {
    const rate = taxBreakdown[0]?.rate
    rows.push({ key: 'vat', label: rate == null ? documentLabel(model.identity.language, 'vatAmount') : `${documentLabel(model.identity.language, 'vatAmount')} (${formatTaxRate(rate)}%)`, value: totals.vat })
  }
  rows.push({ key: 'total', label: documentLabel(model.identity.language, model.identity.kind === 'credit_note' ? 'creditTotal' : 'totalIncludingVat'), value: totals.total, emphasized: true })
  if (model.identity.kind === 'credit_note') {
    if (totals.refunded > 0) rows.push({ key: 'refunded', label: documentLabel(model.identity.language, 'refunded'), value: totals.refunded })
  } else {
    if (model.payments.length > 0) rows.push({ key: 'paid', label: documentLabel(model.identity.language, 'paid'), value: totals.paid })
    if ((totals.balance ?? 0) > 0.005) rows.push({ key: 'balance', label: documentLabel(model.identity.language, 'balance'), value: totals.balance ?? 0 })
  }
  return rows
}
