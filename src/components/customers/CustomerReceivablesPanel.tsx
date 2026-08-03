import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, CreditCard, FileText, Landmark, Loader2, ReceiptText, RefreshCw, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import {
  clearPersistentReceivableOperation,
  getPersistentReceivableOperation,
  loadCustomerReceivableWorkspace,
  recordCustomerPaymentReceipt,
  saveCustomerCreditPolicy,
  type CustomerReceivableWorkspace,
  type ReceivableTenderMethod,
} from '@/lib/customers/receivables'

function money(value: number) {
  return <Rial amount={value} />
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'amber' | 'emerald' }) {
  const color = tone === 'emerald'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
    : tone === 'amber'
      ? 'border-amber-100 bg-amber-50 text-amber-900'
      : 'border-slate-100 bg-slate-50 text-slate-900'
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${color}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-65">{label}</p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

function dateLabel(value: string, locale: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', { dateStyle: 'medium' })
}

export function CustomerReceivablesPanel({
  customerId,
  branchId,
  isOwner,
}: {
  customerId: string
  branchId: string | null | undefined
  isOwner: boolean
}) {
  const { t, i18n } = useTranslation('receivables')
  const navigate = useNavigate()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const [workspace, setWorkspace] = useState<CustomerReceivableWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<ReceivableTenderMethod>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [operationId, setOperationId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string } | null>(null)
  const [creditLimit, setCreditLimit] = useState('0')
  const [terms, setTerms] = useState('')
  const [creditEnabled, setCreditEnabled] = useState(false)
  const [hold, setHold] = useState(false)
  const [holdReason, setHoldReason] = useState('')
  const [overdueBlock, setOverdueBlock] = useState(false)
  const [warnThresholdPercent, setWarnThresholdPercent] = useState('80')
  const [savingPolicy, setSavingPolicy] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loadCustomerReceivableWorkspace({ customerId, branchId: branchId ?? null })
      setWorkspace(result)
      setCreditEnabled(result.policy?.creditEnabled ?? false)
      setCreditLimit(String(result.policy?.creditLimit ?? 0))
      setTerms(result.policy?.terms ?? '')
      setHold(result.policy?.hold ?? false)
      setHoldReason(result.policy?.holdReason ?? '')
      setOverdueBlock(result.policy?.overdueBlock ?? false)
      setWarnThresholdPercent(String(result.policy?.warnThresholdPercent ?? 80))
    } catch (loadError) {
      console.error('Unable to load customer receivables workspace', loadError)
      setError(t('errors.load'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [customerId, branchId])

  const paymentAmount = Number(amount)
  const validPayment = Number.isFinite(paymentAmount) && paymentAmount > 0 && Boolean(branchId)
  const availableCredit = useMemo(() => {
    if (!workspace?.policy) return null
    return Math.max(0, workspace.policy.creditLimit - Math.max(workspace.summary.balance, 0))
  }, [workspace])

  async function submitPayment() {
    if (!validPayment || !branchId || submitting) return
    const stableOperationId = operationId ?? getPersistentReceivableOperation({
      branchId,
      customerId,
      kind: 'payment-receipt',
      fingerprint: JSON.stringify({ branchId, customerId, amount: paymentAmount, method, reference: reference.trim() || null, notes: notes.trim() || null }),
    })
    setOperationId(stableOperationId)
    setSubmitting(true)
    try {
      const result = await recordCustomerPaymentReceipt({
        operationId: stableOperationId,
        branchId,
        customerId,
        amount: paymentAmount,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        autoAllocate: true,
      })
      setLastReceipt({ id: result.receiptId, number: result.receiptNumber })
      toast.success(t('payment.saved'))
      setAmount('')
      setReference('')
      setNotes('')
      setOperationId(null)
      setPaymentOpen(false)
      clearPersistentReceivableOperation(branchId, customerId, 'payment-receipt')
      await refresh()
    } catch (submitError) {
      console.error('Unable to record customer payment', submitError)
      toast.error(t('errors.payment'))
    } finally {
      setSubmitting(false)
    }
  }

  async function savePolicy() {
    const limit = Number(creditLimit)
    const threshold = Number(warnThresholdPercent)
    if (!isOwner || savingPolicy || !Number.isFinite(limit) || limit < 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      if (isOwner && Number.isFinite(threshold) && (threshold < 0 || threshold > 100)) toast.error(t('errors.threshold'))
      return
    }
    if (hold && !holdReason.trim()) {
      toast.error(t('errors.holdReason'))
      return
    }
    setSavingPolicy(true)
    try {
      await saveCustomerCreditPolicy({
        customerId,
        creditEnabled,
        creditLimit: limit,
        terms: terms.trim() || null,
        hold,
        holdReason: holdReason.trim() || null,
        overdueBlock,
        warnThresholdPercent: threshold,
        requiresOwnerApproval: false,
      })
      toast.success(t('credit.saved'))
      await refresh()
    } catch (saveError) {
      console.error('Unable to save customer credit policy', saveError)
      toast.error(t('errors.credit'))
    } finally {
      setSavingPolicy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white py-10"><Loader2 className="animate-spin text-primary-500" size={20} /></div>
  }
  if (error || !workspace) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
        <div className="flex items-center gap-2"><AlertCircle size={16} /> {error ?? t('errors.load')}</div>
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => void refresh()}><RefreshCw size={14} /> {t('actions.retry')}</Button>
      </div>
    )
  }

  return (
    <section className="space-y-4" aria-labelledby="customer-receivables-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{t('eyebrow')}</p>
          <h2 id="customer-receivables-heading" className="mt-1 text-xl font-bold text-slate-950">{t('title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{workspace.scope.ownerConsolidated ? t('consolidated') : t('branchScope')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/print/customer-statement/${customerId}${branchId ? `?branch=${encodeURIComponent(branchId)}` : ''}`)}><FileText size={14} /> {t('actions.printStatement')}</Button>
          <Button size="sm" disabled={!branchId} onClick={() => { setLastReceipt(null); setPaymentOpen(value => !value) }}><ReceiptText size={14} /> {t('actions.receivePayment')}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t('metrics.balance')} value={money(workspace.summary.balance)} tone={workspace.summary.balance > 0 ? 'amber' : 'emerald'} />
        <Metric label={t('metrics.totalInvoiced')} value={money(workspace.summary.totalInvoiced)} />
        <Metric label={t('metrics.totalCollected')} value={money(workspace.summary.totalCollected)} tone="emerald" />
        <Metric label={t('metrics.unpaid')} value={money(workspace.summary.unpaidAmount)} tone={workspace.summary.unpaidAmount > 0 ? 'amber' : 'slate'} />
        <Metric label={t('metrics.partial')} value={money(workspace.summary.partialAmount)} />
        <Metric label={t('metrics.openInvoices')} value={workspace.summary.openInvoiceCount} />
        <Metric label={t('metrics.unappliedCredit')} value={money(workspace.summary.unappliedReceipts)} tone="emerald" />
        <Metric label={t('metrics.overdue')} value={money(workspace.aging.overdue)} tone={workspace.aging.overdue > 0 ? 'amber' : 'slate'} />
      </div>

      {lastReceipt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <span>{t('payment.receiptCreated', { number: lastReceipt.number })}</span>
          <Link className="font-semibold underline underline-offset-2" to={`/print/payment-receipt/${lastReceipt.id}`}>{t('actions.openReceipt')}</Link>
        </div>
      )}

      {paymentOpen && (
        <div className="rounded-2xl border border-primary-100 bg-primary-50/40 p-4 shadow-sm" aria-label={t('payment.title')}>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><WalletCards size={16} className="text-primary-600" /> {t('payment.title')}</div>
          <p className="mt-1 text-xs text-slate-500">{t('payment.hint')}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-slate-700">{t('payment.amount')}
              <input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" placeholder="0.00" />
            </label>
            <label className="text-xs font-semibold text-slate-700">{t('payment.method')}
              <select value={method} onChange={event => setMethod(event.target.value as ReceivableTenderMethod)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <option value="cash">{t('methods.cash')}</option><option value="card">{t('methods.card')}</option><option value="bank_transfer">{t('methods.bank')}</option><option value="other">{t('methods.other')}</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">{t('payment.reference')}
              <input value={reference} onChange={event => setReference(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-700">{t('payment.notes')}
              <input value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!validPayment || submitting} onClick={() => void submitPayment()}>{submitting ? <Loader2 size={14} className="animate-spin" /> : <ReceiptText size={14} />}{t('payment.submit')}</Button>
            <Button size="sm" variant="secondary" disabled={submitting} onClick={() => { setPaymentOpen(false); setOperationId(null) }}>{t('actions.cancel')}</Button>
            <span className="text-xs text-slate-500">{t('payment.autoAllocate')}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Landmark size={16} className="text-primary-600" /> {t('openInvoices.title')}</div>
            <span className="text-xs text-slate-500">{t('openInvoices.count', { count: workspace.openInvoices.length })}</span>
          </div>
          {workspace.openInvoices.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">{t('openInvoices.empty')}</p> : (
            <div className="divide-y divide-slate-100">
              {workspace.openInvoices.map(invoice => (
                <Link to={`/invoices/${invoice.id}`} key={invoice.id} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                  <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{invoice.invoiceNumber}</span><span className="block text-xs text-slate-500">{dateLabel(invoice.invoiceDate, locale)}{invoice.dueDate ? ` · ${t('openInvoices.due', { date: dateLabel(invoice.dueDate, locale) })}` : ''}</span></span>
                  <span className="text-right"><span className="block text-sm font-bold tabular-nums text-slate-900">{money(invoice.outstanding)}</span>{invoice.isOverdue && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('openInvoices.overdue')}</span>}</span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><CreditCard size={16} className="text-primary-600" /> {t('credit.title')}</div>
          {workspace.policy ? <>
            <div className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><span className="text-slate-500">{t('credit.limit')}</span><span className="font-semibold tabular-nums">{money(workspace.policy.creditLimit)}</span></div><div className="flex justify-between gap-3"><span className="text-slate-500">{t('credit.available')}</span><span className="font-semibold tabular-nums">{money(availableCredit ?? 0)}</span></div></div>
            {workspace.policy.hold && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-800">{workspace.policy.holdReason || t('credit.hold')}</p>}
          </> : <p className="mt-3 text-sm text-slate-500">{t('credit.notConfigured')}</p>}
          {isOwner && <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-primary-700">{t('credit.settings')}</summary><div className="mt-3 space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={creditEnabled} onChange={event => setCreditEnabled(event.target.checked)} /> {t('credit.enabled')}</label><label className="block text-xs font-semibold text-slate-700">{t('credit.limit')}<input inputMode="decimal" value={creditLimit} onChange={event => setCreditLimit(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label><label className="block text-xs font-semibold text-slate-700">{t('credit.terms')}<textarea value={terms} onChange={event => setTerms(event.target.value)} className="mt-1 block min-h-16 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" /></label><label className="block text-xs font-semibold text-slate-700">{t('credit.warnThreshold')}<input inputMode="decimal" value={warnThresholdPercent} onChange={event => setWarnThresholdPercent(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdueBlock} onChange={event => setOverdueBlock(event.target.checked)} /> {t('credit.overdueBlock')}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={event => setHold(event.target.checked)} /> {t('credit.hold')}</label>{hold && <input value={holdReason} onChange={event => setHoldReason(event.target.value)} className="block h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" placeholder={t('credit.holdReason')} />}<Button size="sm" disabled={savingPolicy} onClick={() => void savePolicy()}>{savingPolicy && <Loader2 size={14} className="animate-spin" />}{t('credit.save')}</Button></div></details>}
        </article>
      </div>

      <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ReceiptText size={16} className="text-primary-600" /> {t('ledger.title')}</div><span className="text-xs text-slate-500">{t('ledger.opening', { amount: workspace.statement.openingBalance.toFixed(2) })}</span></div>
        {workspace.ledger.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">{t('ledger.empty')}</p> : <div className="divide-y divide-slate-100">{workspace.ledger.map(row => { const href = row.sourceKind === 'invoice' || row.sourceKind === 'credit_note' ? `/invoices/${row.sourceId}` : row.sourceKind === 'payment_receipt' ? `/print/payment-receipt/${row.sourceId}` : null; const content = <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 sm:grid-cols-[1fr_100px_100px_110px]"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{row.description}</p><p className="text-xs text-slate-500">{dateLabel(row.effectiveAt, locale)} · {row.branchId}</p></div><span className="hidden text-right text-sm tabular-nums text-slate-600 sm:block">{row.debit > 0 ? money(row.debit) : '—'}</span><span className="hidden text-right text-sm tabular-nums text-emerald-700 sm:block">{row.credit > 0 ? money(row.credit) : '—'}</span><span className="text-right text-sm font-semibold tabular-nums text-slate-900">{money(row.runningBalance)}</span></div>; return href ? <Link className="block hover:bg-slate-50" to={href} key={row.id}>{content}</Link> : <div key={row.id}>{content}</div> })}</div>}
      </article>
    </section>
  )
}
