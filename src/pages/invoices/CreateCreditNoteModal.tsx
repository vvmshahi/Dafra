import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { PaymentMethod, ZatcaStatus } from '@/types/database'

export interface CreditNoteSourceInvoice {
  id: string
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
}

interface RpcCreditNoteResult {
  credit_note_invoice_id?: string
  credit_note_invoice_number?: string
  created_at?: string
  total?: number
  refund_status?: string
  zatca_status?: ZatcaStatus
  idempotent_replay?: boolean
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

export default function CreateCreditNoteModal({
  open,
  invoice,
  defaultRefundMethod = 'cash',
  defaultReturnStock = false,
  onClose,
  onCreated,
}: CreateCreditNoteModalProps) {
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [returnStock, setReturnStock] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  useEffect(() => {
    if (!open || !invoice) return
    setReason('')
    setConfirm('')
    setRefundMethod(defaultRefundMethod ?? 'cash')
    setReturnStock(defaultReturnStock)
    setError(null)
    setCreating(false)
    setIdempotencyKey(newIdempotencyKey(invoice.id))
  }, [open, invoice, defaultRefundMethod, defaultReturnStock])

  if (!open || !invoice) return null

  async function handleCreate() {
    if (!invoice) return
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      setError('Enter a clear reason for the credit note.')
      return
    }
    if (confirm.trim() !== invoice.invoice_number) {
      setError('Type the original invoice number to confirm.')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const payload = {
        original_invoice_id: invoice.id,
        idempotency_key: idempotencyKey || newIdempotencyKey(invoice.id),
        reason: trimmedReason,
        refund_method: refundMethod,
        return_stock: returnStock,
      }
      const { data, error: rpcError } = await (supabase as any).rpc('create_full_credit_note', { p_payload: payload })
      if (rpcError) throw rpcError

      const result = data as RpcCreditNoteResult
      if (!result.credit_note_invoice_id || !result.credit_note_invoice_number) {
        throw new Error('Credit note was not returned')
      }

      onCreated({
        creditNoteId: result.credit_note_invoice_id,
        creditNoteNumber: result.credit_note_invoice_number,
        createdAt: result.created_at ?? new Date().toISOString(),
        total: Number(result.total ?? invoice.total_amount),
        refundStatus: result.refund_status ?? 'completed',
        zatcaStatus: result.zatca_status ?? 'pending',
        idempotentReplay: Boolean(result.idempotent_replay),
        reason: trimmedReason,
        refundMethod,
      })
      onClose()
      toast.success(result.idempotent_replay ? 'Credit note already exists' : 'Credit note created')
    } catch (err) {
      const safeMessage = safeCreditNoteError(err)
      setError(safeMessage)
      toast.error(safeMessage)
    } finally {
      setCreating(false)
    }
  }

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
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#0F2419]"
              placeholder="Returned goods, order cancelled, duplicate sale..."
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">Refund method</span>
            <select
              value={refundMethod}
              onChange={e => setRefundMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#0F2419]"
            >
              <option value="cash">Cash</option>
              <option value="card">Card / POS</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </label>

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

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">Type invoice number to confirm</span>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono outline-none transition-colors focus:border-[#0F2419]"
              placeholder={invoice.invoice_number}
            />
          </label>

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
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating && <Loader2 size={13} className="animate-spin" />}
            Create Credit Note
          </button>
        </div>
      </div>
    </div>
  )
}
