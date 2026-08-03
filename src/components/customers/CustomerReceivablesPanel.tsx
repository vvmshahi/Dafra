import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, CreditCard, FileText, Landmark, Loader2, Plus, ReceiptText, RefreshCw, Trash2, Undo2, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import {
  clearPersistentReceivableOperation,
  createReceivableOperationId,
  getPersistentReceivableOperation,
  isCustomerCreditPolicyStorageChange,
  loadCustomerReceivableWorkspace,
  loadBranchCustomerCreditSettings,
  loadUnappliedCustomerPaymentReceipts,
  postCustomerReceivableAdjustment,
  reallocateCustomerPayment,
  recordCustomerPaymentReceipt,
  reverseCustomerPaymentReceipt,
  type CustomerReceivableWorkspace,
  type BranchCustomerCreditSettings,
  type ReceivableTender,
  type ReceivableTenderMethod,
  type UnappliedCustomerPaymentReceipt,
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

function dateLabel(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', { dateStyle: 'medium' })
    : '—'
}

export function CustomerReceivablesPanel({
  customerId,
  branchId,
  isOwner,
  canReversePayment,
  canAdjustReceivables,
}: {
  customerId: string
  branchId: string | null | undefined
  isOwner: boolean
  canReversePayment: boolean
  canAdjustReceivables: boolean
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
  const [splitTenders, setSplitTenders] = useState<Array<ReceivableTender>>([])
  const [manualAllocation, setManualAllocation] = useState(false)
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({})
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [operationId, setOperationId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string } | null>(null)
  const [branchCreditSettings, setBranchCreditSettings] = useState<BranchCustomerCreditSettings | null>(null)
  const [reversalOpen, setReversalOpen] = useState(false)
  const [reversalReason, setReversalReason] = useState('')
  const [reversing, setReversing] = useState(false)
  const [settlementOpen, setSettlementOpen] = useState(false)
  const [unappliedReceipts, setUnappliedReceipts] = useState<UnappliedCustomerPaymentReceipt[]>([])
  const [loadingReceipts, setLoadingReceipts] = useState(false)
  const [selectedUnappliedReceipt, setSelectedUnappliedReceipt] = useState<UnappliedCustomerPaymentReceipt | null>(null)
  const [reallocationAmounts, setReallocationAmounts] = useState<Record<string, string>>({})
  const [reallocating, setReallocating] = useState(false)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustmentDirection, setAdjustmentDirection] = useState<'debit' | 'credit'>('credit')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [adjustmentReference, setAdjustmentReference] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [result, branchSettings] = await Promise.all([
        loadCustomerReceivableWorkspace({ customerId, branchId: branchId ?? null }),
        branchId ? loadBranchCustomerCreditSettings(branchId) : Promise.resolve(null),
      ])
      setWorkspace(result)
      setBranchCreditSettings(branchSettings)
    } catch (loadError) {
      console.error('Unable to load customer receivables workspace', loadError)
      setError(t('errors.load'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [customerId, branchId])

  useEffect(() => {
    const refreshForPolicyChange = (event: Event) => {
      const changedCustomerId = (event as CustomEvent<{ customerId?: string | null }>).detail?.customerId
      if (!changedCustomerId || changedCustomerId === customerId) void refresh()
    }
    const refreshForStorageChange = (event: StorageEvent) => {
      if (isCustomerCreditPolicyStorageChange(event)) void refresh()
    }
    window.addEventListener('kubri:customer-credit-policy-changed', refreshForPolicyChange)
    window.addEventListener('storage', refreshForStorageChange)
    return () => {
      window.removeEventListener('kubri:customer-credit-policy-changed', refreshForPolicyChange)
      window.removeEventListener('storage', refreshForStorageChange)
    }
  }, [customerId, branchId, isOwner])

  const paymentAmount = Number(amount)
  const selectedTenders = useMemo<ReceivableTender[]>(() => splitTenders.length
    ? splitTenders.map(tender => ({ ...tender, amount: Number(tender.amount) }))
    : [{ method, amount: paymentAmount, reference: reference.trim() || null }], [splitTenders, method, paymentAmount, reference])
  const tenderTotal = selectedTenders.reduce((sum, tender) => sum + (Number.isFinite(tender.amount) ? tender.amount : 0), 0)
  const selectedAllocations = useMemo(() => workspace?.openInvoices
    .map(invoice => ({ invoiceId: invoice.id, amount: Number(allocationAmounts[invoice.id] ?? 0), outstanding: invoice.outstanding }))
    .filter(row => Number.isFinite(row.amount) && row.amount > 0) ?? [], [allocationAmounts, workspace?.openInvoices])
  const allocationTotal = selectedAllocations.reduce((sum, row) => sum + row.amount, 0)
  const validPayment = Number.isFinite(paymentAmount) && paymentAmount > 0 && Boolean(branchId)
    && Math.abs(tenderTotal - paymentAmount) < 0.01
    && (!manualAllocation || (selectedAllocations.length > 0 && allocationTotal <= paymentAmount + 0.01 && selectedAllocations.every(row => row.amount <= row.outstanding + 0.01)))
  async function submitPayment() {
    if (!validPayment || !branchId || submitting) return
    const stableOperationId = operationId ?? getPersistentReceivableOperation({
      branchId,
      customerId,
      kind: 'payment-receipt',
      fingerprint: JSON.stringify({ branchId, customerId, amount: paymentAmount, tenders: selectedTenders, reference: reference.trim() || null, notes: notes.trim() || null, manualAllocation, allocations: selectedAllocations }),
    })
    setOperationId(stableOperationId)
    setSubmitting(true)
    try {
      const result = await recordCustomerPaymentReceipt({
        operationId: stableOperationId,
        branchId,
        customerId,
        amount: paymentAmount,
        tenders: selectedTenders,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        autoAllocate: !manualAllocation,
        allocations: selectedAllocations.map(row => ({ invoiceId: row.invoiceId, amount: row.amount })),
      })
      setLastReceipt({ id: result.receiptId, number: result.receiptNumber })
      toast.success(t('payment.saved'))
      setAmount('')
      setReference('')
      setNotes('')
      setSplitTenders([])
      setManualAllocation(false)
      setAllocationAmounts({})
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

  function addSplitTender() {
    const used = new Set((splitTenders.length ? splitTenders : [{ method }]).map(tender => tender.method))
    const next = (['cash', 'card', 'bank_transfer', 'other'] as ReceivableTenderMethod[]).find(candidate => !used.has(candidate))
    if (!next) return
    setSplitTenders(current => [...(current.length ? current : [{ method, amount: paymentAmount || 0, reference: reference.trim() || null }]), { method: next, amount: 0, reference: null }])
  }

  function updateSplitTender(index: number, patch: Partial<ReceivableTender>) {
    setSplitTenders(current => current.map((tender, tenderIndex) => tenderIndex === index ? { ...tender, ...patch } : tender))
  }

  async function reverseLastReceipt() {
    if (!lastReceipt || !reversalReason.trim() || reversing) return
    setReversing(true)
    try {
      await reverseCustomerPaymentReceipt({ operationId: createReceivableOperationId(), receiptId: lastReceipt.id, reason: reversalReason.trim() })
      toast.success(t('payment.reversed'))
      setReversalOpen(false)
      setReversalReason('')
      await refresh()
    } catch (reverseError) {
      console.error('Unable to reverse customer payment receipt', reverseError)
      toast.error(t('errors.reversal'))
    } finally {
      setReversing(false)
    }
  }

  async function openSettlementControls() {
    if (!branchId || loadingReceipts) return
    setSettlementOpen(true)
    setLoadingReceipts(true)
    try {
      setUnappliedReceipts(await loadUnappliedCustomerPaymentReceipts({ customerId, branchId }))
    } catch (receiptError) {
      console.error('Unable to load unapplied customer receipts', receiptError)
      toast.error(t('errors.load'))
    } finally {
      setLoadingReceipts(false)
    }
  }

  const reallocationAdditions = useMemo(() => workspace?.openInvoices
    .map(invoice => ({ invoiceId: invoice.id, amount: Number(reallocationAmounts[invoice.id] ?? 0), outstanding: invoice.outstanding }))
    .filter(row => Number.isFinite(row.amount) && row.amount > 0) ?? [], [reallocationAmounts, workspace?.openInvoices])
  const reallocationRows = useMemo(() => {
    const amounts = new Map<string, number>()
    for (const allocation of selectedUnappliedReceipt?.allocations ?? []) amounts.set(allocation.invoiceId, allocation.amount)
    for (const allocation of reallocationAdditions) amounts.set(allocation.invoiceId, (amounts.get(allocation.invoiceId) ?? 0) + allocation.amount)
    return [...amounts].map(([invoiceId, amount]) => ({ invoiceId, amount }))
  }, [reallocationAdditions, selectedUnappliedReceipt])
  const reallocationTotal = reallocationAdditions.reduce((sum, row) => sum + row.amount, 0)
  const validReallocation = Boolean(selectedUnappliedReceipt) && reallocationAdditions.length > 0
    && reallocationTotal <= (selectedUnappliedReceipt?.unappliedAmount ?? 0) + 0.01
    && reallocationAdditions.every(row => row.amount <= row.outstanding + 0.01)

  async function applyPriorReceipt() {
    if (!branchId || !selectedUnappliedReceipt || !validReallocation || reallocating) return
    const fingerprint = JSON.stringify({ receiptId: selectedUnappliedReceipt.id, allocations: reallocationRows })
    const stableOperationId = getPersistentReceivableOperation({
      branchId,
      customerId,
      kind: 'payment-reallocation',
      fingerprint,
    })
    setReallocating(true)
    try {
      await reallocateCustomerPayment({
        operationId: stableOperationId,
        receiptId: selectedUnappliedReceipt.id,
        allocations: reallocationRows.map(row => ({ invoiceId: row.invoiceId, amount: row.amount })),
      })
      toast.success(t('settlement.applied'))
      clearPersistentReceivableOperation(branchId, customerId, 'payment-reallocation')
      setSelectedUnappliedReceipt(null)
      setReallocationAmounts({})
      setUnappliedReceipts(current => current.filter(receipt => receipt.id !== selectedUnappliedReceipt.id))
      await refresh()
    } catch (reallocationError) {
      console.error('Unable to apply prior customer receipt', reallocationError)
      toast.error(t('errors.reallocation'))
    } finally {
      setReallocating(false)
    }
  }

  const parsedAdjustmentAmount = Number(adjustmentAmount)
  const validAdjustment = Boolean(branchId) && Number.isFinite(parsedAdjustmentAmount) && parsedAdjustmentAmount > 0 && adjustmentReason.trim().length >= 3

  async function submitAdjustment() {
    if (!branchId || !validAdjustment || adjusting) return
    const fingerprint = JSON.stringify({ branchId, customerId, direction: adjustmentDirection, amount: parsedAdjustmentAmount, reason: adjustmentReason.trim(), reference: adjustmentReference.trim() || null })
    const stableOperationId = getPersistentReceivableOperation({ branchId, customerId, kind: 'receivable-adjustment', fingerprint })
    setAdjusting(true)
    try {
      await postCustomerReceivableAdjustment({
        operationId: stableOperationId,
        branchId,
        customerId,
        direction: adjustmentDirection,
        amount: parsedAdjustmentAmount,
        reason: adjustmentReason.trim(),
        reference: adjustmentReference.trim() || null,
      })
      toast.success(t('settlement.adjustmentSaved'))
      clearPersistentReceivableOperation(branchId, customerId, 'receivable-adjustment')
      setAdjustmentAmount('')
      setAdjustmentReason('')
      setAdjustmentReference('')
      setAdjustmentOpen(false)
      await refresh()
    } catch (adjustmentError) {
      console.error('Unable to post approved receivables adjustment', adjustmentError)
      toast.error(t('errors.adjustment'))
    } finally {
      setAdjusting(false)
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
    <section id="customer-credit-settings" className="space-y-4" aria-labelledby="customer-receivables-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{t('eyebrow')}</p>
          <h2 id="customer-receivables-heading" className="mt-1 text-xl font-bold text-slate-950">{t('title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{workspace.scope.ownerConsolidated ? t('consolidated') : t('branchScope')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-xs font-semibold text-primary-800 hover:bg-primary-100" to="/reports/receivables?tab=customers">{t('actions.openWorkspace')}</Link>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/print/customer-statement/${customerId}${branchId ? `?branch=${encodeURIComponent(branchId)}` : ''}`)}><FileText size={14} /> {t('actions.printStatement')}</Button>
          {canReversePayment && <Button variant="secondary" size="sm" disabled={!branchId} onClick={() => void openSettlementControls()}><CreditCard size={14} /> {t('actions.applyPriorCredit')}</Button>}
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
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('payment.receiptCreated', { number: lastReceipt.number })}</span>
            <div className="flex items-center gap-3"><Link className="font-semibold underline underline-offset-2" to={`/print/payment-receipt/${lastReceipt.id}`}>{t('actions.openReceipt')}</Link>{canReversePayment && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2" onClick={() => setReversalOpen(value => !value)}><Undo2 size={13} /> {t('payment.reverse')}</button>}</div>
          </div>
          {reversalOpen && <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-emerald-200 pt-3"><label className="min-w-[220px] flex-1 text-xs font-semibold">{t('payment.reversalReason')}<input value={reversalReason} onChange={event => setReversalReason(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-emerald-200 bg-white px-2 text-sm text-slate-900" /></label><Button size="sm" variant="danger" disabled={reversing || !reversalReason.trim()} onClick={() => void reverseLastReceipt()}>{reversing && <Loader2 size={14} className="animate-spin" />}{t('payment.reverse')}</Button></div>}
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
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={splitTenders.length > 0} onChange={event => { if (event.target.checked) setSplitTenders([{ method, amount: paymentAmount || 0, reference: reference.trim() || null }]); else setSplitTenders([]) }} /> {t('payment.splitTender')}</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={manualAllocation} onChange={event => setManualAllocation(event.target.checked)} /> {t('payment.manualAllocation')}</label>
            <span className={Math.abs(tenderTotal - paymentAmount) < 0.01 ? 'text-slate-500' : 'font-semibold text-amber-700'}>{t('payment.tenderTotal', { amount: tenderTotal.toFixed(2) })}</span>
          </div>
          {splitTenders.length > 0 && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-slate-800">{t('payment.tenders')}</p><Button size="sm" variant="secondary" disabled={splitTenders.length >= 4} onClick={addSplitTender}><Plus size={14} /> {t('payment.addTender')}</Button></div><div className="mt-3 space-y-2">{splitTenders.map((tender, index) => <div key={`${tender.method}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]"><select value={tender.method} onChange={event => updateSplitTender(index, { method: event.target.value as ReceivableTenderMethod })} className="h-9 rounded-lg border border-slate-200 px-2 text-sm"><option value="cash">{t('methods.cash')}</option><option value="card">{t('methods.card')}</option><option value="bank_transfer">{t('methods.bank')}</option><option value="other">{t('methods.other')}</option></select><input inputMode="decimal" value={tender.amount || ''} onChange={event => updateSplitTender(index, { amount: Number(event.target.value) || 0 })} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" placeholder="0.00" /><input value={tender.reference ?? ''} onChange={event => updateSplitTender(index, { reference: event.target.value || null })} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" placeholder={t('payment.reference')} />{splitTenders.length > 1 && <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-red-100 text-red-700" onClick={() => setSplitTenders(current => current.filter((_, tenderIndex) => tenderIndex !== index))} aria-label={t('payment.removeTender')}><Trash2 size={14} /></button>}</div>)}</div></div>}
          {manualAllocation && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-slate-800">{t('payment.manualAllocation')}</p><span className={allocationTotal <= paymentAmount + 0.01 ? 'text-xs text-slate-500' : 'text-xs font-semibold text-amber-700'}>{t('payment.allocationTotal', { amount: allocationTotal.toFixed(2) })}</span></div><div className="mt-3 divide-y divide-slate-100">{workspace.openInvoices.map(invoice => <label key={invoice.id} className="grid grid-cols-[1fr_120px] items-center gap-3 py-2 text-sm"><span><span className="font-semibold text-slate-900">{invoice.invoiceNumber}</span><span className="ms-2 text-xs text-slate-500">{t('payment.outstanding', { amount: invoice.outstanding.toFixed(2) })}</span></span><input inputMode="decimal" value={allocationAmounts[invoice.id] ?? ''} onChange={event => setAllocationAmounts(current => ({ ...current, [invoice.id]: event.target.value }))} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" placeholder="0.00" /></label>)}</div></div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!validPayment || submitting} onClick={() => void submitPayment()}>{submitting ? <Loader2 size={14} className="animate-spin" /> : <ReceiptText size={14} />}{t('payment.submit')}</Button>
            <Button size="sm" variant="secondary" disabled={submitting} onClick={() => { setPaymentOpen(false); setOperationId(null) }}>{t('actions.cancel')}</Button>
            <span className="text-xs text-slate-500">{manualAllocation ? t('payment.manualHint') : t('payment.autoAllocate')}</span>
          </div>
        </div>
      )}

      {settlementOpen && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm" aria-label={t('settlement.title')}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-slate-900">{t('settlement.title')}</p><p className="mt-1 text-xs text-slate-600">{t('settlement.hint')}</p></div><Button size="sm" variant="secondary" disabled={loadingReceipts} onClick={() => void openSettlementControls()}><RefreshCw size={14} className={loadingReceipts ? 'animate-spin' : ''} /> {t('actions.refresh')}</Button></div>
          {loadingReceipts ? <div className="grid place-items-center py-6"><Loader2 size={18} className="animate-spin text-primary-600" /></div> : unappliedReceipts.length === 0 ? <p className="mt-4 rounded-xl bg-white px-3 py-4 text-sm text-slate-600">{t('settlement.empty')}</p> : <div className="mt-4 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]"><div className="overflow-hidden rounded-xl border border-emerald-100 bg-white"><p className="border-b border-emerald-100 px-3 py-2 text-xs font-bold text-slate-700">{t('settlement.availableReceipts')}</p><div className="divide-y divide-slate-100">{unappliedReceipts.map(receipt => <button type="button" key={receipt.id} onClick={() => { setSelectedUnappliedReceipt(receipt); setReallocationAmounts({}) }} className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-start text-sm hover:bg-emerald-50 ${selectedUnappliedReceipt?.id === receipt.id ? 'bg-emerald-50' : ''}`}><span><span className="block font-semibold text-slate-900">{receipt.number}</span><span className="block text-xs text-slate-500">{dateLabel(receipt.receivedAt, locale)}</span></span><span className="font-bold tabular-nums text-emerald-800">{money(receipt.unappliedAmount)}</span></button>)}</div></div><div className="rounded-xl border border-emerald-100 bg-white p-3">{selectedUnappliedReceipt ? <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-slate-800">{t('settlement.allocateReceipt', { number: selectedUnappliedReceipt.number })}</p><span className={reallocationTotal <= selectedUnappliedReceipt.unappliedAmount + 0.01 ? 'text-xs text-slate-500' : 'text-xs font-semibold text-amber-700'}>{t('settlement.availableAmount', { amount: selectedUnappliedReceipt.unappliedAmount.toFixed(2) })}</span></div><div className="mt-3 divide-y divide-slate-100">{workspace.openInvoices.map(invoice => <label key={invoice.id} className="grid grid-cols-[1fr_120px] items-center gap-3 py-2 text-sm"><span><span className="font-semibold text-slate-900">{invoice.invoiceNumber}</span><span className="ms-2 text-xs text-slate-500">{t('payment.outstanding', { amount: invoice.outstanding.toFixed(2) })}</span></span><input inputMode="decimal" value={reallocationAmounts[invoice.id] ?? ''} onChange={event => setReallocationAmounts(current => ({ ...current, [invoice.id]: event.target.value }))} className="h-9 rounded-lg border border-slate-200 px-2 text-sm" placeholder="0.00" /></label>)}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" disabled={!validReallocation || reallocating} onClick={() => void applyPriorReceipt()}>{reallocating && <Loader2 size={14} className="animate-spin" />}{t('settlement.apply')}</Button><span className="text-xs text-slate-500">{t('settlement.allocationTotal', { amount: reallocationTotal.toFixed(2) })}</span></div></> : <p className="py-6 text-center text-sm text-slate-500">{t('settlement.selectReceipt')}</p>}</div></div>}
          {canAdjustReceivables && <details className="mt-4 border-t border-emerald-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-primary-700" onClick={() => setAdjustmentOpen(value => !value)}>{t('settlement.adjustment')}</summary>{adjustmentOpen && <div className="mt-3 grid gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3 sm:grid-cols-2"><p className="sm:col-span-2 text-xs text-amber-800">{t('settlement.adjustmentHint')}</p><label className="text-xs font-semibold text-slate-700">{t('settlement.direction')}<select value={adjustmentDirection} onChange={event => setAdjustmentDirection(event.target.value as 'debit' | 'credit')} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="credit">{t('settlement.credit')}</option><option value="debit">{t('settlement.debit')}</option></select></label><label className="text-xs font-semibold text-slate-700">{t('payment.amount')}<input inputMode="decimal" value={adjustmentAmount} onChange={event => setAdjustmentAmount(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" placeholder="0.00" /></label><label className="text-xs font-semibold text-slate-700">{t('settlement.reason')}<input value={adjustmentReason} onChange={event => setAdjustmentReason(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label><label className="text-xs font-semibold text-slate-700">{t('payment.reference')}<input value={adjustmentReference} onChange={event => setAdjustmentReference(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label><div className="sm:col-span-2"><Button size="sm" variant="secondary" disabled={!validAdjustment || adjusting} onClick={() => void submitAdjustment()}>{adjusting && <Loader2 size={14} className="animate-spin" />}{t('settlement.saveAdjustment')}</Button></div></div>}</details>}
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
          {!branchCreditSettings?.branchCreditEnabled && <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900"><p>{t('credit.branchDisabled')}</p><Link to={isOwner ? `/settings/branches/${branchId}?section=credit` : '/branch-settings?section=credit'} className="mt-2 inline-flex font-semibold text-primary-800 underline underline-offset-2">{t('credit.openBranchSettings')}</Link></div>}
          {branchCreditSettings?.branchCreditEnabled && <p className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">{t('credit.businessRule')}</p>}
        </article>
      </div>

      <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ReceiptText size={16} className="text-primary-600" /> {t('ledger.title')}</div><span className="text-xs text-slate-500">{t('ledger.opening', { amount: workspace.statement.openingBalance.toFixed(2) })}</span></div>
        {workspace.ledger.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">{t('ledger.empty')}</p> : <div className="divide-y divide-slate-100">{workspace.ledger.map(row => { const href = row.sourceKind === 'invoice' || row.sourceKind === 'credit_note' ? `/invoices/${row.sourceId}` : row.sourceKind === 'payment_receipt' ? `/print/payment-receipt/${row.sourceId}` : null; const content = <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 sm:grid-cols-[1fr_100px_100px_110px]"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{row.description}</p><p className="text-xs text-slate-500">{dateLabel(row.effectiveAt, locale)} · {row.branchId}</p></div><span className="hidden text-right text-sm tabular-nums text-slate-600 sm:block">{row.debit > 0 ? money(row.debit) : '—'}</span><span className="hidden text-right text-sm tabular-nums text-emerald-700 sm:block">{row.credit > 0 ? money(row.credit) : '—'}</span><span className="text-right text-sm font-semibold tabular-nums text-slate-900">{money(row.runningBalance)}</span></div>; return href ? <Link className="block hover:bg-slate-50" to={href} key={row.id}>{content}</Link> : <div key={row.id}>{content}</div> })}</div>}
      </article>
    </section>
  )
}
