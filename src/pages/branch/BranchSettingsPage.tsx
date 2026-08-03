import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, ExternalLink, Landmark, Loader2, Printer, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  loadBranchCustomerCreditSettings,
  notifyCustomerCreditPolicyChanged,
  saveBranchCustomerCreditSettings,
  type BranchCustomerCreditSettings,
} from '@/lib/customers/receivables'
import { Button } from '@/components/ui/Button'

type BranchOption = { id: string; name: string; name_ar: string | null; is_active: boolean }

export default function BranchSettingsPage() {
  const { t } = useTranslation('branches')
  const { profile, branch } = useAuth()
  const { branchId: routeBranchId } = useParams<{ branchId: string }>()
  const navigate = useNavigate()
  const isOwner = profile?.role === 'owner' || profile?.role === 'admin'
  const selectedBranchId = isOwner ? routeBranchId ?? '' : branch?.id ?? ''
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [settings, setSettings] = useState<BranchCustomerCreditSettings | null>(null)
  const [creditEnabled, setCreditEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isOwner || !profile?.tenant_id) return
    let cancelled = false
    void (async () => {
      const { data, error: loadError } = await supabase
        .from('branches')
        .select('id,name,name_ar,is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('name')
      if (cancelled) return
      if (loadError) {
        console.error('Unable to load branches for Branch Settings', loadError)
        setError(t('simpleSettings.loadFailed'))
        return
      }
      setBranches((data ?? []) as BranchOption[])
      if (!routeBranchId && data?.[0]?.id) navigate(`/settings/branches/${data[0].id}`, { replace: true })
    })()
    return () => { cancelled = true }
  }, [isOwner, profile?.tenant_id, routeBranchId, navigate, t])

  useEffect(() => {
    if (!selectedBranchId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadBranchCustomerCreditSettings(selectedBranchId)
      .then(result => {
        if (cancelled) return
        setSettings(result)
        setCreditEnabled(result.branchCreditEnabled)
      })
      .catch(loadError => {
        console.error('Unable to load Branch Settings', loadError)
        if (!cancelled) setError(t('simpleSettings.loadFailed'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedBranchId, t])

  const selectedBranch = useMemo(
    () => branches.find(option => option.id === selectedBranchId) ?? (branch?.id === selectedBranchId ? branch : null),
    [branch, branches, selectedBranchId],
  )

  async function save() {
    if (!selectedBranchId || saving || !settings) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = await saveBranchCustomerCreditSettings({ branchId: selectedBranchId, creditEnabled })
      setSettings(result)
      setCreditEnabled(result.branchCreditEnabled)
      setSaved(true)
      notifyCustomerCreditPolicyChanged()
    } catch (saveError) {
      console.error('Unable to save Branch Settings', saveError)
      setError(t('simpleSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="card flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-primary-500" size={22} /></div>
  }

  if (!selectedBranchId || !settings) {
    return <div className="card p-6 text-sm text-slate-600">{error ?? t('simpleSettings.noBranch')}</div>
  }

  const businessDisabled = !settings.tenantCreditEnabled

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{t('simpleSettings.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">{t('simpleSettings.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('simpleSettings.subtitle')}</p>
        </div>
        <Link to={isOwner ? '/branches' : '/branch'} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-900">
          <Building2 size={15} /> {t('simpleSettings.backToBranch')} <ExternalLink size={13} />
        </Link>
      </header>

      {isOwner && branches.length > 0 && (
        <label className="card flex max-w-xl items-center gap-3 p-4 text-sm font-semibold text-slate-800">
          <span className="shrink-0">{t('simpleSettings.chooseBranch')}</span>
          <select value={selectedBranchId} onChange={event => navigate(`/settings/branches/${event.target.value}`)} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal">
            {branches.map(option => <option key={option.id} value={option.id}>{option.name}{option.name_ar ? ` · ${option.name_ar}` : ''}</option>)}
          </select>
        </label>
      )}

      {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {saved && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={15} />{t('simpleSettings.saved')}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Building2 size={17} className="text-primary-600" />{t('simpleSettings.general')}</div>
          <p className="mt-1 text-sm text-slate-500">{t('simpleSettings.generalHelp')}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">{t('simpleSettings.branchName')}</dt><dd className="mt-1 font-semibold text-slate-900">{selectedBranch?.name ?? settings.branchName}</dd></div>
            <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">{t('simpleSettings.status')}</dt><dd className="mt-1 font-semibold text-emerald-700">{t('simpleSettings.active')}</dd></div>
          </dl>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Landmark size={17} className="text-primary-600" />{t('simpleSettings.pos')}</div>
          <p className="mt-1 text-sm text-slate-500">{t('simpleSettings.posHelp')}</p>
          <Link to={isOwner ? '/branches' : '/branch'} className="mt-4 inline-flex text-sm font-semibold text-primary-700 underline underline-offset-2">{t('simpleSettings.openBranchSetup')}</Link>
        </section>

        <section className="card p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Landmark size={17} className="text-primary-600" />{t('simpleSettings.customerCredit')}</div>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('simpleSettings.customerCreditHelp')}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${settings.branchCreditEnabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {settings.branchCreditEnabled ? t('simpleSettings.enabled') : t('simpleSettings.disabled')}
            </span>
          </div>
          {businessDisabled && <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900">{t('simpleSettings.businessOff')}</p>}
          {!businessDisabled && settings.inherited && <p className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm text-primary-900">{t('simpleSettings.inherited')}</p>}
          <label className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-800">
            <span>{t('simpleSettings.customerCreditLabel')}<span className="mt-0.5 block text-xs font-normal text-slate-500">{t('simpleSettings.customerCreditHelp')}</span></span>
            <input type="checkbox" checked={creditEnabled} disabled={businessDisabled} onChange={event => { setCreditEnabled(event.target.checked); setSaved(false) }} />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving || businessDisabled}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t('simpleSettings.save')}</Button>
            <Button variant="secondary" onClick={() => window.location.reload()} disabled={saving}><RefreshCw size={14} />{t('simpleSettings.reload')}</Button>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Printer size={17} className="text-primary-600" />{t('simpleSettings.printing')}</div>
          <p className="mt-1 text-sm text-slate-500">{t('simpleSettings.printingHelp')}</p>
          <Link to={isOwner ? '/branches' : '/invoice-settings'} className="mt-4 inline-flex text-sm font-semibold text-primary-700 underline underline-offset-2">{t('simpleSettings.openPrinting')}</Link>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck size={17} className="text-primary-600" />{t('simpleSettings.zatca')}</div>
          <p className="mt-1 text-sm text-slate-500">{t('simpleSettings.zatcaHelp')}</p>
          {isOwner && <Link to="/zatca" className="mt-4 inline-flex text-sm font-semibold text-primary-700 underline underline-offset-2">{t('simpleSettings.openZatca')}</Link>}
        </section>
      </div>
    </div>
  )
}
