import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Eye, FileText, Loader2, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getComplianceReadiness } from '@/lib/complianceIdentity'
import { canonicalPresentationDefaults, immutableLogoObjectPath, resolveHistoricalA4Template } from '@/lib/invoices/presentationSettings'
import { documentFromPreviewDraft, type InvoicePresentationDraft } from '@/lib/invoices/documentViewAdapters'
import DocumentPreview from '@/components/print/DocumentPreview'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import { Switch as Toggle } from '@/components/ui/Switch'
import type { ComplianceReadiness } from '@/types/complianceIdentity'
import type { InvoicePresentationSettings } from '@/types/database'

type DocumentLanguage = 'en' | 'ar' | 'both'
type PrintMode = 'thermal' | 'pdf' | 'both'
type PreviewMode = 'thermal' | 'a4'
type RpcInvoker = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>

interface SettingsResponse {
  branch_id: string
  presentation_settings: InvoicePresentationSettings
  invoice_language: DocumentLanguage
  print_mode: PrintMode
  can_edit: boolean
  role: string
}

type DraftPath =
  | keyof InvoicePresentationSettings['identity'] | keyof InvoicePresentationSettings['contact']
  | keyof InvoicePresentationSettings['footer'] | keyof InvoicePresentationSettings['logo']
  | keyof InvoicePresentationSettings['thermal'] | keyof InvoicePresentationSettings['a4']
type FieldErrors = Partial<Record<DraftPath | 'logo_file', string>>

const rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoker
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SHORT = 160
const MAX_FOOTER = 500

function normalizeDraft(value: InvoicePresentationDraft): InvoicePresentationDraft {
  const clean = (text: string | null) => text?.trim() || null
  return {
    invoiceLanguage: value.invoiceLanguage,
    printMode: value.printMode,
    presentation: {
      ...value.presentation,
      identity: {
        ...value.presentation.identity,
        display_heading: clean(value.presentation.identity.display_heading),
        display_subheading: clean(value.presentation.identity.display_subheading),
        custom_display_name: clean(value.presentation.identity.custom_display_name),
      },
      contact: {
        ...value.presentation.contact,
        phone: clean(value.presentation.contact.phone), email: clean(value.presentation.contact.email),
        website: clean(value.presentation.contact.website),
      },
      footer: {
        ...value.presentation.footer,
        thank_you_message: clean(value.presentation.footer.thank_you_message),
        footer_note: clean(value.presentation.footer.footer_note), refund_note: clean(value.presentation.footer.refund_note),
      },
    },
  }
}
const signature = (value: InvoicePresentationDraft) => JSON.stringify(normalizeDraft(value))
const fromResponse = (value: SettingsResponse): InvoicePresentationDraft => normalizeDraft({ presentation: value.presentation_settings, invoiceLanguage: value.invoice_language, printMode: value.print_mode })

