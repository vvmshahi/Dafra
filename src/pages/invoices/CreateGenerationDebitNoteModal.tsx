import { useEffect, useState } from 'react'
import { AlertCircle, FileText, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { createGenerationDebitNote, type GenerationDebitNoteResult } from '@/lib/zatca/submission'
import { resolveDebitNoteEligibility } from '@/lib/fiscal/domain'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'

export interface GenerationDebitNoteSourceInvoice {
  id: string
  branch_id: string
  invoice_number: string
  total_amount: number
  fiscal_regime_at_issue?: 'generation' | 'integration' | null
  fiscal_lifecycle_state?: string | null
  current_branch_fiscal_regime?: 'generation' | 'integration' | null
  current_branch_policy_revision?: number | null
}

interface CreateGenerationDebitNoteModalProps {
  open: boolean
  invoice: GenerationDebitNoteSourceInvoice | null
  onClose: () => void
  onCreated: (result: GenerationDebitNoteResult) => void
}

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('GENERATION_DEBIT_LIMIT_EXCEEDED')) return 'A non-cancelled Debit Note already exists for this invoice.'
  if (message.includes('CROSS_REGIME_NOTE_NOT_ALLOWED')) return 'This Generation invoice cannot receive a note from an Integration branch.'
  if (message.includes('GENERATION_FINALIZATION_REQUIRED') || message.includes('GENERATION_VALIDATION_FAILED')) return 'Finalize the Generation invoice before creating a Debit Note.'
  if (message.includes('FISCAL_POLICY_CHANGED')) return 'The branch fiscal policy changed. Refresh the invoice and try again.'
  return fallback
}

export default function CreateGenerationDebitNoteModal({ open, invoice, onClose, onCreated }: CreateGenerationDebitNoteModalProps) {
  const { t } = useTranslation(['invoices', 'common'])
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open, invoice?.id])

  if (!open || !invoice) return null

  const eligibility = resolveDebitNoteEligibility({
    parentRegime: invoice.fiscal_regime_at_issue,
    parentLifecycle: invoice.fiscal_lifecycle_state,
    currentRegime: invoice.current_branch_fiscal_regime,
  })
  const canSubmit = eligibility.allowed && profile?.role && ['owner', 'branch'].includes(profile.role)

  async function submit() {
    const trimmedReason = reason.trim()
    if (!canSubmit || !invoice || trimmedReason.length < 3 || trimmedReason.length > 500 || invoice.current_branch_policy_revision == null) {
      setError(trimmedReason.length < 3 ? 'Enter a Debit Note reason.' : 'The Debit Note cannot be created from the current invoice state.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await createGenerationDebitNote({
        parentInvoiceId: invoice.id,
        branchId: invoice.branch_id,
        reason: trimmedReason,
        checkoutIdempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${invoice.id}-${Date.now()}`,
        expectedPolicyRevision: Number(invoice.current_branch_policy_revision),
      })
      toast.success(t('invoices:generationDebitCreated'))
      onCreated(result)
    } catch (caught) {
      setError(errorMessage(caught, t('invoices:generationDebitCreateFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="generation-debit-note-title" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#B5943E]">Generation</p>
            <h2 id="generation-debit-note-title" className="mt-1 text-lg font-black text-[#0F2419]">{t('invoices:createDebitNote')}</h2>
            <p className="mt-1 text-xs text-slate-500">{invoice.invoice_number} · <span dir="ltr">SAR {Number(invoice.total_amount).toFixed(2)}</span></p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('common:close')}><X size={18} /></button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-xl border border-[#B5943E]/35 bg-[#fffdf5] px-3 py-3 text-xs leading-relaxed text-slate-700">
            <p className="font-bold text-[#0F2419]">{t('invoices:generationDebitFullParentOnly')}</p>
            <p className="mt-1">{t('invoices:generationDebitAccountingDisclosure')}</p>
          </div>
          {!eligibility.allowed && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('invoices:generationDebitNotEligible')}</p>}
          <label className="block space-y-1.5">
            <span className="text-sm font-bold text-slate-900">{t('invoices:debitNoteReason')}</span>
            <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={busy} maxLength={500} rows={4} className="input w-full resize-y text-sm" placeholder={t('invoices:debitNoteReasonPlaceholder')} />
            <span className="block text-end text-[11px] text-slate-400">{reason.trim().length}/500</span>
          </label>
          {error && <p className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800" role="alert"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</p>}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">{t('common:cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !canSubmit} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-4 text-sm font-bold text-white hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            {busy ? t('common:loading') : t('invoices:createDebitNote')}
          </button>
        </div>
      </div>
    </div>
  )
}
