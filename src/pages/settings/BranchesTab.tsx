import { useState, useRef, useEffect } from 'react'
import {
  Plus, Pencil, Building2, CheckCircle2, X,
  Upload, Globe, Phone, Mail, MapPin, FileText,
  ReceiptText, ShieldCheck, ChevronDown, ChevronRight,
  Star, KeyRound, LogIn,
  CreditCard, Warehouse,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import type { Branch, BranchLoginUsername, BranchPosMode, TenantBranchUsage } from '@/types'
import { supportConfig } from '@/config/support'
import {
  BRANCH_USERNAME_HELPER_TEXT,
  branchUsernameCreateErrorMessage,
  isInternalBranchAuthEmail,
  normalizeBranchUsernameInput,
  validateBranchUsernameInput,
} from '@/lib/utils/branchUsername'
import { branchCreationErrorMessage, branchIdFromRpcResult } from '@/lib/utils/branchCreation'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useTranslation } from 'react-i18next'

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
  // POS checkout
  allow_split_payments: boolean
  show_pos_scroll_buttons: boolean
  pos_mode: BranchPosMode
  stock_enabled: boolean | null
  // zatca
  zatca_phase: 1 | 2
  is_active: boolean
  is_main_branch: boolean
  // branch login (new branches only)
  login_username: string
  login_password: string
  login_confirm_password: string
}

type BranchWithLogin = Branch & {
  branch_username?: string | null
}

type StockModuleSetting = 'default' | 'enabled' | 'disabled'

const POS_MODE_OPTIONS: Array<{
  value: BranchPosMode
  label: string
  description: string
}> = [
  {
    value: 'touch',
    label: 'Touch POS',
    description: 'Best for cafes, restaurants, service counters, and businesses using visual product cards.',
  },
  {
    value: 'quick',
    label: 'Quick Billing',
    description: 'Best for trading, wholesale, retail, warehouses, and businesses that search products by name, SKU, or barcode.',
  },
]

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
  allow_split_payments: false,
  show_pos_scroll_buttons: false,
  pos_mode: 'touch',
  stock_enabled: null,
  zatca_phase: 1,
  is_active: true,
  is_main_branch: false,
  login_username: '',
  login_password: '',
  login_confirm_password: '',
}

/* ── Helpers ─────────────────────────────────────────────────── */

function sectionClass(open: boolean) {
  return `border border-gray-100 rounded-2xl overflow-hidden mb-3 transition-shadow ${open ? 'shadow-sm' : ''}`
}

function branchUsername(branch: BranchWithLogin): string | null {
  return branch.branch_username?.trim() || null
}

function branchLegacyEmail(branch: BranchWithLogin): string | null {
  const email = branch.branch_email?.trim() || null
  if (!email || isInternalBranchAuthEmail(email)) return null
  return email
}

function branchLoginCredential(branch: BranchWithLogin): { label: string; value: string; kind: 'username' | 'email' } | null {
  const username = branchUsername(branch)
  if (username) return { label: 'Branch username', value: username, kind: 'username' }

  const legacyEmail = branchLegacyEmail(branch)
  if (legacyEmail) return { label: 'Legacy branch email', value: legacyEmail, kind: 'email' }

  return null
}

function stockModuleSetting(value: boolean | null | undefined): StockModuleSetting {
  if (value === true) return 'enabled'
  if (value === false) return 'disabled'
  return 'default'
}

function branchPosMode(value: string | null | undefined): BranchPosMode {
  return value === 'quick' ? 'quick' : 'touch'
}

function stockModuleValue(setting: StockModuleSetting): boolean | null {
  if (setting === 'enabled') return true
  if (setting === 'disabled') return false
  return null
}

