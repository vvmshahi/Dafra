import { useState, useEffect, useMemo } from 'react'
import { Upload, Check, Loader2, Info, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import type { Branch } from '@/types/database'
import { Switch as Toggle } from '@/components/ui/Switch'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { documentDirection, documentFontFamily, documentLabel, documentLabelLines, documentNames, normalizeDocumentLanguage } from '@/localization/documents'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  invoice_language: 'en' | 'ar' | 'both'
  display_name: string
  phone: string
  show_logo: boolean
  logo_url: string | null
  website: string
  email: string
  show_website: boolean
  show_email: boolean
  receipt_footer: string
  show_footer: boolean
  show_cash_change: boolean
  print_mode: 'thermal' | 'pdf' | 'both'
}

type FieldErrors = Partial<Record<keyof FormState | 'logo_file', string>>

const FOOTER_MAX_LENGTH = 500
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function normalizeWebsite(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function validateSettings(form: FormState, t: TFunction): FieldErrors {
  const errors: FieldErrors = {}
  const email = form.email.trim()
  const website = form.website.trim()
  const phone = form.phone.trim()

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = t('settings:invoiceSettings.emailInvalid')
  }

  if (website) {
    try {
      const url = new URL(normalizeWebsite(website))
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
        errors.website = t('settings:invoiceSettings.websiteInvalid')
      }
    } catch {
      errors.website = t('settings:invoiceSettings.websiteInvalid')
    }
  }

  if (phone && (!/^[0-9+\-() ]+$/.test(phone) || phone.length < 7 || phone.length > 50)) {
    errors.phone = t('settings:invoiceSettings.phoneInvalid')
  }

  if (form.receipt_footer.length > FOOTER_MAX_LENGTH) {
    errors.receipt_footer = t('settings:invoiceSettings.footerTooLong', { count: FOOTER_MAX_LENGTH })
  }

  return errors
}

function formSignature(form: FormState) {
  return JSON.stringify({
    ...form,
    display_name: form.display_name.trim(),
    phone: form.phone.trim(),
    website: form.website.trim(),
    email: form.email.trim(),
    receipt_footer: form.receipt_footer.trim(),
  })
}

// ── Sample data for live preview ──────────────────────────────────────────────

const PREVIEW_ITEMS: ThermalItem[] = [
  { name: 'Arabic coffee', nameAr: 'قهوة عربية', qty: 2, unitPrice: 18.00, lineTotal: 36.00 },
  { name: 'Chocolate cake', nameAr: 'كيك شوكولاتة', qty: 1, unitPrice: 22.00, lineTotal: 22.00 },
]
const PREVIEW_SUBTOTAL = 50.43
const PREVIEW_TAX      = 7.57
const PREVIEW_TOTAL    = 58.00

// ── InfoTip ───────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1.5 text-gray-400 hover:text-gray-600 cursor-help inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-100 hover:bg-gray-200 flex-shrink-0"
    >
      <Info size={8} />
    </span>
  )
}

// ── A4 Invoice Preview ────────────────────────────────────────────────────────