function Section({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <section className="border-b border-gray-200 pb-7 last:border-0"><div className="mb-5"><h2 className="text-base font-bold text-gray-950">{title}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{help}</p></div><div className="space-y-4">{children}</div></section>
}
function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const description = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return <div><label htmlFor={id} className="label">{label}</label>{children}{error ? <p id={`${id}-error`} className="mt-1 text-[11px] font-medium text-red-600">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1 text-[11px] text-gray-400">{hint}</p> : null}<span className="sr-only" aria-live="polite">{description ? error : ''}</span></div>
}
function Choice<T extends string>({ legend, value, options, onChange, disabled = false }: { legend: string; value: T; options: { value: T; label: string; description?: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled}><legend className="label">{legend}</legend><div className={`grid gap-2 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>{options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={`rounded-xl border px-3 py-3 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-primary-500 ${value === option.value ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'} disabled:cursor-not-allowed disabled:opacity-60`}><span className="block text-xs font-semibold">{option.label}</span>{option.description && <span className="mt-1 block text-[10px] leading-4 text-gray-500">{option.description}</span>}</button>)}</div></fieldset>
}
function ToggleRow({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5"><span className="text-xs font-medium text-gray-700">{label}</span><Toggle checked={checked} onChange={onChange} disabled={disabled} /></div>
}

export default function InvoiceSettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { profile, loading: authLoading } = useAuth()
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [branchId, setBranchId] = useState<string | null>(null)
  const [draft, setDraft] = useState<InvoicePresentationDraft | null>(null)
  const [saved, setSaved] = useState<InvoicePresentationDraft | null>(null)
  const [defaults, setDefaults] = useState<InvoicePresentationDraft | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [readiness, setReadiness] = useState<ComplianceReadiness | null>(null)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false)
  const [saveOk, setSaveOk] = useState(false), [saveError, setSaveError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({}), [previewMode, setPreviewMode] = useState<PreviewMode>('thermal')
  const [pendingLogoPreview, setPendingLogoPreview] = useState<string | null>(null), [resetOpen, setResetOpen] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  const isDirty = !!draft && !!saved && signature(draft) !== signature(saved)

  useEffect(() => { if (!authLoading) void loadBranches() }, [authLoading, profile?.branch_id, profile?.tenant_id])
  async function loadBranches() {
    if (profile?.branch_id) { setBranches([{ id: profile.branch_id, name: t('settings:invoiceSettings.assignedBranch') }]); setBranchId(profile.branch_id); return }
    if (!profile?.tenant_id) { setLoading(false); return }
    const { data } = await supabase.from('branches').select('id,name').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('is_main_branch', { ascending: false }).order('name')
    const list = (data ?? []) as { id: string; name: string }[]; setBranches(list); setBranchId(current => current && list.some(item => item.id === current) ? current : list[0]?.id ?? null)
  }
  useEffect(() => { if (branchId) void loadSettings(branchId) }, [branchId])
  async function loadSettings(id: string) {
    setLoading(true); setSaveError(null)
    try {
      const [{ data, error }, official] = await Promise.all([rpc('get_branch_invoice_settings', { p_branch_id: id }), getComplianceReadiness(id).catch(() => null)])
      if (error) throw error
      const response = data as SettingsResponse, next = fromResponse(response)
      setDraft(next); setSaved(next); setDefaults({ ...next, presentation: canonicalPresentationDefaults(next.presentation) }); setCanEdit(response.can_edit); setReadiness(official); setPendingLogoPreview(null)
    } catch (error) { setSaveError(error instanceof Error ? error.message : t('settings:invoiceSettings.loadFailed')) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = '' } }
    const routeGuard = (event: MouseEvent) => { const anchor = (event.target as HTMLElement).closest('a'); if (isDirty && anchor && !window.confirm(t('settings:invoiceSettings.leaveWarning'))) { event.preventDefault(); event.stopPropagation() } }
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', routeGuard, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', routeGuard, true) }
  }, [isDirty, t])
  useEffect(() => () => { if (pendingLogoPreview) URL.revokeObjectURL(pendingLogoPreview) }, [pendingLogoPreview])

  function updateSection<S extends keyof InvoicePresentationSettings, K extends keyof InvoicePresentationSettings[S]>(section: S, key: K, value: InvoicePresentationSettings[S][K]) { setDraft(current => current ? { ...current, presentation: { ...current.presentation, [section]: { ...current.presentation[section], [key]: value } } } : current); setSaveOk(false); setErrors(current => { const next = { ...current }; delete next[key as DraftPath]; return next }) }
  function validate(value: InvoicePresentationDraft) {
    const next: FieldErrors = {}, p = value.presentation
    for (const [key, text] of Object.entries(p.identity) as [keyof typeof p.identity, string | boolean | null][]) if (typeof text === 'string' && text.length > MAX_SHORT) next[key] = t('settings:invoiceSettings.tooLong', { count: MAX_SHORT })
    if (p.contact.phone && (!/^[0-9+\-() ]{7,50}$/.test(p.contact.phone))) next.phone = t('settings:invoiceSettings.phoneInvalid')
    if (p.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contact.email)) next.email = t('settings:invoiceSettings.emailInvalid')
    if (p.contact.website && !/^https:\/\/[^\s]+$/i.test(p.contact.website)) next.website = t('settings:invoiceSettings.websiteInvalidHttps')
    for (const [key, text] of Object.entries(p.footer) as [keyof typeof p.footer, string | boolean | null][]) if (typeof text === 'string' && text.length > MAX_FOOTER) next[key] = t('settings:invoiceSettings.footerTooLong', { count: MAX_FOOTER })
    return next
  }
  async function saveChanges() {
    if (!draft || !branchId || !canEdit || saving) return
    const normalized = normalizeDraft(draft), nextErrors = validate(normalized); setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true); setSaveError(null); setSaveOk(false)
    const { data, error } = await rpc('update_branch_invoice_settings', { p_payload: { branch_id: branchId, invoice_language: normalized.invoiceLanguage, print_mode: normalized.printMode, presentation_settings: normalized.presentation } })
    if (error) { setSaveError(error.message); setSaving(false); return }
    const result = fromResponse(data as SettingsResponse); setDraft(result); setSaved(result); setDefaults(current => current ?? result); setPendingLogoPreview(null); setSaveOk(true); setSaving(false)
  }
  function cancelChanges() { if (!saved) return; setDraft(saved); setErrors({}); setSaveError(null); setPendingLogoPreview(null); setResetOpen(false) }
  function resetChanges() { if (!defaults) return; setDraft(defaults); setErrors({}); setResetOpen(false) }
  function chooseBranch(next: string) { if (next === branchId) return; if (isDirty && !window.confirm(t('settings:invoiceSettings.leaveWarning'))) return; setBranchId(next) }
  async function uploadLogo(file: File) {
    if (!draft || !branchId || !profile?.tenant_id || !canEdit) return
    if (!LOGO_MIME_TYPES.includes(file.type)) { setErrors(current => ({ ...current, logo_file: t('settings:invoiceSettings.logoTypeInvalid') })); return }
    if (file.size > LOGO_MAX_BYTES) { setErrors(current => ({ ...current, logo_file: t('settings:invoiceSettings.logoTooLarge') })); return }
    setUploading(true); setSaveError(null)
    try {
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
      const version = draft.presentation.logo.asset_version + 1, path = immutableLogoObjectPath(profile.tenant_id, branchId, version, extension)
      const { error } = await supabase.storage.from('branch-assets').upload(path, file, { upsert: false }); if (error) throw error
      if (pendingLogoPreview) URL.revokeObjectURL(pendingLogoPreview); setPendingLogoPreview(URL.createObjectURL(file))
      setDraft(current => current ? { ...current, presentation: { ...current.presentation, logo: { ...current.presentation.logo, asset_path: path, asset_version: version, visible: true } } } : current)
    } catch (error) { setSaveError(error instanceof Error ? error.message : t('settings:invoiceSettings.logoUploadFailed')) }
    finally { setUploading(false) }
  }

  if (authLoading || loading || !draft) return <div className="grid h-64 place-items-center"><Loader2 className="animate-spin text-primary-600" /></div>
  const p = draft.presentation, template = resolveHistoricalA4Template(p.a4.template_id, p.a4.template_version)
  const logoSrc = pendingLogoPreview || (p.logo.asset_path ? supabase.storage.from('branch-assets').getPublicUrl(p.logo.asset_path).data.publicUrl : null)
  const previewCopy = Object.fromEntries(['invoiceTitle','item','quantity','total','subtotal','discount','vat','qr'].map(key => [key, t(`settings:invoiceSettings.preview.${key}`)]))
  const previewModel = documentFromPreviewDraft(draft, logoSrc)
  const input = (id: DraftPath, value: string | null, section: 'identity' | 'contact' | 'footer', placeholder = '') => <input id={id} value={value ?? ''} disabled={!canEdit} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-error` : undefined} onChange={event => updateSection(section, id as never, event.target.value as never)} placeholder={placeholder} className="input disabled:bg-gray-50 disabled:text-gray-500" />
  const official = readiness?.profile, officialAddress = official ? [official.buildingNumber, official.street, official.district, official.city, official.postalCode, official.country].filter(Boolean).join(', ') : '—'

  return <div className="mx-auto max-w-[1440px] space-y-5 pb-28">
    <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold text-primary-700">{t('settings:invoiceSettings.branchAccount')}</p><h1 className="mt-1 text-2xl font-bold text-gray-950">{t('settings:invoiceSettings.title')}</h1><p className="mt-1 max-w-2xl text-sm text-gray-500">{t('settings:invoiceSettings.customerAppearanceHelp')}</p></div>{branches.length > 1 && <label className="text-xs font-semibold text-gray-600">{t('settings:invoiceSettings.branch')}<span className="relative mt-1 block"><select value={branchId ?? ''} onChange={event => chooseBranch(event.target.value)} className="input min-w-52 appearance-none pe-9">{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown className="pointer-events-none absolute end-3 top-3 text-gray-400" size={14} /></span></label>}</header>
    {!canEdit && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('settings:invoiceSettings.readOnlyMessage')}</div>}
    <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,540px)_minmax(420px,1fr)]">
      <main className="rounded-2xl border border-gray-200 bg-white px-5 py-6 shadow-sm sm:px-7"><div className="space-y-7">
        <Section title={t('settings:invoiceSettings.sections.branding')} help={t('settings:invoiceSettings.sections.brandingHelp')}>
          <Field id="display_heading" label={t('settings:invoiceSettings.fields.displayHeading')} error={errors.display_heading}>{input('display_heading',p.identity.display_heading,'identity')}</Field>
          <Field id="display_subheading" label={t('settings:invoiceSettings.fields.displaySubheading')} error={errors.display_subheading}>{input('display_subheading',p.identity.display_subheading,'identity')}</Field>
          <Field id="custom_display_name" label={t('settings:invoiceSettings.fields.customDisplayName')} error={errors.custom_display_name}>{input('custom_display_name',p.identity.custom_display_name,'identity')}</Field>
          <div className="grid gap-2 sm:grid-cols-2"><ToggleRow label={t('settings:invoiceSettings.fields.showCompany')} checked={p.identity.show_company_name} disabled={!canEdit} onChange={value => updateSection('identity','show_company_name',value)} /><ToggleRow label={t('settings:invoiceSettings.fields.showBranch')} checked={p.identity.show_branch_name} disabled={!canEdit} onChange={value => updateSection('identity','show_branch_name',value)} /></div>
          <div className="rounded-xl border border-dashed border-gray-300 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="grid h-20 w-24 place-items-center overflow-hidden rounded-xl bg-gray-50">{logoSrc ? <img src={logoSrc} alt={t('settings:invoiceSettings.logo')} className="h-full w-full object-contain" /> : <FileText className="text-gray-300" />}</div><div className="min-w-0 flex-1"><ToggleRow label={t('settings:invoiceSettings.fields.showLogo')} checked={p.logo.visible} disabled={!canEdit} onChange={value => updateSection('logo','visible',value)} /><button type="button" disabled={!canEdit || uploading} onClick={() => logoInput.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50">{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{t('settings:invoiceSettings.replaceLogo')}</button><input ref={logoInput} type="file" className="sr-only" accept={LOGO_MIME_TYPES.join(',')} onChange={event => { const file=event.target.files?.[0]; if(file) void uploadLogo(file); event.target.value='' }} /></div></div>{errors.logo_file && <p className="mt-2 text-[11px] text-red-600">{errors.logo_file}</p>}</div>
          <Choice legend={t('settings:invoiceSettings.fields.logoSize')} value={p.logo.size} disabled={!canEdit} onChange={value => updateSection('logo','size',value)} options={(['small','medium','large'] as const).map(value => ({ value, label:t(`settings:invoiceSettings.options.${value}`) }))} />
        </Section>
        <Section title={t('settings:invoiceSettings.sections.contact')} help={t('settings:invoiceSettings.sections.contactHelp')}>
          <Field id="phone" label={t('settings:invoiceSettings.phoneNumber')} error={errors.phone}>{input('phone',p.contact.phone,'contact','+966 5X XXX XXXX')}</Field><ToggleRow label={t('settings:invoiceSettings.fields.showPhone')} checked={p.contact.show_phone} disabled={!canEdit || !p.contact.phone} onChange={value => updateSection('contact','show_phone',value)} />
          <Field id="email" label={t('settings:invoiceSettings.email')} error={errors.email}>{input('email',p.contact.email,'contact','hello@example.com')}</Field><ToggleRow label={t('settings:invoiceSettings.showEmail')} checked={p.contact.show_email} disabled={!canEdit || !p.contact.email} onChange={value => updateSection('contact','show_email',value)} />
          <Field id="website" label={t('settings:invoiceSettings.website')} error={errors.website} hint={t('settings:invoiceSettings.websiteHttpsHint')}>{input('website',p.contact.website,'contact','https://example.com')}</Field><ToggleRow label={t('settings:invoiceSettings.showWebsite')} checked={p.contact.show_website} disabled={!canEdit || !p.contact.website} onChange={value => updateSection('contact','show_website',value)} /><ToggleRow label={t('settings:invoiceSettings.fields.showAddress')} checked={p.contact.show_address} disabled={!canEdit} onChange={value => updateSection('contact','show_address',value)} />
        </Section>
        <Section title={t('settings:invoiceSettings.sections.footer')} help={t('settings:invoiceSettings.sections.footerHelp')}>
          <Field id="thank_you_message" label={t('settings:invoiceSettings.fields.thankYou')} error={errors.thank_you_message}>{input('thank_you_message',p.footer.thank_you_message,'footer')}</Field><ToggleRow label={t('settings:invoiceSettings.fields.showThankYou')} checked={p.footer.show_thank_you} disabled={!canEdit || !p.footer.thank_you_message} onChange={value => updateSection('footer','show_thank_you',value)} />
          <Field id="footer_note" label={t('settings:invoiceSettings.fields.footerNote')} error={errors.footer_note}>{input('footer_note',p.footer.footer_note,'footer')}</Field><ToggleRow label={t('settings:invoiceSettings.fields.showFooterNote')} checked={p.footer.show_footer} disabled={!canEdit || !p.footer.footer_note} onChange={value => updateSection('footer','show_footer',value)} />
          <Field id="refund_note" label={t('settings:invoiceSettings.fields.refundNote')} error={errors.refund_note}>{input('refund_note',p.footer.refund_note,'footer')}</Field><ToggleRow label={t('settings:invoiceSettings.fields.showRefundNote')} checked={p.footer.show_refund_note} disabled={!canEdit || !p.footer.refund_note} onChange={value => updateSection('footer','show_refund_note',value)} />
        </Section>
        <Section title={t('settings:invoiceSettings.sections.language')} help={t('settings:invoiceSettings.sections.languageHelp')}><Choice legend={t('settings:invoiceSettings.documentLanguage')} value={draft.invoiceLanguage} disabled={!canEdit} onChange={value => setDraft(current => current ? {...current,invoiceLanguage:value}:current)} options={[{value:'en',label:t('settings:english')},{value:'ar',label:t('settings:arabic')},{value:'both',label:t('settings:invoiceSettings.bilingual')}]} /></Section>
        <Section title={t('settings:invoiceSettings.sections.thermal')} help={t('settings:invoiceSettings.sections.thermalHelp')}>
          <Choice legend={t('settings:invoiceSettings.fields.receiptWidth')} value={p.thermal.width} disabled={!canEdit} onChange={value => updateSection('thermal','width',value)} options={(['58mm','80mm'] as const).map(value=>({value,label:value.replace('mm',' mm')}))} />
          <Choice legend={t('settings:invoiceSettings.fields.density')} value={p.thermal.density} disabled={!canEdit} onChange={value => updateSection('thermal','density',value)} options={(['compact','standard','detailed'] as const).map(value=>({value,label:t(`settings:invoiceSettings.options.${value}`)}))} />
          <Choice legend={t('settings:invoiceSettings.fields.qrSize')} value={p.thermal.qr_size} disabled={!canEdit} onChange={value => updateSection('thermal','qr_size',value)} options={(['small','standard','large'] as const).map(value=>({value,label:t(`settings:invoiceSettings.options.${value}`)}))} />
          <ToggleRow label={t('settings:invoiceSettings.fields.wrapItems')} checked={p.thermal.wrap_item_names} disabled={!canEdit} onChange={value => updateSection('thermal','wrap_item_names',value)} /><ToggleRow label={t('settings:invoiceSettings.fields.showCash')} checked={p.thermal.show_cash_change} disabled={!canEdit} onChange={value => updateSection('thermal','show_cash_change',value)} />
        </Section>
        <Section title={t('settings:invoiceSettings.sections.a4')} help={t('settings:invoiceSettings.sections.a4Help')}>
          <Choice legend={t('settings:invoiceSettings.fields.template')} value={template.resolvedId} disabled={!canEdit} onChange={value => updateSection('a4','template_id',value)} options={(['classic','modern_split','minimal_professional'] as const).map(value=>({value,label:t(`settings:invoiceSettings.templates.${value}.name`),description:t(`settings:invoiceSettings.templates.${value}.description`)}))} />
          <Choice legend={t('settings:invoiceSettings.fields.headerStyle')} value={p.a4.header_style} disabled={!canEdit} onChange={value => updateSection('a4','header_style',value)} options={(['standard','compact','branded'] as const).map(value=>({value,label:t(`settings:invoiceSettings.options.${value}`)}))} />
          <Choice legend={t('settings:invoiceSettings.defaultPrintAction')} value={draft.printMode} disabled={!canEdit} onChange={value => setDraft(current=>current?{...current,printMode:value}:current)} options={(['thermal','pdf','both'] as const).map(value=>({value,label:t(`settings:invoiceSettings.printModes.${value}`)}))} />
        </Section>
        <Section title={t('settings:invoiceSettings.sections.official')} help={t('settings:invoiceSettings.sections.officialHelp')}><div className="rounded-xl bg-gray-50 p-4"><div className="grid gap-3 sm:grid-cols-2">{[[t('settings:officialSeller.fields.registeredSellerName'),official?.registeredSellerName],[t('settings:officialSeller.fields.registeredSellerNameAr'),official?.registeredSellerNameAr],[t('settings:officialSeller.fields.vatNumber'),official?.vatNumber],[t('settings:officialSeller.fields.registrationIdentifier'),official?.registrationIdentifier],[t('settings:officialSeller.groups.address'),officialAddress],[t('settings:invoiceSettings.fields.confirmationStatus'),readiness ? t(`settings:officialSeller.status.${readiness.status}`) : '—']].map(([label,value])=><div key={label}><p className="text-[10px] text-gray-400">{label}</p><p className="mt-0.5 text-xs font-semibold text-gray-800" dir="auto">{value||'—'}</p></div>)}</div><div className="mt-4 flex items-start gap-2 border-t border-gray-200 pt-4"><ShieldCheck size={16} className="mt-0.5 text-primary-700"/><div><p className="text-xs text-gray-600">{t('settings:invoiceSettings.officialSeparate')}</p>{profile?.role==='owner'&&<Link to="/settings/official-seller" className="mt-2 inline-flex text-xs font-semibold text-primary-700 hover:underline">{t('settings:invoiceSettings.manageOfficial')}</Link>}</div></div></div></Section>
      </div></main>
      <aside className="xl:sticky xl:top-5"><div className="rounded-2xl border border-gray-200 bg-[#f4f6f4] p-4 sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><Eye size={15} className="text-primary-700"/><h2 className="text-sm font-bold text-gray-900">{t('settings:livePreview')}</h2></div><p className="mt-1 text-[10px] text-gray-500">{t('settings:invoiceSettings.samplePreview')}</p></div><div className="flex rounded-xl bg-white p-1 ring-1 ring-gray-200">{(['thermal','a4'] as const).map(mode=><button key={mode} onClick={()=>setPreviewMode(mode)} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${previewMode===mode?'bg-primary-700 text-white':'text-gray-500'}`}>{mode==='thermal'?t('settings:thermalPreview'):t('settings:a4Preview')}</button>)}</div></div>{previewMode==='thermal'?<ThermalReceipt model={previewModel} options={{preview:true,qrImageUrl:null,sampleLabel:t('settings:invoiceSettings.samplePreview')}}/>:<DocumentPreview model={previewModel} mode="a4" logoSrc={logoSrc} copy={previewCopy}/>}<p className="mt-5 text-center text-[10px] leading-4 text-gray-500">{t('settings:invoiceSettings.newDocumentsOnly')}</p></div></aside>
    </div>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur"><div className="mx-auto flex max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-h-5">{saveError?<p className="flex items-center gap-2 text-xs text-red-700"><AlertCircle size={14}/>{saveError}</p>:saveOk?<p className="flex items-center gap-2 text-xs text-emerald-700"><Check size={14}/>{t('settings:invoiceSettings.settingsSaved')}</p>:<p className="text-xs text-gray-500">{isDirty?t('settings:invoiceSettings.unsavedChanges'):t('settings:invoiceSettings.saved')}</p>}</div>{canEdit&&<div className="grid grid-cols-3 gap-2 sm:flex"><button type="button" onClick={()=>setResetOpen(true)} disabled={saving} className="btn-secondary gap-1.5"><RotateCcw size={14}/>{t('settings:invoiceSettings.reset')}</button><button type="button" onClick={cancelChanges} disabled={!isDirty||saving} className="btn-secondary">{t('common:cancel')}</button><button type="button" onClick={()=>void saveChanges()} disabled={!isDirty||saving||Object.keys(validate(draft)).length>0} className="btn-primary gap-1.5">{saving&&<Loader2 size={14} className="animate-spin"/>}{t('settings:invoiceSettings.saveSettings')}</button></div>}</div></div>
    {resetOpen&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setResetOpen(false)}}><div role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 id="reset-title" className="text-lg font-bold text-gray-950">{t('settings:invoiceSettings.resetTitle')}</h2><p id="reset-description" className="mt-2 text-sm leading-6 text-gray-500">{t('settings:invoiceSettings.resetDescription')}</p><div className="mt-6 flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setResetOpen(false)}>{t('common:cancel')}</button><button className="btn-primary" onClick={resetChanges}>{t('settings:invoiceSettings.resetDraft')}</button></div></div></div>}
  </div>
}
