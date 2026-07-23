import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'
import { MoneyInput } from '@/components/ui/MoneyInput'
import type { PaymentMethod, ZatcaStatus } from '@/types/database'
import { isPermanentDemoSandboxBranch, submitInvoiceForBranch } from '@/lib/zatca/submission'
import {
  atomicCheckoutFingerprint,
  checkoutSimplifiedAtomically,
  clearPendingAtomicCheckout,
  persistPendingAtomicCheckout,
  readPendingAtomicCheckout,
  type AtomicReceiptPayload,
} from '@/lib/zatca/atomicCheckout'
import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useLocale } from '@/localization/useLocale'

export interface CreditNoteSourceInvoice {
  id: string
  branch_id: string
  invoice_number: string
  total_amount: number
  zatca_document_kind: 'simplified' | 'standard'
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

function safeCreditNoteError(error: unknown, t: TFunction): string {
  const message = typeof (error as any)?.message === 'string' ? (error as any).message : ''
  if (/select at least one|no items/i.test(message)) return t('validation:creditNoteChooseItem')
  if (/invalid returned quantity|quantity.*greater than zero/i.test(message)) return t('validation:returnQuantityPositive')
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

const QUICK_REASONS = [
  'Test sale',
  'Customer refund',
  'Cancelled order',
  'Billing mistake',
] as const

function paymentLabel(method: PaymentMethod | string | null | undefined, t: TFunction): string {
  if (method === 'cash') return t('payments:cash')
  if (method === 'card') return t('payments:cardPos')
  if (method === 'bank_transfer') return t('payments:bankTransfer')
  return t('payments:other')
}

function money(amount: number): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function qty(amount: number): string {
  return Number(amount).toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function quantityStep(item: RefundableItem): string {
  return Number.isInteger(item.original_quantity) ? '1' : '0.001'
}

function roundMoney(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100
}

function parseReturnQuantity(value: string | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatQuantityInput(amount: number): string {
  return String(Math.round(amount * 1000) / 1000)
}

function normalizeQuantityInput(value: string, item: RefundableItem): string {
  if (value.trim() === '') return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''
  if (parsed < 0) return '0'
  if (parsed > item.remaining_quantity) return formatQuantityInput(item.remaining_quantity)
  return value
}

function fullReturnQuantity(item: RefundableItem): string {
  return formatQuantityInput(Math.max(item.remaining_quantity, 0))
}

function amountForQuantity(
  originalAmount: number,
  remainingAmount: number,
  item: RefundableItem,
  returnQuantity: number,
): number {
  if (returnQuantity <= 0 || item.original_quantity <= 0) return 0
  if (Math.abs(returnQuantity - item.remaining_quantity) <= 0.0005) return roundMoney(remainingAmount)
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
  const { tenant, profile } = useAuth()
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
  const [refundMode, setRefundMode] = useState<'cash' | 'card' | 'split'>('cash')
  const [refundCash, setRefundCash] = useState('')
  const [refundCard, setRefundCard] = useState('')
  const [refundEdited, setRefundEdited] = useState(false)
  const businessType = resolveBusinessType(tenant?.business_type)
  const isServiceBusiness = businessType === 'service'

  useEffect(() => {
    if (!open || !invoice) return
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
    setIdempotencyKey(
      readPendingAtomicCheckout(invoice.branch_id, 'credit_note')?.idempotencyKey
        ?? newIdempotencyKey(invoice.id),
    )
    setRefundMode('cash')
    setRefundCash('')
    setRefundCard('')
    setRefundEdited(false)

    let cancelled = false

    ;(async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('payments')
          .select('method, amount')
          .eq('invoice_id', invoice.id)
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
          .rpc('get_invoice_refundable_items', { p_invoice_id: invoice.id })

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
  }, [open, invoice, isServiceBusiness])

  const linePreviews = useMemo(() => refundableItems.map(item => {
    const selectedQuantity = parseReturnQuantity(returnQuantities[item.original_invoice_item_id])
    return previewForItem(item, selectedQuantity)
  }), [refundableItems, returnQuantities])

  const selectedLines = linePreviews.filter(line => line.quantity > 0)
  const totals = selectedLines.reduce((acc, line) => ({
    subtotal: acc.subtotal + line.subtotal,
    discount: acc.discount + line.discount,
    tax: acc.tax + line.tax,
    total: acc.total + line.total,
  }), { subtotal: 0, discount: 0, tax: 0, total: 0 })
  const totalRemainingQuantity = refundableItems.reduce((sum, item) => sum + Math.max(item.remaining_quantity, 0), 0)
  const stockReturnQuantity = selectedLines
    .filter(line => line.item.track_stock && !line.item.is_service)
    .reduce((sum, line) => sum + line.quantity, 0)

  useEffect(() => {
    if (refundEdited || totals.total <= 0 || paymentsLoading) return
    const originalCash = originalPayments.filter(row => row.method === 'cash').reduce((sum, row) => sum + row.amount, 0)
    const originalCard = originalPayments.filter(row => row.method === 'card').reduce((sum, row) => sum + row.amount, 0)
    if (originalCash > 0 && originalCard > 0) {
      const originalTotal = originalCash + originalCard
      const cashDefault = roundMoney(totals.total * originalCash / originalTotal)
      setRefundMode('split')
      setRefundCash(cashDefault.toFixed(2))
      setRefundCard(roundMoney(totals.total - cashDefault).toFixed(2))
    } else if (originalCard > 0) {
      setRefundMode('card')
      setRefundCash('')
      setRefundCard(totals.total.toFixed(2))
    } else {
      setRefundMode('cash')
      setRefundCash(totals.total.toFixed(2))
      setRefundCard('')
    }
  }, [originalPayments, paymentsLoading, refundEdited, totals.total])

  if (!open || !invoice) return null

  async function handleCreate() {
    if (!invoice) return
    if (itemsLoading) return
    if (!selectedReason) {
      setError(t('validation:chooseCreditReason'))
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
      return
    }

    const invalidLine = lines.find(line => line.quantity > line.item.remaining_quantity + 0.0005)
    if (invalidLine) {
      setError(t('validation:returnQuantityNamedExceeded', { name: invalidLine.item.name }))
      return
    }

    const trimmedRemarks = remarks.trim()
    const finalReason = trimmedRemarks ? `${selectedReason} - ${trimmedRemarks}` : selectedReason
    if (finalReason.length > 500) {
      setError(t('validation:remarksTooLong'))
      return
    }

    const cashRefund = refundMode === 'card' ? 0 : Number(refundCash || 0)
    const cardRefund = refundMode === 'cash' ? 0 : Number(refundCard || 0)
    if (cashRefund < 0 || cardRefund < 0 || cashRefund + cardRefund <= 0 || Math.abs(cashRefund + cardRefund - totals.total) > 0.01) {
      setError(t('validation:refundAllocationMismatch'))
      return
    }
    const refundAllocations = [
      cashRefund > 0 ? { method: 'cash', amount: roundMoney(cashRefund) } : null,
      cardRefund > 0 ? { method: 'card', amount: roundMoney(cardRefund) } : null,
    ].filter(Boolean)

    setCreating(true)
    setSubmitting(false)
    setError(null)
    try {
      const payload = {
        original_invoice_id: invoice.id,
        idempotency_key: idempotencyKey || newIdempotencyKey(invoice.id),
        reason: finalReason,
        // The RPC applies this only to stock-tracked, non-service products and
        // scopes every movement to the original invoice branch.
        return_stock: !isServiceBusiness,
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
        const pending = readPendingAtomicCheckout(invoice.branch_id, 'credit_note')
        const atomicPayload = pending?.checkout ?? payload
        const fingerprint = await atomicCheckoutFingerprint(atomicPayload)
        if (pending && pending.cartFingerprint !== fingerprint) {
          throw new Error('Persisted credit-note fingerprint does not match its request payload')
        }
        persistPendingAtomicCheckout(invoice.branch_id, {
          idempotencyKey: String(atomicPayload.idempotency_key),
          cartFingerprint: fingerprint,
          documentType: 'credit_note',
          checkout: atomicPayload,
        })
        const atomic = await checkoutSimplifiedAtomically({
          branchId: invoice.branch_id,
          checkout: atomicPayload,
          cartFingerprint: fingerprint,
          documentType: 'credit_note',
        })
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
          )
        } else {
          clearPendingAtomicCheckout(
            invoice.branch_id,
            String(atomicPayload.idempotency_key),
            fingerprint,
            'credit_note',
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
      let autoSubmitSucceeded = usedAtomicSimplifiedCredit
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
            options: { source: 'auto_credit_note', retryDelayMs: 1500 },
          })
          autoSubmitSucceeded = routed.mode === 'sandbox_validation'
            ? routed.result.status === 'sandbox_validated' || routed.result.status === 'sandbox_validated_with_warnings'
            : routed.result.ok
        } catch {
          autoSubmitSucceeded = false
        } finally {
          const refreshedStatus = await fetchCreditNoteStatus(creditNoteId)
          zatcaStatus = refreshedStatus ?? zatcaStatus
        }
      }

      onCreated({
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
        originalInvoiceId: invoice.id,
        atomicReceipt,
      })
      onClose()
      if (autoSubmitSucceeded || zatcaStatus === 'reported' || zatcaStatus === 'cleared') {
        const demoSubmission = isPermanentDemoSandboxBranch(profile?.tenant_id, invoice.branch_id)
        toast.success(result.idempotent_replay ? t('creditNotes:alreadyExists') : t('creditNotes:createdSubmitted'), {
          description: demoSubmission ? t('creditNotes:processedByZatca') : undefined,
        })
      } else {
        toast.error(t('creditNotes:createdSubmissionFailed'))
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
  const actionLabel = submitting ? t('creditNotes:submitting') : creating ? t('creditNotes:creating') : t('creditNotes:createRefund')
  const createDisabled = busy || itemsLoading || selectedLines.length === 0
  const reasonLabel = (reason: (typeof QUICK_REASONS)[number]) => reason === 'Test sale'
    ? t('creditNotes:reasonTestSale')
    : reason === 'Customer refund'
    ? t('creditNotes:reasonCustomerRefund')
    : reason === 'Cancelled order'
    ? t('creditNotes:reasonCancelledOrder')
    : t('creditNotes:reasonBillingMistake')

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">{t('creditNotes:create')}</h2>
            <p className="text-xs text-gray-500">{t('creditNotes:returnFromInvoice', { number: invoice.invoice_number })}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('common:close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {t('creditNotes:unchangedNotice')}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span className="font-semibold text-gray-900">{invoice.invoice_number}</span>
            <span className="mx-2 text-gray-300">·</span>
            <span>{t('creditNotes:originalTotal')} <bdi dir="ltr">SAR {money(invoice.total_amount)}</bdi></span>
            <span className="mx-2 text-gray-300">·</span>
            <span>{t('creditNotes:remainingQuantity')} <bdi dir="ltr">{qty(totalRemainingQuantity)}</bdi></span>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-700">{t('creditNotes:reason')}</h3>
            <select value={selectedReason} onChange={event => setSelectedReason(event.target.value as (typeof QUICK_REASONS)[number] | '')} disabled={busy} className="input h-10 text-sm">
              <option value="">{t('creditNotes:chooseReason')}</option>
              {QUICK_REASONS.map(reason => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}
            </select>
            <textarea value={remarks} onChange={event => setRemarks(event.target.value)} rows={2} maxLength={430} className="input resize-none text-sm" placeholder={t('creditNotes:additionalDetails')} />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-gray-700">{t('creditNotes:returnedItems')}</h3>
              {selectedLines.length > 0 && (
                <span className="rounded-full bg-[#0F2419] px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t('creditNotes:selectedCount', { count: selectedLines.length })}
                </span>
              )}
            </div>

            {itemsLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                {t('creditNotes:loadingItems')}
              </div>
            ) : refundableItems.length === 0 || totalRemainingQuantity <= 0 ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-4 text-xs leading-relaxed text-gray-500">
                {t('creditNotes:noRemainingItems')}
              </div>
            ) : (
              <div className="space-y-2">
                {linePreviews.map(line => {
                  const item = line.item
                  const disabled = busy || item.remaining_quantity <= 0
                  const lineIncluded = line.quantity > 0
                  return (
                    <div
                      key={item.original_invoice_item_id}
                      className={`rounded-xl border px-3 py-3 ${
                        item.remaining_quantity <= 0
                          ? 'border-gray-100 bg-gray-50 opacity-70'
                          : lineIncluded
                          ? 'border-[#0F2419]/30 bg-[#F8FBF7]'
                          : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_130px_170px] md:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900" dir="auto">{isRtl && item.name_ar?.trim() ? item.name_ar : item.name}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                            <span>{t('creditNotes:originalQuantity', { quantity: qty(item.original_quantity), unit: item.unit ?? '' })}</span>
                            <span>{t('creditNotes:previouslyCredited', { quantity: qty(item.credited_quantity) })}</span>
                            <span className={item.remaining_quantity > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-gray-400'}>
                              {t('creditNotes:remainingReturnable', { quantity: qty(item.remaining_quantity) })}
                            </span>
                            {item.track_stock && !item.is_service && <span>{t('creditNotes:stockItem')}</span>}
                          </div>
                        </div>

                        <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                          lineIncluded
                            ? 'border-[#0F2419]/30 bg-white text-[#0F2419]'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-white'
                        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
                          <input
                            type="checkbox"
                            checked={lineIncluded}
                            onChange={event => {
                              setReturnQuantities(prev => ({
                                ...prev,
                                [item.original_invoice_item_id]: event.target.checked ? fullReturnQuantity(item) : '0',
                              }))
                            }}
                            disabled={disabled}
                            className="h-4 w-4 rounded border-gray-300 text-[#0F2419] focus:ring-[#0F2419]"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-bold">{t('creditNotes:returnAll')}</span>
                            <span className="block text-[10px] text-gray-500">{t('creditNotes:returnAllHint', { quantity: qty(item.remaining_quantity) })}</span>
                          </span>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('creditNotes:returnQuantity')}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={item.remaining_quantity}
                            step={quantityStep(item)}
                            value={returnQuantities[item.original_invoice_item_id] ?? '0'}
                            onChange={event => {
                              const next = normalizeQuantityInput(event.target.value, item)
                              setReturnQuantities(prev => ({
                                ...prev,
                                [item.original_invoice_item_id]: next,
                              }))
                            }}
                            disabled={disabled}
                            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm font-semibold tabular-nums outline-none focus:border-[#0F2419] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                          />
                        </label>

                        <div className="grid grid-cols-3 gap-2 text-end md:block md:space-y-1">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:subtotal')}</p>
                            <p className="text-xs font-semibold tabular-nums text-gray-700">SAR {money(line.subtotal)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:vat')}</p>
                            <p className="text-xs font-semibold tabular-nums text-amber-700">SAR {money(line.tax)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:total')}</p>
                            <p className="text-sm font-bold tabular-nums text-[#0F2419]">SAR {money(line.total)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold text-gray-800">{t('creditNotes:stockImpact')}</p>
            <p className="mt-0.5 text-[11px] text-gray-600">
              {stockReturnQuantity > 0
                ? t('creditNotes:unitsReturned', { quantity: qty(stockReturnQuantity) })
                : t('creditNotes:noStockMovement')}
            </p>
          </div>

          <div className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:subtotal')}</p>
              <p className="text-sm font-bold tabular-nums text-gray-800">SAR {money(totals.subtotal)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:discount')}</p>
              <p className="text-sm font-bold tabular-nums text-gray-800">SAR {money(totals.discount)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('invoices:vat')}</p>
              <p className="text-sm font-bold tabular-nums text-amber-700">SAR {money(totals.tax)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('creditNotes:creditTotal')}</p>
              <p className="text-base font-black tabular-nums text-[#0F2419]">SAR {money(totals.total)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
            <p className="text-xs font-semibold text-emerald-800">{t('refunds:originalPayment')}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700">
              {refundPlanText(originalPayments, paymentsLoading, t)}
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-gray-700">{t('refunds:method')}</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['cash', 'card', 'split'] as const).map(method => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={refundMode === method}
                  disabled={busy || totals.total <= 0}
                  onClick={() => {
                    setRefundEdited(true)
                    setRefundMode(method)
                    if (method === 'cash') { setRefundCash(totals.total.toFixed(2)); setRefundCard('') }
                    if (method === 'card') { setRefundCash(''); setRefundCard(totals.total.toFixed(2)) }
                    if (method === 'split') {
                      const cashPart = roundMoney(totals.total / 2)
                      setRefundCash(cashPart.toFixed(2))
                      setRefundCard(roundMoney(totals.total - cashPart).toFixed(2))
                    }
                  }}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${refundMode === method ? 'border-[#0F2419] bg-[#0F2419] text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {t(`refunds:${method}`)}
                </button>
              ))}
            </div>
            {refundMode === 'split' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-[11px] font-medium text-gray-600">{t('refunds:cashAmount')}</span><MoneyInput value={refundCash} onValueChange={value => { setRefundEdited(true); setRefundCash(value) }} className="input" placeholder="0.00" /></label>
                <label className="space-y-1"><span className="text-[11px] font-medium text-gray-600">{t('refunds:cardAmount')}</span><MoneyInput value={refundCard} onValueChange={value => { setRefundEdited(true); setRefundCard(value) }} className="input" placeholder="0.00" /></label>
              </div>
            )}
            <p className="text-[11px] text-gray-500">
              {t('refunds:allocated', { cash: money(refundMode === 'card' ? 0 : Number(refundCash || 0)), card: money(refundMode === 'cash' ? 0 : Number(refundCard || 0)) })}
            </p>
          </fieldset>

          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {t('creditNotes:irreversible')}
          </div>

          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createDisabled}
            title={selectedLines.length === 0 ? t('creditNotes:enterQuantityFirst') : undefined}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
