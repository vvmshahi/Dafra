import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, FileText, LayoutTemplate, Loader2, Minus, Palette, Plus, ReceiptText, RotateCcw, Settings2, Trash2, Upload, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { documentFromPreviewDraft, type InvoicePresentationDraft } from '@/lib/invoices/documentViewAdapters'
import type { DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { invoiceArtworkObjectPath, resolveInvoicePresentationSettings, serializeInvoicePresentationSettingsForSave, type UpdateBranchInvoiceSettingsPayload } from '@/lib/invoices/presentationSettings'
import { resolveInvoiceLogoUrl } from '@/lib/invoices/runtimePresentation'
import { A4_TEMPLATE_IDS, A4_TEMPLATE_REGISTRY } from '@/lib/invoices/a4TemplateRegistry'
import { A4_ACCENT_PRESETS, A4_LAYOUT_COLOR_DEFAULTS, hasSafeTextContrast } from '@/lib/invoices/a4ColorTokens'
import { createPreviewQrDataUrl, type PreviewQrState } from '@/lib/invoices/previewQr'
import { cropLetterheadRegion, defaultLetterheadCrops, formatArtworkBytes, LETTERHEAD_ACCEPT, LETTERHEAD_MAX_SOURCE_BYTES, LetterheadValidationError, loadLetterheadSource, type LetterheadCrop, type LetterheadSource } from '@/lib/invoices/letterheadArtwork'
import { resolveBranchDisplayName } from '@/lib/utils/localizedDisplayName.mjs'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import A4Document from '@/components/print/A4Document'
import A4PreviewFit, { type A4PreviewZoom } from '@/components/print/A4PreviewFit'
import LetterheadCropPanel from '@/components/print/LetterheadCropPanel'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  DocumentStudioActionFooter,
  DocumentStudioPreviewToolbar,
  DocumentStudioSectionNav,
  DocumentStudioWorkspace,
  SavedStatus,
} from '@/components/printing/DocumentStudioShell'
import type { A4TemplateId, Branch, InvoicePresentationSettings, ThermalDensity } from '@/types/database'
import { useNavigate, useSearchParams } from 'react-router-dom'

type DocumentLanguage = 'en' | 'ar' | 'both'
type PrintMode = 'thermal' | 'pdf' | 'both'
type PreviewMode = 'thermal' | 'a4'
type Tab = 'general' | 'branding' | 'contact' | 'thermal' | 'a4'
type PostgrestError = { message: string; code?: string; details?: string | null; hint?: string | null }
type RpcInvoker = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: PostgrestError | null }>

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

function saveErrorKey(error: PostgrestError) {
  const message = error.message ?? ''
  if (error.code === '42501' || error.code === 'PGRST301') return 'permissionDenied'
  if (error.code === 'PGRST202' || error.code === 'PGRST203' || error.code === '42883') return 'settingsFormatUnsupported'
  if (error.code === '22023') {
    if (/after.?sale action/i.test(message)) return 'afterSaleUnsupported'
    if (/layout/i.test(message)) return 'layoutUnavailable'
    if (/artwork|asset path|logo path|crop|colour|A4/i.test(message)) return 'artworkValidationFailed'
    if (/schema|unknown|format|presentation_settings|operational document defaults/i.test(message)) return 'settingsFormatUnsupported'
  }
  return 'saveFailed'
}

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

function Choice<T extends string>({ label, value, options, onChange, help }: { label: string; value: T; options: { value: T; label: string; description?: string }[]; onChange: (value: T) => void; help?: string }) {
  return <fieldset><legend className="text-xs font-semibold text-gray-800">{label}</legend>{help && <p className="mt-1 text-[11px] leading-4 text-gray-500">{help}</p>}<div className={`mt-2 grid gap-2 ${options.length > 3 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={`min-h-12 rounded-xl border px-3 py-2 text-start outline-none transition-[border-color,background-color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${value === option.value ? 'border-primary-600 bg-primary-50 text-primary-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}><span className="block text-xs font-semibold">{option.label}</span>{option.description && <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{option.description}</span>}</button>)}</div></fieldset>
}

function ThemeChoice({ label, value, options, onChange }: {
  label: string
  value: A4TemplateId
  options: Array<{ value: A4TemplateId; label: string; description: string }>
  onChange: (value: A4TemplateId) => void
}) {
  return <fieldset><legend className="text-xs font-semibold text-gray-800">{label}</legend><div className="mt-2 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">{options.map(option => {
    const selected = value === option.value
    return <button
      key={option.value}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onChange(option.value)}
      className={`group relative rounded-xl border p-2 text-start outline-none transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${selected ? 'border-primary-700 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-primary-300'}`}
    >
      <span className={`theme-thumb theme-thumb--${A4_TEMPLATE_REGISTRY[option.value].thumbnailClass}`} aria-hidden="true"><i className="thumb-brand" /><i className="thumb-title" /><i className="thumb-from" /><i className="thumb-to" /><i className="thumb-meta" /><i className="thumb-table" /><i className="thumb-qr" /><i className="thumb-total" /></span>
      <span className="mt-1.5 flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-gray-900">{option.label}</span>{selected && <span className="grid h-4 w-4 place-items-center rounded-full bg-primary-700 text-white"><Check size={10} /></span>}</span>
      <span className="mt-0.5 block text-[9px] leading-3 text-gray-500">{option.description}</span>
    </button>
  })}</div></fieldset>
}

function ColourControl({
  label,
  value,
  presets,
  resetValue,
  resetLabel,
  allowWhite,
  onChange,
  onUnsafe,
}: {
  label: string
  value: string
  presets: readonly string[]
  resetValue: string
  resetLabel: string
  allowWhite: boolean
  onChange: (value: string) => void
  onUnsafe: () => void
}) {
  const [hexDraft, setHexDraft] = useState(value)
  useEffect(() => setHexDraft(value), [value])
  const commit = (next: string) => {
    const normalized = next.toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      setHexDraft(value)
      return
    }
    if (!allowWhite && !hasSafeTextContrast(normalized, '#ffffff')) {
      onUnsafe()
      setHexDraft(value)
      return
    }
    setHexDraft(normalized)
    onChange(normalized)
  }
  return <fieldset><legend className="text-xs font-semibold text-gray-800">{label}</legend><div className="mt-2 flex flex-wrap items-center gap-2">
    {presets.map((colour, index) => <button key={`${colour}-${index}`} type="button" aria-label={`${label} ${colour}`} aria-pressed={value === colour} onClick={() => commit(colour)} className={`h-8 w-8 rounded-full border-[3px] outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${value === colour ? 'border-blue-600' : colour === '#ffffff' ? 'border-gray-500' : 'border-gray-200'}`} style={{ backgroundColor: colour }} />)}
    <input aria-label={`${label} picker`} type="color" value={value} onChange={event => commit(event.target.value)} className="h-9 w-11 rounded border border-gray-200 bg-white p-1" />
    <input aria-label={`${label} hex`} value={hexDraft} onChange={event => setHexDraft(event.target.value)} onBlur={() => commit(hexDraft)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(hexDraft) } }} maxLength={7} spellCheck={false} className="h-9 w-24 rounded-lg border border-gray-200 px-2 font-mono text-[11px] uppercase" />
    <button type="button" onClick={() => commit(resetValue)} className="text-[11px] font-semibold text-gray-600 underline">{resetLabel}</button>
  </div></fieldset>
}

