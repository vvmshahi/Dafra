import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Landmark, Loader2, RefreshCw, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  loadTenantCustomerCreditPolicy,
  notifyCustomerCreditPolicyChanged,
  saveTenantCustomerCreditPolicy,
  type TenantCustomerCreditPolicy,
} from '@/lib/customers/receivables'
import { Button } from '@/components/ui/Button'

export default function CustomerCreditPolicySettings() {
  const { t } = useTranslation('settings')
  const { profile } = useAuth()
  const [policy, setPolicy] = useState<TenantCustomerCreditPolicy | null>(null)
  const [creditEnabled, setCreditEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [firstBranchId, setFirstBranchId] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const result = await loadTenantCustomerCreditPolicy()
      setPolicy(result)
      setCreditEnabled(result.creditEnabled)
    } catch (loadError) {
      console.error('Unable to load tenant customer-credit policy', loadError)
      setError(t('customerCredit.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (!profile?.tenant_id) return
    void (supabase as any).from('branches').select('id').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('name').limit(1).maybeSingle()
      .then(({ data }: { data: { id?: string } | null }) => setFirstBranchId(data?.id ?? null))
  }, [profile?.tenant_id])

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = await saveTenantCustomerCreditPolicy({ creditEnabled })
      setPolicy(result)
      setCreditEnabled(result.creditEnabled)
      setSaved(true)
      notifyCustomerCreditPolicyChanged()
    } catch (saveError) {
      console.error('Unable to save tenant customer-credit policy', saveError)
      setError(t('customerCredit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !policy) {
    return <div className="card flex min-h-48 items-center justify-center"><Loader2 className="animate-spin text-primary-500" size={20} /></div>
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="customer-credit-policy-heading">
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 text-xs font-semibold text-slate-500 sm:px-6">{t('customerCredit.workspaceLabel')}</div>
      <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700"><Landmark size={18} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-primary-700">{t('customerCredit.eyebrow')}</p>
            <h2 id="customer-credit-policy-heading" className="mt-1 text-lg font-bold text-slate-950">{t('customerCredit.title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('customerCredit.description')}</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${policy.creditEnabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          {policy.creditEnabled ? t('customerCredit.statusEnabled') : t('customerCredit.statusDisabled')}
        </span>
      </div>

      {!policy.exists && <div className="mt-5 rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-primary-950"><p className="font-semibold">{t('customerCredit.setupTitle')}</p><p className="mt-1 text-primary-800">{t('customerCredit.setupBody')}</p></div>}
      {error && <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 shrink-0" size={15} />{error}</div>}
      {saved && <div role="status" className="mt-4 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={15} />{t('customerCredit.saved')}</div>}

      <label className="mt-5 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-800">
        <span><span className="block">{t('customerCredit.enabled')}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{t('customerCredit.enabledHelp')}</span></span>
        <input type="checkbox" checked={creditEnabled} onChange={event => { setCreditEnabled(event.target.checked); setSaved(false) }} />
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t('customerCredit.save')}</Button>
        <Button variant="secondary" onClick={() => void reload()} disabled={saving}><RefreshCw size={14} />{t('customerCredit.reload')}</Button>
        {firstBranchId && <Link to={`/settings/branches/${firstBranchId}?section=credit`} className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t('customerCredit.viewBranchSettings')}</Link>}
        <Link to="/reports/receivables" className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50">{t('customerCredit.openWorkspace')}</Link>
      </div>
      </div>
    </section>
  )
}
