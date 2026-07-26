import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Eye, FileText, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { documentFromPreviewDraft, type InvoicePresentationDraft } from '@/lib/invoices/documentViewAdapters'
import { resolveInvoicePresentationSettings, serializeInvoicePresentationSettingsForSave } from '@/lib/invoices/presentationSettings'
import { resolveInvoiceLogoUrl } from '@/lib/invoices/runtimePresentation'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import A4Document from '@/components/print/A4Document'
import A4PreviewFit from '@/components/print/A4PreviewFit'
import type { Branch, InvoicePresentationSettings } from '@/types/database'

type DocumentLanguage = 'en' | 'ar' | 'both'
type PrintMode = 'thermal' | 'pdf' | 'both'
type PreviewMode = 'thermal' | 'a4'
type Tab = 'general' | 'branding' | 'contact' | 'thermal' | 'a4'
type RpcInvoker = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>

interface SettingsResponse {
  branch_id?: string
  presentation_settings?: InvoicePresentationSettings | null
  invoice_language?: DocumentLanguage | null
  print_mode?: PrintMode | null
  can_edit?: boolean
}

const rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoker
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SHORT = 160
const MAX_FOOTER = 500

function normalizeDraft(value: InvoicePresentationDraft): InvoicePresentationDraft {
  const clean = (text: string | null) => text?.trim() || null
  return {
    invoiceLanguage: value.invoiceLanguage === 'en' ? 'both' : value.invoiceLanguage,
    printMode: value.printMode,
    afterSaleAction: value.afterSaleAction,
    presentation: {
        ...value.presentation,
      after_sale_action: value.afterSaleAction,
      identity: {
        ...value.presentation.identity,
        display_heading: clean(value.presentation.identity.display_heading),
        display_subheading: clean(value.presentation.identity.display_subheading),
        custom_display_name: clean(value.presentation.identity.custom_display_name),
      },
      contact: {
        ...value.presentation.contact,
        phone: clean(value.presentation.contact.phone),
        email: clean(value.presentation.contact.email),
        website: clean(value.presentation.contact.website),
      },
      footer: {
        ...value.presentation.footer,
        thank_you_message: clean(value.presentation.footer.thank_you_message),
        footer_note: clean(value.presentation.footer.footer_note),
        refund_note: clean(value.presentation.footer.refund_note),
      },
    },
  }
}

