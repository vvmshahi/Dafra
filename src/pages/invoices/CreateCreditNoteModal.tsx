import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Minus,
  PackageCheck,
  PackageX,
  Plus,
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
import { isStockModuleVisible } from '@/lib/utils/businessType'
import { useLocale } from '@/localization/useLocale'

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

type CreditScope = '' | 'full' | 'selected'

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
  if (/session has expired|authenticated session is required/i.test(message)) return t('validation:sessionExpired')
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
  const [creditScope, setCreditScope] = useState<CreditScope>('')
  const [activeStep, setActiveStep] = useState(1)
  const [fullItemsExpanded, setFullItemsExpanded] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [cartFingerprint, setCartFingerprint] = useState('')
  const [modalInvoiceIdentity, setModalInvoiceIdentity] = useState<CreditNoteModalInvoiceIdentity | null>(null)
  const [refundMode, setRefundMode] = useState<'' | 'cash' | 'card' | 'split'>('')
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
  const dirtyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const stockEnabled = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  dirtyRef.current = creditScope !== ''
    || selectedReason !== ''
    || remarks !== ''
    || stockReturnChoice !== null
    || refundMode !== ''
    || Object.values(returnQuantities).some(value => parseReturnQuantity(value) > 0)

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
    setCreditScope('')
    setActiveStep(1)
    setFullItemsExpanded(false)
    setDiscardConfirmOpen(false)
    setPaymentsLoading(true)
    setItemsLoading(true)
    setError(null)
    setCreating(false)
    setSubmitting(false)
    setIdempotencyKey('')
    setCartFingerprint('')
    setModalInvoiceIdentity(null)
    setRefundMode('')
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
          if (dirtyRef.current) setDiscardConfirmOpen(true)
          else onCloseRef.current()
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
    const selectedQuantity = creditScope === 'full'
      ? Math.max(item.remaining_quantity, 0)
      : parseReturnQuantity(returnQuantities[item.original_invoice_item_id])
    return previewForItem(item, selectedQuantity)
  }), [creditScope, refundableItems, returnQuantities])

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
    .filter(line => line.item.product_id
      && line.item.stock_tracked_at_sale === true
      && line.item.service_item_at_sale !== true)
    .reduce((sum, line) => sum + (
      line.item.product_unit_id
        ? line.quantity * Number(line.item.conversion_to_base ?? 0)
        : line.quantity
    ), 0)
  const hasEligibleStockLines = stockEnabled && stockReturnQuantity > 0

  useEffect(() => {
    if (!hasEligibleStockLines) setStockReturnChoice(null)
  }, [hasEligibleStockLines])

  useEffect(() => {
    if (refundMode === 'cash') setRefundCash(totals.total.toFixed(2))
    if (refundMode === 'card') setRefundCard(totals.total.toFixed(2))
  }, [refundMode, totals.total])

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

    const lines = selectedLines

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

    if (!refundMode) {
      setError(t('creditNotes:refundMethodRequired'))
      refundSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      refundSectionRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }
    const cashRefund = refundMode === 'card' ? 0 : Number(refundCash || 0)
    const cardRefund = refundMode === 'cash' ? 0 : Number(refundCard || 0)
    const refundTotal = cashRefund + cardRefund
    if (cashRefund < 0 || cardRefund < 0 || refundTotal <= 0 || Math.abs(refundTotal - totals.total) > 0.01) {
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
      let atomicReceipt: AtomicReceiptPayload | undefined
      let result: RpcCreditNoteResult | null = null
      if (atomicSimplifiedCreditEligible) {
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
  const scopeComplete = creditScope === 'full'
    ? selectedLines.length > 0 && !hasInvalidQuantity
    : creditScope === 'selected' && selectedLines.length > 0 && !hasInvalidQuantity
  const completionChecks = [
    { key: 'scope', complete: scopeComplete, label: t('creditNotes:checkItems') },
    { key: 'reason', complete: Boolean(selectedReason), label: t('creditNotes:checkReason') },
    { key: 'inventory', complete: !hasEligibleStockLines || stockReturnChoice !== null, label: t('creditNotes:checkInventory') },
    { key: 'refund', complete: refundAllocationValid, label: t('creditNotes:checkRefund') },
  ]
  const createDisabled = busy || itemsLoading || completionChecks.some(check => !check.complete)
  const selectedQuantity = selectedLines.reduce((sum, line) => sum + line.quantity, 0)
  const selectedNonStockCount = selectedLines.filter(line => (
    line.item.service_item_at_sale === true || line.item.stock_tracked_at_sale !== true || !line.item.product_id
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

  const isDirty = creditScope !== ''
    || selectedReason !== ''
    || remarks !== ''
    || stockReturnChoice !== null
    || refundMode !== ''
    || Object.values(returnQuantities).some(value => parseReturnQuantity(value) > 0)
  const requestClose = () => {
    if (busy) return
    if (isDirty) setDiscardConfirmOpen(true)
    else onClose()
  }
  const stepComplete = [scopeComplete, Boolean(selectedReason), !hasEligibleStockLines || stockReturnChoice !== null, refundAllocationValid]
  const continueStep = () => {
    const requiredIndex = activeStep - 1
    if (!stepComplete[requiredIndex]) { setError(activeStep === 1 ? t('creditNotes:chooseScopePrompt') : activeStep === 2 ? t('validation:chooseCreditReason') : activeStep === 3 ? t('creditNotes:stockReturnChoiceRequired') : t('creditNotes:refundMethodRequired')); return }
    setError(null); setActiveStep(activeStep === 2 && !hasEligibleStockLines ? 4 : activeStep + 1)
  }
  const stepBack = () => setActiveStep(activeStep === 4 && !hasEligibleStockLines ? 2 : Math.max(1, activeStep - 1))
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" data-cart-fingerprint={cartFingerprint || undefined} onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1} className="flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-[#fffef9] shadow-2xl sm:max-h-[92vh] sm:max-w-4xl sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3.5 sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 id={titleId} className="text-base font-black tracking-tight text-slate-950 sm:text-lg">{t('creditNotes:create')}</h2><span className="rounded-md border border-[#B5943E]/55 bg-[#0F2419] px-2.5 py-1 text-[11px] font-black text-[#F3D98B]"><bdi dir="ltr">{invoice.invoice_number}</bdi></span></div><p id={descriptionId} className="mt-1 text-xs text-slate-500">{t('creditNotes:sequentialDescription')}</p></div><button ref={closeButtonRef} type="button" onClick={requestClose} disabled={busy} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50" aria-label={t('common:close')}><X size={18} /></button></header>
        <section data-testid="source-invoice-strip" className="shrink-0 border-b border-[#B5943E]/40 bg-[#0F2419] px-4 py-3 text-[#FFF9E8] sm:px-6"><p className="text-[10px] font-bold uppercase tracking-wider text-[#F3D98B]">{t('creditNotes:invoiceContext')}</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3"><div><dt className="text-[10px] text-white/55">{t('creditNotes:invoiceNumber')}</dt><dd className="text-xs font-bold"><bdi>{invoice.invoice_number}</bdi></dd></div><div><dt className="text-[10px] text-white/55">{t('invoices:date')}</dt><dd className="text-xs font-bold"><bdi>{invoiceDate(invoice.invoice_date, isRtl)}</bdi></dd></div><div><dt className="text-[10px] text-white/55">{t('invoices:customer')}</dt><dd className="truncate text-xs font-bold" dir="auto">{invoice.customer_name || t('creditNotes:walkInCustomer')}</dd></div><div><dt className="text-[10px] text-white/55">{t('creditNotes:originalTotal')}</dt><dd className="text-xs font-bold" dir="ltr">SAR {money(invoice.total_amount)}</dd></div><div><dt className="text-[10px] text-white/55">{t('creditNotes:remainingRefundableTotal')}</dt><dd className="text-xs font-bold" dir="ltr">SAR {money(remainingRefundableTotal)}</dd></div><div><dt className="text-[10px] text-white/55">{t('creditNotes:originalPayment')}</dt><dd className="truncate text-xs font-bold">{refundPlanText(originalPayments, paymentsLoading, t)}</dd></div></dl></section>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><main className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6"><ol className="mb-6 grid grid-cols-5 gap-1">{[t('creditNotes:scopeStep'), t('creditNotes:reasonStep'), t('creditNotes:inventoryStep'), t('creditNotes:refundStep'), t('creditNotes:reviewStep')].map((label, index) => { const step = index + 1; const unavailable = step === 3 && !hasEligibleStockLines; const complete = stepComplete[index]; return <li key={label}><button type="button" disabled={busy || unavailable} onClick={() => setActiveStep(step)} className={activeStep === step ? 'flex w-full flex-col items-center gap-1 rounded-lg bg-[#eaf1ec] px-1 py-1.5 text-[#0F2419]' : complete ? 'flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[#1B6B3A]' : 'flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-slate-400'}><span className={complete ? 'flex h-6 w-6 items-center justify-center rounded-full bg-[#1B6B3A] text-white' : activeStep === step ? 'flex h-6 w-6 items-center justify-center rounded-full bg-[#0F2419] text-[#F3D98B]' : 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-100'}>{complete ? <Check size={12} /> : step}</span><span className="hidden text-[10px] font-semibold sm:block">{unavailable ? t('creditNotes:skipped') : label}</span></button></li> })}</ol>
          {activeStep === 1 && <section ref={itemsSectionRef} className="space-y-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#1B6B3A]">{t('creditNotes:scopeStep')}</p><h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">{t('creditNotes:scopeTitle')}</h3><p className="mt-1 text-sm text-slate-500">{t('creditNotes:scopeHint')}</p></div><div className="grid gap-3 sm:grid-cols-2">{(['full', 'selected'] as const).map(scope => <button key={scope} type="button" role="radio" aria-checked={creditScope === scope} disabled={busy || itemsLoading} onClick={() => { setCreditScope(scope); setError(null) }} className={creditScope === scope ? 'min-h-28 rounded-2xl border border-[#B5943E] bg-[#0F2419] p-4 text-start text-[#FFF9E8]' : 'min-h-28 rounded-2xl border border-slate-200 bg-white p-4 text-start text-slate-900 hover:border-[#B5943E]/60'}><span className="block text-sm font-black">{scope === 'full' ? t('creditNotes:fullRemaining') : t('creditNotes:selectedItemsScope')}</span><span className={creditScope === scope ? 'mt-1 block text-xs text-white/70' : 'mt-1 block text-xs text-slate-500'}>{scope === 'full' ? t('creditNotes:fullRemainingHint') : t('creditNotes:selectedItemsHint')}</span></button>)}</div>
          {itemsLoading ? <div className="rounded-xl border border-slate-200 p-5 text-sm text-slate-500"><Loader2 className="mr-2 inline animate-spin" size={15} />{t('creditNotes:loadingItems')}</div> : creditScope === 'full' ? <div className="rounded-2xl border border-[#B5943E]/40 bg-[#fffdf5] p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black text-[#0F2419]">{t('creditNotes:fullRemaining')}</p><p className="mt-1 text-xs text-slate-600">{t('creditNotes:refundableLines', { count: selectedLines.length })} · {qty(selectedQuantity)}</p></div><p className="text-lg font-black text-[#0F2419]" dir="ltr">SAR {money(totals.total)}</p></div><button type="button" onClick={() => setFullItemsExpanded(value => !value)} className="mt-3 min-h-10 text-xs font-bold text-[#1B6B3A] underline underline-offset-4">{fullItemsExpanded ? t('creditNotes:hideItems') : t('creditNotes:viewItems', { count: selectedLines.length })}</button>{fullItemsExpanded && <div className="mt-2 divide-y divide-[#B5943E]/20 border-t border-[#B5943E]/20">{selectedLines.map(line => <div key={line.item.original_invoice_item_id} className="flex justify-between gap-3 py-2 text-xs"><span>{line.item.name} · {qty(line.quantity)} {line.item.unit}</span><bdi>SAR {money(line.total)}</bdi></div>)}</div>}</div> : creditScope === 'selected' ? <div className="space-y-2">{refundableItems.filter(item => item.remaining_quantity > 0).map(item => { const line = linePreviews.find(value => value.item.original_invoice_item_id === item.original_invoice_item_id)!; const stockEligible = item.product_id && item.stock_tracked_at_sale === true && item.service_item_at_sale !== true; return <article key={item.original_invoice_item_id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-sm font-bold text-slate-900" dir="auto">{isRtl && item.name_ar ? item.name_ar : item.name}</h4><p className="mt-1 text-[11px] text-slate-500">{t('creditNotes:originalQuantity', { quantity: qty(item.original_quantity), unit: item.unit ?? '' })} · {t('creditNotes:previouslyCreditedWithUnit', { quantity: qty(item.credited_quantity), unit: item.unit ?? '' })}</p><p className="text-[11px] font-semibold text-[#1B6B3A]">{t('creditNotes:remainingReturnableWithUnit', { quantity: qty(item.remaining_quantity), unit: item.unit ?? '' })}{stockEligible ? ' · ' + t('creditNotes:stockItem') : ''}</p></div><div className="shrink-0 text-end"><p className="text-[10px] text-slate-400">{t('creditNotes:expectedCredit')}</p><p className="font-black text-[#0F2419]" dir="ltr">SAR {money(line.total)}</p></div></div><div className="mt-3 flex items-center gap-2"><div className="flex flex-1" dir="ltr"><button type="button" onClick={() => adjustQuantity(item, -1)} disabled={busy || line.quantity <= 0} className="flex h-11 w-11 items-center justify-center rounded-s-xl border border-e-0 border-slate-200 bg-slate-50 disabled:opacity-40"><Minus size={15} /></button><input type="number" inputMode="decimal" min="0" max={item.remaining_quantity} step={quantityStepForItem(item)} data-line-id={item.original_invoice_item_id} value={returnQuantities[item.original_invoice_item_id] ?? '0'} onChange={event => { const current = returnQuantities[item.original_invoice_item_id] ?? '0'; setReturnQuantities(previous => ({ ...previous, [item.original_invoice_item_id]: normalizeQuantityInput(event.target.value, item, current) })); setError(null) }} disabled={busy} className="h-11 min-w-0 flex-1 border border-slate-200 px-2 text-center text-sm font-bold outline-none focus:border-[#1B6B3A]" /><button type="button" onClick={() => adjustQuantity(item, 1)} disabled={busy || line.quantity >= item.remaining_quantity} className="flex h-11 w-11 items-center justify-center rounded-e-xl border border-s-0 border-slate-200 bg-slate-50 disabled:opacity-40"><Plus size={15} /></button></div><button type="button" onClick={() => setReturnQuantities(previous => ({ ...previous, [item.original_invoice_item_id]: fullReturnQuantity(item) }))} className="h-11 rounded-xl border border-[#0F2419] px-3 text-[11px] font-bold text-[#0F2419]">{t('creditNotes:returnAll')}</button></div></article> })}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{t('creditNotes:chooseScopePrompt')}</div>}</section>}
          {activeStep === 2 && <section ref={reasonSectionRef} className="space-y-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#1B6B3A]">{t('creditNotes:reasonStep')}</p><h3 className="mt-1 text-xl font-black text-slate-950">{t('creditNotes:reasonStepTitle')}</h3></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">{QUICK_REASONS.map(reason => <button key={reason} type="button" role="radio" aria-checked={selectedReason === reason} onClick={() => { setSelectedReason(reason); setError(null) }} disabled={busy} className={selectedReason === reason ? 'min-h-12 rounded-xl border border-[#B5943E] bg-[#0F2419] px-3 text-xs font-bold text-[#FFF9E8]' : 'min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700'}>{reasonLabel(reason)}</button>)}</div><button type="button" onClick={() => setRemarksExpanded(value => !value)} className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-[#1B6B3A]"><ChevronDown className={remarksExpanded ? 'rotate-180' : ''} size={15} />{t('creditNotes:addEmployeeRemarks')}</button>{remarksExpanded && <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700">{t('creditNotes:additionalRemarks')}</span><textarea value={remarks} onChange={event => setRemarks(event.target.value)} maxLength={430} rows={4} disabled={busy} className="input resize-y" placeholder={t('creditNotes:additionalDetails')} /><span className="text-[10px] text-slate-500">{t('creditNotes:remarksFiscalHint')}</span></label>}</section>}
          {activeStep === 3 && hasEligibleStockLines && <section ref={inventorySectionRef} className="space-y-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#1B6B3A]">{t('creditNotes:inventoryStep')}</p><h3 className="mt-1 text-xl font-black text-slate-950">{t('creditNotes:inventoryTreatment')}</h3><p className="mt-1 text-sm text-slate-500">{t('creditNotes:stockReturnQuestionHint')}</p></div><div className="grid gap-3 sm:grid-cols-2" role="radiogroup">{([{ value: true, icon: PackageCheck, title: t('creditNotes:stockReturnYes'), description: t('creditNotes:stockReturnYesDescription') }, { value: false, icon: PackageX, title: t('creditNotes:stockReturnNo'), description: t('creditNotes:stockReturnNoDescription') }] as const).map(option => { const Icon = option.icon; return <button key={String(option.value)} type="button" role="radio" aria-checked={stockReturnChoice === option.value} onClick={() => { setStockReturnChoice(option.value); setError(null) }} disabled={busy} className={stockReturnChoice === option.value ? 'min-h-28 rounded-2xl border border-[#B5943E] bg-[#0F2419] p-4 text-start text-[#FFF9E8]' : 'min-h-28 rounded-2xl border border-slate-200 bg-white p-4 text-start text-slate-900'}><Icon size={19} /><span className="mt-3 block text-sm font-black">{option.title}</span><span className={stockReturnChoice === option.value ? 'mt-1 block text-xs text-white/70' : 'mt-1 block text-xs text-slate-500'}>{option.description}</span></button> })}</div></section>}
          {activeStep === 4 && <section ref={refundSectionRef} className="space-y-5"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#1B6B3A]">{t('creditNotes:refundStep')}</p><h3 className="mt-1 text-xl font-black text-slate-950">{t('creditNotes:refundStepTitle')}</h3></div><div className="rounded-2xl border border-[#B5943E]/35 bg-[#fffdf5] p-4"><p className="text-xs font-black text-[#0F2419]">{t('creditNotes:originalPayment')}</p><p className="mt-1 text-xs text-slate-600">{refundPlanText(originalPayments, paymentsLoading, t)}</p></div><fieldset className="space-y-3"><legend className="text-sm font-bold text-slate-900">{t('creditNotes:chooseRefundAllocation')}</legend><div className="grid grid-cols-3 gap-2">{(['cash', 'card', 'split'] as const).map(method => <button key={method} type="button" role="radio" aria-checked={refundMode === method} onClick={() => { setRefundMode(method); if (method === 'cash') { setRefundCash(totals.total.toFixed(2)); setRefundCard('') } else if (method === 'card') { setRefundCash(''); setRefundCard(totals.total.toFixed(2)) } else { const cashPart = roundMoney(totals.total / 2); setRefundCash(cashPart.toFixed(2)); setRefundCard(roundMoney(totals.total - cashPart).toFixed(2)) } }} disabled={busy || totals.total <= 0} className={refundMode === method ? 'min-h-11 rounded-xl border border-[#B5943E] bg-[#0F2419] px-2 text-xs font-bold text-[#FFF9E8]' : 'min-h-11 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700'}>{method === 'card' ? t('creditNotes:bankTransferRefund') : t('refunds:' + method)}</button>)}</div>{refundMode === 'split' && <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-[11px] text-slate-500">{t('refunds:cashAmount')}</span><MoneyInput value={refundCash} onValueChange={setRefundCash} className="input" placeholder="0.00" /></label><label className="space-y-1"><span className="text-[11px] text-slate-500">{t('creditNotes:bankTransferAmount')}</span><MoneyInput value={refundCard} onValueChange={setRefundCard} className="input" placeholder="0.00" /></label></div>}</fieldset><p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><AlertCircle className="shrink-0" size={15} />{t('creditNotes:refundAllocationDisclosure')}</p></section>}
          {activeStep === 5 && <section className="space-y-4"><div><p className="text-[10px] font-black uppercase tracking-wider text-[#1B6B3A]">{t('creditNotes:reviewStep')}</p><h3 className="mt-1 text-xl font-black text-slate-950">{t('creditNotes:reviewCreateTitle')}</h3></div><div className="rounded-2xl border border-[#0F2419] bg-[#0F2419] p-5 text-[#FFF9E8]"><div className="grid gap-5 sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[#F3D98B]">{t('creditNotes:financialSummary')}</p><dl className="mt-3 space-y-2 text-xs text-white/75"><div className="flex justify-between"><dt>{t('invoices:subtotal')}</dt><dd>SAR {money(totals.subtotal)}</dd></div><div className="flex justify-between"><dt>{t('invoices:vat')}</dt><dd>SAR {money(totals.tax)}</dd></div></dl><div className="mt-4 border-t border-white/15 pt-3"><p className="text-[10px] text-[#F3D98B]">{t('creditNotes:creditTotal')}</p><p className="text-3xl font-black" dir="ltr">SAR {money(totals.total)}</p></div></div><div className="space-y-3 text-xs"><p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:sourceInvoice')}</span>{invoice.invoice_number} · {invoiceDate(invoice.invoice_date, isRtl)}</p><p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:creditScope')}</span>{creditScope === 'full' ? t('creditNotes:fullRemaining') : t('creditNotes:selectedItems', { count: selectedLines.length })}</p><p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:inventoryTreatment')}</span>{hasEligibleStockLines && stockReturnChoice ? t('creditNotes:stockReturnYes') : t('creditNotes:noStockMovement')}</p><p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:refundAllocationTitle')}</span>{refundMode === 'split' ? t('refunds:split') : refundMode === 'card' ? t('creditNotes:bankTransferRefund') : t('refunds:cash')}</p><p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:reason')}</span>{selectedReason}</p>{remarks.trim() && <p><span className="block text-[10px] font-bold uppercase text-[#F3D98B]">{t('creditNotes:additionalRemarks')}</span>{remarks.trim()}</p>}</div></div></div><p className="flex gap-2 text-xs leading-relaxed text-amber-800"><AlertCircle className="shrink-0" size={15} />{t('creditNotes:irreversible')}</p></section>}
          {error && <div id={errorId} className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{error}</div>}</main></div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6"><button type="button" onClick={activeStep === 1 ? requestClose : stepBack} disabled={busy} className="min-h-11 rounded-xl px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{activeStep === 1 ? t('common:cancel') : t('common:back')}</button>{activeStep < 5 ? <button type="button" onClick={continueStep} disabled={busy || itemsLoading} className="min-h-11 rounded-xl bg-[#0F2419] px-5 text-xs font-bold text-white hover:bg-[#1a3a28] disabled:opacity-50">{t('common:continue')}</button> : <button type="button" onClick={handleCreate} disabled={createDisabled} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0F2419] px-5 text-xs font-bold text-white disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={14} />}{actionLabel}</button>}</footer>
        {discardConfirmOpen && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-base font-black text-slate-950">{t('creditNotes:discardTitle')}</h3><p className="mt-2 text-sm text-slate-600">{t('creditNotes:discardBody')}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDiscardConfirmOpen(false)} className="min-h-10 rounded-xl px-3 text-xs font-bold text-slate-700">{t('creditNotes:keepEditing')}</button><button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-red-600 px-3 text-xs font-bold text-white">{t('creditNotes:discardChanges')}</button></div></div></div>}
      </div>
    </div>
  )
}
