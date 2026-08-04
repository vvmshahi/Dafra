import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Building2, CheckCircle2, ChevronLeft, CreditCard, ExternalLink,
  FileText, Landmark, Loader2, Printer, RefreshCw, Save, Settings2, ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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

type SectionId = 'general' | 'pos' | 'credit' | 'printing' | 'zatca'
type BranchOption = { id: string; name: string; name_ar: string | null; is_active: boolean }
type BranchRecord = BranchOption & {
  branch_code: string | null
  phone: string | null
  email: string | null
  website: string | null
  building_number: string | null
  street: string | null
  district: string | null
  city: string | null
  country: string | null
  postal_code: string | null
  allow_split_payments: boolean | null
  show_pos_scroll_buttons: boolean | null
  pos_mode: 'touch' | 'quick' | null
}

const sections: Array<{ id: SectionId; icon: React.ElementType }> = [
  { id: 'general', icon: Building2 },
  { id: 'pos', icon: Settings2 },
  { id: 'credit', icon: CreditCard },
  { id: 'printing', icon: Printer },
  { id: 'zatca', icon: ShieldCheck },
]

const branchSelect = 'id,name,name_ar,is_active,branch_code,phone,email,website,building_number,street,district,city,country,postal_code,allow_split_payments,show_pos_scroll_buttons,pos_mode'