function A4LayoutComparison({ model, options, qrImageUrl, label }: {
  model: DocumentViewModel
  options: Array<{ value: A4TemplateId; label: string }>
  qrImageUrl: string | null
  label: string
}) {
  const scale = .19
  return <details className="rounded-xl border border-gray-200 bg-white">
    <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-bold text-gray-800">{label}</summary>
    <div className="grid grid-cols-2 gap-2 border-t border-gray-200 bg-gray-50 p-2 2xl:grid-cols-3">
      {options.map(option => {
        const comparisonModel: DocumentViewModel = {
          ...model,
          template: {
            ...model.template,
            requestedId: option.value,
            resolvedId: option.value,
            requestedVersion: 1,
            resolvedVersion: 1,
            fallback: false,
            fallbackReason: null,
          },
        }
        return <figure key={option.value} className="min-w-0 rounded-lg border border-gray-200 bg-white p-1.5">
          <figcaption className="mb-1 truncate text-[9px] font-bold text-gray-700">{option.label}</figcaption>
          <div className="mx-auto overflow-hidden border border-gray-200 bg-white" style={{ width: 794 * scale, height: 1123 * scale }}>
            <div style={{ width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <A4Document model={comparisonModel} options={{ preview: true, qrImageUrl, sampleLabel: 'PREVIEW' }} />
            </div>
          </div>
        </figure>
      })}
    </div>
  </details>
}

function ReceiptThemeChoice({ value, onChange, t }: { value: ThermalDensity; onChange: (value: ThermalDensity) => void; t: (key: string) => string }) {
  const themes: Array<{ id: ThermalDensity; name: string; use: string; colour: string }> = [
    { id: 'classic', name: t('printing:invoiceSettings.receiptThemes.classic'), use: t('printing:invoiceSettings.receiptThemes.classicUse'), colour: t('printing:invoiceSettings.receiptThemes.original') },
    { id: 'compact', name: t('printing:invoiceSettings.receiptThemes.compact'), use: t('printing:invoiceSettings.receiptThemes.compactUse'), colour: t('printing:invoiceSettings.receiptThemes.monochrome') },
    { id: 'standard', name: t('printing:invoiceSettings.receiptThemes.structured'), use: t('printing:invoiceSettings.receiptThemes.structuredUse'), colour: t('printing:invoiceSettings.receiptThemes.ledger') },
    { id: 'detailed', name: t('printing:invoiceSettings.receiptThemes.branded'), use: t('printing:invoiceSettings.receiptThemes.brandedUse'), colour: t('printing:invoiceSettings.receiptThemes.kubri') },
  ]
  return <fieldset><legend className="text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.receiptThemes.title')}</legend><div className="mt-2 grid gap-1.5">{themes.map(theme => <button key={theme.id} type="button" role="radio" aria-checked={value === theme.id} onClick={() => onChange(theme.id)} className={`grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 rounded-xl border p-2 text-start outline-none transition-[border-color,background-color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${value === theme.id ? 'border-primary-700 bg-primary-50' : 'border-gray-200 hover:border-primary-300'}`}><span className={`receipt-theme-thumb receipt-theme-thumb--${theme.id}`} aria-hidden="true"><span className="receipt-theme-thumb__brand" /><span className="receipt-theme-thumb__meta" /><span className="receipt-theme-thumb__items" /><span className="receipt-theme-thumb__total" /><span className="receipt-theme-thumb__qr" /></span><span><span className="flex items-center justify-between gap-2 text-xs font-bold text-gray-900">{theme.name}{value === theme.id && <Check size={13} className="text-primary-700" />}</span><span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{theme.use}</span><span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-primary-700">{theme.colour}</span></span></button>)}</div></fieldset>
}

