import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  PackageCheck,
  PackageX,
  Plus,
  ReceiptText,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'
import { MoneyInput } from '@/components/ui/MoneyInput'
import type { PaymentMethod, ZatcaStatus } from '@/types/database'
import {
  getInvoiceZatcaOutputState,
  isPermanentDemoSandboxBranch,
  submitInvoiceForBranch,
} from '@/lib/zatca/submission'
import {
  atomicCheckoutFingerprint,
  checkoutSimplifiedAtomically,
  cleanupObsoleteCreditNotePendingCheckouts,
  clearPendingAtomicCheckout,
  inspectPendingAtomicCheckout,
  persistPendingAtomicCheckout,
  type AtomicReceiptPayload,
  type PendingAtomicCheckoutInspection,
} from '@/lib/zatca/atomicCheckout'
import { resolveScopedAtomicCheckout } from '@/lib/zatca/atomicCheckoutScope.mjs'
import { creditNotePresentationState } from '@/lib/zatca/creditNotePresentation.mjs'
import { useAuth } from '@/hooks/useAuth'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import { useLocale } from '@/localization/useLocale'
import {
  clearPersistentReceivableOperation,
  createCustomerCreditNoteSettlement,
  getPersistentReceivableOperation,
} from '@/lib/customers/receivables'

export interface CreditNoteSourceInvoice {
  id: string
  branch_id: string
  invoice_number: string
  total_amount: number
  zatca_document_kind: 'simplified' | 'standard'
  invoice_date?: string | null
  customer_name?: string | null
}

export interface CreditNoteCreatedResult {
  creditNoteId: string
  creditNoteNumber: string
  createdAt: string
  total: number
  refundStatus: string
  zatcaStatus: ZatcaStatus
  idempotentReplay: boolean
  reason: string
  refundMethod: PaymentMethod
  autoSubmitSucceeded: boolean
  subtotal: number
  taxAmount: number
  itemsCount: number
  originalInvoiceId: string
  originalInvoiceNumber: string
  documentKind: 'simplified' | 'standard'
  invoiceStatus: string
  finalizationStatus: string
  artifactStage: string
  reportingDisplayState: string
  canPrint: boolean
  retryAvailable: boolean
  reconciliationRequired: boolean
  atomicReceipt?: AtomicReceiptPayload
}

interface RpcCreditNoteResult {
  credit_note_invoice_id?: string
  credit_note_invoice_number?: string
  created_at?: string
  total?: number
  refund_status?: string
  zatca_status?: ZatcaStatus
  refund_method?: PaymentMethod | 'split'
  idempotent_replay?: boolean
}

interface CreditNotePaymentRow {
  method: PaymentMethod
  amount: number
}

interface RefundableItem {
  original_invoice_item_id: string
  name: string
  name_ar: string | null
  sku: string | null
  unit: string | null
  product_id: string | null
  original_quantity: number
  credited_quantity: number
  remaining_quantity: number
  unit_price: number
  subtotal: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  remaining_subtotal: number
  remaining_discount_amount: number
  remaining_tax_amount: number
  remaining_total: number
  track_stock: boolean
  is_service: boolean
  product_unit_id: string | null
  product_unit_version: number | null
  selling_unit_name: string | null
  selling_unit_name_ar: string | null
  selling_unit_code: string | null
  package_quantity: number | null
  package_quantity_scale: number | null
  conversion_to_base: number | null
  base_quantity: number | null
  base_unit_name: string | null
  base_unit_name_ar: string | null
  base_unit_code: string | null
  base_quantity_scale: number | null
  package_unit_price: number | null
  base_unit_price: number | null
  stock_tracked_at_sale: boolean | null
  service_item_at_sale: boolean | null
}

interface ReturnLinePreview {
  item: RefundableItem
  quantity: number
  subtotal: number
  discount: number
  tax: number
  total: number
}

interface CreateCreditNoteModalProps {
  open: boolean
  invoice: CreditNoteSourceInvoice | null
  defaultRefundMethod?: PaymentMethod | null
  onClose: () => void
  onCreated: (result: CreditNoteCreatedResult) => void
}

interface CreditNoteModalInvoiceIdentity {
  id: string
  branchId: string
  invoiceNumber: string
}

interface CreditNoteOutputState {
  documentKind: 'simplified' | 'standard'
  invoiceStatus: string
  finalizationStatus: string
  artifactStage: string
  reportingDisplayState: string
  canPrint: boolean
  retryAvailable: boolean
  reconciliationRequired: boolean
}

function safeCreditNoteError(error: unknown, t: TFunction): string {
  const message = typeof (error as any)?.message === 'string' ? (error as any).message : ''
  if (/select at least one|no items/i.test(message)) return t('validation:creditNoteChooseItem')
  if (/invalid returned quantity|quantity.*greater than zero/i.test(message)) return t('validation:returnQuantityPositive')
  if (/unsupported decimal precision|exact valid base quantity|invalid package fraction/i.test(message)) {
    return t('creditNotes:packages.invalidFraction')
  }
  if (/exceeds remaining|fully credited/i.test(message)) return t('validation:returnQuantityExceeded')
  if (/does not belong/i.test(message)) return t('validation:returnItemMismatch')
  if (/duplicate/i.test(message)) return t('validation:returnItemDuplicate')
  if (/refunds cannot exceed|payment total/i.test(message)) return t('validation:refundExceedsPayment')
  if (/stock return failed/i.test(message)) return t('validation:stockReturnFailed')
  if (/reported|cleared/i.test(message)) return t('validation:creditInvoiceStatus')
  if (/posted/i.test(message)) return t('validation:creditPostedOnly')
  if (/reason/i.test(message)) return t('validation:creditReasonRequired')
  if (/forbidden|unauthorized|permission/i.test(message)) return t('validation:creditPermissionDenied')
  return t('validation:creditNoteFailed')
}