function A4InvoicePreview({ form, branch }: { form: FormState; branch: Branch | null }) {
  const documentLanguage = normalizeDocumentLanguage(form.invoice_language)
  const documentDir = documentDirection(documentLanguage)
  const brandName = form.display_name || branch?.business_name || branch?.name || 'Business Name'
  const brandNames = documentNames(documentLanguage, brandName, branch?.business_name_ar || branch?.name_ar)
  const address = [
    branch?.building_number ? `Building ${branch.building_number}` : null,
    branch?.street,
    branch?.district,
    branch?.city,
    branch?.postal_code || null,
  ].filter(Boolean).join(', ')

  return (
    <div dir={documentDir} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden text-[11px]" style={{ fontFamily: documentFontFamily(documentLanguage) }}>

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">

          {/* Seller info */}
          <div className="flex items-start gap-3">
            {form.logo_url && form.show_logo ? (
              <img src={form.logo_url} alt="logo" className="w-10 h-10 rounded-lg object-contain flex-shrink-0 border border-gray-100" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[#0F2419] flex items-center justify-center flex-shrink-0">
                <span className="text-[#D4AF37] font-black text-base leading-none">د</span>
              </div>
            )}
            <div>
              {brandNames.map((name, index) => <p key={name} className={index === 0 ? 'font-bold text-gray-900 text-sm' : 'text-gray-400 text-[10px]'} dir="auto">{name}</p>)}
              {address && <p className="text-gray-400 text-[10px] mt-0.5 max-w-[180px]">{address}</p>}
              <div className="flex flex-wrap gap-2.5 mt-1.5">
                {branch?.vat_number && (
                  <span className="text-[10px] text-gray-500"><span className="font-semibold text-gray-600">{documentLabel(documentLanguage, 'vatNumber')}:</span> <bdi dir="ltr">{branch.vat_number}</bdi></span>
                )}
                {branch?.cr_number && (
                  <span className="text-[10px] text-gray-500"><span className="font-semibold text-gray-600">{documentLabel(documentLanguage, 'crNumber')}:</span> <bdi dir="ltr">{branch.cr_number}</bdi></span>
                )}
              </div>
              {form.show_website && form.website && (
                <p className="text-[10px] text-gray-400 mt-0.5">{form.website}</p>
              )}
              {form.show_email && form.email && (
                <p className="text-[10px] text-gray-400">{form.email}</p>
              )}
            </div>
          </div>

          {/* Invoice meta */}
          <div className="text-end flex-shrink-0">
            <div className="mb-2">{documentLabelLines(documentLanguage, 'simplifiedTaxInvoice').map((line, index) => <p key={line} dir="auto" className={index === 0 ? 'font-bold text-[#0F2419] text-sm' : 'text-gray-400 text-[10px]'}>{line}</p>)}</div>
            <div className="space-y-0.5">
              <div className="flex justify-end gap-3">
                <span className="font-mono font-semibold text-gray-800">INV-0042</span>
                <span className="text-gray-400 uppercase tracking-wide text-[9px]">{documentLabel(documentLanguage, 'invoiceNumber')}</span>
              </div>
              <div className="flex justify-end gap-3">
                <span className="text-gray-700">15 Jan 2026</span>
                <span className="text-gray-400 uppercase tracking-wide text-[9px]">{documentLabel(documentLanguage, 'date')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="px-5 py-3">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-start py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{documentLabel(documentLanguage, 'item')}</th>
              <th className="text-end py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide w-10">{documentLabel(documentLanguage, 'quantity')}</th>
              <th className="text-end py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide w-20">{documentLabel(documentLanguage, 'totalIncludingVat')}</th>
            </tr>
          </thead>
          <tbody>
            {PREVIEW_ITEMS.map((item, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2 text-gray-800">{documentNames(documentLanguage, item.name, item.nameAr).map(name => <span key={name} className="block" dir="auto">{name}</span>)}</td>
                <td className="py-2 text-end text-gray-600" dir="ltr">{item.qty}</td>
                <td className="py-2 text-end font-medium text-gray-900" dir="ltr">SAR {item.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="px-5 pb-4">
        <div className="flex justify-end">
          <div className="w-48 space-y-1 bg-gray-50 rounded-lg px-3 py-2.5">
            <div className="flex justify-between text-gray-600">
              <span>{documentLabel(documentLanguage, 'amountBeforeVat')}</span><span dir="ltr">SAR {PREVIEW_SUBTOTAL.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
              <span className="font-semibold">{documentLabel(documentLanguage, 'vatAmount')} 15%</span>
              <span className="font-semibold" dir="ltr">SAR {PREVIEW_TAX.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1">
              <span>{documentLabel(documentLanguage, 'totalIncludingVat')}</span><span dir="ltr">SAR {PREVIEW_TOTAL.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-[8px] text-center leading-tight">
          {documentLabel(documentLanguage, 'qrCode')}
        </div>
        <div className="text-[9px] text-gray-400 space-y-0.5">
          <p className="font-semibold">{documentLabel(documentLanguage, 'qrCode')}</p>
          {form.show_footer && form.receipt_footer && (
            <p className="text-gray-500">{form.receipt_footer}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── InvoiceSettingsPage ───────────────────────────────────────────────────────

export default function InvoiceSettingsPage() {
  const { t } = useTranslation(['settings', 'printing'])
  const { profile, loading: authLoading } = useAuth()

  const [branch,       setBranch]       = useState<Branch | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saveOk,       setSaveOk]       = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<FieldErrors>({})
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const [savedForm, setSavedForm] = useState<FormState | null>(null)
  const [uploadedLogoPendingSave, setUploadedLogoPendingSave] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [previewMode,  setPreviewMode]  = useState<'thermal' | 'a4'>('thermal')

  const [form, setForm] = useState<FormState>({
    invoice_language: 'both',
    display_name:     '',
    phone:            '',
    show_logo:        true,
    logo_url:         null,
    website:          '',
    email:            '',
    show_website:     false,
    show_email:       false,
    receipt_footer:   '',
    show_footer:      true,
    show_cash_change: true,
    print_mode:       'thermal',
  })

  useEffect(() => {
    if (authLoading) return  // wait for auth before deciding
    const bid = profile?.branch_id
    if (!bid) { setLoading(false); return }
    supabase.from('branches').select('*').eq('id', bid).single().then(({ data, error }) => {
      if (error) { console.error('[InvoiceSettings] branch fetch:', error.message) }
      if (data) {
        const b = data as Branch
        setBranch(b)
        const nextForm: FormState = {
          invoice_language: normalizeDocumentLanguage(b.invoice_language),
          display_name:     b.display_name     ?? '',
          phone:            b.phone            ?? '',
          show_logo:        b.show_logo        ?? true,
          logo_url:         b.logo_url         ?? null,
          website:          b.website          ?? '',
          email:            b.email            ?? '',
          show_website:     b.show_website     ?? false,
          show_email:       b.show_email       ?? false,
          receipt_footer:   b.receipt_footer   ?? '',
          show_footer:      b.show_footer      ?? true,
          show_cash_change: b.show_cash_change ?? true,
          print_mode:       (b.print_mode as 'thermal' | 'pdf' | 'both') ?? 'thermal',
        }
        setForm(nextForm)
        setSavedForm(nextForm)
        setSavedSignature(formSignature(nextForm))
      }
      setLoading(false)
    })
  }, [profile?.branch_id, authLoading])

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: val }))
    setSaveOk(false)
    setSaveError(null)
    setFieldErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const currentErrors = useMemo(() => validateSettings(form, t), [form, t])
  const hasValidationErrors = Object.keys(currentErrors).length > 0
  const hasUnsavedChanges = savedSignature !== null && formSignature(form) !== savedSignature
  const saveDisabled = saving || !hasUnsavedChanges || hasValidationErrors

  async function uploadLogo(file: File) {
    const bid = profile?.branch_id
    if (!bid) return
    setSaveError(null)
    setSaveOk(false)
    if (!LOGO_MIME_TYPES.includes(file.type)) {
      setFieldErrors(prev => ({ ...prev, logo_file: t('settings:invoiceSettings.logoTypeInvalid') }))
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFieldErrors(prev => ({ ...prev, logo_file: t('settings:invoiceSettings.logoTooLarge') }))
      return
    }
    setFieldErrors(prev => {
      const next = { ...prev }
      delete next.logo_file
      return next
    })
    setUploadingLogo(true)
    try {
      const ext  = file.name.split('.').pop() ?? 'png'
      const path = `${bid}/logo.${ext}`
      const { error } = await supabase.storage.from('branch-assets').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('branch-assets').getPublicUrl(path)
      set('logo_url', urlData.publicUrl)
      setUploadedLogoPendingSave(true)
    } catch (err: any) {
      setSaveError(err?.message ?? t('settings:invoiceSettings.logoUploadFailed'))
    } finally {
      setUploadingLogo(false)
    }
  }

  async function save() {
    const bid = profile?.branch_id
    if (!bid) return
    setSaving(true)
    setSaveError(null)
    setFieldErrors({})
    setSaveOk(false)
    try {
      const validationErrors = validateSettings(form, t)
      if (Object.keys(validationErrors).length > 0) {
        setFieldErrors(validationErrors)
        return
      }
      const normalizedWebsite = normalizeWebsite(form.website)
      const payload = {
        branch_id:         bid,
        invoice_language: form.invoice_language,
        display_name:     form.display_name.trim()     || null,
        phone:            form.phone.trim()            || null,
        show_logo:        form.show_logo,
        logo_url:         form.logo_url,
        website:          normalizedWebsite             || null,
        email:            form.email.trim()             || null,
        show_website:     form.show_website,
        show_email:       form.show_email,
        receipt_footer:   form.receipt_footer.trim()   || null,
        show_footer:      form.show_footer,
        show_cash_change: form.show_cash_change,
        print_mode:       form.print_mode,
      }
      const { error } = await (supabase as any).rpc('update_branch_invoice_settings', {
        p_payload: payload,
      })
      if (error) throw error
      const savedForm: FormState = {
        ...form,
        display_name: form.display_name.trim(),
        phone: form.phone.trim(),
        website: normalizedWebsite,
        email: form.email.trim(),
        receipt_footer: form.receipt_footer.trim(),
      }
      setForm(savedForm)
      setSavedForm(savedForm)
      setBranch(prev => prev ? { ...prev, ...payload } : prev)
      setSavedSignature(formSignature(savedForm))
      setUploadedLogoPendingSave(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    } catch (err: any) {
      setSaveError(err?.message ?? t('settings:invoiceSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function cancelChanges() {
    if (!savedForm || saving) return
    setForm(savedForm)
    setFieldErrors({})
    setSaveError(null)
    setSaveOk(false)
    setUploadedLogoPendingSave(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const previewBrandName = form.display_name || branch?.business_name || branch?.name || ''
  const previewLegalName = branch?.business_name || branch?.name || ''
  const previewAddress = [
    branch?.building_number ? `Building ${branch.building_number}` : null,
    branch?.street, branch?.district, branch?.city,
  ].filter(Boolean).join(', ')

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">{t('settings:invoiceSettings.branchAccount')}</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">{t('settings:invoiceSettings.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('settings:invoiceSettings.subtitle')}</p>
        </div>
        <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
          hasUnsavedChanges
            ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
            : saveOk
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
            : 'bg-gray-50 text-gray-500 ring-1 ring-gray-100'
        }`}>
          <span className={`h-2 w-2 rounded-full ${hasUnsavedChanges ? 'bg-amber-500' : saveOk ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          {hasUnsavedChanges ? t('settings:invoiceSettings.unsavedChanges') : saveOk ? t('settings:invoiceSettings.settingsSaved') : t('settings:invoiceSettings.saved')}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_minmax(420px,1fr)] xl:items-start">

        {/* ── LEFT: Form ──────────────────────── */}
        <div className="min-w-0 space-y-4">

          <div className="card border-primary-100 bg-primary-50/30 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.documentLanguage')}</h2>
            <p className="mt-1 text-xs text-gray-500">{t('settings:invoiceSettings.documentLanguageHelp')}</p>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('settings:invoiceSettings.documentLanguage')}>
              {([
                { value: 'en' as const, label: 'English' },
                { value: 'ar' as const, label: 'العربية' },
                { value: 'both' as const, label: t('settings:invoiceSettings.bilingual') },
              ]).map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={form.invoice_language === option.value}
                  onClick={() => set('invoice_language', option.value)}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${form.invoice_language === option.value ? 'border-primary-500 bg-primary-500 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-400">{t('settings:invoiceSettings.documentLanguageHistory')}</p>
          </div>

          {/* Business identity */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0 text-primary-700 text-xs font-bold">K</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.businessIdentity')}</h2>
                <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.businessIdentityHelp')}</p>
              </div>
            </div>

            <div>
              <label className="label flex items-center">
                {t('settings:invoiceSettings.displayName')}
                <InfoTip text={t('settings:invoiceSettings.displayNameHelp')} />
              </label>
              <input type="text" value={form.display_name}
                onChange={e => set('display_name', e.target.value)}
                className="input" placeholder={t('settings:invoiceSettings.displayNamePlaceholder')} />
            </div>

            {/* Logo upload */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0 flex items-center">
                  {t('settings:invoiceSettings.logo')}
                  <InfoTip text={t('settings:invoiceSettings.logoHelp')} />
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-500">{t('settings:invoiceSettings.show')}</span>
                  <Toggle checked={form.show_logo} onChange={v => set('show_logo', v)} />
                </div>
              </div>
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-3">
                <div className="flex items-center gap-3">
                {form.logo_url ? (
                  <div className="relative flex-shrink-0">
                    <img src={form.logo_url} alt="logo"
                      className="w-16 h-16 object-contain rounded-xl border border-gray-200 bg-white" />
                    <button
                      onClick={() => set('logo_url', null)}
                      className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] bg-red-500 text-white rounded-full flex items-center justify-center text-[9px] hover:bg-red-600 transition-colors"
                      title={t('settings:invoiceSettings.removeLogo')}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-white flex-shrink-0">
                    <span className="text-gray-300 text-xl leading-none">+</span>
                  </div>
                )}
                  <div className="min-w-0 flex-1">
                    <label className={`cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors ${uploadingLogo ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <Upload size={13} />
                      {uploadingLogo ? t('settings:invoiceSettings.uploading') : form.logo_url ? t('settings:invoiceSettings.replaceLogo') : t('settings:invoiceSettings.uploadLogo')}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                        disabled={uploadingLogo}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
                    </label>
                    <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{t('settings:invoiceSettings.logoUploadHelp')}</p>
                    {uploadedLogoPendingSave && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-700">{t('settings:invoiceSettings.logoPendingSave')}</p>
                    )}
                    {fieldErrors.logo_file && <p className="mt-1 text-[10px] font-semibold text-red-600">{fieldErrors.logo_file}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Contact details */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0 text-emerald-700 text-xs font-bold">@</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.contactDetails')}</h2>
                <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.contactDetailsHelp')}</p>
              </div>
            </div>

            <div>
              <label className="label">{t('settings:invoiceSettings.phoneNumber')}</label>
              <input type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)}
                className={`input ${currentErrors.phone ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="+966 5X XXX XXXX" />
              {currentErrors.phone && <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.phone}</p>}
            </div>

            <div>
              <label className="label flex items-center">
                {t('settings:invoiceSettings.email')}
                <InfoTip text={t('settings:invoiceSettings.emailHelp')} />
              </label>
              <input type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                className={`input ${currentErrors.email ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="info@example.com" />
              {currentErrors.email && <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.email}</p>}
            </div>

            <div>
              <label className="label flex items-center">
                {t('settings:invoiceSettings.website')}
                <InfoTip text={t('settings:invoiceSettings.websiteHelp')} />
              </label>
              <input type="url" value={form.website}
                onChange={e => set('website', e.target.value)}
                className={`input ${currentErrors.website ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="example.com" />
              {currentErrors.website
                ? <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.website}</p>
                : <p className="mt-1 text-[10px] text-gray-400">{t('settings:invoiceSettings.websiteHint')}</p>}
            </div>
          </div>

          {/* Optional printed fields */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-gold-50 rounded-xl flex items-center justify-center flex-shrink-0 text-gold-700 text-xs font-bold">✓</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.optionalFields')}</h2>
                <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.optionalFieldsHelp')}</p>
              </div>
            </div>

            {([
              { key: 'show_website'     as const, label: t('settings:invoiceSettings.showWebsite'),     desc: form.website || t('settings:invoiceSettings.noWebsite') },
              { key: 'show_email'       as const, label: t('settings:invoiceSettings.showEmail'),       desc: form.email   || t('settings:invoiceSettings.noEmail')   },
              { key: 'show_cash_change' as const, label: t('settings:invoiceSettings.showCashChange'), desc: t('settings:invoiceSettings.cashChangeHelp') },
            ]).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800">{label}</p>
                  <p className="text-[10px] text-gray-400 truncate">{desc}</p>
                </div>
                <Toggle checked={form[key] as boolean} onChange={v => set(key, v)} />
              </div>
            ))}
          </div>

          {/* Footer message */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.footerMessage')}</h2>
                <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.footerMessageHelp')}</p>
              </div>
              <Toggle checked={form.show_footer} onChange={v => set('show_footer', v)} />
            </div>

            <div>
              <label className="label flex items-center">
                {t('settings:invoiceSettings.footerText')}
                <InfoTip text={t('settings:invoiceSettings.footerTextHelp')} />
              </label>
              <textarea value={form.receipt_footer}
                onChange={e => set('receipt_footer', e.target.value)}
                className={`input resize-none text-xs ${currentErrors.receipt_footer ? 'border-red-200 bg-red-50/40' : ''}`} rows={3}
                placeholder={t('settings:invoiceSettings.footerPlaceholder')} />
              <div className="mt-1 flex items-center justify-between gap-2">
                {currentErrors.receipt_footer
                  ? <p className="text-[10px] font-semibold text-red-600">{currentErrors.receipt_footer}</p>
                  : <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.footerShortHint')}</p>}
                <p className={`text-[10px] tabular-nums ${form.receipt_footer.length > FOOTER_MAX_LENGTH ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                  {form.receipt_footer.length}/{FOOTER_MAX_LENGTH}
                </p>
              </div>
            </div>
          </div>

          {/* Print behavior */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0 text-amber-700 text-xs font-bold">⎙</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{t('settings:invoiceSettings.defaultPrintAction')}</h2>
                <p className="text-[10px] text-gray-400">{t('settings:invoiceSettings.defaultPrintActionHelp')}</p>
              </div>
            </div>

            <div className="space-y-2">
              {([
                { value: 'thermal' as const, label: t('settings:invoiceSettings.thermalReceipt'), desc: t('settings:invoiceSettings.thermalReceiptHelp') },
                { value: 'pdf'     as const, label: t('settings:invoiceSettings.a4Invoice'),      desc: t('settings:invoiceSettings.a4InvoiceHelp') },
                { value: 'both'    as const, label: t('settings:invoiceSettings.bothActions'),    desc: t('settings:invoiceSettings.bothActionsHelp') },
              ]).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => set('print_mode', opt.value)}
                  className={`flex items-start gap-3 p-3 rounded-xl border w-full text-start transition-all ${
                    form.print_mode === opt.value
                      ? 'border-primary-300 bg-primary-50/60'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                    form.print_mode === opt.value ? 'border-primary-500' : 'border-gray-300'
                  }`}>
                    {form.print_mode === opt.value && (
                      <div className="w-2 h-2 bg-primary-500 rounded-full" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{opt.label}</p>
                    <p className="text-[10px] text-gray-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Sticky save */}
          <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            {saveError && (
              <div className="mb-2 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={`text-xs font-semibold ${hasUnsavedChanges ? 'text-amber-700' : saveOk ? 'text-emerald-700' : 'text-gray-600'}`}>
                  {hasUnsavedChanges ? t('settings:invoiceSettings.unsavedChanges') : saveOk ? t('settings:invoiceSettings.settingsSaved') : t('settings:invoiceSettings.noChanges')}
                </p>
                <p className="text-[10px] text-gray-400">
                  {hasValidationErrors ? t('settings:invoiceSettings.fixFields') : t('settings:invoiceSettings.futurePrints')}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={cancelChanges} disabled={!hasUnsavedChanges || saving}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {t('common:cancel')}
                </button>
                <button
                  onClick={save}
                  disabled={saveDisabled}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                {saving ? (
                  <><Loader2 size={15} className="animate-spin" /> {t('settings:invoiceSettings.saving')}</>
                ) : saveOk ? (
                  <><Check size={15} /> {t('settings:invoiceSettings.saved')}</>
                ) : (
                  t('settings:invoiceSettings.saveSettings')
                )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Live Preview ───────────────────────────── */}
        <div className="min-w-0 space-y-3 xl:sticky xl:top-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{t('settings:livePreview')}</h2>
              <p className="text-[10px] text-gray-400">{t('settings:previewBeforeSaving')}</p>
            </div>
            <div className="flex border border-gray-200 rounded-xl overflow-hidden text-xs">
              <button
                onClick={() => setPreviewMode('thermal')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'thermal' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('settings:thermalPreview')}
              </button>
              <button
                onClick={() => setPreviewMode('a4')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'a4' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('settings:a4Preview')}
              </button>
            </div>
          </div>

          {previewMode === 'thermal' ? (
            <div className="flex justify-center bg-gray-100 rounded-2xl p-6">
              <div className="w-[280px]">
                <ThermalReceipt
                  preview
                  documentLanguage={normalizeDocumentLanguage(form.invoice_language)}
                  businessNameAr={branch?.business_name_ar || branch?.name_ar || previewBrandName}
                  businessNameEn={previewLegalName}
                  branchName={branch?.name}
                  branchNameAr={branch?.name_ar}
                  address={previewAddress || null}
                  addressAr={branch?.address_ar || null}
                  vatNumber={branch?.vat_number ?? undefined}
                  phone={form.phone || undefined}
                  website={form.website || undefined}
                  showWebsite={form.show_website}
                  email={form.email || undefined}
                  showEmail={form.show_email}
                  invoiceNumber="INV-0042"
                  date="15/01/2026"
                  time="02:30 PM"
                  cashierName="Ahmed"
                  items={PREVIEW_ITEMS}
                  subtotal={PREVIEW_SUBTOTAL}
                  taxAmount={PREVIEW_TAX}
                  total={PREVIEW_TOTAL}
                  paymentMethod="cash"
                  cashReceived={60}
                  change={2.00}
                  showCashChange={form.show_cash_change}
                  customerName="Walk-in Customer"
                  logoUrl={form.logo_url}
                  showLogo={form.show_logo}
                  receiptFooter={form.receipt_footer || null}
                  showFooter={form.show_footer}
                />
              </div>
            </div>
          ) : (
            <A4InvoicePreview form={form} branch={branch} />
          )}

          <p className="text-[10px] text-gray-400 text-center">
            {t('settings:previewSaveHint')}
          </p>
        </div>
      </div>
    </div>
  )
}
