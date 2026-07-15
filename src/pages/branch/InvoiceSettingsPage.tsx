import { useState, useEffect, useMemo } from 'react'
import { Upload, Check, Loader2, Info, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import type { Branch } from '@/types/database'
import { Switch as Toggle } from '@/components/ui/Switch'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
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

function validateSettings(form: FormState): FieldErrors {
  const errors: FieldErrors = {}
  const email = form.email.trim()
  const website = form.website.trim()
  const phone = form.phone.trim()

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (website) {
    try {
      const url = new URL(normalizeWebsite(website))
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
        errors.website = 'Enter a valid website, such as example.com.'
      }
    } catch {
      errors.website = 'Enter a valid website, such as example.com.'
    }
  }

  if (phone && (!/^[0-9+\-() ]+$/.test(phone) || phone.length < 7 || phone.length > 50)) {
    errors.phone = 'Use 7-50 digits or phone symbols only.'
  }

  if (form.receipt_footer.length > FOOTER_MAX_LENGTH) {
    errors.receipt_footer = `Footer must be ${FOOTER_MAX_LENGTH} characters or fewer.`
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
  { name: 'قهوة عربية', qty: 2, unitPrice: 18.00, lineTotal: 36.00 },
  { name: 'كيك شوكولاتة', qty: 1, unitPrice: 22.00, lineTotal: 22.00 },
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
  const brandName = form.display_name || branch?.business_name || branch?.name || 'Business Name'
  const legalName = branch?.business_name || branch?.name || ''
  const address = [
    branch?.building_number ? `Building ${branch.building_number}` : null,
    branch?.street,
    branch?.district,
    branch?.city,
    branch?.postal_code || null,
  ].filter(Boolean).join(', ')

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden text-[11px]">

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">

          {/* Seller info */}
          <div className="flex items-start gap-3">
            {form.logo_url && form.show_logo ? (
              <img src={form.logo_url} alt="logo" className="w-10 h-10 rounded-lg object-contain flex-shrink-0 border border-gray-100" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[#0F2419] flex items-center justify-center flex-shrink-0">
                <span className="text-[#D4AF37] font-black text-base leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
              </div>
            )}
            <div>
              <p className="font-bold text-gray-900 text-sm" dir="auto" style={{ fontFamily: 'Cairo, sans-serif' }}>{brandName}</p>
              {legalName !== brandName && <p className="text-gray-400 text-[10px]">{legalName}</p>}
              {address && <p className="text-gray-400 text-[10px] mt-0.5 max-w-[180px]">{address}</p>}
              <div className="flex flex-wrap gap-2.5 mt-1.5">
                {branch?.vat_number && (
                  <span className="text-[10px] text-gray-500"><span className="font-semibold text-gray-600">VAT:</span> {branch.vat_number}</span>
                )}
                {branch?.cr_number && (
                  <span className="text-[10px] text-gray-500"><span className="font-semibold text-gray-600">CR:</span> {branch.cr_number}</span>
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
          <div className="text-right flex-shrink-0">
            <p className="font-bold text-[#0F2419] text-sm" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>فاتورة ضريبية مبسطة</p>
            <p className="text-gray-400 text-[10px] mb-2">Simplified Tax Invoice</p>
            <div className="space-y-0.5">
              <div className="flex justify-end gap-3">
                <span className="font-mono font-semibold text-gray-800">INV-0042</span>
                <span className="text-gray-400 uppercase tracking-wide text-[9px]">Invoice #</span>
              </div>
              <div className="flex justify-end gap-3">
                <span className="text-gray-700">15 Jan 2026</span>
                <span className="text-gray-400 uppercase tracking-wide text-[9px]">Date</span>
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
              <th className="text-left py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Item</th>
              <th className="text-right py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide w-10">Qty</th>
              <th className="text-right py-1.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide w-20">Total</th>
            </tr>
          </thead>
          <tbody>
            {PREVIEW_ITEMS.map((item, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2 text-gray-800">{item.name}</td>
                <td className="py-2 text-right text-gray-600">{item.qty}</td>
                <td className="py-2 text-right font-medium text-gray-900">SAR {item.lineTotal.toFixed(2)}</td>
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
              <span>Subtotal</span><span>SAR {PREVIEW_SUBTOTAL.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
              <span className="font-semibold">VAT 15%</span>
              <span className="font-semibold">SAR {PREVIEW_TAX.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1">
              <span>Total</span><span>SAR {PREVIEW_TOTAL.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-[8px] text-center leading-tight">
          ZATCA<br/>QR
        </div>
        <div className="text-[9px] text-gray-400 space-y-0.5">
          <p className="font-semibold">ZATCA QR Code</p>
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
  const { profile, loading: authLoading } = useAuth()

  const [branch,       setBranch]       = useState<Branch | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saveOk,       setSaveOk]       = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<FieldErrors>({})
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const [uploadedLogoPendingSave, setUploadedLogoPendingSave] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [previewMode,  setPreviewMode]  = useState<'thermal' | 'a4'>('thermal')

  const [form, setForm] = useState<FormState>({
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

  const currentErrors = useMemo(() => validateSettings(form), [form])
  const hasValidationErrors = Object.keys(currentErrors).length > 0
  const hasUnsavedChanges = savedSignature !== null && formSignature(form) !== savedSignature
  const saveDisabled = saving || !hasUnsavedChanges || hasValidationErrors

  async function uploadLogo(file: File) {
    const bid = profile?.branch_id
    if (!bid) return
    setSaveError(null)
    setSaveOk(false)
    if (!LOGO_MIME_TYPES.includes(file.type)) {
      setFieldErrors(prev => ({ ...prev, logo_file: 'Upload a PNG, JPG, or WebP logo.' }))
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFieldErrors(prev => ({ ...prev, logo_file: 'Logo must be under 2MB.' }))
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
      setSaveError(err?.message ?? 'Logo upload failed')
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
      const validationErrors = validateSettings(form)
      if (Object.keys(validationErrors).length > 0) {
        setFieldErrors(validationErrors)
        return
      }
      const normalizedWebsite = normalizeWebsite(form.website)
      const payload = {
        branch_id:         bid,
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
      setBranch(prev => prev ? { ...prev, ...payload } : prev)
      setSavedSignature(formSignature(savedForm))
      setUploadedLogoPendingSave(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    } catch (err: any) {
      setSaveError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">Branch account</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">Invoice Settings</h1>
          <p className="text-sm text-gray-500 mt-1">إعدادات الفاتورة · Configure receipt and invoice appearance</p>
        </div>
        <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
          hasUnsavedChanges
            ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
            : saveOk
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
            : 'bg-gray-50 text-gray-500 ring-1 ring-gray-100'
        }`}>
          <span className={`h-2 w-2 rounded-full ${hasUnsavedChanges ? 'bg-amber-500' : saveOk ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          {hasUnsavedChanges ? 'Unsaved changes' : saveOk ? 'Settings saved' : 'Saved'}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_minmax(420px,1fr)] xl:items-start">

        {/* ── LEFT: Form ──────────────────────── */}
        <div className="min-w-0 space-y-4">

          {/* Business identity */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0 text-primary-700 text-xs font-bold">K</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Business identity</h2>
                <p className="text-[10px] text-gray-400">Brand name and logo used on printed documents</p>
              </div>
            </div>

            <div>
              <label className="label flex items-center">
                Display Name Override
                <InfoTip text="Optional. Replaces business name on invoice headers. The legal business name is always used in the QR code." />
              </label>
              <input type="text" value={form.display_name}
                onChange={e => set('display_name', e.target.value)}
                className="input" placeholder="e.g. Ameen Café (optional)" />
            </div>

            {/* Logo upload */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0 flex items-center">
                  Logo
                  <InfoTip text="PNG or JPG, recommended 200×200px, max 2MB" />
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-500">Show</span>
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
                      title="Remove logo"
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
                      {uploadingLogo ? 'Uploading...' : form.logo_url ? 'Replace logo' : 'Upload logo'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                        disabled={uploadingLogo}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
                    </label>
                    <p className="mt-2 text-[10px] leading-relaxed text-gray-400">PNG, JPG, or WebP. Max 2MB. Save settings after uploading to apply this logo.</p>
                    {uploadedLogoPendingSave && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-700">Logo uploaded. Save settings to keep it on this branch.</p>
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
                <h2 className="text-sm font-semibold text-gray-900">Contact details</h2>
                <p className="text-[10px] text-gray-400">Optional contact information for invoices and receipts</p>
              </div>
            </div>

            <div>
              <label className="label">Phone Number</label>
              <input type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)}
                className={`input ${currentErrors.phone ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="+966 5X XXX XXXX" />
              {currentErrors.phone && <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.phone}</p>}
            </div>

            <div>
              <label className="label flex items-center">
                Email
                <InfoTip text="Shown on invoices when Show Email is enabled" />
              </label>
              <input type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                className={`input ${currentErrors.email ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="info@example.com" />
              {currentErrors.email && <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.email}</p>}
            </div>

            <div>
              <label className="label flex items-center">
                Website
                <InfoTip text="Shown on invoices when Show Website is enabled. Plain domains are saved with https://" />
              </label>
              <input type="url" value={form.website}
                onChange={e => set('website', e.target.value)}
                className={`input ${currentErrors.website ? 'border-red-200 bg-red-50/40' : ''}`} placeholder="example.com" />
              {currentErrors.website
                ? <p className="mt-1 text-[10px] font-semibold text-red-600">{currentErrors.website}</p>
                : <p className="mt-1 text-[10px] text-gray-400">You can enter example.com; it will be saved as https://example.com.</p>}
            </div>
          </div>

          {/* Optional printed fields */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-7 h-7 bg-gold-50 rounded-xl flex items-center justify-center flex-shrink-0 text-gold-700 text-xs font-bold">✓</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Optional printed fields</h2>
                <p className="text-[10px] text-gray-400">Choose which saved details appear on printed documents</p>
              </div>
            </div>

            {([
              { key: 'show_website'     as const, label: 'Show Website',     desc: form.website || 'No website set' },
              { key: 'show_email'       as const, label: 'Show Email',       desc: form.email   || 'No email set'   },
              { key: 'show_cash_change' as const, label: 'Show Cash Change', desc: 'Print change amount on cash receipts' },
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
                <h2 className="text-sm font-semibold text-gray-900">Footer message</h2>
                <p className="text-[10px] text-gray-400">Printed at the bottom of thermal and A4 documents</p>
              </div>
              <Toggle checked={form.show_footer} onChange={v => set('show_footer', v)} />
            </div>

            <div>
              <label className="label flex items-center">
                Receipt Footer Text
                <InfoTip text="Custom message printed at the bottom when Show Footer is enabled" />
              </label>
              <textarea value={form.receipt_footer}
                onChange={e => set('receipt_footer', e.target.value)}
                className={`input resize-none text-xs ${currentErrors.receipt_footer ? 'border-red-200 bg-red-50/40' : ''}`} rows={3}
                placeholder="e.g. Thank you for your business! Visit again." />
              <div className="mt-1 flex items-center justify-between gap-2">
                {currentErrors.receipt_footer
                  ? <p className="text-[10px] font-semibold text-red-600">{currentErrors.receipt_footer}</p>
                  : <p className="text-[10px] text-gray-400">Keep it short for thermal receipts.</p>}
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
                <h2 className="text-sm font-semibold text-gray-900">Default print action after sale</h2>
                <p className="text-[10px] text-gray-400">Controls the buttons shown after checkout. Direct printer uses thermal receipt format.</p>
              </div>
            </div>

            <div className="space-y-2">
              {([
                { value: 'thermal' as const, label: 'Thermal receipt', desc: 'Show the receipt print action after sale' },
                { value: 'pdf'     as const, label: 'A4 invoice',      desc: 'Show the A4 invoice print action after sale' },
                { value: 'both'    as const, label: 'Both actions',    desc: 'Show receipt and A4 invoice actions' },
              ]).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => set('print_mode', opt.value)}
                  className={`flex items-start gap-3 p-3 rounded-xl border w-full text-left transition-all ${
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
                  {hasUnsavedChanges ? 'Unsaved changes' : saveOk ? 'Settings saved' : 'No changes to save'}
                </p>
                <p className="text-[10px] text-gray-400">
                  {hasValidationErrors ? 'Fix the highlighted fields before saving.' : 'Saved settings apply to future prints and reprints.'}
                </p>
              </div>
              <button
                onClick={save}
                disabled={saveDisabled}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <><Loader2 size={15} className="animate-spin" /> Saving...</>
                ) : saveOk ? (
                  <><Check size={15} /> Saved</>
                ) : (
                  'Save settings'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Live Preview ───────────────────────────── */}
        <div className="min-w-0 space-y-3 xl:sticky xl:top-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Live preview</h2>
              <p className="text-[10px] text-gray-400">Preview updates before saving.</p>
            </div>
            <div className="flex border border-gray-200 rounded-xl overflow-hidden text-xs">
              <button
                onClick={() => setPreviewMode('thermal')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'thermal' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Thermal preview
              </button>
              <button
                onClick={() => setPreviewMode('a4')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'a4' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                A4 preview
              </button>
            </div>
          </div>

          {previewMode === 'thermal' ? (
            <div className="flex justify-center bg-gray-100 rounded-2xl p-6">
              <div className="w-[280px]">
                <ThermalReceipt
                  preview
                  businessNameAr={previewBrandName}
                  businessNameEn={previewLegalName}
                  branchName={null}
                  address={previewAddress || null}
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
            Preview is visual. Use Save settings to apply changes to printed documents.
          </p>
        </div>
      </div>
    </div>
  )
}