function fromResponse(value: unknown, branch: Branch): InvoicePresentationDraft {
  return normalizeDraft(resolveInvoicePresentationSettings({ savedSettings: value, branch }))
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary-500 ${active ? 'bg-primary-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
}

function Choice<T extends string>({ label, value, options, onChange, help }: { label: string; value: T; options: { value: T; label: string; description?: string }[]; onChange: (value: T) => void; help?: string }) {
  return <fieldset><legend className="text-xs font-semibold text-gray-800">{label}</legend>{help && <p className="mt-1 text-[11px] leading-4 text-gray-500">{help}</p>}<div className={`mt-2 grid gap-2 ${options.length > 3 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={`min-h-12 rounded-xl border px-3 py-2 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-primary-500 ${value === option.value ? 'border-primary-600 bg-primary-50 text-primary-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}><span className="block text-xs font-semibold">{option.label}</span>{option.description && <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{option.description}</span>}</button>)}</div></fieldset>
}

function ToggleRow({ label, checked, onChange, disabled = false, help }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; help?: string }) {
  return <label className={`flex min-h-12 items-center justify-between gap-4 rounded-xl border px-3 py-2.5 ${disabled ? 'bg-gray-50 opacity-60' : 'bg-white'}`}><span><span className="block text-xs font-semibold text-gray-800">{label}</span>{help && <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{help}</span>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-primary-700" /></label>
}

function TextField({ id, label, value, onChange, placeholder, disabled = false, error, multiline = false }: { id: string; label: string; value: string | null; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; error?: string; multiline?: boolean }) {
  const props = { id, value: value ?? '', disabled, placeholder, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), className: 'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50' }
  return <div><label htmlFor={id} className="text-xs font-semibold text-gray-800">{label}</label>{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}{error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}</div>
}

export default function InvoiceSettingsPage({
  embedded = false,
  workspace = 'invoices',
}: {
  embedded?: boolean
  workspace?: 'receipts' | 'invoices'
} = {}) {
  const { t } = useTranslation(['settings', 'common'])
  const { profile, loading: authLoading } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<string | null>(null)
  const [draft, setDraft] = useState<InvoicePresentationDraft | null>(null)
  const [saved, setSaved] = useState<InvoicePresentationDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>(workspace === 'receipts' ? 'thermal' : 'general')
  const [previewMode, setPreviewMode] = useState<PreviewMode>(workspace === 'receipts' ? 'thermal' : 'a4')
  const [mobilePane, setMobilePane] = useState<'settings' | 'preview'>('settings')
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  const branch = branches.find(item => item.id === branchId) ?? null
  const isDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => { if (!authLoading) void loadBranches() }, [authLoading, profile?.branch_id, profile?.tenant_id])
  useEffect(() => { if (branchId && branch) void loadSettings(branch) }, [branchId, branch?.id])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = '' } }
    const routeGuard = (event: MouseEvent) => { const anchor = (event.target as HTMLElement).closest('a'); if (isDirty && anchor && !window.confirm(t('settings:invoiceSettings.leaveWarning'))) { event.preventDefault(); event.stopPropagation() } }
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', routeGuard, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', routeGuard, true) }
  }, [isDirty, t])

  async function loadBranches() {
    if (profile?.branch_id) {
      const { data } = await supabase.from('branches').select('*').eq('id', profile.branch_id).single()
      const row = data as Branch | null
      setBranches(row ? [row] : []); setBranchId(row?.id ?? null); setLoading(false); return
    }
    if (!profile?.tenant_id) { setLoading(false); return }
    const { data } = await supabase.from('branches').select('*').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('is_main_branch', { ascending: false }).order('name')
    const list = (data ?? []) as Branch[]
    setBranches(list); setBranchId(current => current && list.some(item => item.id === current) ? current : list[0]?.id ?? null)
  }

  async function loadSettings(selected: Branch) {
    setLoading(true); setSaveError(null)
    try {
      const { data, error } = await rpc('get_branch_invoice_settings', { p_branch_id: selected.id })
      if (error) throw error
      const next = fromResponse(data as SettingsResponse, selected)
      setDraft(next); setSaved(next); setCanEdit((data as SettingsResponse | null)?.can_edit !== false); setSaveOk(false)
    } catch (error) { setSaveError(error instanceof Error ? error.message : t('settings:invoiceSettings.loadFailed')) }
    finally { setLoading(false) }
  }

  function updateDraft(next: (current: InvoicePresentationDraft) => InvoicePresentationDraft) { setDraft(current => current ? next(current) : current); setSaveOk(false); setSaveError(null) }
  function updateSection<S extends keyof InvoicePresentationSettings, K extends keyof InvoicePresentationSettings[S]>(section: S, key: K, value: InvoicePresentationSettings[S][K]) { updateDraft(current => ({ ...current, presentation: { ...current.presentation, [section]: { ...current.presentation[section], [key]: value } } })) }
  function validate(value: InvoicePresentationDraft) {
    const errors: string[] = [], p = value.presentation
    for (const field of [p.identity.display_heading, p.identity.display_subheading, p.identity.custom_display_name]) if (field && field.length > MAX_SHORT) errors.push('identity')
    for (const field of [p.footer.footer_note, p.footer.thank_you_message, p.footer.refund_note]) if (field && field.length > MAX_FOOTER) errors.push('footer')
    if (p.contact.email && !/^\S+@\S+\.\S+$/.test(p.contact.email)) errors.push('email')
    if (p.contact.website && !/^https:\/\/\S+$/i.test(p.contact.website)) errors.push('website')
    return errors
  }
  async function saveChanges() {
    if (!draft || !branchId || !canEdit || saving || validate(draft).length) return
    setSaving(true); setSaveError(null); setSaveOk(false)
    const normalized = normalizeDraft(draft)
    try {
      const presentationSettings = serializeInvoicePresentationSettingsForSave(normalized, branch?.name)
      const payload = { branch_id: branchId, presentation_settings: presentationSettings }
      const { data, error } = await rpc('update_branch_invoice_settings', { p_payload: payload })
      if (error) throw error
      const next = fromResponse(data, branch ?? ({} as Branch))
      setDraft(next); setSaved(next); setSaveOk(true)
    } catch (error) { const rpcError = error as { code?: string; message?: string }; setSaveError(rpcError.code === '22023' && /after.?sale action/i.test(rpcError.message ?? '') ? "Couldn't save because the selected after-sale action is not supported. Refresh and try again." : error instanceof Error ? error.message : t('settings:invoiceSettings.saveFailed')) }
    finally { setSaving(false) }
  }
  function resetChanges() { if (saved) { setDraft(saved); setSaveError(null); setSaveOk(false) } }
  async function uploadLogo(file: File) {
    if (!draft || !branch || !profile?.tenant_id || !canEdit) return
    if (!LOGO_MIME_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) { setSaveError(t('settings:invoiceSettings.logoTypeInvalid')); return }
    setUploading(true); setSaveError(null)
    try {
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
      const version = draft.presentation.logo.asset_version + 1
      const path = `${branch.id}/logo.${extension}`
      const { error } = await supabase.storage.from('branch-assets').upload(path, file, { upsert: true }); if (error) throw error
      updateSection('logo', 'asset_path', path); updateSection('logo', 'asset_version', version); updateSection('logo', 'visible', true)
    } catch (error) { setSaveError(error instanceof Error ? error.message : t('settings:invoiceSettings.logoUploadFailed')) }
    finally { setUploading(false) }
  }

  const p = draft?.presentation
  const logoSrc = resolveInvoiceLogoUrl(p?.logo.asset_path)
  const previewModel = useMemo(() => draft ? documentFromPreviewDraft(draft, logoSrc, {
    registeredName: branch?.business_name || branch?.name || undefined,
    registeredNameAr: branch?.business_name_ar || branch?.name_ar || null,
    vatNumber: branch?.vat_number || '',
    registeredAddress: branch?.address || null,
    branchName: branch?.name || null,
    branchNameAr: branch?.name_ar || null,
  }) : null, [draft, logoSrc, branch])
  const branchName = branch?.name ?? ''
  const useBranchName = !!p && p.identity.display_heading === branchName
  const setUseBranchName = (enabled: boolean) => updateDraft(current => ({ ...current, presentation: { ...current.presentation, identity: { ...current.presentation.identity, display_heading: enabled ? branchName : null, custom_display_name: enabled ? null : current.presentation.identity.custom_display_name, show_branch_name: false, heading_mode: enabled ? 'branch' : 'custom' } } }))

  if (authLoading || loading || !draft || !previewModel) return <div className="grid h-64 place-items-center"><Loader2 className="animate-spin text-primary-600" /></div>

  const allTabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' }, { id: 'branding', label: 'Header & Branding' }, { id: 'contact', label: 'Contact & Footer' }, { id: 'thermal', label: 'Thermal Receipt' }, { id: 'a4', label: 'A4 Themes' },
  ]
  const tabs = allTabs.filter(tab => workspace === 'receipts' ? tab.id !== 'a4' : tab.id !== 'thermal')
  const actionOptions = [{ value: 'receipt' as const, label: 'Receipt only', description: 'Use the thermal receipt path' }, { value: 'a4' as const, label: 'A4 invoice only', description: 'Use the A4 invoice path' }, { value: 'both' as const, label: 'Receipt and A4 invoice', description: 'Keep both document formats available' }]

  return <div className={`mx-auto max-w-[1440px] space-y-5 ${embedded ? 'pb-24' : 'pb-28'}`}>
    {!embedded && <header className="border-b border-gray-200 pb-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Invoice workspace</p><h1 className="mt-1 text-2xl font-bold text-gray-950">Invoice Settings</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">Shape the invoices your team sends without changing compliance identity or print execution.</p></div>{branches.length > 1 && <label className="min-w-48 text-xs font-semibold text-gray-700">Branch<select value={branchId ?? ''} onChange={event => { if (isDirty && !window.confirm('Discard unsaved changes?')) { event.preventDefault(); return }; setBranchId(event.target.value) }} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"><option value="" disabled>Select branch</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div></header>}
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2" role="tablist" aria-label="Invoice settings sections">{tabs.map(tab => <TabButton key={tab.id} active={activeTab === tab.id} label={tab.label} onClick={() => { setActiveTab(tab.id); setMobilePane('settings') }} />)}</div>
    <div className="flex gap-2 lg:hidden"><button type="button" onClick={() => setMobilePane('settings')} className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold ${mobilePane === 'settings' ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Settings</button><button type="button" onClick={() => setMobilePane('preview')} className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold ${mobilePane === 'preview' ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Preview</button></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <main className={`${mobilePane === 'preview' ? 'hidden lg:block' : ''} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6`} role="tabpanel">
        {!canEdit && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">This branch is read-only for your account.</div>}
        <fieldset disabled={!canEdit} className="space-y-5">
        {activeTab === 'general' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">General</h2><p className="mt-1 text-xs leading-5 text-gray-500">Choose Arabic or bilingual human-readable documents and the action after sale.</p></div><Choice label="Invoice language" value={draft.invoiceLanguage === 'en' ? 'both' : draft.invoiceLanguage} onChange={value => updateDraft(current => ({ ...current, invoiceLanguage: value }))} options={[{ value: 'ar', label: 'Arabic' }, { value: 'both', label: 'Bilingual — Arabic + English' }]} /><Choice label="After-sale document" value={draft.afterSaleAction ?? 'receipt'} onChange={value => updateDraft(current => ({ ...current, afterSaleAction: value }))} options={actionOptions} /></div>}
        {activeTab === 'branding' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">Header & Branding</h2><p className="mt-1 text-xs leading-5 text-gray-500">Make the first impression clear and recognisable.</p></div><ToggleRow label="Use branch name" checked={useBranchName} onChange={setUseBranchName} help={branchName ? `Resolved branch: ${branchName}` : undefined} /><TextField id="display-heading" label="Custom display heading" value={p.identity.display_heading} disabled={useBranchName} onChange={value => updateSection('identity', 'display_heading', value)} placeholder="Shown at the top of the invoice" /><TextField id="display-subheading" label="Display subheading (optional)" value={p.identity.display_subheading} onChange={value => updateSection('identity', 'display_subheading', value)} placeholder="Leave blank to hide it" /><ToggleRow label="Show legal company name in branded header" checked={p.identity.show_company_name} onChange={value => updateSection('identity', 'show_company_name', value)} help="The mandatory legal seller name remains in the invoice information section." /><div className="rounded-2xl border border-dashed border-gray-300 p-4"><div className="flex items-center gap-4"><div className="grid h-20 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-gray-50">{logoSrc ? <img src={logoSrc} alt="Current invoice logo" className="h-full w-full object-contain" /> : <FileText className="text-gray-300" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-gray-800">Logo</p><p className="mt-1 text-[11px] text-gray-500">Upload, replace, or remove the saved branch logo.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={uploading} onClick={() => logoInput.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Upload size={14} />{uploading ? 'Uploading…' : 'Replace logo'}</button><button type="button" disabled={!p.logo.asset_path} onClick={() => setConfirmRemoveLogo(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} />Remove</button></div><input ref={logoInput} type="file" className="sr-only" accept={LOGO_MIME_TYPES.join(',')} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = '' }} /></div></div></div><Choice label="Logo size" value={p.logo.size} onChange={value => updateSection('logo', 'size', value)} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} /></div>}
        {activeTab === 'contact' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">Contact & Footer</h2><p className="mt-1 text-xs leading-5 text-gray-500">Only enabled, non-empty contact details appear in the document. Leave address blank to inherit from the branch profile.</p></div><ToggleRow label="Show phone" checked={p.contact.show_phone} onChange={value => updateSection('contact', 'show_phone', value)} />{p.contact.show_phone && <TextField id="phone" label="Phone override" value={p.contact.phone} onChange={value => updateSection('contact', 'phone', value)} placeholder={branch?.phone ?? 'Inherit branch phone'} />}<ToggleRow label="Show email" checked={p.contact.show_email} onChange={value => updateSection('contact', 'show_email', value)} />{p.contact.show_email && <TextField id="email" label="Email" value={p.contact.email} onChange={value => updateSection('contact', 'email', value)} placeholder="hello@example.com" />}<ToggleRow label="Show website" checked={p.contact.show_website} onChange={value => updateSection('contact', 'show_website', value)} />{p.contact.show_website && <TextField id="website" label="Website" value={p.contact.website} onChange={value => updateSection('contact', 'website', value)} placeholder="https://example.com" />}<ToggleRow label="Show address" checked={p.contact.show_address} onChange={value => updateSection('contact', 'show_address', value)} />{p.contact.show_address && <TextField id="address-override" label="Address override" value={p.contact.address_override} onChange={value => updateSection('contact', 'address_override', value)} placeholder={branch?.address ?? 'Inherit branch address'} multiline />}<TextField id="footer-message" label="Footer message" value={p.footer.footer_note} onChange={value => updateSection('footer', 'footer_note', value)} placeholder="Leave blank to hide the footer message" multiline /></div>}
        {activeTab === 'thermal' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">Thermal Receipt</h2><p className="mt-1 text-xs leading-5 text-gray-500">Tune the receipt for the paper your counter uses.</p></div><Choice label="Paper width" value={p.thermal.width} onChange={value => updateSection('thermal', 'width', value)} options={[{ value: '58mm', label: '58 mm' }, { value: '80mm', label: '80 mm' }]} /><Choice label="Content density" value={p.thermal.density} onChange={value => updateSection('thermal', 'density', value)} options={[{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'detailed', label: 'Detailed' }]} /><Choice label="QR size" value={p.thermal.qr_size} onChange={value => updateSection('thermal', 'qr_size', value)} options={[{ value: 'small', label: 'Small' }, { value: 'standard', label: 'Medium' }, { value: 'large', label: 'Large' }]} /><ToggleRow label="Wrap long item names" checked={p.thermal.wrap_item_names} onChange={value => updateSection('thermal', 'wrap_item_names', value)} /><ToggleRow label="Show cash change" checked={p.thermal.show_cash_change} onChange={value => updateSection('thermal', 'show_cash_change', value)} /></div>}
        {activeTab === 'a4' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">A4 Themes</h2><p className="mt-1 text-xs leading-5 text-gray-500">Choose a complete visual theme. Each theme owns its header, table, totals, and footer treatment.</p></div><Choice label="Invoice theme" value={p.a4.template_id} onChange={value => updateSection('a4', 'template_id', value)} options={[{ value: 'classic', label: 'Classic', description: 'Balanced and familiar' }, { value: 'modern_split', label: 'Modern Split', description: 'Strong visual separation' }, { value: 'minimal_professional', label: 'Minimal Professional', description: 'Quiet, clean hierarchy' }]} /></div>}
        {activeTab === 'branding' && <p className="mt-2 text-[11px] leading-4 text-gray-500">Mandatory legal seller details will still appear in the invoice information section.</p>}
        </fieldset>
      </main>
      <aside className={`${mobilePane === 'settings' ? 'hidden lg:block' : ''} lg:sticky lg:top-5`} aria-label="Live invoice preview"><div className="rounded-2xl border border-gray-200 bg-[#f4f6f4] p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Eye size={16} className="text-primary-700" /><div><h2 className="text-sm font-bold text-gray-900">Live preview</h2><p className="text-[10px] text-gray-500">Updates as you edit; save when ready.</p></div></div><div className="flex rounded-xl bg-white p-1 ring-1 ring-gray-200"><button type="button" onClick={() => setPreviewMode('thermal')} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${previewMode === 'thermal' ? 'bg-primary-700 text-white' : 'text-gray-500'}`}>Thermal</button><button type="button" onClick={() => setPreviewMode('a4')} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${previewMode === 'a4' ? 'bg-primary-700 text-white' : 'text-gray-500'}`}>A4</button></div></div>{previewMode === 'thermal' ? <div className="mx-auto max-w-full overflow-x-auto rounded-xl bg-gray-100 p-3"><ThermalReceipt model={previewModel} options={{ preview: true, qrImageUrl: null, sampleLabel: 'Preview' }} /></div> : <A4PreviewFit><A4Document model={previewModel} options={{ preview: true, qrImageUrl: null, sampleLabel: 'Preview', pageNumbers: true }} /></A4PreviewFit>}</div></aside>
    </div>
    <div className="sticky bottom-3 z-20 rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-h-5">{saveError ? <p className="flex items-center gap-2 text-xs text-red-700"><AlertCircle size={14} />{saveError}</p> : saveOk ? <p className="flex items-center gap-2 text-xs text-emerald-700"><Check size={14} />Settings saved</p> : <p className="text-xs text-gray-500">{isDirty ? 'Unsaved changes' : 'All changes saved'}</p>}</div><div className="flex gap-2"><button type="button" onClick={resetChanges} disabled={!isDirty || saving} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-40"><RotateCcw size={14} />Reset changes</button><button type="button" onClick={() => void saveChanges()} disabled={!canEdit || !isDirty || saving || validate(draft).length > 0} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-primary-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}Save settings</button></div></div></div>
    {confirmRemoveLogo && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmRemoveLogo(false) }}><div role="dialog" aria-modal="true" aria-labelledby="remove-logo-title" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"><h2 id="remove-logo-title" className="text-lg font-bold text-gray-950">Remove logo?</h2><p className="mt-2 text-sm leading-6 text-gray-500">The logo will disappear from the draft and future documents after you save.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmRemoveLogo(false)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold">Cancel</button><button type="button" onClick={() => { updateSection('logo', 'asset_path', null); updateSection('logo', 'visible', false); setConfirmRemoveLogo(false) }} className="rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white">Remove logo</button></div></div></div>}
  </div>
}
