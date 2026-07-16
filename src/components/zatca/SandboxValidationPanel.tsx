import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import {
  getSandboxValidationStatus,
  validateInvoiceInSandbox,
  type SandboxValidationMessage,
  type SandboxValidationResponse,
} from '@/lib/zatca/api'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'

function statusLabel(status: SandboxValidationResponse['status']): string {
  switch (status) {
    case 'sandbox_validated': return 'Submitted'
    case 'sandbox_validated_with_warnings': return 'Submitted with warnings'
    case 'sandbox_validation_pending': return 'Submission pending'
    case 'sandbox_validation_rejected': return 'ZATCA submission rejected'
    case 'sandbox_validation_failed': return 'ZATCA submission failed'
    default: return 'Not submitted'
  }
}

function safeMessage(item: SandboxValidationMessage): string {
  return [item.code, item.message].filter(Boolean).join(': ') || 'Validation message available.'
}

export function SandboxValidationPanel({
  invoiceId,
  tenantId,
  branchId,
  onResult,
}: {
  invoiceId: string
  tenantId: string
  branchId: string
  onResult?: (result: SandboxValidationResponse) => void
}) {
  const inDemoScope = isPermanentDemoSandboxBranch(tenantId, branchId)
  const [result, setResult] = useState<SandboxValidationResponse | null>(null)
  const [loading, setLoading] = useState(inDemoScope)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    if (!inDemoScope) return
    setLoading(true)
    setError(null)
    try {
      setResult(await getSandboxValidationStatus(invoiceId))
    } catch {
      setError('Unable to load ZATCA submission status.')
    } finally {
      setLoading(false)
    }
  }, [inDemoScope, invoiceId])

  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => { if (result) onResult?.(result) }, [result, onResult])

  if (!inDemoScope) return null

  const validate = async () => {
    if (submitting || result?.status === 'sandbox_validation_pending') return
    setSubmitting(true)
    setError(null)
    setResult(previous => previous ? { ...previous, status: 'sandbox_validation_pending' } : previous)
    try {
      setResult(await validateInvoiceInSandbox(invoiceId))
    } catch {
      await loadStatus()
      setError('ZATCA submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const pending = submitting || result?.status === 'sandbox_validation_pending'
  const succeeded = result?.status === 'sandbox_validated' || result?.status === 'sandbox_validated_with_warnings'
  const hasResult = !!result?.validationId

  return (
    <section className="no-print overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${succeeded ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-500'}`}>
            {pending ? <Loader2 size={17} className="animate-spin" /> : succeeded ? <CheckCircle2 size={17} /> : <ShieldCheck size={17} />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-gray-950">ZATCA E-Invoice</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${succeeded ? 'bg-emerald-50 text-emerald-700' : pending ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-500'}`}>
                {statusLabel(result?.status ?? null)}
              </span>
            </div>
            {succeeded && <p className="mt-1 text-xs font-medium text-gray-600">Successfully processed by ZATCA</p>}
          </div>
        </div>

        {!loading && (!hasResult || result?.retryAllowed) && (
          <button
            type="button"
            onClick={() => void validate()}
            disabled={!result?.eligible || pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#1a3a28] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {pending ? 'Submitting…' : result?.retryAllowed ? 'Retry submission' : 'Submit to ZATCA'}
          </button>
        )}
      </div>

      <div className="border-t border-gray-100 px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Loading submission status…
          </div>
        ) : succeeded ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-bold text-emerald-900">ZATCA submission successful</p>
              <p className="mt-0.5 text-xs text-emerald-700">Successfully processed by ZATCA</p>
            </div>
          </div>
        ) : result?.status && result.status !== 'sandbox_validation_pending' ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <AlertTriangle size={17} className="mt-0.5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-amber-900">{statusLabel(result.status)}</p>
              <p className="mt-0.5 text-xs text-amber-700">Review the submission messages below.</p>
            </div>
          </div>
        ) : pending ? (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 size={14} className="animate-spin" /> Submission is in progress. Repeat submission is disabled.
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {result?.eligible
              ? 'This invoice is ready to submit to ZATCA.'
              : 'This invoice is not eligible for ZATCA submission.'}
          </p>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}

        {!!result?.warnings.length && (
          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Warnings</p>
            {result.warnings.map((warning, index) => <p key={index} className="mt-1 text-xs text-amber-800">{safeMessage(warning)}</p>)}
          </div>
        )}
        {!!result?.errors.length && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50/60 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">Errors</p>
            {result.errors.map((item, index) => <p key={index} className="mt-1 text-xs text-red-800">{safeMessage(item)}</p>)}
          </div>
        )}

        <p className="mt-4 border-t border-gray-100 pt-3 text-[10px] text-gray-400">
          Demo environment — no production tax submission was made.
        </p>
      </div>
    </section>
  )
}
