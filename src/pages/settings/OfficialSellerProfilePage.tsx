import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { complianceCapability, confirmOfficialSellerInformation, getComplianceReadiness, saveComplianceDraft } from '@/lib/complianceIdentity'
import { resolveBranchDisplayName } from '@/lib/utils/localizedDisplayName.mjs'
import type { BranchComplianceProfile, ComplianceReadiness, DraftProfilePayload } from '@/types/complianceIdentity'

const EMPTY: DraftProfilePayload = {
  registeredSellerName: '', registeredSellerNameAr: '', vatNumber: '', registrationScheme: 'CRN',
  registrationIdentifier: '', buildingNumber: '', street: '', district: '', city: '', postalCode: '',
  country: 'SA', evidenceReference: '',
}

function fromProfile(p: BranchComplianceProfile | null): DraftProfilePayload {
  return p ? {
    registeredSellerName: p.registeredSellerName ?? '', registeredSellerNameAr: p.registeredSellerNameAr ?? '',
    vatNumber: p.vatNumber ?? '', registrationScheme: p.registrationScheme,
    registrationIdentifier: p.registrationIdentifier ?? '', buildingNumber: p.buildingNumber ?? '',
    street: p.street ?? '', district: p.district ?? '', city: p.city ?? '', postalCode: p.postalCode ?? '',
    country: p.country, evidenceReference: p.evidenceReference ?? '',
  } : { ...EMPTY }
}

type PublicState = 'incomplete' | 'confirmed' | 'reconfirm'
function publicState(readiness: ComplianceReadiness | null): PublicState {
  if (!readiness) return 'incomplete'
  if (readiness.status === 'verified' && readiness.mode === 'protected') return 'confirmed'
  if (readiness.status === 'revalidation_required') return 'reconfirm'
  if (readiness.status === 'verified' || readiness.mode === 'protected') return 'reconfirm'
  return 'incomplete'
}

