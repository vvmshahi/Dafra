import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Landmark, Loader2, RefreshCw, Save, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  loadTenantCustomerCreditPolicy,
  notifyCustomerCreditPolicyChanged,
  saveTenantCustomerCreditPolicy,
  type TenantCustomerCreditPolicy,
} from '@/lib/customers/receivables'
import { Button } from '@/components/ui/Button'

type CreditPolicyDraft = Omit<TenantCustomerCreditPolicy, 'exists' | 'defaultCreditLimit' | 'warnThresholdPercent' | 'dueDateDays' | 'internalTerms'> & {
  defaultCreditLimit: string
  warnThresholdPercent: string
  dueDateDays: string
  internalTerms: string
}

const safeDraft = (policy: TenantCustomerCreditPolicy): CreditPolicyDraft => ({
  ...policy,
  defaultCreditLimit: String(policy.defaultCreditLimit),
  warnThresholdPercent: String(policy.warnThresholdPercent),
  dueDateDays: policy.dueDateDays ? String(policy.dueDateDays) : '',
  internalTerms: policy.internalTerms ?? '',
})

export default function CustomerCreditPolicySettings() {
  const { t } = useTranslation('settings')
  const [policy, setPolicy] = useState<TenantCustomerCreditPolicy | null>(null)
  const [draft, setDraft] = useState<CreditPolicyDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const result = await loadTenantCustomerCreditPolicy()
      setPolicy(result)
      setDraft(safeDraft(result))
    } catch (loadError) {
      console.error('Unable to load tenant customer-credit policy', loadError)
      setError(t('customerCredit.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  function update<K extends keyof CreditPolicyDraft>(key: K, value: CreditPolicyDraft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current)
    setSaved(false)
  }

  async function save() {
    if (!draft || saving) return
    const limit = Number(draft.defaultCreditLimit)
    const warning = Number(draft.warnThresholdPercent)
    const dueDays = draft.dueDateDays.trim() ? Number(draft.dueDateDays) : null
    if (!Number.isFinite(limit) || limit < 0 || !Number.isFinite(warning) || warning < 0 || warning > 100
      || (dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365))
      || draft.internalTerms.trim().length > 2000) {
      setError(t('customerCredit.invalid'))
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = await saveTenantCustomerCreditPolicy({
        creditEnabled: draft.creditEnabled,
        allowUnpaidInvoices: draft.allowUnpaidInvoices,
        allowPartialInitialPayments: draft.allowPartialInitialPayments,
        defaultCreditLimit: limit,
        hardLimitEnforced: draft.hardLimitEnforced,
        warnThresholdPercent: warning,
        enforceCustomerHold: draft.enforceCustomerHold,
        allowManagerOverride: draft.allowManagerOverride,
        defaultAllocationMode: draft.defaultAllocationMode,
        internalTerms: draft.internalTerms.trim() || null,
        dueDateDays: dueDays,
      })
      setPolicy(result)
      setDraft(safeDraft(result))
      setSaved(true)
      notifyCustomerCreditPolicyChanged()
    } catch (saveError) {
      console.error('Unable to save tenant customer-credit policy', saveError)
      setError(t('customerCredit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !draft || !policy) {
    return <div className="card flex min-h-48 items-center justify-center"><Loader2 className="animate-spin text-primary-500" size={20} /></div>
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="customer-credit-policy-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700"><Landmark size={18} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-primary-700">{t('customerCredit.eyebrow')}</p>
            <h2 id="customer-credit-policy-heading" className="mt-1 text-lg font-bold text-slate-950">{t('customerCredit.title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('customerCredit.description')}</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${policy.exists && policy.creditEnabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          {policy.exists ? (policy.creditEnabled ? t('customerCredit.statusEnabled') : t('customerCredit.statusDisabled')) : t('customerCredit.statusMissing')}
        </span>
      </div>

      {!policy.exists && <div className="mt-5 rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-primary-950"><p className="font-semibold">{t('customerCredit.setupTitle')}</p><p className="mt-1 text-primary-800">{t('customerCredit.setupBody')}</p></div>}

      {error && <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 shrink-0" size={15} />{error}</div>}
      {saved && <div role="status" className="mt-4 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={15} />{t('customerCredit.saved')}</div>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800">
          <span><span className="block">{t('customerCredit.enabled')}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{t('customerCredit.enabledHelp')}</span></span>
          <input type="checkbox" checked={draft.creditEnabled} onChange={event => update('creditEnabled', event.target.checked)} />
        </label>
        <label className="block text-sm font-semibold text-slate-800">{t('customerCredit.defaultLimit')}
          <input inputMode="decimal" value={draft.defaultCreditLimit} onChange={event => update('defaultCreditLimit', event.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" placeholder="0.00" />
          <span className="mt-1 block text-xs font-normal text-slate-500">{t('customerCredit.defaultLimitHelp')}</span>
        </label>
      </div>

      <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <summary className="cursor-pointer list-none text-sm font-bold text-slate-900"><span className="inline-flex items-center gap-2"><Settings2 size={15} className="text-primary-600" />{t('customerCredit.advanced')}</span></summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{t('customerCredit.allowUnpaid')}</span><input type="checkbox" checked={draft.allowUnpaidInvoices} onChange={event => update('allowUnpaidInvoices', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{t('customerCredit.allowPartial')}</span><input type="checkbox" checked={draft.allowPartialInitialPayments} onChange={event => update('allowPartialInitialPayments', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{t('customerCredit.hardLimit')}</span><input type="checkbox" checked={draft.hardLimitEnforced} onChange={event => update('hardLimitEnforced', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{t('customerCredit.enforceHold')}</span><input type="checkbox" checked={draft.enforceCustomerHold} onChange={event => update('enforceCustomerHold', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{t('customerCredit.managerOverride')}</span><input type="checkbox" checked={draft.allowManagerOverride} onChange={event => update('allowManagerOverride', event.target.checked)} /></label>
          <label className="block text-sm font-semibold text-slate-800">{t('customerCredit.warningThreshold')}
            <input inputMode="decimal" value={draft.warnThresholdPercent} onChange={event => update('warnThresholdPercent', event.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" />
          </label>
          <label className="block text-sm font-semibold text-slate-800">{t('customerCredit.allocation')}
            <select value={draft.defaultAllocationMode} onChange={event => update('defaultAllocationMode', event.target.value as 'oldest_first' | 'manual')} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"><option value="oldest_first">{t('customerCredit.oldestFirst')}</option><option value="manual">{t('customerCredit.manual')}</option></select>
          </label>
          <label className="block text-sm font-semibold text-slate-800">{t('customerCredit.dueDateDays')}
            <input inputMode="numeric" value={draft.dueDateDays} onChange={event => update('dueDateDays', event.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" placeholder={t('customerCredit.disabledByDefault')} />
          </label>
          <label className="block text-sm font-semibold text-slate-800 lg:col-span-2">{t('customerCredit.terms')}
            <textarea value={draft.internalTerms} onChange={event => update('internalTerms', event.target.value)} className="mt-1.5 block min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
        </div>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{policy.exists ? t('customerCredit.save') : t('customerCredit.setup')}</Button>
        <Button variant="secondary" onClick={() => void reload()} disabled={saving}><RefreshCw size={14} />{t('customerCredit.reload')}</Button>
      </div>
    </section>
  )
}