function stockModuleHint(setting: boolean | null, tenantBusinessType: string | null | undefined) {
  if (setting === true) return 'Stock will be visible in the branch sidebar.'
  if (setting === false) return 'Stock will be hidden from the branch sidebar.'
  return resolveBusinessType(tenantBusinessType) === 'service'
    ? 'Default for service businesses: Stock is hidden.'
    : 'Default for trading businesses: Stock is visible.'
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

function branchPosSettingsErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')

  if (/permission|forbidden|unauthorized|42501/i.test(message)) {
    return 'You do not have permission to update POS checkout settings for this branch.'
  }
  if (/function .*update_branch_pos_settings|could not find the function|PGRST202|schema cache/i.test(message)) {
    return 'The POS settings update is not available yet. Apply the latest SQL hotfix, then refresh and try again.'
  }
  if (/allow_split_payments|show_pos_scroll_buttons|pos_mode|unsupported POS setting|invalid POS settings/i.test(message)) {
    return 'The POS checkout settings payload was rejected. Refresh and try again.'
  }
  return message || 'Failed to save POS checkout settings.'
}

function branchPosSettingsErrorDebug(error: unknown) {
  if (error && typeof error === 'object') {
    const rpcError = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return {
      code: typeof rpcError.code === 'string' ? rpcError.code : null,
      message: typeof rpcError.message === 'string' ? rpcError.message : null,
      details: typeof rpcError.details === 'string' ? rpcError.details : null,
      hint: typeof rpcError.hint === 'string' ? rpcError.hint : null,
      error,
    }
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : String(error ?? ''),
    details: null,
    hint: null,
    error,
  }
}

function branchModuleSettingsErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')

  if (/permission|forbidden|unauthorized|42501/i.test(message)) {
    return 'You do not have permission to update module settings for this branch.'
  }
  if (/function .*update_branch_module_settings|could not find the function|PGRST202|schema cache/i.test(message)) {
    return 'The Stock module setting is not available yet. Apply the Stock module SQL migration, then refresh and try again.'
  }
  return message || 'Failed to save module settings.'
}

function branchModuleSettingsErrorDebug(error: unknown) {
  if (error && typeof error === 'object') {
    const rpcError = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return {
      code: typeof rpcError.code === 'string' ? rpcError.code : null,
      message: typeof rpcError.message === 'string' ? rpcError.message : null,
      details: typeof rpcError.details === 'string' ? rpcError.details : null,
      hint: typeof rpcError.hint === 'string' ? rpcError.hint : null,
      error,
    }
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : String(error ?? ''),
    details: null,
    hint: null,
    error,
  }
}

/* ── Drawer ──────────────────────────────────────────────────── */

