import { useState, useRef, useEffect } from 'react'
import {
  Plus, Pencil, Trash2, Building2, CheckCircle2, X,
  Upload, Globe, Phone, Mail, MapPin, FileText,
  ReceiptText, ShieldCheck, ChevronDown, ChevronRight,
  Star, KeyRound, LogIn,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import type { Branch } from '@/types'

/* ── Types ──────────────────────────────────────────────────── */

type BranchForm = {
  name: string
  name_ar: string
  business_name: string
  business_name_ar: string
  vat_number: string
  cr_number: string
  // address
  building_number: string
  street: string
  district: string
  city: string
  country: string
  postal_code: string
  // contact
  phone: string
  email: string
  website: string
  // invoice
  vat_mode: 'exclusive' | 'inclusive'
  invoice_prefix: string
  receipt_footer: string
  show_logo: boolean
  invoice_language: 'en' | 'ar' | 'both'
  // zatca
  zatca_phase: 1 | 2
  is_active: boolean
  is_main_branch: boolean
  // branch login (new branches only)
  login_email: string
  login_password: string
}

const EMPTY_FORM: BranchForm = {
  name: '', name_ar: '',
  business_name: '', business_name_ar: '',
  vat_number: '', cr_number: '',
  building_number: '', street: '', district: '', city: '',
  country: 'SA', postal_code: '',
  phone: '', email: '', website: '',
  vat_mode: 'exclusive',
  invoice_prefix: 'INV',
  receipt_footer: '',
  show_logo: true,
  invoice_language: 'both',
  zatca_phase: 1,
  is_active: true,
  is_main_branch: false,
  login_email: '',
  login_password: '',
}

/* ── Helpers ─────────────────────────────────────────────────── */

function sectionClass(open: boolean) {
  return `border border-gray-100 rounded-2xl overflow-hidden mb-3 transition-shadow ${open ? 'shadow-sm' : ''}`
}

function SectionHeader({
  icon: Icon, title, open, toggle, color = 'text-primary-600', bg = 'bg-primary-50',
}: {
  icon: React.ElementType; title: string; open: boolean; toggle: () => void
  color?: string; bg?: string
}) {
  return (
    <button
      type="button"
      onClick={toggle}
      className="w-full flex items-center gap-3 px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
    >
      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={14} className={color} />
      </div>
      <span className="flex-1 text-sm font-semibold text-gray-800">{title}</span>
      {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
    </button>
  )
}

/* ── Logo uploader ───────────────────────────────────────────── */

function LogoUploader({
  currentUrl, previewUrl, onFile,
}: {
  currentUrl: string | null; previewUrl: string | null; onFile: (f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const display = previewUrl ?? currentUrl

  return (
    <div className="flex items-center gap-4">
      <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {display
          ? <img src={display} alt="logo" className="w-full h-full object-cover" />
          : <Building2 size={24} className="text-gray-300" />
        }
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium text-gray-700">Branch Logo</p>
        <p className="text-[11px] text-gray-400 mt-0.5 mb-2">PNG, JPG, WebP · max 5 MB · shown on invoices</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => ref.current?.click()}>
          <Upload size={13} /> Upload logo
        </Button>
        <input
          ref={ref} type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        />
      </div>
    </div>
  )
}

/* ── Form section: toggle helper ─────────────────────────────── */

function useSection(initial = true) {
  const [open, setOpen] = useState(initial)
  return { open, toggle: () => setOpen(v => !v) }
}

/* ── Drawer ──────────────────────────────────────────────────── */

function BranchDrawer({
  branch, tenantId, onClose, onSaved, onRefresh,
}: {
  branch: Branch | null
  tenantId: string
  onClose: () => void
  onSaved: () => void
  onRefresh?: () => void
}) {
  const isNew = branch === null
  const [form, setForm] = useState<BranchForm>(
    branch
      ? {
          name:             branch.name,
          name_ar:          branch.name_ar ?? '',
          business_name:    branch.business_name ?? '',
          business_name_ar: branch.business_name_ar ?? '',
          vat_number:       branch.vat_number ?? '',
          cr_number:        branch.cr_number ?? '',
          building_number:  branch.building_number ?? '',
          street:           branch.street ?? '',
          district:         branch.district ?? '',
          city:             branch.city ?? '',
          country:          branch.country ?? 'SA',
          postal_code:      branch.postal_code ?? '',
          phone:            branch.phone ?? '',
          email:            branch.email ?? '',
          website:          branch.website ?? '',
          vat_mode:         branch.vat_mode ?? 'exclusive',
          invoice_prefix:   branch.invoice_prefix ?? 'INV',
          receipt_footer:   branch.receipt_footer ?? '',
          show_logo:        branch.show_logo ?? true,
          invoice_language: branch.invoice_language ?? 'both',
          zatca_phase:      branch.zatca_phase ?? 1,
          is_active:        branch.is_active,
          is_main_branch:   branch.is_main_branch,
          login_email:      '',
          login_password:   '',
        }
      : { ...EMPTY_FORM },
  )

  const [logoFile, setLogoFile]   = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // ── Validation ──────────────────────────────────────────────
  const VAT_RE    = /^3\d{13}3$/
  const CR_RE     = /^[a-zA-Z0-9]+$/
  const BLDG_RE   = /^\d{4}$/
  const POSTAL_RE = /^\d{5}$/

  // Pre-touch all fields when editing so errors show immediately
  const [touched, setTouched] = useState<Set<string>>(
    isNew
      ? new Set<string>()
      : new Set<string>(['vat_number', 'cr_number', 'building_number', 'postal_code', 'street', 'city', 'district'])
  )
  const touch = (k: string) => setTouched(prev => { const s = new Set(prev); s.add(k); return s })

  const errs: Record<string, string | null> = {
    vat_number:      !form.vat_number.trim() ? 'Required' : !VAT_RE.test(form.vat_number.trim()) ? 'Must be 15 digits, starting and ending with 3' : null,
    cr_number:       !form.cr_number.trim() ? 'Required' : !CR_RE.test(form.cr_number.trim()) ? 'Alphanumeric characters only' : null,
    building_number: !form.building_number.trim() ? 'Required' : !BLDG_RE.test(form.building_number.trim()) ? 'Exactly 4 digits (use leading zeros e.g. 0056)' : null,
    postal_code:     !form.postal_code.trim() ? 'Required' : !POSTAL_RE.test(form.postal_code.trim()) ? 'Exactly 5 digits' : null,
    street:          !form.street.trim() ? 'Required' : null,
    city:            !form.city.trim() ? 'Required' : null,
    district:        !form.district.trim() ? 'Required' : null,
  }
  const hasErrors = Object.values(errs).some(Boolean)
  const fieldErr  = (k: string) => (touched.has(k) ? errs[k] : null)

  const identity  = useSection(true)
  const address   = useSection(true)
  const contact   = useSection(true)
  const invoice   = useSection(false)
  const zatca     = useSection(false)

  const set = (k: keyof BranchForm) => (v: string | boolean | number) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const handleLogoFile = (f: File) => {
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
  }

  const uploadLogo = async (branchId: string): Promise<string | null> => {
    if (!logoFile) return branch?.logo_url ?? null
    const ext  = logoFile.name.split('.').pop()
    const path = `${tenantId}/${branchId}/logo.${ext}`
    const { error } = await supabase.storage.from('branch-assets').upload(path, logoFile, { upsert: true })
    if (error) { console.error('logo upload:', error); return null }
    const { data } = supabase.storage.from('branch-assets').getPublicUrl(path)
    return data.publicUrl
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const payload = {
        tenant_id:        tenantId,
        name:             form.name.trim(),
        name_ar:          form.name_ar.trim() || null,
        business_name:    form.business_name.trim() || null,
        business_name_ar: form.business_name_ar.trim() || null,
        vat_number:       form.vat_number.trim() || null,
        cr_number:        form.cr_number.trim() || null,
        building_number:  form.building_number.trim() || null,
        street:           form.street.trim() || null,
        district:         form.district.trim() || null,
        city:             form.city.trim() || null,
        country:          form.country.trim() || 'SA',
        postal_code:      form.postal_code.trim() || null,
        phone:            form.phone.trim() || null,
        email:            form.email.trim() || null,
        website:          form.website.trim() || null,
        vat_mode:         form.vat_mode,
        invoice_prefix:   form.invoice_prefix.trim() || 'INV',
        receipt_footer:   form.receipt_footer.trim() || null,
        show_logo:        form.show_logo,
        invoice_language: form.invoice_language,
        zatca_phase:      form.zatca_phase,
        is_active:        form.is_active,
        is_main_branch:   form.is_main_branch,
        // Store the login email on the branch record so the owner can see it
        ...(isNew && form.login_email.trim()
          ? { branch_email: form.login_email.trim().toLowerCase() }
          : {}),
      }

      // supabase-js@2.45 PostgrestVersion "12" resolves hand-written Database
      // Insert/Update types to `never` for tables with custom columns. Use an
      // untyped reference for write calls while keeping reads typed.
      const q = supabase as unknown as { from: (t: string) => any }
      if (isNew) {
        const { data, error } = await q.from('branches').insert(payload).select('id').single()
        if (error) throw error
        const logoUrl = await uploadLogo(data.id)
        if (logoUrl) await q.from('branches').update({ logo_url: logoUrl }).eq('id', data.id)

        // Refresh the parent branch list now (branch is in DB regardless of login outcome)
        onRefresh?.()

        // Create the branch login user via edge function (no email confirmation)
        if (form.login_email.trim()) {
          const password = form.login_password.trim() || `Dafra@${Math.random().toString(36).slice(2, 10)}`
          const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-branch-user', {
            body: {
              email:     form.login_email.trim(),
              password,
              full_name: form.name.trim(),
              tenant_id: tenantId,
              branch_id: data.id,
            },
          })
          const fnErrMsg = fnErr?.message ?? (fnData as any)?.error ?? null
          if (fnErrMsg) {
            setError(`Branch created! But login setup failed: ${fnErrMsg}. Click Cancel to close.`)
            return  // Keep drawer open so owner sees the error; list already refreshed above
          }
        }
      } else {
        const { error } = await q.from('branches').update(payload).eq('id', branch!.id)
        if (error) throw error
        const logoUrl = await uploadLogo(branch!.id)
        if (logoUrl) await q.from('branches').update({ logo_url: logoUrl }).eq('id', branch!.id)
      }

      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save branch')
    } finally {
      setSaving(false)
    }
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-[640px] bg-white h-full flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {isNew ? 'Add Branch' : 'Edit Branch'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isNew ? 'Configure invoice and ZATCA settings for this location' : branch!.name}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-0">

          {/* ── BRANCH IDENTITY ───────────────────────── */}
          <div className={sectionClass(identity.open)}>
            <SectionHeader icon={Building2} title="Branch Identity" open={identity.open} toggle={identity.toggle} />
            {identity.open && (
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Branch Name (English)" value={form.name} onChange={e => set('name')(e.target.value)} placeholder="Main Branch" required />
                  <Input label="Branch Name (Arabic)" value={form.name_ar} onChange={e => set('name_ar')(e.target.value)} placeholder="الفرع الرئيسي" />
                </div>
                <Input label="Company Name" value={form.business_name} onChange={e => set('business_name')(e.target.value)} placeholder="Al-Faris Trading Co." />
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('vat_number')}>
                    <Input label="VAT Registration Number" value={form.vat_number} onChange={e => set('vat_number')(e.target.value)} placeholder="301234567890123" maxLength={15} />
                    {fieldErr('vat_number') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('vat_number')}</p>}
                  </div>
                  <div onBlur={() => touch('cr_number')}>
                    <Input label="CR Number" value={form.cr_number} onChange={e => set('cr_number')(e.target.value)} placeholder="1234567890" />
                    {fieldErr('cr_number') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('cr_number')}</p>}
                  </div>
                </div>
                <LogoUploader currentUrl={branch?.logo_url ?? null} previewUrl={logoPreview} onFile={handleLogoFile} />

                {/* Flags */}
                <div className="flex gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_main_branch} onChange={e => set('is_main_branch')(e.target.checked)}
                      className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                    <span className="text-sm text-gray-700">Main branch</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_active} onChange={e => set('is_active')(e.target.checked)}
                      className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                    <span className="text-sm text-gray-700">Active</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ── ADDRESS ───────────────────────────────── */}
          <div className={sectionClass(address.open)}>
            <SectionHeader icon={MapPin} title="Branch Address (ZATCA Mandatory)" open={address.open} toggle={address.toggle}
              color="text-blue-600" bg="bg-blue-50" />
            {address.open && (
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('building_number')}>
                    <Input label="Building Number" value={form.building_number} onChange={e => set('building_number')(e.target.value)} placeholder="0056" helperText="Use leading zeros e.g. 0056" />
                    {fieldErr('building_number') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('building_number')}</p>}
                  </div>
                  <div onBlur={() => touch('street')}>
                    <Input label="Street Name" value={form.street} onChange={e => set('street')(e.target.value)} placeholder="King Fahd Road" />
                    {fieldErr('street') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('street')}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('district')}>
                    <Input label="District" value={form.district} onChange={e => set('district')(e.target.value)} placeholder="Al-Olaya" />
                    {fieldErr('district') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('district')}</p>}
                  </div>
                  <div onBlur={() => touch('city')}>
                    <Input label="City" value={form.city} onChange={e => set('city')(e.target.value)} placeholder="Riyadh" />
                    {fieldErr('city') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('city')}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="w-full">
                    <label className="label">Country</label>
                    <select value={form.country} onChange={e => set('country')(e.target.value)}
                      className="input">
                      <option value="SA">Saudi Arabia</option>
                      <option value="AE">UAE</option>
                      <option value="BH">Bahrain</option>
                      <option value="KW">Kuwait</option>
                      <option value="OM">Oman</option>
                      <option value="QA">Qatar</option>
                    </select>
                  </div>
                  <div onBlur={() => touch('postal_code')}>
                    <Input label="Postal Code" value={form.postal_code} onChange={e => set('postal_code')(e.target.value)} placeholder="12345" />
                    {fieldErr('postal_code') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('postal_code')}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── CONTACT ───────────────────────────────── */}
          <div className={sectionClass(contact.open)}>
            <SectionHeader icon={Phone} title="Branch Contact" open={contact.open} toggle={contact.toggle}
              color="text-emerald-600" bg="bg-emerald-50" />
            {contact.open && (
              <div className="px-5 py-4 space-y-3">
                <Input label="Phone Number" icon={Phone} type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder="+966 5x xxx xxxx" />
                <Input label="Email (optional)" icon={Mail} type="email" value={form.email} onChange={e => set('email')(e.target.value)} placeholder="branch@company.com" />
                <Input label="Website (optional)" icon={Globe} type="url" value={form.website} onChange={e => set('website')(e.target.value)} placeholder="https://company.com" />
              </div>
            )}
          </div>

          {/* ── INVOICE SETTINGS ──────────────────────── */}
          <div className={sectionClass(invoice.open)}>
            <SectionHeader icon={ReceiptText} title="Invoice Settings" open={invoice.open} toggle={invoice.toggle}
              color="text-gold-600" bg="bg-amber-50" />
            {invoice.open && (
              <div className="px-5 py-4 space-y-4">
                {/* VAT mode */}
                <div>
                  <label className="label">VAT Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['exclusive', 'inclusive'] as const).map(mode => (
                      <button key={mode} type="button" onClick={() => set('vat_mode')(mode)}
                        className={`border rounded-xl px-4 py-3 text-left transition-all ${
                          form.vat_mode === mode
                            ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <p className="text-sm font-semibold text-gray-800 capitalize">{mode}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {mode === 'exclusive' ? 'VAT added on top of price' : 'VAT included in price'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Invoice Prefix" value={form.invoice_prefix} onChange={e => set('invoice_prefix')(e.target.value.toUpperCase())} placeholder="INV" maxLength={10} helperText="e.g. INV, FAT, ORD" />

                  {/* Invoice language */}
                  <div>
                    <label className="label">Invoice Language</label>
                    <select value={form.invoice_language} onChange={e => set('invoice_language')(e.target.value as 'en' | 'ar' | 'both')}
                      className="input">
                      <option value="both">Arabic + English</option>
                      <option value="en">English only</option>
                      <option value="ar">Arabic only</option>
                    </select>
                  </div>
                </div>

                {/* Receipt footer */}
                <div>
                  <label className="label">Receipt Footer Message</label>
                  <textarea
                    value={form.receipt_footer}
                    onChange={e => set('receipt_footer')(e.target.value)}
                    rows={3}
                    placeholder="Thank you for your purchase! · شكراً لتسوقكم معنا"
                    className="input resize-none"
                  />
                </div>

                {/* Show logo */}
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <input type="checkbox" checked={form.show_logo} onChange={e => set('show_logo')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">Show logo on invoice</p>
                    <p className="text-[11px] text-gray-400">Displays the branch logo at the top of every invoice</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* ── ZATCA SETTINGS ────────────────────────── */}
          <div className={sectionClass(zatca.open)}>
            <SectionHeader icon={ShieldCheck} title="ZATCA Settings" open={zatca.open} toggle={zatca.toggle}
              color="text-violet-600" bg="bg-violet-50" />
            {zatca.open && (
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="label">ZATCA Phase</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([1, 2] as const).map(phase => (
                      <button key={phase} type="button" onClick={() => set('zatca_phase')(phase)}
                        className={`border rounded-xl px-4 py-3 text-left transition-all ${
                          form.zatca_phase === phase
                            ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <p className="text-sm font-semibold text-gray-800">Phase {phase}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {phase === 1 ? 'QR Code (TLV) generation' : 'UBL 2.1 e-invoice + clearance'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {!isNew && (
                  <div className="flex items-start gap-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <FileText size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-gray-700">Certificate Status</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Managed in the ZATCA tab. Upload your CSID via the ZATCA Certificates section after saving branch details.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── BRANCH LOGIN (new branches only) ──────── */}
          {isNew && (
            <div className={sectionClass(true)}>
              <SectionHeader icon={KeyRound} title="Branch Login Credentials" open={true} toggle={() => {}}
                color="text-indigo-600" bg="bg-indigo-50" />
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-gray-400">
                  Optional — create a login so this branch can access the POS and branch dashboard.
                  The password can be changed later from the Users tab.
                </p>
                <Input label="Login Email" icon={Mail} type="email" value={form.login_email}
                  onChange={e => set('login_email')(e.target.value)} placeholder="branch@company.com" />
                <Input label="Initial Password" icon={KeyRound} type="password" value={form.login_password}
                  onChange={e => set('login_password')(e.target.value)} placeholder="Min. 8 characters"
                  helperText="Leave blank to auto-generate" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
              <span className="text-red-400">⚠</span> {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-gray-50">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={hasErrors || saving} onClick={handleSubmit as any}>
            {isNew ? 'Create Branch' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Branch card ─────────────────────────────────────────────── */

function BranchCard({
  branch, onEdit, onDelete,
}: {
  branch: Branch; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div className={`card p-5 flex items-start gap-4 ${!branch.is_active ? 'opacity-60' : ''}`}>
      {/* Logo / initials */}
      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden border border-gray-200">
        {branch.logo_url
          ? <img src={branch.logo_url} alt={branch.name} className="w-full h-full object-cover" />
          : <span className="text-lg font-bold text-gray-400">{branch.name.charAt(0)}</span>
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 text-sm">{branch.name}</span>
          {branch.name_ar && <span className="text-gray-400 text-xs" style={{ fontFamily: 'Cairo' }}>{branch.name_ar}</span>}
          {branch.is_main_branch && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-gold-500/10 text-gold-700 px-2 py-0.5 rounded-full ring-1 ring-gold-500/20">
              <Star size={9} /> MAIN
            </span>
          )}
          <Badge variant={branch.is_active ? 'success' : 'neutral'} dot>
            {branch.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
          {branch.city && <span className="flex items-center gap-1"><MapPin size={10} /> {branch.city}</span>}
          {branch.phone && <span className="flex items-center gap-1"><Phone size={10} /> {branch.phone}</span>}
          {branch.vat_number && <span>VAT {branch.vat_number}</span>}
          {branch.invoice_prefix && <span className="font-mono">#{branch.invoice_prefix}-XXXX</span>}
          <span className="flex items-center gap-1">
            <ShieldCheck size={10} />
            Phase {branch.zatca_phase ?? 1}
          </span>
          {branch.branch_email
            ? <span className="flex items-center gap-1 text-indigo-500"><LogIn size={10} /> {branch.branch_email}</span>
            : <span className="flex items-center gap-1 text-gray-300 italic"><LogIn size={10} /> No login configured</span>
          }
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button onClick={onEdit}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <Pencil size={14} />
        </button>
        <button onClick={onDelete}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────── */

const WA_LINK = 'https://wa.me/919895953210'

export default function BranchesTab() {
  const { profile } = useAuth()
  const sub = useSubscription()
  const [branches, setBranches]     = useState<Branch[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [drawerBranch, setDrawer]   = useState<Branch | 'new' | null>(null)
  const [deleting, setDeleting]     = useState<string | null>(null)

  const load = async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('is_main_branch', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) {
      setLoadError(error.message)
      setLoading(false)
      return
    }
    setBranches((data as Branch[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile?.tenant_id])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this branch? This cannot be undone.')) return
    setDeleting(id)
    await supabase.from('branches').delete().eq('id', id)
    await load()
    setDeleting(null)
  }

  const tenantId = profile?.tenant_id ?? ''

  return (
    <div className="space-y-4">

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Branches</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {branches.length} / {sub.maxBranches} branch{sub.maxBranches !== 1 ? 'es' : ''} used
          </p>
        </div>
        {branches.length >= sub.maxBranches ? (
          <div className="text-right">
            <p className="text-xs text-red-600 font-medium">Branch limit reached</p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 hover:underline"
            >
              Contact us to add more
            </a>
          </div>
        ) : (
          <Button onClick={() => setDrawer('new')} size="sm">
            <Plus size={14} /> Add Branch
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card p-5 h-20 animate-pulse bg-gray-50" />
          ))}
        </div>
      ) : loadError ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-red-600 mb-1">Failed to load branches</p>
          <p className="text-xs text-gray-400 mb-4">{loadError}</p>
          <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
        </div>
      ) : branches.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No branches yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Add your first branch to start generating ZATCA-compliant invoices</p>
          <Button size="sm" onClick={() => setDrawer('new')}><Plus size={13} /> Add your first branch</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {branches.map(b => (
            <BranchCard
              key={b.id}
              branch={b}
              onEdit={() => setDrawer(b)}
              onDelete={() => !deleting && handleDelete(b.id)}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawerBranch !== null && (
        <BranchDrawer
          branch={drawerBranch === 'new' ? null : drawerBranch}
          tenantId={tenantId}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); load() }}
          onRefresh={load}
        />
      )}

      {/* ZATCA hint */}
      <div className="flex items-start gap-3 bg-primary-50 border border-primary-100 rounded-2xl p-4">
        <CheckCircle2 size={16} className="text-primary-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-primary-800">ZATCA tip</p>
          <p className="text-[11px] text-primary-700 mt-0.5 leading-relaxed">
            Each branch requires its own CSID certificate for Phase 2 e-invoicing. After adding a branch, go to the ZATCA tab to upload certificates.
          </p>
        </div>
      </div>
    </div>
  )
}