function StatusChip({ enabled, enabledLabel, disabledLabel }: { enabled: boolean; enabledLabel: string; disabledLabel: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
    {enabled ? enabledLabel : disabledLabel}
  </span>
}

function InfoRow({ label, value, dir = 'auto' }: { label: string; value: string; dir?: 'auto' | 'ltr' | 'rtl' }) {
  return <div className="flex min-w-0 items-start justify-between gap-5 border-b border-slate-100 py-3 last:border-0">
    <dt className="shrink-0 text-xs font-semibold text-slate-500">{label}</dt>
    <dd className="min-w-0 truncate text-end text-sm font-semibold text-slate-900" dir={dir}>{value || '—'}</dd>
  </div>
}

function ToggleRow({ label, help, checked, disabled = false, onChange }: { label: string; help: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`flex min-h-14 items-center justify-between gap-4 rounded-xl border px-3.5 py-3 transition-colors ${disabled ? 'border-slate-100 bg-slate-50/80 opacity-70' : 'border-slate-200 bg-white hover:border-primary-200'}`}>
    <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{help}</span></span>
    <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary-700" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </label>
}

export default function BranchSettingsPage() {
  const { t } = useTranslation('branches')
  const { profile, branch: authBranch } = useAuth()
  const { branchId: routeBranchId } = useParams<{ branchId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isOwner = profile?.role === 'owner' || profile?.role === 'admin'
  const sectionParam = searchParams.get('section') as SectionId | null
  const activeSection: SectionId = sections.some(item => item.id === sectionParam) ? sectionParam as SectionId : 'general'
  const selectedBranchId = isOwner ? routeBranchId ?? '' : authBranch?.id ?? profile?.branch_id ?? ''

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [selectedBranch, setSelectedBranch] = useState<BranchRecord | null>(null)
  const [creditSettings, setCreditSettings] = useState<BranchCustomerCreditSettings | null>(null)
  const [creditEnabled, setCreditEnabled] = useState(false)
  const [posDraft, setPosDraft] = useState({ allowSplit: false, showArrows: false, mode: 'touch' as 'touch' | 'quick' })
  const [posSaved, setPosSaved] = useState({ allowSplit: false, showArrows: false, mode: 'touch' as 'touch' | 'quick' })
  const [loading, setLoading] = useState(true)
  const [savingCredit, setSavingCredit] = useState(false)
  const [savingPos, setSavingPos] = useState(false)
  const [saved, setSaved] = useState<SectionId | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!searchParams.get('section')) {
      const next = new URLSearchParams(searchParams)
      next.set('section', 'general')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!isOwner || !profile?.tenant_id) return
    let cancelled = false
    void (async () => {
      const { data, error: loadError } = await (supabase as any)
        .from('branches')
        .select('id,name,name_ar,is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('name')
      if (cancelled) return
      if (loadError) {
        setError(t('workspace.loadFailed'))
        return
      }
      const list = (data ?? []) as BranchOption[]
      setBranches(list)
      if (!routeBranchId && list[0]?.id) navigate(`/settings/branches/${list[0].id}?section=${activeSection}`, { replace: true })
    })()
    return () => { cancelled = true }
  }, [activeSection, isOwner, navigate, profile?.tenant_id, routeBranchId, t])

  useEffect(() => {
    if (!selectedBranchId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([
      (supabase as any).from('branches').select(branchSelect).eq('id', selectedBranchId).maybeSingle(),
      loadBranchCustomerCreditSettings(selectedBranchId),
    ]).then(([branchResult, credit]) => {
      if (cancelled) return
      if (branchResult.error || !branchResult.data) throw branchResult.error ?? new Error('Branch not found')
      const row = branchResult.data as BranchRecord
      const nextPos = { allowSplit: row.allow_split_payments === true, showArrows: row.show_pos_scroll_buttons === true, mode: row.pos_mode === 'quick' ? 'quick' as const : 'touch' as const }
      setSelectedBranch(row)
      setCreditSettings(credit)
      setCreditEnabled(credit.branchCreditEnabled)
      setPosDraft(nextPos)
      setPosSaved(nextPos)
    }).catch(loadError => {
      console.error('Unable to load Branch Settings', loadError)
      if (!cancelled) setError(t('workspace.loadFailed'))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedBranchId, t])

  useEffect(() => {
    const dirty = JSON.stringify(posDraft) !== JSON.stringify(posSaved) || creditEnabled !== creditSettings?.branchCreditEnabled
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [creditEnabled, creditSettings?.branchCreditEnabled, posDraft, posSaved])

  const selectedOption = useMemo(() => branches.find(item => item.id === selectedBranchId) ?? authBranch, [authBranch, branches, selectedBranchId])
  const posDirty = JSON.stringify(posDraft) !== JSON.stringify(posSaved)
  const creditDirty = creditSettings ? creditEnabled !== creditSettings.branchCreditEnabled : false

  function selectSection(nextSection: SectionId) {
    const next = new URLSearchParams(searchParams)
    next.set('section', nextSection)
    setSearchParams(next)
    setSaved(null)
  }

  async function savePos() {
    if (!selectedBranchId || savingPos || !posDirty) return
    setSavingPos(true); setError(null); setSaved(null)
    try {
      await (supabase as any).rpc('update_branch_pos_settings', {
        p_branch_id: selectedBranchId,
        p_payload: {
          allow_split_payments: posDraft.allowSplit,
          show_pos_scroll_buttons: posDraft.showArrows,
          pos_mode: posDraft.mode,
        },
      })
      setPosSaved(posDraft)
      setSelectedBranch(current => current ? { ...current, allow_split_payments: posDraft.allowSplit, show_pos_scroll_buttons: posDraft.showArrows, pos_mode: posDraft.mode } : current)
      setSaved('pos')
    } catch (saveError) {
      console.error('Unable to save Branch POS settings', saveError)
      setError(t('workspace.posSaveFailed'))
    } finally { setSavingPos(false) }
  }

  async function saveCredit() {
    if (!selectedBranchId || !creditSettings || savingCredit || !creditDirty) return
    setSavingCredit(true); setError(null); setSaved(null)
    try {
      const result = await saveBranchCustomerCreditSettings({ branchId: selectedBranchId, creditEnabled })
      setCreditSettings(result)
      setCreditEnabled(result.branchCreditEnabled)
      setSaved('credit')
      notifyCustomerCreditPolicyChanged()
    } catch (saveError) {
      console.error('Unable to save Branch customer credit settings', saveError)
      setError(t('workspace.creditSaveFailed'))
    } finally { setSavingCredit(false) }
  }

  const printingPath = isOwner ? `/settings/branches/${selectedBranchId}/printing?tab=receipts` : '/invoice-settings?tab=receipts'
  const branchName = selectedOption?.name ?? selectedBranch?.name ?? creditSettings?.branchName ?? ''
  const address = [selectedBranch?.building_number, selectedBranch?.street, selectedBranch?.district, selectedBranch?.city, selectedBranch?.postal_code].filter(Boolean).join(', ')

  if (loading) return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-100 bg-white"><Loader2 className="animate-spin text-primary-600" size={22} /></div>
  if (!selectedBranchId || !selectedBranch || !creditSettings) return <div className="rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-600">{error ?? t('workspace.noBranch')}</div>

  return <div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary-700"><Building2 size={14} /> {t('workspace.eyebrow')}</div>
        <h1 className="mt-1 truncate text-2xl font-black tracking-tight text-slate-950">{t('workspace.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('workspace.subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="font-semibold text-slate-800">{branchName}</span><span aria-hidden="true">·</span><span>{selectedBranch.branch_code || selectedBranch.id.slice(0, 8)}</span><StatusChip enabled={selectedBranch.is_active} enabledLabel={t('workspace.active')} disabledLabel={t('workspace.inactive')} /></div>
      </div>
      <Link to={isOwner ? '/dashboard' : '/branch'} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><ArrowLeft size={15} />{t('workspace.backToDashboard')}</Link>
    </header>

    {isOwner && branches.length > 0 && <label className="flex max-w-xl flex-wrap items-center gap-3 text-sm font-semibold text-slate-800"><span>{t('workspace.chooseBranch')}</span><select value={selectedBranchId} onChange={event => navigate(`/settings/branches/${event.target.value}?section=${activeSection}`)} className="h-10 min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">{branches.map(option => <option key={option.id} value={option.id}>{option.name}{option.name_ar ? ` · ${option.name_ar}` : ''}</option>)}</select></label>}

    {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-800">{error}</div>}
    {saved && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"><CheckCircle2 size={15} />{t('workspace.saved')}</div>}

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/70 p-2" role="tablist" aria-label={t('workspace.title')}>
        {sections.map(item => { const Icon = item.icon; const selected = activeSection === item.id; return <button key={item.id} id={`branch-settings-tab-${item.id}`} type="button" role="tab" aria-selected={selected} aria-controls={`branch-settings-panel-${item.id}`} tabIndex={selected ? 0 : -1} onClick={() => selectSection(item.id)} className={`flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold outline-none transition-[background-color,color,box-shadow,transform] active:scale-[.98] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${selected ? 'bg-[#173d2a] text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}><Icon size={14} className={selected ? 'text-emerald-200' : 'text-slate-400'} /><span>{t(`workspace.sections.${item.id}`)}</span></button> })}
      </nav>

      <main id={`branch-settings-panel-${activeSection}`} role="tabpanel" aria-labelledby={`branch-settings-tab-${activeSection}`} className="p-4 sm:p-6">
        {activeSection === 'general' && <section aria-labelledby="branch-general-heading" className="max-w-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('workspace.sections.general')}</p><h2 id="branch-general-heading" className="mt-1 text-lg font-bold text-slate-950">{t('workspace.generalTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t('workspace.generalHelp')}</p></div><Building2 className="hidden text-primary-200 sm:block" size={30} /></div><dl className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-100 px-4"><InfoRow label={t('workspace.branchName')} value={selectedBranch.name} /><InfoRow label={t('workspace.branchNameAr')} value={selectedBranch.name_ar ?? ''} dir="rtl" /><InfoRow label={t('workspace.branchCode')} value={selectedBranch.branch_code ?? ''} dir="ltr" /><InfoRow label={t('workspace.phone')} value={selectedBranch.phone ?? ''} dir="ltr" /><InfoRow label={t('workspace.email')} value={selectedBranch.email ?? ''} dir="ltr" /><InfoRow label={t('workspace.address')} value={address} /></dl><p className="mt-4 text-xs leading-5 text-slate-500">{t('workspace.generalReadOnly')}</p></section>}

        {activeSection === 'pos' && <section aria-labelledby="branch-pos-heading" className="max-w-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('workspace.sections.pos')}</p><h2 id="branch-pos-heading" className="mt-1 text-lg font-bold text-slate-950">{t('workspace.posTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t('workspace.posHelp')}</p></div><Landmark className="hidden text-primary-200 sm:block" size={30} /></div><div className="mt-6 space-y-3"><fieldset><legend className="text-xs font-bold text-slate-700">{t('workspace.posMode')}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{(['touch', 'quick'] as const).map(mode => <label key={mode} className={`cursor-pointer rounded-xl border p-3 transition-colors ${posDraft.mode === mode ? 'border-primary-400 bg-primary-50/60' : 'border-slate-200 hover:border-primary-200'}`}><input type="radio" className="sr-only" name="branch-pos-mode" checked={posDraft.mode === mode} onChange={() => { setPosDraft(current => ({ ...current, mode })); setSaved(null) }} /><span className="block text-sm font-semibold text-slate-900">{t(`workspace.posModes.${mode}.label`)}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{t(`workspace.posModes.${mode}.help`)}</span></label>)}</div></fieldset><ToggleRow label={t('workspace.splitPayment')} help={t('workspace.splitPaymentHelp')} checked={posDraft.allowSplit} onChange={value => { setPosDraft(current => ({ ...current, allowSplit: value })); setSaved(null) }} /><ToggleRow label={t('workspace.categoryArrows')} help={t('workspace.categoryArrowsHelp')} checked={posDraft.showArrows} onChange={value => { setPosDraft(current => ({ ...current, showArrows: value })); setSaved(null) }} /></div><div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><Button onClick={() => void savePos()} disabled={savingPos || !posDirty}>{savingPos ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t('workspace.save')}</Button><Button variant="secondary" onClick={() => setPosDraft(posSaved)} disabled={savingPos || !posDirty}><RefreshCw size={14} />{t('workspace.reset')}</Button><span className="text-xs text-slate-500" role="status">{posDirty ? t('workspace.unsaved') : t('workspace.allSaved')}</span></div></section>}

        {activeSection === 'credit' && <section aria-labelledby="branch-credit-heading" className="max-w-3xl"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('workspace.sections.credit')}</p><h2 id="branch-credit-heading" className="mt-1 text-lg font-bold text-slate-950">{t('workspace.creditTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t('workspace.creditHelp')}</p></div><StatusChip enabled={creditSettings.branchCreditEnabled} enabledLabel={t('workspace.enabled')} disabledLabel={t('workspace.disabled')} /></div><div className="mt-5"><ToggleRow label={t('workspace.creditToggle')} help={t('workspace.creditToggleHelp')} checked={creditEnabled} onChange={value => { setCreditEnabled(value); setSaved(null) }} /></div><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => void saveCredit()} disabled={savingCredit || !creditDirty}>{savingCredit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t('workspace.save')}</Button><Link to={`/reports/receivables?branch=${encodeURIComponent(selectedBranchId)}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><CreditCard size={14} />{t('workspace.openCredit')}</Link></div></section>}

        {activeSection === 'printing' && <section aria-labelledby="branch-printing-heading" className="max-w-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('workspace.sections.printing')}</p><h2 id="branch-printing-heading" className="mt-1 text-lg font-bold text-slate-950">{t('workspace.printingTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{t('workspace.printingHelp')}</p></div><Printer className="hidden text-primary-200 sm:block" size={30} /></div><div className="mt-6 grid gap-2 sm:grid-cols-2">{['receipts', 'invoices', 'barcodeLabels', 'paymentReceipts', 'statements'].map(key => <div key={key} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-800"><FileText size={15} className="text-primary-600" />{t(`workspace.printingItems.${key}`)}</div>)}</div><Link to={printingPath} className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><Printer size={15} />{t('workspace.openPrinting')}<ExternalLink size={13} /></Link></section>}

        {activeSection === 'zatca' && <section aria-labelledby="branch-zatca-heading" className="max-w-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-700">{t('workspace.sections.zatca')}</p><h2 id="branch-zatca-heading" className="mt-1 text-lg font-bold text-slate-950">{t('workspace.zatcaTitle')}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t('workspace.zatcaHelp')}</p></div><ShieldCheck className="hidden text-primary-200 sm:block" size={30} /></div><div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3"><span className="text-sm font-semibold text-slate-800">{t('workspace.branchStatus')}</span><StatusChip enabled={selectedBranch.is_active} enabledLabel={t('workspace.active')} disabledLabel={t('workspace.inactive')} /></div>{isOwner && <Link to="/zatca" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary-200 px-4 text-sm font-bold text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><ShieldCheck size={15} />{t('workspace.manageZatca')}<ExternalLink size={13} /></Link>}</section>}
      </main>
    </div>
    <div className="flex items-center gap-1 text-xs text-slate-400"><ChevronLeft size={13} className="rtl:rotate-180" /><span>{t('workspace.authorityNote')}</span></div>
  </div>
}
