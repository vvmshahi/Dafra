import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { PaymentMethod, ZatcaStatus } from '@/types/database'
import { submitInvoiceToZatca } from '@/lib/zatca/submission'
import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'

export interface CreditNoteSourceInvoice {
  id: string
  branch_id: string
  invoice_number: string
  total_amount: number
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
}

interface RpcCreditNoteResult {
  credit_note_invoice_id?: string
  credit_note_invoice_number?: string
  created_at?: string
  total?: number
  refund_status?: string
  zatca_status?: ZatcaStatus
  refund_method?: PaymentMethod
  idempotent_replay?: boolean
}

interface CreditNotePaymentRow {
  method: PaymentMethod
  amount: number
}

interface CreateCreditNoteModalProps {
  open: boolean
  invoice: CreditNoteSourceInvoice | null
  defaultRefundMethod?: PaymentMethod | null
  defaultReturnStock?: boolean
  onClose: () => void
  onCreated: (result: CreditNoteCreatedResult) => void
}

function safeCreditNoteError(error: unknown): string {
  const message = typeof (error as any)?.message === 'string' ? (error as any).message : ''
  if (/already.*credited/i.test(message)) return 'This invoice already has a full credit note.'
  if (/reported|cleared/i.test(message)) return 'Only reported or cleared invoices can be credited.'
  if (/posted/i.test(message)) return 'Only posted invoices can be credited.'
  if (/reason/i.test(message)) return 'A credit note reason is required.'
  if (/forbidden|unauthorized|permission/i.test(message)) return 'You do not have permission to create this credit note.'
  return 'Could not create the credit note. Please check the invoice status and try again.'
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

function paymentLabel(method: PaymentMethod | string | null | undefined): string {
  if (method === 'cash') return 'Cash'
  if (method === 'card') return 'Card / POS'
  if (method === 'bank_transfer') return 'Bank Transfer'
  return 'Other'
}

function money(amount: number): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function resolveAutoRefundMethod(payments: CreditNotePaymentRow[]): PaymentMethod {
  const methods = new Set(payments.filter(row => row.amount > 0).map(row => row.method))
  if (methods.size === 1) return [...methods][0]
  return 'other'
}

function refundPlanText(payments: CreditNotePaymentRow[], loading: boolean): string {
  if (loading) return 'Loading original payment details...'
  const usable = payments.filter(row => row.amount > 0)
  if (usable.length === 0) return 'Original payment details unavailable; refund recorded as Other.'
  if (usable.length === 1) return `Refund follows original payment: ${paymentLabel(usable[0].method)}.`
  return `Refund preserves original split: ${usable.map(row => `${paymentLabel(row.method)} SAR ${money(row.amount)}`).join(' · ')}.`
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
  defaultRefundMethod = 'cash',
  defaultReturnStock = false,
  onClose,
  onCreated,
}: CreateCreditNoteModalProps) {
  const { tenant } = useAuth()
  const [selectedReason, setSelectedReason] = useState<(typeof QUICK_REASONS)[number] | ''>('')
  const [remarks, setRemarks] = useState('')
  const [originalPayments, setOriginalPayments] = useState<CreditNotePaymentRow[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [returnStock, setReturnStock] = useState(false)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const businessType = resolveBusinessType(tenant?.business_type)
  const isServiceBusiness = businessType === 'service'

  useEffect(() => {
    if (!open || !invoice) return
    setSelectedReason('')
    setRemarks('')
    setOriginalPayments([])
    setPaymentsLoading(true)
    setReturnStock(isServiceBusiness ? false : defaultReturnStock)
    setError(null)
    setCreating(false)
    setSubmitting(false)
    setIdempotencyKey(newIdempotencyKey(invoice.id))

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

    return () => { cancelled = true }
  }, [open, invoice, defaultRefundMethod, defaultReturnStock, isServiceBusiness])

  if (!open || !invoice) return null

  async function handleCreate() {
    if (!invoice) return
    if (!selectedReason) {
      setError('Choose a reason for the credit note.')
      return
    }
    const trimmedRemarks = remarks.trim()
    const finalReason = trimmedRemarks ? `${selectedReason} - ${trimmedRemarks}` : selectedReason
    if (finalReason.length > 500) {
      setError('Remarks are too long.')
      return
    }

    setCreating(true)
    setSubmitting(false)
    setError(null)
    try {
      const payload = {
        original_invoice_id: invoice.id,
        idempotency_key: idempotencyKey || newIdempotencyKey(invoice.id),
        reason: finalReason,
        return_stock: isServiceBusiness ? false : returnStock,
      }
      const { data, error: rpcError } = await (supabase as any).rpc('create_full_credit_note', { p_payload: payload })
      if (rpcError) throw rpcError

      const result = data as RpcCreditNoteResult
      if (!result.credit_note_invoice_id || !result.credit_note_invoice_number) {
        throw new Error('Credit note was not returned')
      }

      const creditNoteId = result.credit_note_invoice_id
      let zatcaStatus = result.zatca_status ?? 'pending'
      let autoSubmitSucceeded = false
      const shouldAutoSubmit = zatcaStatus !== 'reported' && zatcaStatus !== 'cleared'

      if (shouldAutoSubmit) {
        setCreating(false)
        setSubmitting(true)
        try {
          autoSubmitSucceeded = await submitInvoiceToZatca(creditNoteId, invoice.branch_id)
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
        total: Number(result.total ?? invoice.total_amount),
        refundStatus: result.refund_status ?? 'completed',
        zatcaStatus,
        idempotentReplay: Boolean(result.idempotent_replay),
        reason: finalReason,
        refundMethod: result.refund_method ?? resolveAutoRefundMethod(originalPayments),
        autoSubmitSucceeded,
      })
      onClose()
      if (autoSubmitSucceeded || zatcaStatus === 'reported' || zatcaStatus === 'cleared') {
        toast.success(result.idempotent_replay ? 'Credit note already exists and is reported' : 'Credit note created and submitted to ZATCA')
      } else {
        toast.error('Credit note created, but ZATCA submission failed. You can retry from the credit note page.')
      }
    } catch (err) {
      const safeMessage = safeCreditNoteError(err)
      setError(safeMessage)
      toast.error(safeMessage)
    } finally {
      setCreating(false)
      setSubmitting(false)
    }
  }

  const busy = creating || submitting
  const actionLabel = submitting ? 'Submitting to ZATCA' : creating ? 'Creating Credit Note' : 'Create Credit Note'

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Create Full Credit Note</h2>
            <p className="text-xs text-gray-500">Original invoice {invoice.invoice_number}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            This creates a new credit note document for the full invoice amount. The original invoice remains unchanged.
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span className="font-semibold text-gray-900">{invoice.invoice_number}</span>
            <span className="mx-2 text-gray-300">·</span>
            <span>SAR {Number(invoice.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">Reason</span>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSelectedReason(reason)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    selectedReason === reason
                      ? 'border-[#0F2419] bg-[#0F2419] text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">Optional remarks</span>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={2}
              maxLength={430}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#0F2419]"
              placeholder="Add a short note if needed"
            />
          </label>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
            <p className="text-xs font-semibold text-emerald-800">Refund source</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700">
              {refundPlanText(originalPayments, paymentsLoading)}
            </p>
          </div>

          {isServiceBusiness ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-700">Stock is not returned for service credit notes</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                This credit note reduces sales and VAT, but does not increase stock.
              </p>
            </div>
          ) : (
            <label className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-2">
              <input
                type="checkbox"
                checked={returnStock}
                onChange={e => setReturnStock(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-xs font-semibold text-gray-700">Return tracked stock</span>
                <span className="block text-[11px] leading-relaxed text-gray-500">
                  Adds stock back only for products configured with stock tracking.
                </span>
              </span>
            </label>
          )}

          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            This will create a credit note and cannot be undone.
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
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
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