function ToggleRow({ label, checked, onChange, disabled = false, help }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; help?: string }) {
  return <label className={`flex min-h-12 items-center justify-between gap-4 rounded-xl border px-3 py-2.5 ${disabled ? 'bg-gray-50 opacity-60' : 'bg-white'}`}><span><span className="block text-xs font-semibold text-gray-800">{label}</span>{help && <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{help}</span>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-primary-700" /></label>
}

function TextField({ id, label, value, onChange, placeholder, disabled = false, error, multiline = false }: { id: string; label: string; value: string | null; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; error?: string; multiline?: boolean }) {
  const props = { id, value: value ?? '', disabled, placeholder, 'aria-invalid': !!error || undefined, 'aria-describedby': error ? `${id}-error` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), className: 'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50' }
  return <div><label htmlFor={id} className="text-xs font-semibold text-gray-800">{label}</label>{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}{error && <p id={`${id}-error`} className="mt-1 text-[11px] text-red-600">{error}</p>}</div>
}

export default function InvoiceSettingsPage({
  embedded = false,
  workspace = 'invoices',
  onDirtyChange,
}: {
  embedded?: boolean
  workspace?: 'receipts' | 'invoices'
  onDirtyChange?: (dirty: boolean) => void
} = {}) {
  const { t, i18n } = useTranslation(['settings', 'common', 'printing'])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const allowedSections = useMemo<readonly Tab[]>(() => workspace === 'receipts'
    ? ['general', 'branding', 'contact', 'thermal']
    : ['general', 'branding', 'contact', 'a4'], [workspace])
  const requestedSection = searchParams.get('section') as Tab | null
  const [activeTab, setActiveTab] = useState<Tab>(
    requestedSection && allowedSections.includes(requestedSection)
      ? requestedSection
      : workspace === 'receipts' ? 'thermal' : 'general',
  )
  const [previewMode, setPreviewMode] = useState<PreviewMode>(workspace === 'receipts' ? 'thermal' : 'a4')
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false)
  const [previewZoom, setPreviewZoom] = useState<A4PreviewZoom>('page')
  const [a4PageCount, setA4PageCount] = useState(1)
  const [previewQrState, setPreviewQrState] = useState<PreviewQrState>('eligible_simplified')
  const [previewQrUrl, setPreviewQrUrl] = useState<string | null>(null)
  const [artworkSource, setArtworkSource] = useState<LetterheadSource | null>(null)
  const [headerCrop, setHeaderCrop] = useState<LetterheadCrop>({ top: 0, height: 18 })
  const [footerCrop, setFooterCrop] = useState<LetterheadCrop>({ top: 92, height: 8 })
  const [includeFooterCrop, setIncludeFooterCrop] = useState(false)
  const [artworkZoom, setArtworkZoom] = useState(1)
  const [pendingRoute, setPendingRoute] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const headerInput = useRef<HTMLInputElement>(null)
  const branch = branches.find(item => item.id === branchId) ?? null
  const isDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])
  useEffect(() => {
    const requested = searchParams.get('section') as Tab | null
    if (requested && allowedSections.includes(requested)) {
      setActiveTab(requested)
      return
    }
    const fallback: Tab = workspace === 'receipts' ? 'thermal' : 'general'
    setActiveTab(fallback)
    const next = new URLSearchParams(searchParams)
    next.set('section', fallback)
    setSearchParams(next, { replace: true })
  }, [allowedSections, searchParams, setSearchParams, workspace])

  useEffect(() => { if (!authLoading) void loadBranches() }, [authLoading, profile?.branch_id, profile?.tenant_id])
  useEffect(() => { if (branchId && branch) void loadSettings(branch) }, [branchId, branch?.id])
  useEffect(() => {
    let active = true
    void createPreviewQrDataUrl(previewQrState).then(url => { if (active) setPreviewQrUrl(url) })
    return () => { active = false }
  }, [previewQrState])
  useEffect(() => () => artworkSource?.release(), [artworkSource])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = '' } }
    const routeGuard = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
      if (!isDirty || !anchor) return
      event.preventDefault()
      event.stopPropagation()
      setPendingRoute(anchor.getAttribute('href'))
    }
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
      const payload: UpdateBranchInvoiceSettingsPayload = {
        branch_id: branchId,
        invoice_language: normalized.invoiceLanguage === 'ar' ? 'ar' : 'both',
        print_mode: normalized.printMode,
        presentation_settings: presentationSettings,
      }
      const { data, error } = await rpc('update_branch_invoice_settings', { p_payload: payload })
      if (error) throw error
      const next = fromResponse(data, branch ?? ({} as Branch))
      setDraft(next); setSaved(next); setSaveOk(true)
    } catch (error) {
      const rpcError = error as PostgrestError
      if (import.meta.env.DEV) {
        console.warn('Invoice settings RPC rejected the save', {
          code: rpcError.code,
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
        })
      }
      setSaveError(t(`printing:invoiceSettings.errors.${saveErrorKey(rpcError)}`))
    }
    finally { setSaving(false) }
  }
  function resetChanges() { if (saved) { setDraft(saved); setSaveError(null); setSaveOk(false) } }
  function artworkValidationMessage(error: LetterheadValidationError, file?: File) {
    if (error.code === 'size') return file
      ? t('printing:invoiceSettings.a4.errors.sourceSize', { size: formatArtworkBytes(file.size), max: formatArtworkBytes(LETTERHEAD_MAX_SOURCE_BYTES) })
      : t('printing:invoiceSettings.a4.errors.derivativeSize')
    return t(`printing:invoiceSettings.a4.errors.${error.code}`)
  }
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
  async function selectLetterheadSource(file: File) {
    setSaveError(null)
    setSaveOk(false)
    setUploading(true)
    try {
      const source = await loadLetterheadSource(file)
      const crops = defaultLetterheadCrops(source)
      setArtworkSource(source)
      setHeaderCrop(crops.header)
      setFooterCrop(crops.footer)
      setIncludeFooterCrop(source.height / source.width > .7)
      setArtworkZoom(1)
    } catch (error) {
      setArtworkSource(null)
      setSaveError(error instanceof LetterheadValidationError ? artworkValidationMessage(error, file) : t('printing:invoiceSettings.a4.errors.inspect'))
    } finally {
      setUploading(false)
    }
  }

  async function extractAndUploadArtwork() {
    if (!draft || !branch || !profile?.tenant_id || !canEdit || !artworkSource) return
    setUploading(true)
    setSaveError(null)
    const uploaded: string[] = []
    try {
      const header = await cropLetterheadRegion(artworkSource, headerCrop)
      const footer = includeFooterCrop ? await cropLetterheadRegion(artworkSource, footerCrop) : null
      const assetId = crypto.randomUUID()
      const headerPath = invoiceArtworkObjectPath(profile.tenant_id, branch.id, assetId, 'header', header.extension)
      const headerUpload = await supabase.storage.from('invoice-artwork').upload(headerPath, header.blob, { contentType: header.blob.type, upsert: false })
      if (headerUpload.error) throw headerUpload.error
      uploaded.push(headerPath)
      let footerPath: string | null = null
      if (footer) {
        footerPath = invoiceArtworkObjectPath(profile.tenant_id, branch.id, assetId, 'footer', footer.extension)
        const footerUpload = await supabase.storage.from('invoice-artwork').upload(footerPath, footer.blob, { contentType: footer.blob.type, upsert: false })
        if (footerUpload.error) throw footerUpload.error
        uploaded.push(footerPath)
      }
      updateDraft(current => ({
        ...current,
        presentation: {
          ...current.presentation,
          a4: {
            ...current.presentation.a4,
            header_asset_path: headerPath,
            header_asset_version: current.presentation.a4.header_asset_version + 1,
            header_asset_enabled: true,
            show_standard_branding: current.presentation.a4.header_asset_enabled || current.presentation.a4.header_asset_path
              ? current.presentation.a4.show_standard_branding
              : false,
            header_crop_top: Math.round(headerCrop.top),
            header_crop_height: Math.round(headerCrop.height),
            footer_asset_path: footerPath,
            footer_asset_version: footerPath ? current.presentation.a4.footer_asset_version + 1 : current.presentation.a4.footer_asset_version,
            footer_asset_enabled: !!footerPath,
            footer_crop_top: Math.round(footerCrop.top),
            footer_crop_height: Math.round(footerCrop.height),
            artwork_template_id: current.presentation.a4.template_id,
          },
        },
      }))
      setArtworkSource(null)
    } catch (error) {
      if (uploaded.length > 0) await supabase.storage.from('invoice-artwork').remove(uploaded)
      const message = error instanceof Error ? error.message : 'Artwork extraction failed.'
      setSaveError(
        /row-level security|bucket not found|not found/i.test(message)
          ? t('printing:invoiceSettings.a4.errors.storage')
          : error instanceof LetterheadValidationError
            ? artworkValidationMessage(error)
            : t('printing:invoiceSettings.a4.errors.extract'),
      )
    } finally {
      setUploading(false)
    }
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
    { id: 'general', label: t(`printing:workspace.sections.${workspace}.general`) },
    { id: 'branding', label: t(`printing:workspace.sections.${workspace}.branding`) },
    { id: 'contact', label: t(`printing:workspace.sections.${workspace}.contact`) },
    { id: 'thermal', label: t('printing:workspace.sections.receipts.thermal') },
    { id: 'a4', label: t('printing:workspace.sections.invoices.a4') },
  ]
  const tabs = allTabs.filter(tab => workspace === 'receipts' ? tab.id !== 'a4' : tab.id !== 'thermal')
  const sectionIcons: Record<Tab, React.ElementType> = {
    general: Settings2,
    branding: Palette,
    contact: Users,
    thermal: ReceiptText,
    a4: LayoutTemplate,
  }
  const sections = tabs.map(tab => ({ ...tab, icon: sectionIcons[tab.id] }))
  const selectSection = (id: string) => {
    const nextSection = allowedSections.includes(id as Tab) ? id as Tab : workspace === 'receipts' ? 'thermal' : 'general'
    setActiveTab(nextSection)
    setPreviewMode(nextSection === 'thermal' ? 'thermal' : workspace === 'invoices' ? 'a4' : previewMode)
    const next = new URLSearchParams(searchParams)
    next.set('section', nextSection)
    setSearchParams(next)
  }
  const actionOptions = [{ value: 'receipt' as const, label: t('printing:invoiceSettings.actions.receiptOnly'), description: t('printing:invoiceSettings.actions.receiptHelp') }, { value: 'a4' as const, label: t('printing:invoiceSettings.actions.a4Only'), description: t('printing:invoiceSettings.actions.a4Help') }, { value: 'both' as const, label: t('printing:invoiceSettings.actions.both'), description: t('printing:invoiceSettings.actions.bothHelp') }]
  const themeKeys: Record<A4TemplateId, { label: string; help: string }> = {
    classic: { label: 'classic', help: 'classicHelp' },
    modern_split: { label: 'modern', help: 'modernHelp' },
    minimal_professional: { label: 'minimal', help: 'minimalHelp' },
    executive_green: { label: 'executive', help: 'executiveHelp' },
    clean_ledger: { label: 'ledger', help: 'ledgerHelp' },
    contemporary_border: { label: 'contemporary', help: 'contemporaryHelp' },
  }
  const themeOptions = A4_TEMPLATE_IDS.map(value => ({ value, label: t(`printing:invoiceSettings.a4.${themeKeys[value].label}`), description: t(`printing:invoiceSettings.a4.${themeKeys[value].help}`) }))
  const validationErrors = validate(draft)

  return <div className={`invoice-editor-shell flex min-h-0 flex-col ${embedded ? '' : 'min-h-[720px]'}`}>
    {!embedded && <header className="border-b border-gray-200 pb-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{t('printing:invoiceSettings.eyebrow')}</p><h1 className="mt-1 text-2xl font-bold text-gray-950">{t('printing:invoiceSettings.title')}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{t('printing:invoiceSettings.subtitle')}</p></div>{branches.length > 1 && <label className="min-w-48 text-xs font-semibold text-gray-700">{t('printing:invoiceSettings.branch')}<select value={branchId ?? ''} onChange={event => setBranchId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"><option value="" disabled>{t('printing:invoiceSettings.selectBranch')}</option>{branches.map(item => <option key={item.id} value={item.id}>{resolveBranchDisplayName(item, i18n.resolvedLanguage?.startsWith('ar') === true)}</option>)}</select></label>}</div></header>}
    <DocumentStudioWorkspace
      configurationLabel={t('workspace.studio.configuration')}
      previewLabel={t('printing:invoiceSettings.livePreview')}
      settingsLabel={t('workspace.studio.settings')}
      closeSettingsLabel={t('workspace.studio.closeSettings')}
      previewOverflow={previewMode === 'a4' ? 'hidden' : 'auto'}
      sectionNavigation={<DocumentStudioSectionNav sections={sections} activeSection={activeTab} onSelect={selectSection} label={t('printing:invoiceSettings.sections')} />}
      configuration={<>
        {!canEdit && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">{t('printing:invoiceSettings.readOnly')}</div>}
        <fieldset disabled={!canEdit} className="space-y-5">
        {activeTab === 'general' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">{t('printing:invoiceSettings.tabs.general')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('printing:invoiceSettings.general.help')}</p></div><Choice label={t('printing:invoiceSettings.general.language')} value={draft.invoiceLanguage === 'en' ? 'both' : draft.invoiceLanguage} onChange={value => updateDraft(current => ({ ...current, invoiceLanguage: value }))} options={[{ value: 'ar', label: t('printing:invoiceSettings.general.arabic') }, { value: 'both', label: t('printing:invoiceSettings.general.bilingual') }]} /><Choice label={t('printing:invoiceSettings.general.afterSale')} value={draft.afterSaleAction ?? 'receipt'} onChange={value => updateDraft(current => ({ ...current, afterSaleAction: value }))} options={actionOptions} /></div>}
        {activeTab === 'branding' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">{t('printing:invoiceSettings.tabs.branding')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('printing:invoiceSettings.branding.help')}</p></div><ToggleRow label={t('printing:invoiceSettings.branding.useBranch')} checked={useBranchName} onChange={setUseBranchName} help={branchName ? t('printing:invoiceSettings.branding.resolvedBranch', { name: branchName }) : undefined} /><TextField id="display-heading" label={t('printing:invoiceSettings.branding.heading')} value={p.identity.display_heading} disabled={useBranchName} onChange={value => updateSection('identity', 'display_heading', value)} placeholder={t('printing:invoiceSettings.branding.headingPlaceholder')} /><TextField id="display-subheading" label={t('printing:invoiceSettings.branding.subheading')} value={p.identity.display_subheading} onChange={value => updateSection('identity', 'display_subheading', value)} placeholder={t('printing:invoiceSettings.branding.optionalPlaceholder')} /><ToggleRow label={t('printing:invoiceSettings.branding.showLegal')} checked={p.identity.show_company_name} onChange={value => updateSection('identity', 'show_company_name', value)} help={t('printing:invoiceSettings.branding.legalHelp')} /><div className="rounded-2xl border border-dashed border-gray-300 p-4"><div className="flex items-center gap-4"><div className="grid h-20 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-gray-50">{logoSrc ? <img src={logoSrc} alt={t('printing:invoiceSettings.branding.logoAlt')} className="h-full w-full object-contain" /> : <FileText className="text-gray-300" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.branding.logo')}</p><p className="mt-1 text-[11px] text-gray-500">{t('printing:invoiceSettings.branding.logoHelp')}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={uploading} onClick={() => logoInput.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Upload size={14} />{t(uploading ? 'printing:invoiceSettings.branding.uploading' : 'printing:invoiceSettings.branding.replace')}</button><button type="button" disabled={!p.logo.asset_path} onClick={() => setConfirmRemoveLogo(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} />{t('printing:invoiceSettings.branding.remove')}</button></div><input ref={logoInput} type="file" className="sr-only" accept={LOGO_MIME_TYPES.join(',')} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = '' }} /></div></div></div><Choice label={t('printing:invoiceSettings.branding.logoSize')} value={p.logo.size} onChange={value => updateSection('logo', 'size', value)} options={[{ value: 'small', label: t('printing:invoiceSettings.values.small') }, { value: 'medium', label: t('printing:invoiceSettings.values.medium') }, { value: 'large', label: t('printing:invoiceSettings.values.large') }]} /></div>}
        {activeTab === 'contact' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">{t('printing:invoiceSettings.tabs.contact')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('printing:invoiceSettings.contact.help')}</p></div><ToggleRow label={t('printing:invoiceSettings.contact.showPhone')} checked={p.contact.show_phone} onChange={value => updateSection('contact', 'show_phone', value)} />{p.contact.show_phone && <TextField id="phone" label={t('printing:invoiceSettings.contact.phone')} value={p.contact.phone} onChange={value => updateSection('contact', 'phone', value)} placeholder={branch?.phone ?? t('printing:invoiceSettings.contact.inheritPhone')} />}<ToggleRow label={t('printing:invoiceSettings.contact.showEmail')} checked={p.contact.show_email} onChange={value => updateSection('contact', 'show_email', value)} />{p.contact.show_email && <TextField id="email" label={t('printing:invoiceSettings.contact.email')} value={p.contact.email} onChange={value => updateSection('contact', 'email', value)} placeholder="hello@example.com" />}<ToggleRow label={t('printing:invoiceSettings.contact.showWebsite')} checked={p.contact.show_website} onChange={value => updateSection('contact', 'show_website', value)} />{p.contact.show_website && <TextField id="website" label={t('printing:invoiceSettings.contact.website')} value={p.contact.website} onChange={value => updateSection('contact', 'website', value)} placeholder="https://example.com" />}<ToggleRow label={t('printing:invoiceSettings.contact.showAddress')} checked={p.contact.show_address} onChange={value => updateSection('contact', 'show_address', value)} />{p.contact.show_address && <TextField id="address-override" label={t('printing:invoiceSettings.contact.address')} value={p.contact.address_override} onChange={value => updateSection('contact', 'address_override', value)} placeholder={branch?.address ?? t('printing:invoiceSettings.contact.inheritAddress')} multiline />}<TextField id="footer-message" label={t('printing:invoiceSettings.contact.footer')} value={p.footer.footer_note} onChange={value => updateSection('footer', 'footer_note', value)} placeholder={t('printing:invoiceSettings.contact.footerPlaceholder')} multiline /></div>}
        {activeTab === 'thermal' && <div className="space-y-5"><div><h2 className="text-base font-bold text-gray-950">{t('printing:invoiceSettings.tabs.thermal')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('printing:invoiceSettings.thermal.help')}</p></div><ReceiptThemeChoice value={p.thermal.density} onChange={value => { updateSection('thermal', 'density', value); setPreviewMode('thermal') }} t={t} /><Choice label={t('printing:invoiceSettings.thermal.paperWidth')} value={p.thermal.width} onChange={value => updateSection('thermal', 'width', value)} options={[{ value: '58mm', label: '58 mm' }, { value: '80mm', label: '80 mm' }]} /><Choice label={t('printing:invoiceSettings.thermal.qrSize')} value={p.thermal.qr_size} onChange={value => updateSection('thermal', 'qr_size', value)} options={[{ value: 'small', label: t('printing:invoiceSettings.values.small') }, { value: 'standard', label: t('printing:invoiceSettings.values.medium') }, { value: 'large', label: t('printing:invoiceSettings.values.large') }]} /><ToggleRow label={t('printing:invoiceSettings.thermal.wrapNames')} checked={p.thermal.wrap_item_names} onChange={value => updateSection('thermal', 'wrap_item_names', value)} /><ToggleRow label={t('printing:invoiceSettings.thermal.showChange')} checked={p.thermal.show_cash_change} onChange={value => updateSection('thermal', 'show_cash_change', value)} /></div>}
        {activeTab === 'a4' && <div className="space-y-6">
          <div><h2 className="text-base font-bold text-gray-950">{t('printing:invoiceSettings.tabs.a4')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('printing:invoiceSettings.a4.help')}</p></div>
          <ThemeChoice label={t('printing:invoiceSettings.a4.layout')} value={p.a4.template_id} onChange={value => { updateSection('a4', 'template_id', value); setPreviewMode('a4') }} options={themeOptions} />
          <A4LayoutComparison model={previewModel} options={themeOptions} qrImageUrl={previewQrUrl} label={t('printing:invoiceSettings.a4.compareLayouts')} />
          <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <ColourControl label={t('printing:invoiceSettings.a4.accent')} value={p.a4.accent_color} presets={A4_ACCENT_PRESETS} resetValue={A4_LAYOUT_COLOR_DEFAULTS[p.a4.template_id].accent} resetLabel={t('printing:invoiceSettings.a4.resetColour')} allowWhite onChange={value => updateSection('a4', 'accent_color', value)} onUnsafe={() => setSaveError(t('printing:invoiceSettings.a4.unsafeColour'))} />
            <ColourControl label={t('printing:invoiceSettings.a4.headingColour')} value={p.a4.heading_color} presets={A4_ACCENT_PRESETS} resetValue={A4_LAYOUT_COLOR_DEFAULTS[p.a4.template_id].heading} resetLabel={t('printing:invoiceSettings.a4.resetColour')} allowWhite={false} onChange={value => updateSection('a4', 'heading_color', value)} onUnsafe={() => setSaveError(t('printing:invoiceSettings.a4.unsafeColour'))} />
            <ColourControl label={t('printing:invoiceSettings.a4.bodyColour')} value={p.a4.body_color} presets={A4_ACCENT_PRESETS} resetValue={A4_LAYOUT_COLOR_DEFAULTS[p.a4.template_id].body} resetLabel={t('printing:invoiceSettings.a4.resetColour')} allowWhite={false} onChange={value => updateSection('a4', 'body_color', value)} onUnsafe={() => setSaveError(t('printing:invoiceSettings.a4.unsafeColour'))} />
            <ToggleRow label={t('printing:invoiceSettings.a4.autoForeground')} checked={p.a4.auto_foreground} onChange={value => updateSection('a4', 'auto_foreground', value)} help={t('printing:invoiceSettings.a4.autoForegroundHelp')} />
          </section>
          <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xs font-bold text-gray-900">{t('printing:invoiceSettings.a4.artwork')}</h3><p className="mt-1 max-w-md text-[11px] leading-4 text-gray-500">{t('printing:invoiceSettings.a4.artworkHelp')}</p></div><button type="button" onClick={() => headerInput.current?.click()} disabled={uploading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold disabled:opacity-50"><Upload size={14} />{uploading ? t('printing:invoiceSettings.branding.uploading') : p.a4.header_asset_path ? t('printing:invoiceSettings.a4.replaceArtwork') : t('printing:invoiceSettings.a4.uploadArtwork')}</button></div>
            <input ref={headerInput} type="file" className="sr-only" accept={LETTERHEAD_ACCEPT} onChange={event => { const file = event.target.files?.[0]; if (file) void selectLetterheadSource(file); event.target.value = '' }} />
            {artworkSource && <LetterheadCropPanel source={artworkSource} header={headerCrop} footer={footerCrop} includeFooter={includeFooterCrop} zoom={artworkZoom} disabled={uploading} onHeaderChange={setHeaderCrop} onFooterChange={setFooterCrop} onIncludeFooterChange={setIncludeFooterCrop} onZoomChange={setArtworkZoom} onReset={() => { const crops = defaultLetterheadCrops(artworkSource); setHeaderCrop(crops.header); setFooterCrop(crops.footer) }} onClear={() => setArtworkSource(null)} onApply={() => void extractAndUploadArtwork()} />}
            {(p.a4.header_asset_path || p.a4.footer_asset_path) && <div className="space-y-4 border-t border-gray-200 pt-4">
              <Choice label={t('printing:invoiceSettings.a4.applyScope')} value={p.a4.artwork_scope} onChange={value => updateDraft(current => ({ ...current, presentation: { ...current.presentation, a4: { ...current.presentation.a4, artwork_scope: value, artwork_template_id: current.presentation.a4.template_id } } }))} options={[{ value: 'all', label: t('printing:invoiceSettings.a4.allLayouts') }, { value: 'selected', label: t('printing:invoiceSettings.a4.selectedLayout') }]} />
              {p.a4.header_asset_path && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3"><ToggleRow label={t('printing:invoiceSettings.a4.enableHeader')} checked={p.a4.header_asset_enabled} onChange={value => updateSection('a4', 'header_asset_enabled', value)} /><ToggleRow label={t('printing:invoiceSettings.a4.showStandardBranding')} checked={p.a4.show_standard_branding} onChange={value => updateSection('a4', 'show_standard_branding', value)} help={t('printing:invoiceSettings.a4.showStandardBrandingHelp')} /><Choice label={t('printing:invoiceSettings.a4.fit')} value={p.a4.header_asset_fit} onChange={value => updateSection('a4', 'header_asset_fit', value)} options={[{ value: 'contain', label: t('printing:invoiceSettings.a4.contain') }, { value: 'cover', label: t('printing:invoiceSettings.a4.cover') }]} /><label className="block text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.a4.headerHeight')} · {p.a4.header_asset_height} mm<input type="range" min="8" max="70" value={p.a4.header_asset_height} onChange={event => updateSection('a4', 'header_asset_height', Number(event.target.value))} className="mt-2 w-full accent-primary-700" /></label><label className="block text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.a4.spacing')} · {p.a4.header_asset_spacing} mm<input type="range" min="0" max="16" value={p.a4.header_asset_spacing} onChange={event => updateSection('a4', 'header_asset_spacing', Number(event.target.value))} className="mt-2 w-full accent-primary-700" /></label></div>}
              {p.a4.footer_asset_path && <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"><ToggleRow label={t('printing:invoiceSettings.a4.enableFooter')} checked={p.a4.footer_asset_enabled} onChange={value => updateSection('a4', 'footer_asset_enabled', value)} /><Choice label={t('printing:invoiceSettings.a4.fit')} value={p.a4.footer_asset_fit} onChange={value => updateSection('a4', 'footer_asset_fit', value)} options={[{ value: 'contain', label: t('printing:invoiceSettings.a4.contain') }, { value: 'cover', label: t('printing:invoiceSettings.a4.cover') }]} /><label className="block text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.a4.footerHeight')} · {p.a4.footer_asset_height} mm<input type="range" min="4" max="35" value={p.a4.footer_asset_height} onChange={event => updateSection('a4', 'footer_asset_height', Number(event.target.value))} className="mt-2 w-full accent-primary-700" /></label><label className="block text-xs font-semibold text-gray-800">{t('printing:invoiceSettings.a4.spacing')} · {p.a4.footer_asset_spacing} mm<input type="range" min="0" max="16" value={p.a4.footer_asset_spacing} onChange={event => updateSection('a4', 'footer_asset_spacing', Number(event.target.value))} className="mt-2 w-full accent-primary-700" /></label></div>}
              <button type="button" onClick={() => updateDraft(current => ({ ...current, presentation: { ...current.presentation, a4: { ...current.presentation.a4, header_asset_path: null, header_asset_enabled: false, footer_asset_path: null, footer_asset_enabled: false } } }))} className="inline-flex items-center gap-2 text-xs font-semibold text-red-700"><Trash2 size={14} />{t('printing:invoiceSettings.a4.removeArtwork')}</button>
            </div>}
          </section>
        </div>}
        {activeTab === 'a4' && <p className="text-[11px] leading-4 text-gray-500">{t('printing:invoiceSettings.artworkDimensionsHelp')}</p>}
        {activeTab === 'branding' && <p className="mt-2 text-[11px] leading-4 text-gray-500">{t('printing:invoiceSettings.branding.legalReminder')}</p>}
        </fieldset>
      </>}
      previewToolbar={<DocumentStudioPreviewToolbar
        title={t('printing:invoiceSettings.livePreview')}
        meta={previewMode === 'thermal' ? p.thermal.width : t('printing:invoiceSettings.pageCount', { count: a4PageCount })}
      >
        <label className="sr-only" htmlFor={`${workspace}-preview-state`}>{t('printing:invoiceSettings.a4.qrPreviewState')}</label>
        <select id={`${workspace}-preview-state`} value={previewQrState} onChange={event => setPreviewQrState(event.target.value as PreviewQrState)} className="h-8 max-w-36 rounded-md border border-gray-200 bg-white px-2 text-[10px] font-medium">
          <option value="eligible_simplified">{t('printing:invoiceSettings.a4.qrEligibleSimplified')}</option>
          <option value="eligible_standard">{t('printing:invoiceSettings.a4.qrEligibleStandard')}</option>
          <option value="demo">{t('printing:invoiceSettings.a4.qrDemo')}</option>
          <option value="unavailable">{t('printing:invoiceSettings.a4.qrUnavailable')}</option>
        </select>
        {previewMode === 'a4' && <>
          <button type="button" onClick={() => setPreviewZoom('width')} className={`h-8 rounded-md px-2 text-[10px] font-bold ${previewZoom === 'width' ? 'bg-primary-50 text-primary-800' : 'text-gray-600 hover:bg-gray-50'}`}>{t('printing:invoiceSettings.fitWidth')}</button>
          <button type="button" onClick={() => setPreviewZoom('page')} className={`h-8 rounded-md px-2 text-[10px] font-bold ${previewZoom === 'page' ? 'bg-primary-50 text-primary-800' : 'text-gray-600 hover:bg-gray-50'}`}>{t('printing:invoiceSettings.fitPage')}</button>
          <button type="button" aria-label={t('printing:invoiceSettings.zoomOut')} onClick={() => setPreviewZoom(previewZoom === 1.25 ? 1 : previewZoom === 1 ? .75 : 'page')} className="grid h-8 w-8 place-items-center rounded-md text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><Minus size={14} /></button>
          <button type="button" aria-label={t('printing:invoiceSettings.zoomIn')} onClick={() => setPreviewZoom(previewZoom === 'page' || previewZoom === 'width' ? .75 : previewZoom === .75 ? 1 : 1.25)} className="grid h-8 w-8 place-items-center rounded-md text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><Plus size={14} /></button>
        </>}
      </DocumentStudioPreviewToolbar>}
      preview={previewMode === 'thermal'
        ? <div className="mx-auto flex min-h-full max-w-full items-start justify-center"><ThermalReceipt model={previewModel} options={{ preview: true, qrImageUrl: previewQrUrl, sampleLabel: t('printing:preview'), nonFiscalDemo: previewQrState === 'demo', qrUnavailable: previewQrState === 'unavailable' }} /></div>
        : <A4PreviewFit zoom={previewZoom} bounded onPageCountChange={setA4PageCount}><A4Document model={previewModel} options={{ preview: true, qrImageUrl: previewQrUrl, sampleLabel: t('printing:preview'), pageNumbers: true, nonFiscalDemo: previewQrState === 'demo' }} /></A4PreviewFit>}
      actionFooter={<DocumentStudioActionFooter status={
        saveError
          ? <span className="inline-flex items-center gap-2 text-red-700" role="alert"><AlertCircle size={14} />{saveError}</span>
          : validationErrors.length > 0
            ? <span className="inline-flex items-center gap-2 text-red-700" role="alert"><AlertCircle size={14} />{t('printing:workspace.studio.validation')}</span>
          : saveOk
            ? <SavedStatus>{t('printing:invoiceSettings.saved')}</SavedStatus>
            : <span className={isDirty ? 'font-semibold text-amber-800' : 'text-gray-500'}>{t(isDirty ? 'printing:invoiceSettings.unsaved' : 'printing:invoiceSettings.allSaved')}</span>
      }>
        <button type="button" onClick={resetChanges} disabled={!isDirty || saving} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition-transform duration-150 active:scale-[.97] disabled:opacity-40"><RotateCcw size={14} />{t('printing:invoiceSettings.reset')}</button>
        <button type="button" onClick={() => void saveChanges()} disabled={!canEdit || !isDirty || saving || validationErrors.length > 0} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-700 px-4 py-2 text-xs font-semibold text-white transition-transform duration-150 active:scale-[.97] disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{t('printing:invoiceSettings.save')}</button>
      </DocumentStudioActionFooter>}
    />
    <ConfirmDialog open={confirmRemoveLogo} kind="removeLogo" onClose={() => setConfirmRemoveLogo(false)} onConfirm={() => { updateSection('logo', 'asset_path', null); updateSection('logo', 'visible', false); setConfirmRemoveLogo(false) }} />
    <ConfirmDialog open={pendingRoute !== null} kind="discard" onClose={() => setPendingRoute(null)} onConfirm={() => { const route = pendingRoute; setPendingRoute(null); if (route) navigate(route) }} />
  </div>
}