export default function OfficialSellerProfilePage() {
  const { t, i18n } = useTranslation('settings')
  const { profile } = useAuth()
  const owner = profile?.role === 'owner'
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [branches, setBranches] = useState<{ id: string; name: string | null; name_ar?: string | null; display_name?: string | null }[]>([])
  const [branchId, setBranchId] = useState('')
  const [readiness, setReadiness] = useState<ComplianceReadiness | null>(null)
  const [form, setForm] = useState<DraftProfilePayload>({ ...EMPTY })
  const [persisted, setPersisted] = useState<DraftProfilePayload>({ ...EMPTY })
  const [editing, setEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const dialogTitleRef = useRef<HTMLHeadingElement>(null)

  const state = publicState(readiness)
  const dirty = JSON.stringify(form) !== JSON.stringify(persisted)
  const displayedState: PublicState = state === 'confirmed' && dirty ? 'reconfirm' : state
  const complete = useMemo(() => Boolean(
    form.registeredSellerName.trim() && /^3\d{13}3$/.test(form.vatNumber)
    && form.registrationIdentifier.trim() && form.buildingNumber.trim() && form.street.trim()
    && form.district.trim() && form.city.trim() && /^\d{5}$/.test(form.postalCode) && form.country.trim()
  ), [form])

  async function load(id = branchId) {
    if (!id) return
    const next = await getComplianceReadiness(id)
    const values = fromProfile(next.profile)
    setReadiness(next); setForm(values); setPersisted(values)
    setEditing(!next.profile || next.status === 'draft' || next.status === 'rejected' || next.status === 'revalidation_required')
  }

  useEffect(() => {
    let stopped = false
    ;(async () => {
      try {
        const capability = await complianceCapability()
        if (stopped) return
        setEnabled(capability.available)
        if (!capability.available) return
        const { data } = await supabase.from('branches').select('id,name,name_ar,display_name').order('name')
        const rows = (data ?? []) as { id: string; name: string }[]
        setBranches(rows)
        if (rows[0]) setBranchId(rows[0].id)
      } catch (e: any) {
        console.error('[OfficialSellerInformation] capability/load failed', e)
        if (!stopped) { setEnabled(false); setError(true) }
      }
    })()
    return () => { stopped = true }
  }, [])

  useEffect(() => { if (enabled && branchId) load(branchId).catch(handleTechnicalError) }, [enabled, branchId])
  useEffect(() => { if (confirmOpen) dialogTitleRef.current?.focus() }, [confirmOpen])
  useEffect(() => {
    if (readiness && ((readiness.status === 'verified' && readiness.mode !== 'protected') || (readiness.mode === 'protected' && readiness.status !== 'verified' && readiness.status !== 'revalidation_required'))) {
      console.warn('[OfficialSellerInformation] inconsistent readiness state', { branchId: readiness.branchId, status: readiness.status, mode: readiness.mode })
    }
  }, [readiness])

  function handleTechnicalError(e: any) {
    console.error('[OfficialSellerInformation]', e)
    setError(true)
  }
  const set = (key: keyof DraftProfilePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(value => ({ ...value, [key]: e.target.value })); setError(false)
  }

  async function save() {
    setBusy(true); setError(false)
    try {
      await saveComplianceDraft(branchId, form, 'Owner saved official seller information')
      await load()
    } catch (e) { handleTechnicalError(e) } finally { setBusy(false) }
  }

  async function confirmOfficialInformation() {
    if (!acknowledged || !complete) return
    setBusy(true); setError(false)
    try {
      const reason = 'Owner confirmed official seller information against official registration'
      await confirmOfficialSellerInformation({ branchId, payload: form, reason, confirmation: true })
      setConfirmOpen(false); setAcknowledged(false)
      await load()
    } catch (e) { handleTechnicalError(e) } finally { setBusy(false) }
  }

  function cancelEdit() { setForm(persisted); setEditing(false); setError(false) }

  if (enabled === null) return <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-primary-600" /></div>
  if (!enabled) return <div className="card p-6"><h1 className="text-lg font-bold text-gray-950">{t('officialSeller.simpleTitle')}</h1><p className="mt-2 text-sm text-gray-500">{t('officialSeller.notEnabled')}</p></div>

  const disabled = !owner || (!editing && state === 'confirmed')
  const fields: Array<{ key: keyof DraftProfilePayload; group: 'identity' | 'address' | 'optional'; ltr?: boolean }> = [
    { key: 'registeredSellerName', group: 'identity' }, { key: 'registeredSellerNameAr', group: 'identity' },
    { key: 'vatNumber', group: 'identity', ltr: true }, { key: 'registrationIdentifier', group: 'identity', ltr: true },
    { key: 'buildingNumber', group: 'address', ltr: true }, { key: 'street', group: 'address' },
    { key: 'district', group: 'address' }, { key: 'city', group: 'address' },
    { key: 'postalCode', group: 'address', ltr: true }, { key: 'country', group: 'address' },
    { key: 'evidenceReference', group: 'optional' },
  ]

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h1 className="text-2xl font-bold text-gray-950">{t('officialSeller.simpleTitle')}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{t('officialSeller.simpleDescription')}</p></div>
    <div className={`rounded-2xl border p-4 ${displayedState === 'confirmed' ? 'border-emerald-100 bg-emerald-50' : displayedState === 'reconfirm' ? 'border-amber-100 bg-amber-50' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start gap-3">{displayedState === 'confirmed' ? <CheckCircle2 className="text-emerald-600" size={19}/> : <AlertTriangle className="text-amber-600" size={19}/>}<div><p className="text-sm font-bold text-gray-900">{t(`officialSeller.publicState.${displayedState}`)}</p>{displayedState === 'reconfirm' && <p className="mt-1 text-xs text-amber-800">{t('officialSeller.changeWarning')}</p>}</div></div>
    </div>
    <div className="card p-4"><label className="label" htmlFor="official-branch">{t('officialSeller.branch')}</label><select id="official-branch" className="input" value={branchId} onChange={e => setBranchId(e.target.value)}>{branches.map(branch => <option key={branch.id} value={branch.id}>{resolveBranchDisplayName(branch, i18n.resolvedLanguage?.startsWith('ar') === true)}</option>)}</select></div>
    {(['identity', 'address', 'optional'] as const).map(group => <section key={group} className="card p-5"><h2 className="text-sm font-bold text-gray-900">{t(`officialSeller.groups.${group}`)}</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
      {group === 'identity' && <div><label className="label" htmlFor="registrationScheme">{t('officialSeller.fields.registrationScheme')}</label><select id="registrationScheme" className="input" dir="ltr" disabled={disabled} value={form.registrationScheme} onChange={set('registrationScheme')}>{['CRN','MOM','MLS','SAG','OTH'].map(value => <option key={value}>{value}</option>)}</select></div>}
      {fields.filter(field => field.group === group).map(field => <div key={field.key} className={field.key === 'evidenceReference' ? 'sm:col-span-2' : ''}><label className="label" htmlFor={field.key}>{t(`officialSeller.fields.${field.key}`)}</label><input id={field.key} className="input" dir={field.ltr ? 'ltr' : 'auto'} disabled={disabled} value={form[field.key]} onChange={set(field.key)} aria-invalid={(field.key === 'vatNumber' && Boolean(form.vatNumber) && !/^3\d{13}3$/.test(form.vatNumber)) || (field.key === 'postalCode' && Boolean(form.postalCode) && !/^\d{5}$/.test(form.postalCode))}/>{field.key === 'vatNumber' && form.vatNumber && !/^3\d{13}3$/.test(form.vatNumber) && <p className="mt-1 text-xs text-red-600">{t('officialSeller.validation.vat')}</p>}{field.key === 'postalCode' && form.postalCode && !/^\d{5}$/.test(form.postalCode) && <p className="mt-1 text-xs text-red-600">{t('officialSeller.validation.postal')}</p>}</div>)}
    </div></section>)}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{t('officialSeller.actionFailed')}</p>}
    {owner && <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-2xl border border-gray-100 bg-white/95 p-3 shadow-lg backdrop-blur">{!editing && state === 'confirmed' ? <button className="btn-secondary" onClick={() => setEditing(true)}>{t('officialSeller.actions.edit')}</button> : <><button className="btn-secondary" disabled={busy} onClick={cancelEdit}>{t('officialSeller.actions.cancel')}</button><button className="btn-secondary" disabled={busy} onClick={save}>{busy ? t('officialSeller.actions.saving') : t('officialSeller.actions.save')}</button><button className="btn-primary" disabled={busy || !complete} onClick={() => setConfirmOpen(true)}><ShieldCheck size={15}/>{t('officialSeller.actions.confirm')}</button></>}</div>}
    {confirmOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="official-confirm-title"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><h2 id="official-confirm-title" ref={dialogTitleRef} tabIndex={-1} className="text-lg font-bold text-gray-950">{t('officialSeller.confirmDialog.title')}</h2><button aria-label={t('officialSeller.actions.goBack')} onClick={() => setConfirmOpen(false)}><X size={18}/></button></div><p className="mt-3 text-sm leading-6 text-gray-600">{t('officialSeller.confirmDialog.message')}</p><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700"><input className="mt-0.5" type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/><span>{t('officialSeller.confirmDialog.acknowledgement')}</span></label><div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setConfirmOpen(false)}>{t('officialSeller.actions.goBack')}</button><button className="btn-primary" disabled={!acknowledged || busy} onClick={confirmOfficialInformation}>{busy ? t('officialSeller.actions.confirming') : t('officialSeller.actions.confirm')}</button></div></div></div>}
  </div>
}