function newIdempotencyKey(invoiceId: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${invoiceId}-${Date.now()}`
}

function defaultReportingDisplayState(
  documentKind: 'simplified' | 'standard',
  invoiceStatus: string,
  finalizationStatus: string,
): string {
  if (documentKind === 'standard') {
    if (invoiceStatus === 'cleared') return 'cleared'
    if (/failed|rejected|blocked/.test(finalizationStatus) || invoiceStatus === 'failed') {
      return 'clearance_failed'
    }
    return 'clearance_pending'
  }
  if (invoiceStatus === 'reported') return 'reported'
  if (/reconciliation/.test(finalizationStatus)) return 'reconciliation_required'
  if (/failed|rejected|blocked/.test(finalizationStatus) || invoiceStatus === 'failed') {
    return 'reporting_rejected'
  }
  return 'reporting_pending'
}

function logPendingCreditNoteDiagnostic(
  currentModalInvoiceId: string,
  inspection: PendingAtomicCheckoutInspection,
) {
  if (!import.meta.env.DEV) return
  console.info('[credit-note atomic retry]', {
    currentModalInvoiceId,
    pendingStorageScope: inspection.storageScope,
    storedOriginalInvoiceId: inspection.storedOriginalInvoiceId,
    accepted: inspection.accepted,
    rejectedReason: inspection.rejectedReason,
  })
}

const QUICK_REASONS = [
  'Customer refund',
  'Cancelled order',
  'Billing mistake',
  'Test sale',
] as const

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function paymentLabel(method: PaymentMethod | string | null | undefined, t: TFunction): string {
  if (method === 'cash') return t('payments:cash')
  if (method === 'card') return t('payments:cardPos')
  if (method === 'bank_transfer') return t('payments:bankTransfer')
  return t('payments:other')
}

function money(amount: number): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function invoiceDate(value: string | null | undefined, isRtl: boolean): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleDateString(isRtl ? 'ar-SA-u-nu-latn' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function qty(amount: number, scale = 3): string {
  return Number(amount).toLocaleString('en-US', {
    maximumFractionDigits: Math.max(0, Math.min(6, scale)),
  })
}

function isWholeUnitItem(item: RefundableItem): boolean {
  const unitCode = item.selling_unit_code?.trim().toUpperCase()
  if (unitCode === 'PCE' || unitCode === 'EA' || unitCode === 'H87') return true

  const unitIdentity = [
    item.selling_unit_name,
    item.selling_unit_name_ar,
    item.unit,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim().toLowerCase())
  if (unitIdentity.some(value => (
    value === 'piece'
    || value === 'pieces'
    || value === 'unit'
    || value === 'units'
    || value === 'قطعة'
    || value === 'وحدة'
  ))) return true

  // Decimal database types and their generic scale do not grant fractional
  // selling permission. Only an explicit product-unit contract does.
  if (!item.product_unit_id) return true
  return (item.package_quantity_scale ?? 0) === 0
}

function quantityStepForItem(item: RefundableItem): string {
  if (isWholeUnitItem(item)) return '1'
  if (!item.product_unit_id) return '0.001'
  const scale = item.package_quantity_scale ?? 0
  return String(10 ** -Math.max(0, Math.min(6, scale)))
}

function quantityDisplayScaleForItem(item: RefundableItem): number {
  return Math.max(0, Math.min(6, Math.round(-Math.log10(Number(quantityStepForItem(item))))))
}

function roundMoney(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100
}

function parseReturnQuantity(value: string | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatQuantityInput(amount: number, scale = 3): string {
  const factor = 10 ** Math.max(0, Math.min(6, scale))
  return String(Math.round(amount * factor) / factor)
}

function normalizeQuantityInput(value: string, item: RefundableItem, currentValue: string): string {
  if (value.trim() === '') return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''
  if (isWholeUnitItem(item) && !Number.isInteger(parsed)) return currentValue
  if (parsed < 0) return '0'
  if (parsed > item.remaining_quantity) {
    return formatQuantityInput(item.remaining_quantity, quantityDisplayScaleForItem(item))
  }
  return value
}

function fullReturnQuantity(item: RefundableItem): string {
  return formatQuantityInput(
    Math.max(item.remaining_quantity, 0),
    quantityDisplayScaleForItem(item),
  )
}

function invalidPackageReturn(item: RefundableItem, quantity: number): boolean {
  if (!item.product_unit_id || quantity <= 0) return false
  const packageScale = item.package_quantity_scale ?? 0
  const baseScale = item.base_quantity_scale ?? 3
  const conversion = item.conversion_to_base
  if (!Number.isFinite(conversion) || Number(conversion) <= 0) return true
  const packageFactor = 10 ** Math.max(0, Math.min(6, packageScale))
  const baseFactor = 10 ** Math.max(0, Math.min(6, baseScale))
  const packageScaled = quantity * packageFactor
  const baseScaled = quantity * Number(conversion) * baseFactor
  return Math.abs(packageScaled - Math.round(packageScaled)) > 1e-7
    || Math.abs(baseScaled - Math.round(baseScaled)) > 1e-7
}

function invalidReturnQuantity(item: RefundableItem, quantity: number): boolean {
  if (quantity <= 0) return false
  const step = Number(quantityStepForItem(item))
  const scaled = quantity / step
  return quantity > item.remaining_quantity + 1e-7
    || Math.abs(scaled - Math.round(scaled)) > 1e-7
    || invalidPackageReturn(item, quantity)
}

function amountForQuantity(
  originalAmount: number,
  remainingAmount: number,
  item: RefundableItem,
  returnQuantity: number,
): number {
  if (returnQuantity <= 0 || item.original_quantity <= 0) return 0
  if (Math.abs(returnQuantity - item.remaining_quantity) <= 0.0000005) return roundMoney(remainingAmount)
  return Math.min(roundMoney(originalAmount * (returnQuantity / item.original_quantity)), roundMoney(remainingAmount))
}

function previewForItem(item: RefundableItem, returnQuantity: number): ReturnLinePreview {
  return {
    item,
    quantity: returnQuantity,
    subtotal: amountForQuantity(item.subtotal, item.remaining_subtotal, item, returnQuantity),
    discount: amountForQuantity(item.discount_amount, item.remaining_discount_amount, item, returnQuantity),
    tax: amountForQuantity(item.tax_amount, item.remaining_tax_amount, item, returnQuantity),
    total: amountForQuantity(item.total, item.remaining_total, item, returnQuantity),
  }
}

function resolveAutoRefundMethod(payments: CreditNotePaymentRow[]): PaymentMethod {
  const methods = new Set(payments.filter(row => row.amount > 0).map(row => row.method))
  if (methods.size === 1) return [...methods][0]
  return 'other'
}

function refundPlanText(payments: CreditNotePaymentRow[], loading: boolean, t: TFunction): string {
  if (loading) return t('refunds:loadingOriginal')
  const usable = payments.filter(row => row.amount > 0)
  if (usable.length === 0) return t('refunds:allocationUnavailable')
  if (usable.length === 1) return t('refunds:originalSingle', { method: paymentLabel(usable[0].method, t), amount: money(usable[0].amount) })
  return t('refunds:originalMultiple', { details: usable.map(row => `${paymentLabel(row.method, t)} SAR ${money(row.amount)}`).join(' · ') })
}

async function fetchCreditNoteStatus(invoiceId: string): Promise<ZatcaStatus | null> {
  const { data } = await supabase
    .from('invoices')
    .select('zatca_status')
    .eq('id', invoiceId)
    .maybeSingle()

  return (data?.zatca_status as ZatcaStatus | undefined) ?? null
}

export default function CreateCreditNoteModal({
  open,
  invoice,
  onClose,
  onCreated,
}: CreateCreditNoteModalProps) {
  const { t } = useTranslation(['creditNotes', 'refunds', 'payments', 'invoices', 'validation', 'common'])
  const { isRtl } = useLocale()
  const { tenant, branch, profile } = useAuth()
  const [selectedReason, setSelectedReason] = useState<(typeof QUICK_REASONS)[number] | ''>('')
  const [remarks, setRemarks] = useState('')
  const [originalPayments, setOriginalPayments] = useState<CreditNotePaymentRow[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [refundableItems, setRefundableItems] = useState<RefundableItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [cartFingerprint, setCartFingerprint] = useState('')
  const [modalInvoiceIdentity, setModalInvoiceIdentity] = useState<CreditNoteModalInvoiceIdentity | null>(null)
  const [refundMode, setRefundMode] = useState<'' | 'cash' | 'card' | 'split'>('')
  const [settleWithReceivables, setSettleWithReceivables] = useState(false)
  const [refundCash, setRefundCash] = useState('')
  const [refundCard, setRefundCard] = useState('')
  const [stockReturnChoice, setStockReturnChoice] = useState<boolean | null>(null)
  const [remarksExpanded, setRemarksExpanded] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const reasonSectionRef = useRef<HTMLElement>(null)
  const itemsSectionRef = useRef<HTMLElement>(null)
  const inventorySectionRef = useRef<HTMLFieldSetElement>(null)
  const refundSectionRef = useRef<HTMLFieldSetElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const businessType = resolveBusinessType(tenant?.business_type)
  const isServiceBusiness = businessType === 'service'
  const stockEnabled = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })

  useEffect(() => {
    busyRef.current = creating || submitting
    onCloseRef.current = onClose
  }, [creating, submitting, onClose])

  useEffect(() => {
    const cleanup = () => {
      const removed = cleanupObsoleteCreditNotePendingCheckouts()
      if (import.meta.env.DEV
          && (removed.localStorageKeys.length > 0 || removed.sessionStorageKeys.length > 0)) {
        console.info('[credit-note atomic retry]', {
          event: 'obsolete_branch_scope_removed',
          localStorageEntriesRemoved: removed.localStorageKeys.length,
          sessionStorageEntriesRemoved: removed.sessionStorageKeys.length,
        })
      }
    }
    cleanup()
    const handleStorage = () => cleanup()
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    setSelectedReason('')
    setRemarks('')
    setOriginalPayments([])
    setRefundableItems([])
    setReturnQuantities({})
    setPaymentsLoading(true)
    setItemsLoading(true)
    setError(null)
    setCreating(false)
    setSubmitting(false)
    setIdempotencyKey('')
    setCartFingerprint('')
    setModalInvoiceIdentity(null)
    setRefundMode('')
    setSettleWithReceivables(false)
    setRefundCash('')
    setRefundCard('')
    setStockReturnChoice(null)
    setRemarksExpanded(false)

    if (!open || !invoice) {
      setPaymentsLoading(false)
      setItemsLoading(false)
      return
    }

    const originalInvoiceId = invoice.id
    const originalBranchId = invoice.branch_id
    setModalInvoiceIdentity({
      id: originalInvoiceId,
      branchId: originalBranchId,
      invoiceNumber: invoice.invoice_number,
    })
    const pendingInspection = inspectPendingAtomicCheckout(
      originalBranchId,
      'credit_note',
      originalInvoiceId,
    )
    logPendingCreditNoteDiagnostic(originalInvoiceId, pendingInspection)
    setIdempotencyKey(
      pendingInspection.pending?.idempotencyKey
        ?? newIdempotencyKey(originalInvoiceId),
    )

    let cancelled = false

    ;(async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('payments')
          .select('method, amount')
          .eq('invoice_id', originalInvoiceId)
          .order('paid_at', { ascending: true })
          .order('created_at', { ascending: true })

        if (cancelled) return
        if (error) throw error
        setOriginalPayments((data ?? []).map((row: any) => ({
          method: row.method as PaymentMethod,
          amount: Number(row.amount ?? 0),
        })))
      } catch (err) {
        if (!cancelled) {
          console.error('[CreateCreditNoteModal] failed to load original payments', err)
          setOriginalPayments([])
        }
      } finally {
        if (!cancelled) setPaymentsLoading(false)
      }
    })()

    ;(async () => {
      try {
        const { data, error } = await (supabase as any)
          .rpc('get_invoice_refundable_items_v2', { p_invoice_id: originalInvoiceId })

        if (cancelled) return
        if (error) throw error

        const rows: RefundableItem[] = (data ?? []).map((row: any) => ({
          original_invoice_item_id: String(row.original_invoice_item_id),
          name: String(row.name ?? 'Item'),
          name_ar: row.name_ar ?? null,
          sku: row.sku ?? null,
          unit: row.unit ?? null,
          product_id: row.product_id ?? null,
          original_quantity: Number(row.original_quantity ?? 0),
          credited_quantity: Number(row.credited_quantity ?? 0),
          remaining_quantity: Number(row.remaining_quantity ?? 0),
          unit_price: Number(row.unit_price ?? 0),
          subtotal: Number(row.subtotal ?? 0),
          discount_amount: Number(row.discount_amount ?? 0),
          tax_rate: Number(row.tax_rate ?? 0),
          tax_amount: Number(row.tax_amount ?? 0),
          total: Number(row.total ?? 0),
          remaining_subtotal: Number(row.remaining_subtotal ?? 0),
          remaining_discount_amount: Number(row.remaining_discount_amount ?? 0),
          remaining_tax_amount: Number(row.remaining_tax_amount ?? 0),
          remaining_total: Number(row.remaining_total ?? 0),
          track_stock: Boolean(row.track_stock),
          is_service: Boolean(row.is_service),
          product_unit_id: row.product_unit_id ?? null,
          product_unit_version: row.product_unit_version == null ? null : Number(row.product_unit_version),
          selling_unit_name: row.selling_unit_name ?? null,
          selling_unit_name_ar: row.selling_unit_name_ar ?? null,
          selling_unit_code: row.selling_unit_code ?? null,
          package_quantity: row.package_quantity == null ? null : Number(row.package_quantity),
          package_quantity_scale: row.package_quantity_scale == null ? null : Number(row.package_quantity_scale),
          conversion_to_base: row.conversion_to_base == null ? null : Number(row.conversion_to_base),
          base_quantity: row.base_quantity == null ? null : Number(row.base_quantity),
          base_unit_name: row.base_unit_name ?? null,
          base_unit_name_ar: row.base_unit_name_ar ?? null,
          base_unit_code: row.base_unit_code ?? null,
          base_quantity_scale: row.base_quantity_scale == null ? null : Number(row.base_quantity_scale),
          package_unit_price: row.package_unit_price == null ? null : Number(row.package_unit_price),
          base_unit_price: row.base_unit_price == null ? null : Number(row.base_unit_price),
          stock_tracked_at_sale: row.stock_tracked_at_sale == null ? null : Boolean(row.stock_tracked_at_sale),
          service_item_at_sale: row.service_item_at_sale == null ? null : Boolean(row.service_item_at_sale),
        }))

        setRefundableItems(rows)
        setReturnQuantities(Object.fromEntries(rows.map(row => [row.original_invoice_item_id, '0'])))
      } catch (err) {
        if (!cancelled) {
          console.error('[CreateCreditNoteModal] failed to load refundable items', err)
          setError(t('validation:loadRefundableItemsFailed'))
          setRefundableItems([])
        }
      } finally {
        if (!cancelled) setItemsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [
    open,
    invoice?.id,
    invoice?.branch_id,
    invoice?.invoice_number,
    invoice?.total_amount,
    invoice?.zatca_document_kind,
    isServiceBusiness,
  ])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) {
          event.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(element => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open])

  const linePreviews = useMemo(() => refundableItems.map(item => {
    const selectedQuantity = parseReturnQuantity(returnQuantities[item.original_invoice_item_id])
    return previewForItem(item, selectedQuantity)
  }), [refundableItems, returnQuantities])

  const selectedLines = linePreviews.filter(line => line.quantity > 0)
  const hasInvalidQuantity = selectedLines.some(line => invalidReturnQuantity(line.item, line.quantity))
  const totals = selectedLines.reduce((acc, line) => ({
    subtotal: acc.subtotal + line.subtotal,
    discount: acc.discount + line.discount,
    tax: acc.tax + line.tax,
    total: acc.total + line.total,
  }), { subtotal: 0, discount: 0, tax: 0, total: 0 })
  const remainingLineCount = refundableItems.filter(item => item.remaining_quantity > 0).length
  const remainingRefundableTotal = refundableItems.reduce(
    (sum, item) => sum + Math.max(0, item.remaining_total),
    0,
  )
  const stockReturnQuantity = selectedLines
    .filter(line => line.item.product_id && line.item.track_stock && !line.item.is_service)
    .reduce((sum, line) => sum + (
      line.item.product_unit_id
        ? line.quantity * Number(line.item.conversion_to_base ?? 0)
        : line.quantity
    ), 0)
  const hasEligibleStockLines = !isServiceBusiness && stockEnabled && stockReturnQuantity > 0

  useEffect(() => {
    if (!hasEligibleStockLines) setStockReturnChoice(null)
  }, [hasEligibleStockLines])

  useEffect(() => {
    if (!settleWithReceivables && refundMode === 'cash') setRefundCash(totals.total.toFixed(2))
    if (!settleWithReceivables && refundMode === 'card') setRefundCard(totals.total.toFixed(2))
  }, [refundMode, settleWithReceivables, totals.total])

  if (!open || !invoice) return null

  async function handleCreate() {
    if (!invoice) return
    if (itemsLoading) return
    const currentInvoiceIdentity = {
      id: invoice.id,
      branchId: invoice.branch_id,
      invoiceNumber: invoice.invoice_number,
    }
    if (!modalInvoiceIdentity
        || modalInvoiceIdentity.id !== currentInvoiceIdentity.id
        || modalInvoiceIdentity.branchId !== currentInvoiceIdentity.branchId
        || modalInvoiceIdentity.invoiceNumber !== currentInvoiceIdentity.invoiceNumber) {
      setError(t('validation:creditNoteInvoiceChanged'))
      return
    }
    if (!selectedReason) {
      setError(t('validation:chooseCreditReason'))
      reasonSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      reasonSectionRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }

    const lines = refundableItems
      .map(item => ({
        item,
        quantity: parseReturnQuantity(returnQuantities[item.original_invoice_item_id]),
      }))
      .filter(line => line.quantity > 0)

    if (lines.length === 0) {
      setError(t('validation:returnQuantityRequired'))
      itemsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      itemsSectionRef.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
      return
    }

    const invalidLine = lines.find(line => line.quantity > line.item.remaining_quantity + 0.0005)
    if (invalidLine) {
      setError(t('validation:returnQuantityNamedExceeded', { name: invalidLine.item.name }))
      return
    }
    const invalidQuantityLine = lines.find(line => invalidReturnQuantity(line.item, line.quantity))
    if (invalidQuantityLine) {
      setError(t('creditNotes:packages.invalidFractionNamed', { name: invalidQuantityLine.item.name }))
      itemsSectionRef.current
        ?.querySelector<HTMLInputElement>(`input[data-line-id="${invalidQuantityLine.item.original_invoice_item_id}"]`)
        ?.focus()
      return
    }
    if (hasEligibleStockLines && stockReturnChoice === null) {
      setError(t('creditNotes:stockReturnChoiceRequired'))
      inventorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      inventorySectionRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }

    const trimmedRemarks = remarks.trim()
    const finalReason = trimmedRemarks ? `${selectedReason} - ${trimmedRemarks}` : selectedReason
    if (finalReason.length > 500) {
      setError(t('validation:remarksTooLong'))
      return
    }

    if (!settleWithReceivables && !refundMode) {
      setError(t('creditNotes:refundMethodRequired'))
      refundSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      refundSectionRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }
    const cashRefund = refundMode === 'card' ? 0 : Number(refundCash || 0)
    const cardRefund = refundMode === 'cash' ? 0 : Number(refundCard || 0)
    const refundTotal = cashRefund + cardRefund
    if ((!settleWithReceivables && (cashRefund < 0 || cardRefund < 0 || refundTotal <= 0 || Math.abs(refundTotal - totals.total) > 0.01))
      || (settleWithReceivables && refundMode !== '' && (cashRefund < 0 || cardRefund < 0 || refundTotal <= 0 || refundTotal - totals.total > 0.01))) {
      setError(t('validation:refundAllocationMismatch'))
      refundSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      refundSectionRef.current?.querySelector<HTMLInputElement>('input')?.focus()
      return
    }
    const refundAllocations = [
      cashRefund > 0 ? { method: 'cash', amount: roundMoney(cashRefund) } : null,
      cardRefund > 0 ? { method: 'bank_transfer', amount: roundMoney(cardRefund) } : null,
    ].filter(Boolean)

    setCreating(true)
    setSubmitting(false)
    setError(null)
    try {
      const originalInvoiceId = currentInvoiceIdentity.id
      const payload = {
        original_invoice_id: originalInvoiceId,
        idempotency_key: idempotencyKey || newIdempotencyKey(originalInvoiceId),
        reason: finalReason,
        // One document-level answer applies only to eligible stock-tracked,
        // non-service product lines; the RPC enforces the same restrictions.
        return_stock: hasEligibleStockLines ? stockReturnChoice === true : false,
        refund_allocations: refundAllocations,
        items: lines.map(line => ({
          original_invoice_item_id: line.item.original_invoice_item_id,
          quantity: line.quantity,
        })),
      }
      const demoSandbox = isPermanentDemoSandboxBranch(profile?.tenant_id, invoice.branch_id)
      const atomicSimplifiedCreditEligible = !demoSandbox
        && invoice.zatca_document_kind === 'simplified'
      let usedAtomicSimplifiedCredit = false
      let usedReceivableSettlement = false
      let atomicReceipt: AtomicReceiptPayload | undefined
      let result: RpcCreditNoteResult | null = null
      if (settleWithReceivables) {
        const settlementOperationId = getPersistentReceivableOperation({
          branchId: invoice.branch_id,
          // The invoice id is a local storage namespace only. The server
          // resolves and authorizes the actual customer from the invoice.
          customerId: originalInvoiceId,
          kind: 'credit-note-settlement',
          fingerprint: JSON.stringify({ originalInvoiceId, finalReason, returnStock: payload.return_stock, items: payload.items, refundAllocations }),
        })
        result = await createCustomerCreditNoteSettlement({
          operationId: settlementOperationId,
          originalInvoiceId,
          reason: finalReason,
          returnStock: payload.return_stock,
          items: payload.items.map(item => ({ originalInvoiceItemId: item.original_invoice_item_id, quantity: item.quantity })),
          refundTenders: refundAllocations as Array<{ method: 'cash' | 'card'; amount: number }>,
        })
        usedReceivableSettlement = true
      } else if (atomicSimplifiedCreditEligible) {
        cleanupObsoleteCreditNotePendingCheckouts()
        const pendingInspection = inspectPendingAtomicCheckout(
          invoice.branch_id,
          'credit_note',
          originalInvoiceId,
        )
        logPendingCreditNoteDiagnostic(originalInvoiceId, pendingInspection)
        const pending = pendingInspection.pending
        const atomicPayload = resolveScopedAtomicCheckout(
          pending,
          payload,
          'credit_note',
          originalInvoiceId,
          invoice.branch_id,
        )
        const fingerprint = await atomicCheckoutFingerprint(atomicPayload)
        setCartFingerprint(fingerprint)
        if (pending && pending.cartFingerprint !== fingerprint) {
          throw new Error('Persisted credit-note fingerprint does not match its request payload')
        }
        persistPendingAtomicCheckout(invoice.branch_id, {
          idempotencyKey: String(atomicPayload.idempotency_key),
          cartFingerprint: fingerprint,
          documentType: 'credit_note',
          checkout: atomicPayload,
        }, originalInvoiceId)
        let atomic
        try {
          atomic = await checkoutSimplifiedAtomically({
            branchId: invoice.branch_id,
            checkout: atomicPayload,
            cartFingerprint: fingerprint,
            documentType: 'credit_note',
          })
        } catch (atomicError) {
          if (/ATOMIC_CREDIT_NOTE_REQUIRES_REPORTED_SIMPLIFIED_ORIGINAL/.test(
            atomicError instanceof Error ? atomicError.message : String(atomicError ?? ''),
          )) {
            const postErrorInspection = inspectPendingAtomicCheckout(
              invoice.branch_id,
              'credit_note',
              originalInvoiceId,
            )
            logPendingCreditNoteDiagnostic(originalInvoiceId, postErrorInspection)
          }
          throw atomicError
        }
        if (atomic.status === 'committed') {
          usedAtomicSimplifiedCredit = true
          atomicReceipt = atomic.receipt
          result = {
            credit_note_invoice_id: atomic.receipt.invoice_id,
            credit_note_invoice_number: atomic.receipt.invoice_number,
            created_at: atomic.receipt.created_at,
            total: Number(atomic.receipt.total),
            refund_status: 'completed',
            zatca_status: 'pending',
            refund_method: atomic.receipt.payments.length > 1
              ? 'split'
              : atomic.receipt.payment_method as PaymentMethod,
            idempotent_replay: atomic.idempotentReplay,
          }
          clearPendingAtomicCheckout(
            invoice.branch_id,
            String(atomicPayload.idempotency_key),
            fingerprint,
            'credit_note',
            originalInvoiceId,
          )
        } else {
          clearPendingAtomicCheckout(
            invoice.branch_id,
            String(atomicPayload.idempotency_key),
            fingerprint,
            'credit_note',
            originalInvoiceId,
          )
        }
      }
      if (!result) {
        const { data, error: rpcError } = await (supabase as any).rpc(
          'create_partial_credit_note_with_refund',
          { p_payload: payload },
        )
        if (rpcError) throw rpcError
        result = data as RpcCreditNoteResult
      }
      if (!result.credit_note_invoice_id || !result.credit_note_invoice_number) {
        throw new Error(t('creditNotes:missingResult'))
      }

      const creditNoteId = result.credit_note_invoice_id
      let zatcaStatus = result.zatca_status ?? 'pending'
      let autoSubmitSucceeded = false
      let outputState: CreditNoteOutputState = atomicReceipt
        ? {
          documentKind: 'simplified' as const,
          invoiceStatus: result.zatca_status ?? 'pending',
          finalizationStatus: atomicReceipt.finalization_status,
          artifactStage: atomicReceipt.artifact_stage,
          reportingDisplayState: atomicReceipt.reporting_display_state,
          canPrint: atomicReceipt.can_print === true,
          retryAvailable: false,
          reconciliationRequired: false,
        }
        : {
          documentKind: invoice.zatca_document_kind,
          invoiceStatus: result.zatca_status ?? 'pending',
          finalizationStatus: invoice.zatca_document_kind === 'standard'
            ? 'clearance_pending'
            : 'reporting_pending',
          artifactStage: invoice.zatca_document_kind === 'standard'
            ? 'standard_provisional'
            : 'none',
          reportingDisplayState: invoice.zatca_document_kind === 'standard'
            ? 'clearance_pending'
            : 'reporting_pending',
          canPrint: false,
          retryAvailable: true,
          reconciliationRequired: false,
        }
      const shouldAutoSubmit = !usedAtomicSimplifiedCredit
        && zatcaStatus !== 'reported'
        && zatcaStatus !== 'cleared'

      if (shouldAutoSubmit) {
        setCreating(false)
        setSubmitting(true)
        try {
          const routed = await submitInvoiceForBranch({
            invoiceId: creditNoteId,
            tenantId: profile?.tenant_id ?? '',
            branchId: invoice.branch_id,
            options: {
              source: 'auto_credit_note',
              retryDelayMs: 1500,
              documentKind: invoice.zatca_document_kind,
            },
          })
          autoSubmitSucceeded = routed.mode === 'sandbox_validation'
            ? routed.result.status === 'sandbox_validated' || routed.result.status === 'sandbox_validated_with_warnings'
            : routed.result.ok
          if (routed.mode === 'production_submission') {
            const submission = routed.result
            outputState = {
              documentKind: submission.documentKind ?? invoice.zatca_document_kind,
              invoiceStatus: submission.invoiceStatus,
              finalizationStatus: submission.finalizationStatus,
              artifactStage: submission.artifactStage,
              reportingDisplayState: defaultReportingDisplayState(
                submission.documentKind ?? invoice.zatca_document_kind,
                submission.invoiceStatus,
                submission.finalizationStatus,
              ),
              canPrint: submission.canPrint,
              retryAvailable: submission.retryable,
              reconciliationRequired: false,
            }
          } else {
            outputState = {
              ...outputState,
              invoiceStatus: routed.result.status,
              finalizationStatus: routed.result.status,
              reportingDisplayState: routed.result.status,
              canPrint: autoSubmitSucceeded
                && invoice.zatca_document_kind === 'simplified',
              retryAvailable: !autoSubmitSucceeded,
            }
          }
        } catch {
          autoSubmitSucceeded = false
          outputState = {
            ...outputState,
            finalizationStatus: invoice.zatca_document_kind === 'standard'
              ? 'clearance_failed'
              : 'reporting_failed',
            reportingDisplayState: invoice.zatca_document_kind === 'standard'
              ? 'clearance_failed'
              : 'reporting_rejected',
            canPrint: false,
            retryAvailable: true,
          }
        } finally {
          const refreshedStatus = await fetchCreditNoteStatus(creditNoteId)
          zatcaStatus = refreshedStatus ?? zatcaStatus
        }
      }

      if (!usedAtomicSimplifiedCredit && !demoSandbox) {
        try {
          const authoritative = await getInvoiceZatcaOutputState({
            invoiceId: creditNoteId,
            branchId: invoice.branch_id,
          })
          outputState = {
            documentKind: authoritative.documentKind ?? invoice.zatca_document_kind,
            invoiceStatus: authoritative.invoiceStatus,
            finalizationStatus: authoritative.finalizationStatus,
            artifactStage: authoritative.artifactStage,
            reportingDisplayState: authoritative.reportingDisplayState,
            canPrint: authoritative.canPrint,
            retryAvailable: authoritative.retryAvailable,
            reconciliationRequired: authoritative.reconciliationRequired,
          }
          if (authoritative.invoiceStatus === 'reported'
              || authoritative.invoiceStatus === 'cleared') {
            zatcaStatus = authoritative.invoiceStatus
          }
        } catch {
          // The submission result remains the safe fallback. Standard output
          // stays non-printable unless authoritative cleared markers agree.
        }
      }

      const createdResult: CreditNoteCreatedResult = {
        creditNoteId: result.credit_note_invoice_id,
        creditNoteNumber: result.credit_note_invoice_number,
        createdAt: result.created_at ?? new Date().toISOString(),
        total: Number(result.total ?? totals.total),
        refundStatus: result.refund_status ?? 'completed',
        zatcaStatus,
        idempotentReplay: Boolean(result.idempotent_replay),
        reason: finalReason,
        refundMethod: result.refund_method === 'split' ? 'other' : (result.refund_method ?? resolveAutoRefundMethod(originalPayments)),
        autoSubmitSucceeded,
        subtotal: totals.subtotal,
        taxAmount: totals.tax,
        itemsCount: lines.length,
        originalInvoiceId,
        originalInvoiceNumber: currentInvoiceIdentity.invoiceNumber,
        documentKind: outputState.documentKind,
        invoiceStatus: outputState.invoiceStatus,
        finalizationStatus: outputState.finalizationStatus,
        artifactStage: outputState.artifactStage,
        reportingDisplayState: outputState.reportingDisplayState,
        canPrint: outputState.canPrint,
        retryAvailable: outputState.retryAvailable,
        reconciliationRequired: outputState.reconciliationRequired,
        atomicReceipt,
      }
      if (usedReceivableSettlement) {
        clearPersistentReceivableOperation(invoice.branch_id, originalInvoiceId, 'credit-note-settlement')
      }
      onCreated(createdResult)
      onClose()
      const presentation = creditNotePresentationState(createdResult)
      const description = presentation.messageKey
        ? t(presentation.messageKey)
        : presentation.statusKey
        ? t(presentation.statusKey)
        : undefined
      if (presentation.tone === 'error') {
        toast.error(t(presentation.headingKey), { description })
      } else if (presentation.tone === 'warning') {
        toast.warning(t(presentation.headingKey), { description })
      } else if (presentation.tone === 'progress') {
        toast.info(t(presentation.headingKey), { description })
      } else {
        toast.success(t(presentation.headingKey), { description })
      }
    } catch (err) {
      const safeMessage = safeCreditNoteError(err, t)
      setError(safeMessage)
      toast.error(safeMessage)
    } finally {
      setCreating(false)
      setSubmitting(false)
    }
  }

  const busy = creating || submitting
  const actionLabel = submitting ? t('creditNotes:submitting') : creating ? t('creditNotes:creating') : t('creditNotes:create')
  const stockReturnChoiceMissing = hasEligibleStockLines && stockReturnChoice === null
  const refundAllocationValid = refundMode !== ''
    && totals.total > 0
    && Math.abs(
      (refundMode === 'card' ? 0 : Number(refundCash || 0))
      + (refundMode === 'cash' ? 0 : Number(refundCard || 0))
      - totals.total,
    ) <= 0.01
  const completionChecks = [
    { key: 'reason', complete: Boolean(selectedReason), label: t('creditNotes:checkReason') },
    { key: 'items', complete: selectedLines.length > 0 && !hasInvalidQuantity, label: t('creditNotes:checkItems') },
    { key: 'inventory', complete: !hasEligibleStockLines || stockReturnChoice !== null, label: t('creditNotes:checkInventory') },
    { key: 'refund', complete: refundAllocationValid, label: t('creditNotes:checkRefund') },
  ]
  const createDisabled = busy || itemsLoading || completionChecks.some(check => !check.complete)
  const selectedQuantity = selectedLines.reduce((sum, line) => sum + line.quantity, 0)
  const selectedNonStockCount = selectedLines.filter(line => (
    line.item.is_service || !line.item.track_stock || !line.item.product_id
  )).length
  const reasonLabel = (reason: (typeof QUICK_REASONS)[number]) => reason === 'Test sale'
    ? t('creditNotes:reasonTestSale')
    : reason === 'Customer refund'
    ? t('creditNotes:reasonCustomerRefund')
    : reason === 'Cancelled order'
    ? t('creditNotes:reasonCancelledOrder')
    : t('creditNotes:reasonBillingMistake')

  const adjustQuantity = (item: RefundableItem, direction: -1 | 1) => {
    const current = parseReturnQuantity(returnQuantities[item.original_invoice_item_id])
    const step = Number(quantityStepForItem(item))
    const scale = quantityDisplayScaleForItem(item)
    const factor = 10 ** scale
    const next = Math.min(
      item.remaining_quantity,
      Math.max(0, Math.round((current + direction * step) * factor) / factor),
    )
    setReturnQuantities(previous => ({
      ...previous,
      [item.original_invoice_item_id]: formatQuantityInput(next, scale),
    }))
    setError(null)
  }

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      data-cart-fingerprint={cartFingerprint || undefined}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        className="flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-base font-black tracking-tight text-slate-950 sm:text-lg">
                {t('creditNotes:create')}
              </h2>
              <span className="max-w-full rounded-md border border-[#B5943E]/55 bg-[#0F2419] px-2.5 py-1 text-[11px] font-black text-[#F3D98B] shadow-sm [overflow-wrap:anywhere]">
                <bdi dir="ltr">{invoice.invoice_number}</bdi>
              </span>
            </div>
            <p id={descriptionId} className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              {t('creditNotes:dialogDescription')}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-[background-color,color,transform] duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('common:close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <section
          aria-labelledby="credit-invoice-context"
          data-testid="source-invoice-strip"
          className="shrink-0 border-b border-[#B5943E]/40 bg-[#0F2419] px-4 py-2.5 text-[#FFF9E8] sm:px-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h3 id="credit-invoice-context" className="text-[10px] font-bold uppercase tracking-wider text-[#F3D98B] rtl:normal-case rtl:tracking-normal">
              {t('creditNotes:invoiceContext')}
            </h3>
            <span className="rounded-full border border-[#F3D98B]/30 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-[#FFF9E8]">
              {t('creditNotes:refundableLines', { count: remainingLineCount })}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              [t('creditNotes:invoiceNumber'), <bdi dir="ltr">{invoice.invoice_number}</bdi>],
              [t('invoices:date'), <bdi dir="ltr">{invoiceDate(invoice.invoice_date, isRtl)}</bdi>],
              [t('invoices:customer'), <span dir="auto">{invoice.customer_name || t('creditNotes:walkInCustomer')}</span>],
              [t('creditNotes:originalTotal'), <bdi dir="ltr">SAR {money(invoice.total_amount)}</bdi>],
              [t('creditNotes:remainingRefundableTotal'), <bdi dir="ltr">SAR {money(remainingRefundableTotal)}</bdi>],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0">
                <dt className="text-[10px] font-medium text-white/60">{label}</dt>
                <dd className="mt-0.5 truncate text-xs font-bold text-[#FFF9E8]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
            <main className="min-w-0 space-y-5 px-4 py-4 sm:px-6 sm:py-5 lg:border-e lg:border-slate-200">
              <section ref={reasonSectionRef} aria-labelledby="credit-reason-heading" className="space-y-2.5">
                <div>
                  <h3 id="credit-reason-heading" className="text-sm font-bold text-slate-900">{t('creditNotes:reason')}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">{t('creditNotes:reasonLegalHint')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t('creditNotes:reason')}>
                  {QUICK_REASONS.map(reason => {
                    const selected = selectedReason === reason
                    return (
                      <button
                        key={reason}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={busy}
                        onClick={() => {
                          setSelectedReason(reason)
                          setError(null)
                        }}
                        className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start text-xs font-semibold transition-[border-color,background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] active:scale-[0.98] disabled:opacity-60 ${
                          selected
                            ? 'border-[#B5943E] bg-[#0F2419] text-[#FFF9E8] shadow-sm'
                            : 'border-slate-200 bg-[#FFFEFA] text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span>{reasonLabel(reason)}</span>
                        {selected && <Check size={14} aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setRemarksExpanded(value => !value)}
                  aria-expanded={remarksExpanded}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A]"
                >
                  {remarksExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  {t('creditNotes:addEmployeeRemarks')}
                </button>
                {remarksExpanded && (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-600">{t('creditNotes:employeeRemarks')}</span>
                    <textarea
                      value={remarks}
                      onChange={event => setRemarks(event.target.value)}
                      rows={3}
                      maxLength={430}
                      disabled={busy}
                      className="input resize-y text-sm"
                      placeholder={t('creditNotes:additionalDetails')}
                    />
                    <span className="block text-[10px] text-slate-400">
                      {t('creditNotes:remarksCombinedHint')}
                    </span>
                  </label>
                )}
              </section>

              {hasEligibleStockLines && (
                <fieldset ref={inventorySectionRef} className="space-y-2.5" aria-describedby="stock-return-help">
                  <div>
                    <legend className="text-sm font-bold text-slate-900">{t('creditNotes:inventoryTreatment')}</legend>
                    <p id="stock-return-help" className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                      {t('creditNotes:stockReturnQuestionHint')}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                    {([
                      { value: true, icon: PackageCheck, title: t('creditNotes:stockReturnYes'), description: t('creditNotes:stockReturnYesDescription') },
                      { value: false, icon: PackageX, title: t('creditNotes:stockReturnNo'), description: t('creditNotes:stockReturnNoDescription') },
                    ] as const).map(option => {
                      const selected = stockReturnChoice === option.value
                      const Icon = option.icon
                      return (
                        <button
                          key={String(option.value)}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={busy}
                          onClick={() => {
                            setStockReturnChoice(option.value)
                            setError(null)
                          }}
                          className={`flex min-h-16 items-start gap-3 rounded-xl border px-3 py-2.5 text-start transition-[border-color,background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] active:scale-[0.98] disabled:opacity-60 ${
                            selected ? 'border-[#B5943E] bg-[#0F2419] text-[#FFF9E8] shadow-sm' : 'border-slate-200 bg-[#FFFEFA] text-slate-900 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-[#F3D98B] text-[#0F2419]' : 'bg-slate-100 text-slate-500'}`}>
                            {selected ? <Check size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                          </span>
                          <span>
                            <span className={`block text-xs font-bold ${selected ? 'text-[#FFF9E8]' : 'text-slate-900'}`}>{option.title}</span>
                            <span className={`mt-0.5 block text-[10px] leading-relaxed ${selected ? 'text-white/70' : 'text-slate-500'}`}>{option.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )}

              <section ref={itemsSectionRef} aria-labelledby="credit-items-heading" className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h3 id="credit-items-heading" className="text-sm font-bold text-slate-900">{t('creditNotes:returnedItems')}</h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">{t('creditNotes:itemSelectionHint')}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600" aria-live="polite">
                    {t('creditNotes:selectedCount', { count: selectedLines.length })}
                  </span>
                </div>

                {itemsLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs text-slate-500" role="status">
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    {t('creditNotes:loadingItems')}
                  </div>
                ) : refundableItems.length === 0 || remainingLineCount === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-xs leading-relaxed text-slate-600" role="status">
                    {t('creditNotes:noRemainingItems')}
                  </div>
                ) : (
                  <div
                    data-testid="returned-items-grid"
                    className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2"
                  >
                    {linePreviews.map(line => {
                      const item = line.item
                      const disabled = busy || item.remaining_quantity <= 0
                      const lineIncluded = line.quantity > 0
                      const sellingUnit = isRtl && item.selling_unit_name_ar?.trim()
                        ? item.selling_unit_name_ar
                        : (item.selling_unit_name ?? item.unit ?? '')
                      const baseUnit = isRtl && item.base_unit_name_ar?.trim()
                        ? item.base_unit_name_ar
                        : (item.base_unit_name ?? '')
                      const quantityInvalid = invalidReturnQuantity(item, line.quantity)
                      const quantityErrorId = `credit-quantity-error-${item.original_invoice_item_id}`
                      const noInventoryImpact = item.is_service || !item.track_stock || !item.product_id
                      return (
                        <article
                          key={item.original_invoice_item_id}
                          data-selected={lineIncluded}
                          className={`relative w-full max-w-[34rem] min-w-0 overflow-hidden rounded-xl border p-3.5 transition-[border-color,background-color,box-shadow] duration-150 ${
                            item.remaining_quantity <= 0
                              ? 'border-slate-200 bg-slate-50 opacity-70'
                              : lineIncluded
                              ? 'border-[#0F2419] bg-[#F1F5F1] shadow-[0_1px_0_rgba(15,36,25,0.08)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-[#0F2419]'
                              : 'border-slate-200 bg-[#FFFEFA]'
                          }`}
                        >
                          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h4 className="break-words text-sm font-bold text-slate-900" dir="auto">
                                {isRtl && item.name_ar?.trim() ? item.name_ar : item.name}
                              </h4>
                              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                                <span>{t('creditNotes:originalQuantity', { quantity: qty(item.original_quantity, quantityDisplayScaleForItem(item)), unit: sellingUnit })}</span>
                                <span>{t('creditNotes:previouslyCreditedWithUnit', { quantity: qty(item.credited_quantity, quantityDisplayScaleForItem(item)), unit: sellingUnit })}</span>
                                <span className="font-bold text-slate-700">
                                  {t('creditNotes:remainingReturnableWithUnit', { quantity: qty(item.remaining_quantity, quantityDisplayScaleForItem(item)), unit: sellingUnit })}
                                </span>
                              </div>
                              {item.product_unit_id && item.conversion_to_base != null && baseUnit && (
                                <p className="mt-1.5 text-[10px] text-slate-500">
                                  {t('creditNotes:packages.selectedBaseEquivalent', {
                                    quantity: qty(line.quantity * item.conversion_to_base, item.base_quantity_scale ?? 3),
                                    unit: baseUnit,
                                  })}
                                </p>
                              )}
                              <p className={`mt-1.5 text-[10px] font-semibold ${noInventoryImpact ? 'text-slate-500' : 'text-[#1B6B3A]'}`}>
                                {noInventoryImpact
                                  ? t('creditNotes:noInventoryImpact')
                                  : t('creditNotes:eligibleInventoryItem')}
                              </p>
                              {noInventoryImpact && (
                                <p className="mt-0.5 text-[10px] text-slate-400">{t('creditNotes:noInventoryImpactHint')}</p>
                              )}
                            </div>
                            <div className="shrink-0 sm:text-end">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 rtl:normal-case rtl:tracking-normal">
                                {t('creditNotes:expectedCredit')}
                              </p>
                              <p className="mt-0.5 text-base font-black tabular-nums text-[#0F2419]" dir="ltr">
                                SAR {money(line.total)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2 border-t border-slate-200/80 pt-3">
                            <div className="flex min-w-[190px] flex-1 items-stretch" dir="ltr">
                              <button
                                type="button"
                                onClick={() => adjustQuantity(item, -1)}
                                disabled={disabled || line.quantity <= 0}
                                className="inline-flex min-h-11 w-11 items-center justify-center rounded-s-xl border border-e-0 border-slate-200 bg-slate-50 text-slate-700 transition-[background-color,transform] duration-150 hover:bg-slate-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] active:scale-[0.97] disabled:cursor-not-allowed disabled:text-slate-300"
                                aria-label={t('creditNotes:decreaseQuantity', { name: item.name })}
                              >
                                <Minus size={15} aria-hidden="true" />
                              </button>
                              <label className="min-w-0 flex-1">
                                <span className="sr-only">{t('creditNotes:returnQuantity')}</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  max={item.remaining_quantity}
                                  step={quantityStepForItem(item)}
                                  data-line-id={item.original_invoice_item_id}
                                  value={returnQuantities[item.original_invoice_item_id] ?? '0'}
                                  onChange={event => {
                                    const currentValue = returnQuantities[item.original_invoice_item_id] ?? '0'
                                    const next = normalizeQuantityInput(event.target.value, item, currentValue)
                                    setReturnQuantities(previous => ({
                                      ...previous,
                                      [item.original_invoice_item_id]: next,
                                    }))
                                    setError(null)
                                  }}
                                  disabled={disabled}
                                  aria-invalid={quantityInvalid}
                                  aria-describedby={`${quantityErrorId}-max${quantityInvalid ? ` ${quantityErrorId}` : ''}`}
                                  className="h-11 w-full border border-slate-200 bg-white px-2 text-center text-sm font-bold tabular-nums text-slate-900 outline-none focus:z-10 focus:border-[#1B6B3A] focus:ring-1 focus:ring-[#1B6B3A] disabled:bg-slate-100 disabled:text-slate-400"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => adjustQuantity(item, 1)}
                                disabled={disabled || line.quantity >= item.remaining_quantity}
                                className="inline-flex min-h-11 w-11 items-center justify-center rounded-e-xl border border-s-0 border-slate-200 bg-slate-50 text-slate-700 transition-[background-color,transform] duration-150 hover:bg-slate-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] active:scale-[0.97] disabled:cursor-not-allowed disabled:text-slate-300"
                                aria-label={t('creditNotes:increaseQuantity', { name: item.name })}
                              >
                                <Plus size={15} aria-hidden="true" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setReturnQuantities(previous => ({
                                  ...previous,
                                  [item.original_invoice_item_id]: fullReturnQuantity(item),
                                }))
                                setError(null)
                              }}
                              disabled={disabled || Math.abs(line.quantity - item.remaining_quantity) <= 1e-7}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#0F2419] bg-[#0F2419] px-3 text-[11px] font-bold text-[#FFF9E8] transition-[background-color,border-color,transform] duration-150 hover:bg-[#1a3a28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B5943E] focus-visible:ring-offset-2 active:scale-[0.97] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:ring-0"
                            >
                              <Check size={13} aria-hidden="true" />
                              {t('creditNotes:returnAll')}
                            </button>
                          </div>
                          <span id={`${quantityErrorId}-max`} className="sr-only">
                            {t('creditNotes:returnQuantityMaximum', {
                              quantity: qty(item.remaining_quantity, quantityDisplayScaleForItem(item)),
                            })}
                          </span>
                          {quantityInvalid && (
                            <p id={quantityErrorId} className="mt-2 text-[11px] font-medium text-red-600" role="alert">
                              {item.product_unit_id
                                ? t('creditNotes:packages.invalidFraction')
                                : t('creditNotes:invalidUnitFraction')}
                            </p>
                          )}
                          {item.remaining_quantity <= 0 && (
                            <p className="mt-2 text-[11px] font-medium text-slate-500">
                              {t('creditNotes:fullyCreditedItem')}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>

            </main>

            <aside className="min-w-0 bg-slate-50 px-4 py-4 sm:px-6 sm:py-5 lg:sticky lg:top-0 lg:self-start" aria-labelledby="credit-review-heading">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F2419] text-white">
                    <ReceiptText size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="credit-review-heading" className="text-sm font-black text-slate-950">{t('creditNotes:reviewTitle')}</h3>
                    <p className="text-[10px] text-slate-500">{t('creditNotes:sourceInvoice')} <bdi dir="ltr">{invoice.invoice_number}</bdi></p>
                  </div>
                </div>

                {selectedLines.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs leading-relaxed text-slate-500">
                    {t('creditNotes:summaryEmpty')}
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-semibold text-slate-500">{t('creditNotes:selectedItems')}</p>
                      <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{selectedLines.length}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-semibold text-slate-500">{t('creditNotes:selectedQuantity')}</p>
                      <p className="mt-1 text-lg font-black tabular-nums text-slate-900" dir="ltr">{qty(selectedQuantity)}</p>
                    </div>
                  </div>
                )}

                <dl className="mt-4 space-y-2 border-y border-slate-200 py-3 text-xs">
                  {[
                    [t('invoices:subtotal'), totals.subtotal],
                    ...(totals.discount > 0 ? [[t('invoices:discount'), totals.discount]] : []),
                    [t('invoices:vat'), totals.tax],
                  ].map(([label, amount]) => (
                    <div key={String(label)} className="flex items-center justify-between gap-4">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-bold tabular-nums text-slate-800" dir="ltr">SAR {money(Number(amount))}</dd>
                    </div>
                  ))}
                  <div className="flex items-end justify-between gap-4 pt-1">
                    <dt className="font-bold text-slate-900">{t('creditNotes:creditTotal')}</dt>
                    <dd className="text-xl font-black tracking-tight text-[#0F2419]" dir="ltr">SAR {money(totals.total)}</dd>
                  </div>
                </dl>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-bold text-slate-800">{t('creditNotes:stockImpact')}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {hasEligibleStockLines && stockReturnChoice === true
                        ? t('creditNotes:unitsReturned', { quantity: qty(stockReturnQuantity) })
                        : hasEligibleStockLines && stockReturnChoice === null
                        ? t('creditNotes:inventoryChoicePending')
                        : t('creditNotes:noStockMovement')}
                    </p>
                    {selectedNonStockCount > 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">
                        {t('creditNotes:nonStockSelectedCount', { count: selectedNonStockCount })}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[11px] font-bold text-slate-800">{t('creditNotes:refundAllocationTitle')}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                      {t('creditNotes:refundAllocationDisclosure')}
                    </p>
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                      {refundPlanText(originalPayments, paymentsLoading, t)}
                    </p>
                  </div>

                  <fieldset className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                    <legend className="px-1 text-[11px] font-bold text-emerald-900">{t('creditNotes:receivablesSettlementTitle')}</legend>
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-slate-700">
                      <input
                        type="checkbox"
                        checked={settleWithReceivables}
                        disabled={busy}
                        onChange={event => {
                          setSettleWithReceivables(event.target.checked)
                          setRefundMode('')
                          setRefundCash('')
                          setRefundCard('')
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      <span>{t('creditNotes:receivablesSettlementToggle')}</span>
                    </label>
                    {settleWithReceivables && <p className="mt-2 text-[10px] leading-relaxed text-emerald-900">{t('creditNotes:receivablesSettlementHint')}</p>}
                  </fieldset>

                  <fieldset ref={refundSectionRef} className="space-y-2">
                    <legend className="text-[11px] font-bold text-slate-800">{settleWithReceivables ? t('creditNotes:receivablesRefundTitle') : t('refunds:method')}</legend>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['cash', 'card', 'split'] as const).map(method => (
                        <button
                          key={method}
                          type="button"
                          role="radio"
                          aria-checked={refundMode === method}
                          disabled={busy || totals.total <= 0}
                          onClick={() => {
                            setRefundMode(method)
                            if (!settleWithReceivables && method === 'cash') { setRefundCash(totals.total.toFixed(2)); setRefundCard('') }
                            if (!settleWithReceivables && method === 'card') { setRefundCash(''); setRefundCard(totals.total.toFixed(2)) }
                            if (!settleWithReceivables && method === 'split') {
                              const cashPart = roundMoney(totals.total / 2)
                              setRefundCash(cashPart.toFixed(2))
                              setRefundCard(roundMoney(totals.total - cashPart).toFixed(2))
                            }
                          }}
                          className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2 text-[10px] font-bold transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B5943E] focus-visible:ring-offset-1 active:scale-[0.97] disabled:opacity-50 ${
                            refundMode === method
                              ? 'border-[#B5943E] bg-[#0F2419] text-[#FFF9E8]'
                              : 'border-slate-200 bg-[#FFFEFA] text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {refundMode === method && <Check size={11} aria-hidden="true" />}
                          {method === 'card'
                            ? t('creditNotes:nonCashRefund')
                            : t(`refunds:${method}`)}
                        </button>
                      ))}
                    </div>
                    {refundMode === 'card' && (
                      <p className="text-[10px] leading-relaxed text-slate-500">
                        {t('creditNotes:nonCashRefundHint')}
                      </p>
                    )}
                    {settleWithReceivables && refundMode !== '' && (
                      <p className="text-[10px] leading-relaxed text-amber-800">{t('creditNotes:receivablesRefundHint')}</p>
                    )}
                    {settleWithReceivables && (refundMode === 'cash' || refundMode === 'card') && (
                      <label className="block space-y-1">
                        <span className="text-[10px] font-medium text-slate-500">{refundMode === 'cash' ? t('refunds:cashAmount') : t('creditNotes:nonCashAmount')}</span>
                        <MoneyInput
                          value={refundMode === 'cash' ? refundCash : refundCard}
                          onValueChange={refundMode === 'cash' ? setRefundCash : setRefundCard}
                          className="input"
                          placeholder="0.00"
                        />
                      </label>
                    )}
                    {refundMode === 'split' && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-slate-500">{t('refunds:cashAmount')}</span>
                          <MoneyInput value={refundCash} onValueChange={setRefundCash} className="input" placeholder="0.00" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-medium text-slate-500">{t('creditNotes:nonCashAmount')}</span>
                          <MoneyInput value={refundCard} onValueChange={setRefundCard} className="input" placeholder="0.00" />
                        </label>
                      </div>
                    )}
                  </fieldset>

                  <div className="flex items-start gap-2 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-amber-800">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <p>{t('creditNotes:irreversible')}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-[#FBFAF5] p-3" aria-live="polite">
                  <p className="text-[11px] font-bold text-slate-800">{t('creditNotes:completionChecklist')}</p>
                  <ul className="mt-2 grid gap-1.5">
                    {completionChecks.map(check => (
                      <li key={check.key} className="flex items-center gap-2 text-[11px]">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                          check.complete ? 'bg-[#1B6B3A] text-white' : 'border border-amber-500 bg-amber-50 text-amber-700'
                        }`}>
                          {check.complete ? <Check size={10} aria-hidden="true" /> : <span aria-hidden="true">•</span>}
                        </span>
                        <span className={check.complete ? 'text-slate-600' : 'font-semibold text-amber-800'}>
                          {check.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {error && (
                  <div id={errorId} className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700" role="alert" aria-live="assertive">
                    {error}
                  </div>
                )}

                <div className="mt-4 hidden gap-2 lg:grid">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="order-2 min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition-[background-color,transform] duration-150 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 sm:order-1 lg:order-2"
                  >
                    {t('common:cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={createDisabled}
                    aria-describedby={error ? errorId : undefined}
                    title={
                      selectedLines.length === 0
                        ? t('creditNotes:enterQuantityFirst')
                        : stockReturnChoiceMissing
                        ? t('creditNotes:stockReturnChoiceRequired')
                        : undefined
                    }
                    className="order-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-4 text-xs font-bold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-[#1a3a28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2 lg:order-1"
                  >
                    {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                    {actionLabel}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {itemsLoading ? t('creditNotes:loadingItems') : busy ? actionLabel : ''}
        </span>
        <div className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] lg:hidden">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-500">{t('creditNotes:creditTotal')}</p>
            <p className="truncate text-base font-black tabular-nums text-[#0F2419]" dir="ltr">SAR {money(totals.total)}</p>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createDisabled}
            aria-describedby={error ? errorId : undefined}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-5 text-xs font-bold text-white transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A] focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