function BranchDrawer({
  branch, tenantId, tenantBusinessType, canEditModuleSettings, isPhase2, onClose, onSaved, onRefresh, onResetPassword,
}: {
  branch: BranchWithLogin | null
  tenantId: string
  tenantBusinessType?: string | null
  canEditModuleSettings: boolean
  isPhase2: boolean
  onClose: () => void
  onSaved: () => void
  onRefresh?: () => void
  onResetPassword?: () => void
}) {
  const { t } = useTranslation('settings')
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
          allow_split_payments: branch.allow_split_payments ?? false,
          show_pos_scroll_buttons: branch.show_pos_scroll_buttons ?? false,
          pos_mode:        branchPosMode(branch.pos_mode),
          stock_enabled:    branch.stock_enabled ?? null,
          zatca_phase:      branch.zatca_phase ?? 1,
          is_active:        branch.is_active,
          is_main_branch:   branch.is_main_branch,
          login_username:   '',
          login_password:   '',
          login_confirm_password: '',
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
    ...(isNew ? {
      login_username:         validateBranchUsernameInput(form.login_username),
      login_password:         !form.login_password ? 'Password is required'
                              : form.login_password.length < 8 ? 'Must be at least 8 characters' : null,
      login_confirm_password: !form.login_confirm_password ? 'Please confirm the password'
                              : form.login_confirm_password !== form.login_password ? 'Passwords do not match' : null,
    } : {}),
  }
  const hasErrors = Object.values(errs).some(Boolean)
  const fieldErr  = (k: string) => (touched.has(k) ? errs[k] : null)

  const identity  = useSection(true)
  const address   = useSection(true)
  const contact   = useSection(true)
  const checkout  = useSection(false)
  const modules   = useSection(false)
  const invoice   = useSection(false)
  const zatca     = useSection(false)

  const set = (k: keyof BranchForm) => (v: string | boolean | number | null) =>
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

  const savePosSettings = async (branchId: string) => {
    const currentPosMode = branch ? branchPosMode(branch.pos_mode) : 'touch'
    const payload: {
      allow_split_payments: boolean
      show_pos_scroll_buttons: boolean
      pos_mode?: BranchPosMode
    } = {
      allow_split_payments: form.allow_split_payments,
      show_pos_scroll_buttons: form.show_pos_scroll_buttons,
    }
    if (form.pos_mode !== currentPosMode) {
      payload.pos_mode = form.pos_mode
    }

    const params = {
      p_branch_id: branchId,
      p_payload: payload,
    }
    const { error } = await (supabase as any).rpc('update_branch_pos_settings', params)
    if (error) {
      console.error('[BranchesTab] POS settings RPC failed', {
        functionName: 'update_branch_pos_settings',
        params,
        ...branchPosSettingsErrorDebug(error),
      })
      throw new Error(branchPosSettingsErrorMessage(error))
    }
  }

  const saveModuleSettings = async (branchId: string) => {
    const params = {
      p_branch_id: branchId,
      p_stock_enabled: form.stock_enabled,
    }
    const { error } = await (supabase as any).rpc('update_branch_module_settings', params)
    if (error) {
      console.error('[BranchesTab] Module settings RPC failed', {
        functionName: 'update_branch_module_settings',
        params,
        ...branchModuleSettingsErrorDebug(error),
      })
      throw new Error(branchModuleSettingsErrorMessage(error))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const branchPayload = {
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
        zatca_phase:      isNew ? (isPhase2 ? 2 : 1) : form.zatca_phase,
        is_active:        form.is_active,
        is_main_branch:   form.is_main_branch,
      }

      // supabase-js@2.45 PostgrestVersion "12" resolves hand-written Database
      // Insert/Update types to `never` for tables with custom columns. Use an
      // untyped reference for write calls while keeping reads typed.
      const q = supabase as unknown as { from: (t: string) => any }
      if (isNew) {
        const { data, error } = await (supabase as any).rpc('create_branch_for_tenant', {
          p_payload: branchPayload,
        })
        if (error) throw error
        const branchId = branchIdFromRpcResult(data)
        const logoUrl = await uploadLogo(branchId)
        if (logoUrl) await q.from('branches').update({ logo_url: logoUrl }).eq('id', branchId)
        if (form.allow_split_payments || form.show_pos_scroll_buttons || form.pos_mode !== 'touch') {
          await savePosSettings(branchId)
        }
        if (canEditModuleSettings && form.stock_enabled !== null) await saveModuleSettings(branchId)

        // Refresh the parent branch list now (branch is in DB regardless of login outcome)
        onRefresh?.()

        // Create the branch login user via edge function (no email confirmation)
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-branch-user', {
          body: {
            username:  normalizeBranchUsernameInput(form.login_username),
            password:  form.login_password,
            full_name: form.name.trim(),
            tenant_id: tenantId,
            branch_id: branchId,
          },
        })
        const fnErrMsg = fnErr?.message ?? (fnData as any)?.error ?? null
        if (fnErrMsg) {
          setError(`Branch created, but login setup failed: ${branchUsernameCreateErrorMessage(fnErrMsg)} Click Cancel to close.`)
          return  // Keep drawer open so owner sees the error; list already refreshed above
        }
      } else {
        const { error } = await q.from('branches').update(branchPayload).eq('id', branch!.id)
        if (error) throw error
        const logoUrl = await uploadLogo(branch!.id)
        if (logoUrl) await q.from('branches').update({ logo_url: logoUrl }).eq('id', branch!.id)
        if (
          form.allow_split_payments !== (branch!.allow_split_payments ?? false) ||
          form.show_pos_scroll_buttons !== (branch!.show_pos_scroll_buttons ?? false) ||
          form.pos_mode !== branchPosMode(branch!.pos_mode)
        ) {
          await savePosSettings(branch!.id)
        }
        if (canEditModuleSettings && form.stock_enabled !== (branch!.stock_enabled ?? null)) {
          await saveModuleSettings(branch!.id)
        }
      }

      onSaved()
    } catch (err: any) {
      setError(isNew ? branchCreationErrorMessage(err?.message) : (err?.message ?? 'Failed to save branch'))
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

          {/* Info note */}
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-3">
            <FileText size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Each branch requires its own CR number and address. The Company Name and VAT number are shared across all your branches.
            </p>
          </div>

          {/* ── BRANCH IDENTITY ───────────────────────── */}
          <div className={sectionClass(identity.open)}>
            <SectionHeader icon={Building2} title="Branch Identity" open={identity.open} toggle={identity.toggle} />
            {identity.open && (
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Branch Name (English)" value={form.name} onChange={e => set('name')(e.target.value)} placeholder="Main Branch" required />
                  <Input label="Branch Name (Arabic)" value={form.name_ar} onChange={e => set('name_ar')(e.target.value)} placeholder="الفرع الرئيسي" />
                </div>
                <Input
                  label="Company Name (Seller Name)"
                  value={form.business_name}
                  onChange={e => set('business_name')(e.target.value)}
                  helperText="Your registered business name. This appears on ZATCA invoices and certificates."
                />
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('vat_number')}>
                    <Input
                      label="VAT Registration Number"
                      value={form.vat_number}
                      onChange={e => set('vat_number')(e.target.value)}
                      maxLength={15}
                      helperText="From your VAT Registration Certificate. Must be 15 digits starting and ending with 3."
                    />
                    {fieldErr('vat_number') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('vat_number')}</p>}
                  </div>
                  <div onBlur={() => touch('cr_number')}>
                    <Input
                      label="CR / License Number"
                      value={form.cr_number}
                      onChange={e => set('cr_number')(e.target.value)}
                      helperText="Commercial Registration number for this specific branch. Each branch has its own CR."
                    />
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
                    <Input
                      label="Building Number"
                      value={form.building_number}
                      onChange={e => set('building_number')(e.target.value)}
                      helperText="4-digit building number from your Saudi National Address (العنوان الوطني). Use leading zeros e.g. 0056"
                    />
                    {fieldErr('building_number') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('building_number')}</p>}
                  </div>
                  <div onBlur={() => touch('street')}>
                    <Input label="Street Name" value={form.street} onChange={e => set('street')(e.target.value)} placeholder="King Fahd Road" />
                    {fieldErr('street') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('street')}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('district')}>
                    <Input
                      label="District"
                      value={form.district}
                      onChange={e => set('district')(e.target.value)}
                      helperText="Neighbourhood or district name as in your registered address."
                    />
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
                    <Input
                      label="Postal Code"
                      value={form.postal_code}
                      onChange={e => set('postal_code')(e.target.value)}
                      helperText="5-digit postal code from your Saudi National Address document."
                    />
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

          {/* ── POS CHECKOUT ─────────────────────────── */}
          <div className={sectionClass(checkout.open)}>
            <SectionHeader icon={CreditCard} title="POS Checkout" open={checkout.open} toggle={checkout.toggle}
              color="text-indigo-600" bg="bg-indigo-50" />
            {checkout.open && (
              <div className="px-5 py-4 space-y-3">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-800">Billing Interface</p>
                    <p className="text-[11px] text-gray-400">Choose the POS screen this branch opens by default.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POS_MODE_OPTIONS.map(option => {
                      const selected = form.pos_mode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => set('pos_mode')(option.value)}
                          className={`rounded-xl border px-3 py-2.5 text-left transition-colors active:scale-[0.99] ${
                            selected
                              ? 'border-primary-200 bg-white text-primary-800 shadow-sm ring-1 ring-primary-100'
                              : 'border-gray-100 bg-white/70 text-gray-600 hover:border-gray-200 hover:bg-white'
                          }`}
                        >
                          <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                          <span className="mt-1 block text-[11px] leading-4 text-gray-400">{option.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <input
                    type="checkbox"
                    checked={form.allow_split_payments}
                    onChange={e => set('allow_split_payments')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">Allow Split Payment</p>
                    <p className="text-[11px] text-gray-400">Cashiers can split one invoice between cash and card.</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <input
                    type="checkbox"
                    checked={form.show_pos_scroll_buttons}
                    onChange={e => set('show_pos_scroll_buttons')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">Show POS arrow buttons</p>
                    <p className="text-[11px] text-gray-400">Adds large arrow buttons for category and product navigation on touch screens.</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {canEditModuleSettings && (
            <div className={sectionClass(modules.open)}>
              <SectionHeader icon={Warehouse} title="Branch Modules" open={modules.open} toggle={modules.toggle}
                color="text-teal-600" bg="bg-teal-50" />
              {modules.open && (
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Stock module</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Use Stock if this branch tracks physical stock items such as packaged goods, accessories, or resale items.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'default', label: 'Default', desc: 'Follow business type default' },
                      { key: 'enabled', label: 'Enabled', desc: 'Show Stock for this branch' },
                      { key: 'disabled', label: 'Disabled', desc: 'Hide Stock for this branch' },
                    ] as { key: StockModuleSetting; label: string; desc: string }[]).map(option => {
                      const selected = stockModuleSetting(form.stock_enabled) === option.key
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => set('stock_enabled')(stockModuleValue(option.key))}
                          className={`rounded-xl border px-3 py-3 text-left transition-all ${
                            selected
                              ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-gray-800">{option.label}</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{option.desc}</p>
                        </button>
                      )
                    })}
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <p className="text-[11px] font-medium text-gray-600">
                      {stockModuleHint(form.stock_enabled, tenantBusinessType)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      Stock controls the branch Stock page visibility. Purchases remain available for supplier bills and materials.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

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
                    <label className="label">{t('invoiceLanguage')}</label>
                    <select value={form.invoice_language} onChange={e => set('invoice_language')(e.target.value as 'en' | 'ar' | 'both')}
                      className="input">
                      <option value="both">{t('documentBilingual')}</option>
                      <option value="en">{t('documentEnglish')}</option>
                      <option value="ar">{t('documentArabic')}</option>
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
                {/* Phase indicator — read-only, derived from subscription plan */}
                <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">
                      {isNew
                        ? `New branch will be ${isPhase2 ? 'Phase 2' : 'Phase 1'}`
                        : `Phase ${form.zatca_phase}`
                      }
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {(isNew ? isPhase2 : form.zatca_phase === 2)
                        ? 'UBL 2.1 e-invoice + ZATCA clearance — set by your plan'
                        : 'QR Code (TLV) generation — set by your plan'}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    (isNew ? isPhase2 : form.zatca_phase === 2)
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    Phase {isNew ? (isPhase2 ? 2 : 1) : form.zatca_phase}
                  </span>
                </div>

                {!isNew && (
                  <div className="flex items-start gap-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <FileText size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-gray-700">Certificate Status</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Managed from ZATCA in the owner sidebar after saving branch details.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── BRANCH LOGIN (existing branch — read-only + reset) ─ */}
          {!isNew && (
            <div className={sectionClass(true)}>
              <SectionHeader icon={KeyRound} title="Branch Login" open={true} toggle={() => {}}
                color="text-indigo-600" bg="bg-indigo-50" />
              <div className="px-5 py-4 space-y-3">
                {branch && branchLoginCredential(branch) ? (
                  <>
                    <div>
                      <label className="label">{branchLoginCredential(branch)!.label}</label>
                      <input
                        readOnly
                        value={branchLoginCredential(branch)!.value}
                        className="input w-full bg-gray-50 text-gray-600 cursor-default mt-1.5"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">
                        {branchLoginCredential(branch)!.kind === 'username'
                          ? 'Username for POS and branch dashboard access'
                          : 'Legacy email login for POS and branch dashboard access'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { onClose(); onResetPassword?.() }}
                      className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      <KeyRound size={14} /> Reset Password
                    </button>
                  </>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-gray-400">
                    <LogIn size={14} className="flex-shrink-0 mt-0.5" />
                    <p>Username not set for this branch.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── BRANCH LOGIN (new branch — set credentials) ──────── */}
          {isNew && (
            <div className={sectionClass(true)}>
              <SectionHeader icon={KeyRound} title="Branch Login" open={true} toggle={() => {}}
                color="text-indigo-600" bg="bg-indigo-50" />
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-gray-400">
                  Set username credentials for this branch's POS terminal. No email is sent - share these directly with your staff.
                </p>
                <div onBlur={() => touch('login_username')}>
                  <Input
                    label="Branch username"
                    icon={LogIn}
                    type="text"
                    value={form.login_username}
                    onChange={e => set('login_username')(normalizeBranchUsernameInput(e.target.value))}
                    placeholder="main_counter"
                    helperText={BRANCH_USERNAME_HELPER_TEXT}
                    required
                    autoComplete="username"
                  />
                  {fieldErr('login_username') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('login_username')}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div onBlur={() => touch('login_password')}>
                    <Input label="Password" icon={KeyRound} type="password" value={form.login_password}
                      onChange={e => set('login_password')(e.target.value)} placeholder="Min. 8 characters" required />
                    {fieldErr('login_password') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('login_password')}</p>}
                  </div>
                  <div onBlur={() => touch('login_confirm_password')}>
                    <Input label="Confirm Password" icon={KeyRound} type="password" value={form.login_confirm_password}
                      onChange={e => set('login_confirm_password')(e.target.value)} placeholder="Repeat password" required />
                    {fieldErr('login_confirm_password') && <p className="text-[11px] text-red-500 mt-1">{fieldErr('login_confirm_password')}</p>}
                  </div>
                </div>
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

/* ── Reset password modal ────────────────────────────────────── */

function ResetPasswordModal({ branch, onClose }: { branch: BranchWithLogin; onClose: () => void }) {
  const [newPwd,     setNewPwd]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [done,       setDone]       = useState(false)

  async function handleSave() {
    setError('')
    if (newPwd.length < 8)      { setError('Password must be at least 8 characters'); return }
    if (newPwd !== confirmPwd)  { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('reset-branch-password', {
        body: { branch_id: branch.id, new_password: newPwd },
      })
      const errMsg = fnErr?.message ?? (data as any)?.error ?? null
      if (errMsg) throw new Error(errMsg)
      setDone(true)
    } catch (err: any) {
      setError(err.message ?? 'Failed to reset password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Reset Branch Password</h2>
            <p className="text-xs text-gray-400 mt-0.5">{branch.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-900">Password reset successfully</p>
            <p className="text-xs text-gray-400 mt-1">The branch can now log in with the new password.</p>
            <Button className="w-full justify-center mt-4" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {branchLoginCredential(branch) && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-gray-400 font-medium">{branchLoginCredential(branch)!.label}</p>
                <p className="text-sm text-gray-700 mt-0.5">{branchLoginCredential(branch)!.value}</p>
              </div>
            )}
            <Input label="New Password" type="password" value={newPwd}
              onChange={e => setNewPwd(e.target.value)} placeholder="Min. 8 characters" />
            <Input label="Confirm Password" type="password" value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)} placeholder="Repeat password" />
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" loading={saving} disabled={saving} onClick={handleSave}>
                Save Password
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Branch card ─────────────────────────────────────────────── */

const WA_LINK = supportConfig.whatsappLink

function BranchCard({
  branch, onEdit, onResetPassword,
}: {
  branch: BranchWithLogin; onEdit: () => void; onResetPassword: () => void
}) {
  const loginCredential = branchLoginCredential(branch)
  const contactItems = [
    branch.city ? { icon: MapPin, label: 'City', value: branch.city } : null,
    branch.phone ? { icon: Phone, label: 'Phone', value: branch.phone } : null,
    branch.email ? { icon: Mail, label: 'Email', value: branch.email } : null,
    branch.vat_number ? { icon: FileText, label: 'VAT', value: branch.vat_number } : null,
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; value: string }>

  return (
    <div className={`card overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-primary-100 hover:shadow-card-md ${!branch.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gradient-to-r from-white to-primary-50/40 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0 overflow-hidden border border-primary-100">
            {branch.logo_url
              ? <img src={branch.logo_url} alt={branch.name} className="w-full h-full object-cover" />
              : <span className="text-lg font-black text-primary-700">{branch.name.charAt(0)}</span>
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-gray-950 text-base truncate">{branch.name}</span>
              {branch.name_ar && <span className="text-gray-500 text-sm leading-5" style={{ fontFamily: 'Cairo' }}>{branch.name_ar}</span>}
              {branch.is_main_branch && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-gold-500/10 text-gold-700 px-2 py-0.5 rounded-full ring-1 ring-gold-500/20">
                  <Star size={9} /> MAIN
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={branch.is_active ? 'success' : 'neutral'} dot>
                {branch.is_active ? 'Active' : 'Inactive'}
              </Badge>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
                <ShieldCheck size={11} />
                Phase {branch.zatca_phase ?? 1}
              </span>
              {branch.invoice_prefix && (
                <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold text-gray-500 ring-1 ring-gray-100">
                  #{branch.invoice_prefix}-XXXX
                </span>
              )}
            </div>
          </div>
        </div>

        <button onClick={onEdit}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-white hover:text-primary-700 active:scale-[0.97] transition-all"
          title="Edit branch">
          <Pencil size={15} />
        </button>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_220px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {contactItems.length ? contactItems.map(item => (
            <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                <item.icon size={11} /> {item.label}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-gray-800">{item.value}</p>
            </div>
          )) : (
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 text-sm text-gray-400">
              Contact details are not set.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Branch login</p>
          {loginCredential ? (
            <div className="mt-2 space-y-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-indigo-600">
                <LogIn size={13} /> {loginCredential.value}
              </p>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onResetPassword() }}
                className="text-xs font-semibold text-gray-500 hover:text-primary-700 transition-colors"
              >
                Reset password
              </button>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-sm text-gray-300 italic"><LogIn size={12} /> Username not set</p>
          )}
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex text-xs font-semibold text-gray-400 hover:text-primary-600 transition-colors"
            title="Contact Kubri support to delete this branch."
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────── */

export default function BranchesTab() {
  const { profile, tenant } = useAuth()
  const sub = useSubscription()
  const [branches, setBranches]     = useState<BranchWithLogin[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [drawerBranch, setDrawer]     = useState<BranchWithLogin | 'new' | null>(null)
  const [resetTarget, setResetTarget]  = useState<BranchWithLogin | null>(null)
  const [branchUsage, setBranchUsage] = useState<TenantBranchUsage | null>(null)
  const [branchUsageError, setBranchUsageError] = useState(false)

  const load = async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    setLoadError('')
    setBranchUsage(null)
    setBranchUsageError(false)
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
    const loaded = (data as Branch[]) ?? []
    const usernameByBranch = new Map<string, string>()
    const [usernameResult, usageResult] = await Promise.all([
      supabase
        .from('branch_login_usernames')
        .select('branch_id, username, normalized_username')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true),
      (supabase as any).rpc('get_tenant_branch_usage', { p_tenant_id: profile.tenant_id }),
    ])

    if (usernameResult.error) {
      console.warn('[BranchesTab] Branch username lookup skipped:', usernameResult.error.message)
    } else {
      ;((usernameResult.data ?? []) as Array<Pick<BranchLoginUsername, 'branch_id' | 'username' | 'normalized_username'>>)
        .forEach(row => {
          usernameByBranch.set(row.branch_id, row.username || row.normalized_username)
        })
    }

    if (usageResult.error) {
      console.warn('[BranchesTab] Branch usage helper skipped:', usageResult.error.message)
      setBranchUsage(null)
      setBranchUsageError(true)
    } else {
      setBranchUsage(((usageResult.data ?? [])[0] as TenantBranchUsage | undefined) ?? null)
      setBranchUsageError(false)
    }

    const loadedWithLogins: BranchWithLogin[] = loaded.map(branch => ({
      ...branch,
      branch_username: usernameByBranch.get(branch.id) ?? null,
    }))
    setBranches(loadedWithLogins)
    setLoading(false)
    return loadedWithLogins
  }

  useEffect(() => { load() }, [profile?.tenant_id])

  // FIX 4: auto-upgrade existing Phase 1 branches when owner is on Phase 2 plan
  useEffect(() => {
    if (!sub.isPhase2 || !profile?.tenant_id || sub.status === 'loading') return
    ;(supabase as any)
      .from('branches')
      .update({ zatca_phase: 2 })
      .eq('tenant_id', profile.tenant_id)
      .eq('zatca_phase', 1)
      .then(({ error }: { error: any }) => {
        if (!error) load()
      })
  }, [sub.isPhase2, sub.status, profile?.tenant_id])

  const tenantId = profile?.tenant_id ?? ''
  const canEditModuleSettings = ['owner', 'admin', 'super_admin'].includes(String(profile?.role ?? ''))
  const fallbackActiveBranches = branches.filter(branch => branch.is_active !== false).length
  const activeBranchCount = branchUsage?.active_branch_count ?? fallbackActiveBranches
  const totalBranchCount = branchUsage?.total_branch_count ?? branches.length
  const maxBranches = branchUsage?.max_branches ?? sub.maxBranches
  const remainingBranches = branchUsage?.remaining_branches ?? Math.max(maxBranches - activeBranchCount, 0)
  const canCreateActiveBranch = sub.status !== 'suspended' && (branchUsage?.can_create_branch ?? activeBranchCount < maxBranches)

  return (
    <div className="space-y-5">

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-gray-950">Branch directory</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
            <span><span className="font-medium text-gray-600">{activeBranchCount}</span> / {maxBranches} active branches used</span>
            <span>Total branches: <span className="font-medium text-gray-600">{totalBranchCount}</span></span>
            <span>Remaining branch slots: <span className="font-medium text-gray-600">{remainingBranches}</span></span>
            {branchUsageError && <span className="text-amber-600">Using local count</span>}
          </div>
        </div>
        {!canCreateActiveBranch ? (
          <div className="text-right">
            <p className="text-xs text-red-600 font-medium">
              {sub.status === 'suspended' ? 'Account suspended' : 'Branch limit reached'}
            </p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 hover:underline"
            >
              Contact us to add more
            </a>
            <Button onClick={() => setDrawer('new')} size="sm" disabled className="mt-2">
              <Plus size={14} /> Add Branch
            </Button>
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
          <p className="text-xs text-gray-400 mt-1 mb-4">Add your first branch to start generating ZATCA-ready invoices</p>
          <Button size="sm" onClick={() => setDrawer('new')} disabled={!canCreateActiveBranch}>
            <Plus size={13} /> Add your first branch
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {branches.map(b => (
            <BranchCard
              key={b.id}
              branch={b}
              onEdit={() => setDrawer(b)}
              onResetPassword={() => setResetTarget(b)}
            />
          ))}
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <ResetPasswordModal
          branch={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {/* Drawer */}
      {drawerBranch !== null && (
        <BranchDrawer
          branch={drawerBranch === 'new' ? null : drawerBranch}
          tenantId={tenantId}
          tenantBusinessType={tenant?.business_type}
          canEditModuleSettings={canEditModuleSettings}
          isPhase2={sub.isPhase2}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); load() }}
          onRefresh={load}
          onResetPassword={drawerBranch !== 'new' ? () => {
            const b = drawerBranch as BranchWithLogin
            setDrawer(null)
            setResetTarget(b)
          } : undefined}
        />
      )}

    </div>
  )
}
