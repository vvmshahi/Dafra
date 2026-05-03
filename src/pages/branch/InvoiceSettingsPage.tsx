import { useState, useEffect } from 'react'
import { Upload, Check, Loader2, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import type { Branch } from '@/types/database'

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

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center cursor-pointer flex-shrink-0">
      <div
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-200'}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
    </label>
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
  const { profile } = useAuth()

  const [branch,       setBranch]       = useState<Branch | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saveOk,       setSaveOk]       = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)
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
    const bid = profile?.branch_id
    if (!bid) { setLoading(false); return }
    supabase.from('branches').select('*').eq('id', bid).single().then(({ data }) => {
      if (data) {
        const b = data as Branch
        setBranch(b)
        setForm({
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
        })
      }
      setLoading(false)
    })
  }, [profile?.branch_id])

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function uploadLogo(file: File) {
    const bid = profile?.branch_id
    if (!bid) return
    if (file.size > 2 * 1024 * 1024) { setSaveError('Logo must be under 2MB'); return }
    setUploadingLogo(true)
    try {
      const ext  = file.name.split('.').pop() ?? 'png'
      const path = `${bid}/logo.${ext}`
      const { error } = await supabase.storage.from('branch-assets').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('branch-assets').getPublicUrl(path)
      set('logo_url', urlData.publicUrl)
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
    setSaveOk(false)
    try {
      const { error } = await (supabase as any).from('branches').update({
        display_name:     form.display_name     || null,
        phone:            form.phone            || null,
        show_logo:        form.show_logo,
        logo_url:         form.logo_url,
        website:          form.website          || null,
        email:            form.email            || null,
        show_website:     form.show_website,
        show_email:       form.show_email,
        receipt_footer:   form.receipt_footer   || null,
        show_footer:      form.show_footer,
        show_cash_change: form.show_cash_change,
        print_mode:       form.print_mode,
      }).eq('id', bid)
      if (error) throw error
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
      <div>
        <h1 className="text-xl font-bold text-gray-900">Invoice Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">إعدادات الفاتورة · Configure invoice appearance and compliance</p>
      </div>

      <div className="flex gap-6 items-start">

        {/* ── LEFT: Form (fixed width) ──────────────────────── */}
        <div className="w-[420px] flex-shrink-0 space-y-4">

          {/* ── Section 1: Display Settings ──────────────────── */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-6 h-6 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0 text-blue-600 text-xs font-bold">✦</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Display Settings</h2>
                <p className="text-[10px] text-gray-400">How your brand appears on invoices</p>
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
              {form.display_name && (
                <p className="text-[10px] text-amber-600 mt-1">
                  ⚠ QR code always uses the legal business name above
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Phone Number</label>
                <input type="tel" value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  className="input" placeholder="+966 5X XXX XXXX" />
              </div>
              <div>
                <label className="label flex items-center">
                  Email
                  <InfoTip text="Shown on invoices when 'Show Email' is enabled" />
                </label>
                <input type="email" value={form.email}
                  onChange={e => set('email', e.target.value)}
                  className="input" placeholder="info@example.com" />
              </div>
            </div>

            <div>
              <label className="label flex items-center">
                Website
                <InfoTip text="Shown on invoices when 'Show Website' is enabled" />
              </label>
              <input type="url" value={form.website}
                onChange={e => set('website', e.target.value)}
                className="input" placeholder="https://example.com" />
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
              <div className="flex items-center gap-3">
                {form.logo_url ? (
                  <div className="relative flex-shrink-0">
                    <img src={form.logo_url} alt="logo"
                      className="w-14 h-14 object-contain rounded-xl border border-gray-200 bg-gray-50" />
                    <button
                      onClick={() => set('logo_url', null)}
                      className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 w-[18px] h-[18px] bg-red-500 text-white rounded-full flex items-center justify-center text-[9px] hover:bg-red-600 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0">
                    <span className="text-gray-300 text-xl leading-none">+</span>
                  </div>
                )}
                <label className={`flex-1 cursor-pointer flex items-center justify-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50 transition-colors ${uploadingLogo ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <Upload size={13} />
                  {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                    disabled={uploadingLogo}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
                </label>
              </div>
            </div>
          </div>

          {/* ── Section 3: Optional Fields ────────────────────── */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-6 h-6 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0 text-purple-600 text-xs font-bold">⊞</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Optional Invoice Fields</h2>
                <p className="text-[10px] text-gray-400">Control what prints on invoices</p>
              </div>
            </div>

            {([
              { key: 'show_website'     as const, label: 'Show Website',     desc: form.website || 'No website set' },
              { key: 'show_email'       as const, label: 'Show Email',       desc: form.email   || 'No email set'   },
              { key: 'show_footer'      as const, label: 'Show Footer Text', desc: 'Custom message at receipt bottom' },
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

            <div>
              <label className="label flex items-center">
                Receipt Footer Text
                <InfoTip text="Custom message printed at the bottom when Show Footer is enabled" />
              </label>
              <textarea value={form.receipt_footer}
                onChange={e => set('receipt_footer', e.target.value)}
                className="input resize-none text-xs" rows={2}
                placeholder="e.g. Thank you for your business! Visit again." />
            </div>
          </div>

          {/* ── Section 4: Print Settings ─────────────────────── */}
          <div className="card px-5 py-4 space-y-3.5">
            <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100">
              <div className="w-6 h-6 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0 text-amber-600 text-xs font-bold">⎙</div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Print Settings</h2>
                <p className="text-[10px] text-gray-400">Default print format after each sale</p>
              </div>
            </div>

            <div className="space-y-2">
              {([
                { value: 'thermal' as const, label: 'Thermal Receipt',   desc: '80mm thermal printer format'       },
                { value: 'pdf'     as const, label: 'A4 Invoice',        desc: 'Full A4 format for email / archive' },
                { value: 'both'    as const, label: 'Both',              desc: 'Show thermal and A4 options'        },
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

          {/* Save */}
          {saveError && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
              {saveError}
            </div>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <><Loader2 size={15} className="animate-spin" /> Saving…</>
            ) : saveOk ? (
              <><Check size={15} /> Settings Saved</>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>

        {/* ── RIGHT: Live Preview ───────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3 sticky top-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Live Preview</h2>
            <div className="flex border border-gray-200 rounded-xl overflow-hidden text-xs">
              <button
                onClick={() => setPreviewMode('thermal')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'thermal' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Thermal
              </button>
              <button
                onClick={() => setPreviewMode('a4')}
                className={`px-3 py-1.5 transition-colors font-medium ${
                  previewMode === 'a4' ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                A4
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
                  branchName={branch?.name}
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
                  receiptFooter={form.receipt_footer || null}
                  showFooter={form.show_footer}
                />
              </div>
            </div>
          ) : (
            <A4InvoicePreview form={form} branch={branch} />
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Preview updates in real-time as you edit the form
          </p>
        </div>
      </div>
    </div>
  )
}
