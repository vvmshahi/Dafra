import { useState, useEffect, useRef } from 'react'
import {
  Plus, Pencil, Building2, CheckCircle2, X,
  Globe, Phone, Mail, MapPin, FileText,
  ReceiptText, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle,
  Star, KeyRound, LogIn,
  CreditCard, Warehouse,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { Branch, BranchLoginUsername, BranchPosMode, TenantBranchUsage } from '@/types'
import { supportConfig } from '@/config/support'
import {
  isInternalBranchAuthEmail,
  normalizeBranchUsernameInput,
  validateBranchUsernameInput,
} from '@/lib/utils/branchUsername'
import { branchIdFromRpcResult } from '@/lib/utils/branchCreation'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useTranslation, type TFunction } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'
import { useNavigate } from 'react-router-dom'

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

type StockModuleSetting = 'enabled' | 'disabled'
type BranchModalTab = 'general' | 'access' | 'pos' | 'modules' | 'invoices'

const POS_MODE_OPTIONS: Array<{
  value: BranchPosMode
  key: 'touch' | 'quick'
}> = [
  { value: 'touch', key: 'touch' },
  { value: 'quick', key: 'quick' },
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
  return `overflow-hidden rounded-xl border border-[#e8e1d1] bg-white ${open ? '' : 'bg-white/70'}`
}

function branchUsername(branch: BranchWithLogin): string | null {
  return branch.branch_username?.trim() || null
}

function branchLegacyEmail(branch: BranchWithLogin): string | null {
  const email = branch.branch_email?.trim() || null
  if (!email || isInternalBranchAuthEmail(email)) return null
  return email
}

function branchLoginCredential(branch: BranchWithLogin): { labelKey: 'branchUsername' | 'legacyEmail'; value: string; kind: 'username' | 'email' } | null {
  const username = branchUsername(branch)
  if (username) return { labelKey: 'branchUsername', value: username, kind: 'username' }

  const legacyEmail = branchLegacyEmail(branch)
  if (legacyEmail) return { labelKey: 'legacyEmail', value: legacyEmail, kind: 'email' }

  return null
}

function stockModuleSetting(value: boolean | null | undefined): StockModuleSetting {
  if (value === false) return 'disabled'
  return 'enabled'
}

function branchPosMode(value: string | null | undefined): BranchPosMode {
  return value === 'quick' ? 'quick' : 'touch'
}

function stockModuleValue(setting: StockModuleSetting): boolean {
  return setting === 'enabled'
}

function stockModuleHintKey(setting: boolean | null, tenantBusinessType: string | null | undefined) {
  if (resolveBusinessType(tenantBusinessType) === 'service') return 'stock.hidden'
  if (setting === true) return 'stock.visible'
  if (setting === false) return 'stock.hidden'
  return 'stock.visible'
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
      className="flex w-full items-center gap-3 bg-white px-4 py-3 text-start transition-colors hover:bg-[#faf8f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
    >
      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${bg}`}>
        <Icon size={14} className={color} />
      </div>
      <span className="flex-1 text-sm font-semibold text-gray-800">{title}</span>
      {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
    </button>
  )
}

/* ── Form section: toggle helper ─────────────────────────────── */

function useSection(initial = true) {
  const [open, setOpen] = useState(initial)
  return { open, toggle: () => setOpen(v => !v) }
}

function branchPosSettingsErrorMessage(error: unknown, t: TFunction): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')

  if (/permission|forbidden|unauthorized|42501/i.test(message)) {
    return t('branches:errors.posPermission')
  }
  if (/function .*update_branch_pos_settings|could not find the function|PGRST202|schema cache/i.test(message)) {
    return t('branches:errors.posUnavailable')
  }
  if (/allow_split_payments|show_pos_scroll_buttons|pos_mode|unsupported POS setting|invalid POS settings/i.test(message)) {
    return t('branches:errors.posRejected')
  }
  return t('branches:errors.posSaveFailed')
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

function branchModuleSettingsErrorMessage(error: unknown, t: TFunction): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')

  if (/permission|forbidden|unauthorized|42501/i.test(message)) {
    return t('branches:errors.modulePermission')
  }
  if (/function .*update_branch_module_settings|could not find the function|PGRST202|schema cache/i.test(message)) {
    return t('branches:errors.moduleUnavailable')
  }
  return t('branches:errors.moduleSaveFailed')
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

/* ── Centered branch editor modal ───────────────────────────── */

function BranchModal({
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
  const { t } = useTranslation(['settings', 'branches', 'common'])
  const { isRtl } = useLocale()
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
          stock_enabled:    resolveBusinessType(tenantBusinessType) === 'service'
            ? false
            : branch.stock_enabled ?? true,
          zatca_phase:      branch.zatca_phase ?? 1,
          is_active:        branch.is_active,
          is_main_branch:   branch.is_main_branch,
          login_username:   '',
          login_password:   '',
          login_confirm_password: '',
        }
      : {
          ...EMPTY_FORM,
          stock_enabled: resolveBusinessType(tenantBusinessType) === 'service' ? false : true,
        },
  )

  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [activeTab, setActiveTab] = useState<BranchModalTab>('general')
  const [showAllErrors, setShowAllErrors] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const initialFormRef = useRef('')
  const pendingCloseActionRef = useRef<(() => void) | null>(null)
  const discardOpenRef = useRef(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  savingRef.current = saving
  discardOpenRef.current = discardOpen
  if (!initialFormRef.current) initialFormRef.current = JSON.stringify(form)
  const serviceTenant = resolveBusinessType(tenantBusinessType) === 'service'
  const isDirty = JSON.stringify(form) !== initialFormRef.current
  dirtyRef.current = isDirty

  // ── Validation ──────────────────────────────────────────────
  const VAT_RE    = /^3\d{13}3$/
  const CR_RE     = /^[a-zA-Z0-9]+$/
  const BLDG_RE   = /^\d{4}$/
  const POSTAL_RE = /^\d{5}$/
  const usernameValidation = isNew ? validateBranchUsernameInput(form.login_username) : null
  const localizedUsernameValidation = !usernameValidation
    ? null
    : /required/i.test(usernameValidation)
      ? t('branches:validation.usernameRequired')
      : /reserved/i.test(usernameValidation)
        ? t('branches:validation.usernameReserved')
        : t('branches:validation.usernameInvalid')

  // Pre-touch all fields when editing so errors show immediately
  const [touched, setTouched] = useState<Set<string>>(
    isNew
      ? new Set<string>()
      : new Set<string>(['vat_number', 'cr_number', 'building_number', 'postal_code', 'street', 'city', 'district'])
  )
  const touch = (k: string) => setTouched(prev => { const s = new Set(prev); s.add(k); return s })

  const errs: Record<string, string | null> = {
    name:            !form.name.trim() ? t('branches:validation.required') : null,
    vat_number:      !form.vat_number.trim() ? t('branches:validation.required') : !VAT_RE.test(form.vat_number.trim()) ? t('branches:validation.vat') : null,
    cr_number:       !form.cr_number.trim() ? t('branches:validation.required') : !CR_RE.test(form.cr_number.trim()) ? t('branches:validation.alphanumeric') : null,
    building_number: !form.building_number.trim() ? t('branches:validation.required') : !BLDG_RE.test(form.building_number.trim()) ? t('branches:validation.building') : null,
    postal_code:     !form.postal_code.trim() ? t('branches:validation.required') : !POSTAL_RE.test(form.postal_code.trim()) ? t('branches:validation.postal') : null,
    street:          !form.street.trim() ? t('branches:validation.required') : null,
    city:            !form.city.trim() ? t('branches:validation.required') : null,
    district:        !form.district.trim() ? t('branches:validation.required') : null,
    ...(isNew ? {
      login_username:         localizedUsernameValidation,
      login_password:         !form.login_password ? t('branches:validation.passwordRequired')
                              : form.login_password.length < 8 ? t('branches:editor.passwordTooShort') : null,
      login_confirm_password: !form.login_confirm_password ? t('branches:validation.confirmPassword')
                              : form.login_confirm_password !== form.login_password ? t('branches:editor.passwordMismatch') : null,
    } : {}),
  }
  const hasErrors = Object.values(errs).some(Boolean)
  const fieldErr  = (k: string) => (showAllErrors || touched.has(k) ? errs[k] : null)
  const generalError = ['name', 'vat_number', 'cr_number', 'building_number', 'postal_code', 'street', 'city', 'district']
    .some(key => Boolean(errs[key]))
  const accessError = isNew && ['login_username', 'login_password', 'login_confirm_password']
    .some(key => Boolean(errs[key]))
  const identity = useSection(true)
  const address = useSection(true)
  const contact = useSection(true)
  const checkout = useSection(true)
  const modules = useSection(true)
  const invoice = useSection(true)
  const tabs: Array<{ id: BranchModalTab; icon: React.ElementType }> = [
    { id: 'general', icon: Building2 },
    { id: 'access', icon: KeyRound },
    { id: 'pos', icon: CreditCard },
    ...(canEditModuleSettings ? [{ id: 'modules' as const, icon: Warehouse }] : []),
    { id: 'invoices', icon: ReceiptText },
  ]

  const set = (k: keyof BranchForm) => (v: string | boolean | number | null) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const requestClose = (afterClose?: () => void) => {
    if (saving) return
    if (!isDirty) {
      onClose()
      afterClose?.()
      return
    }
    pendingCloseActionRef.current = afterClose ?? null
    setDiscardOpen(true)
  }

  const confirmDiscard = () => {
    const afterClose = pendingCloseActionRef.current
    pendingCloseActionRef.current = null
    setDiscardOpen(false)
    onClose()
    afterClose?.()
  }

  const selectTab = (tab: BranchModalTab, focus = false) => {
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      tabRefs.current[tab]?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
      if (focus) tabRefs.current[tab]?.focus()
    })
  }

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (event.key === 'ArrowRight') nextIndex = (index + (isRtl ? -1 : 1) + tabs.length) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (index + (isRtl ? 1 : -1) + tabs.length) % tabs.length
    if (nextIndex === null) return
    event.preventDefault()
    selectTab(tabs[nextIndex].id, true)
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
      throw new Error(branchPosSettingsErrorMessage(error, t))
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
      throw new Error(branchModuleSettingsErrorMessage(error, t))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (isNew && activeTab !== tabs[tabs.length - 1].id) {
      const currentTabInvalid =
        (activeTab === 'general' && generalError) ||
        (activeTab === 'access' && accessError)
      if (currentTabInvalid) {
        setShowAllErrors(true)
        const firstInvalidField = activeTab === 'access'
          ? ['login_username', 'login_password', 'login_confirm_password'].find(key => errs[key])
          : Object.keys(errs).find(key => !key.startsWith('login_') && errs[key])
        if (firstInvalidField) {
          setTouched(prev => new Set([...prev, firstInvalidField]))
          window.requestAnimationFrame(() => {
            dialogRef.current
              ?.querySelector<HTMLElement>(`[data-branch-field="${firstInvalidField}"] input, [data-branch-field="${firstInvalidField}"] select`)
              ?.focus()
          })
        }
        return
      }
      const currentIndex = tabs.findIndex(tab => tab.id === activeTab)
      selectTab(tabs[Math.min(currentIndex + 1, tabs.length - 1)].id, true)
      return
    }
    if (hasErrors) {
      setShowAllErrors(true)
      setTouched(new Set(Object.keys(errs)))
      const firstInvalidField = Object.keys(errs).find(key => errs[key])
      const invalidTab: BranchModalTab = firstInvalidField?.startsWith('login_') ? 'access' : 'general'
      selectTab(invalidTab)
      window.requestAnimationFrame(() => {
        dialogRef.current
          ?.querySelector<HTMLElement>(`[data-branch-field="${firstInvalidField}"] input, [data-branch-field="${firstInvalidField}"] select`)
          ?.focus()
      })
      return
    }
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
          console.error('Branch login setup failed', fnErrMsg)
          setError(t('branches:errors.loginSetupFailed'))
          return  // Keep drawer open so owner sees the error; list already refreshed above
        }
      } else {
        const { data, error } = await q.from('branches').update(branchPayload).eq('id', branch!.id).select('id').single()
        if (error || data?.id !== branch!.id) throw error ?? new Error('Branch update response was not confirmed')
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

      initialFormRef.current = JSON.stringify(form)
      onSaved()
    } catch (err: any) {
      console.error('Failed to save branch', err)
      const safeAreaErrors = new Set([
        t('branches:errors.posPermission'),
        t('branches:errors.posUnavailable'),
        t('branches:errors.posRejected'),
        t('branches:errors.posSaveFailed'),
        t('branches:errors.modulePermission'),
        t('branches:errors.moduleUnavailable'),
        t('branches:errors.moduleSaveFailed'),
      ])
      setError(err instanceof Error && safeAreaErrors.has(err.message)
        ? err.message
        : t('branches:editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input:not([disabled])')?.focus())
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current && !discardOpenRef.current) {
        event.preventDefault()
        if (dirtyRef.current) setDiscardOpen(true)
        else onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )]
      if (!nodes.length) return
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previousOverflow
      openerRef.current?.focus()
    }
  }, [onClose])

  return (
    <>
    <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-0 md:left-[var(--app-sidebar-width)] md:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="branch-modal-title" aria-describedby="branch-modal-description"
        className="flex h-full w-full flex-col overflow-hidden bg-[#fffdf7] shadow-2xl md:h-[min(760px,calc(100dvh-32px))] md:w-[min(100%,1040px)] md:rounded-2xl md:border md:border-white/20">

        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#173f2a] px-4 py-3 text-white sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#e7ca78] ring-1 ring-white/10">
              <Building2 size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="branch-modal-title" className="text-base font-bold text-white sm:text-lg">
                  {t(isNew ? 'branches:editor.add' : 'branches:editor.edit')}
                </h2>
                {!isNew && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/75">
                    <span className={`h-1.5 w-1.5 rounded-full ${branch?.is_active ? 'bg-emerald-300' : 'bg-white/40'}`} aria-hidden="true" />
                    {t(`branches:status.${branch?.is_active ? 'active' : 'inactive'}`)}
                  </span>
                )}
                {!isNew && branch?.is_main_branch && <span className="text-[11px] font-semibold text-[#e7ca78]">{t('branches:detail.main')}</span>}
              </div>
              <p id="branch-modal-description" className="mt-0.5 truncate text-xs text-white/70">
                {isNew ? t('branches:tabs.addSubtitle') : t('branches:tabs.editSubtitle', { name: branch!.name })}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => requestClose()} disabled={saving} aria-label={t('common:close')}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7ca78] disabled:opacity-50">
            <X size={20} />
          </button>
        </header>

        <div className="flex-shrink-0 border-b border-[#e8e1d1] bg-white px-2 sm:px-5">
          <div role="tablist" aria-label={t('branches:tabs.label')}
            className="flex h-12 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab, index) => {
              const selected = activeTab === tab.id
              const invalid = (tab.id === 'general' && showAllErrors && generalError) || (tab.id === 'access' && showAllErrors && accessError)
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  ref={node => { tabRefs.current[tab.id] = node }}
                  id={`branch-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`branch-panel-${tab.id}`}
                  aria-invalid={invalid || undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={event => handleTabKeyDown(event, index)}
                  className={`relative inline-flex h-12 flex-none items-center gap-2 px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:px-4 ${
                    selected
                      ? 'text-[#173f2a] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#b89138]'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{t(`branches:tabs.${tab.id}`)}</span>
                  {invalid && (
                    <span className="inline-flex items-center gap-1 text-red-600" title={t('branches:tabs.incomplete')}>
                      <AlertTriangle size={12} aria-hidden="true" />
                      <span className="sr-only">{t('branches:tabs.incomplete')}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Form */}
        <form id="branch-modal-form" onSubmit={handleSubmit} noValidate
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fffdf7] px-4 py-4 sm:px-6 sm:py-6">

          {activeTab === 'general' && (
          <section id="branch-panel-general" role="tabpanel" aria-labelledby="branch-tab-general" className="space-y-3">
          {/* ── BRANCH IDENTITY ───────────────────────── */}
          <div className={sectionClass(identity.open)}>
            <SectionHeader icon={Building2} title={t('branches:editor.identity')} open={identity.open} toggle={identity.toggle} />
            {identity.open && (
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-start gap-2 rounded-lg border-s-2 border-amber-400 bg-[#fff9e9] px-3 py-2 text-[11px] leading-relaxed text-gray-700">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
                  <p>{t('settings:officialSeller.legacyFieldWarning')}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-branch-field="name" onBlur={() => touch('name')}>
                    <Input label={t('branches:editor.nameEn')} value={form.name} onChange={e => set('name')(e.target.value)}
                      placeholder={t('branches:editor.nameEnPlaceholder')} error={fieldErr('name') ?? undefined} required />
                  </div>
                  <Input label={t('branches:editor.nameAr')} value={form.name_ar} onChange={e => set('name_ar')(e.target.value)} placeholder={t('branches:editor.nameArPlaceholder')} />
                </div>
                <Input
                  label={t('branches:editor.companyName')}
                  value={form.business_name}
                  onChange={e => set('business_name')(e.target.value)}
                  helperText={t('branches:editor.companyNameHelp')}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-branch-field="vat_number" onBlur={() => touch('vat_number')}>
                    <Input
                      label={t('branches:editor.vatNumber')}
                      value={form.vat_number}
                      onChange={e => set('vat_number')(e.target.value)}
                      maxLength={15}
                      helperText={t('branches:editor.vatHelp')}
                      error={fieldErr('vat_number') ?? undefined}
                    />
                  </div>
                  <div data-branch-field="cr_number" onBlur={() => touch('cr_number')}>
                    <Input
                      label={t('branches:editor.crNumber')}
                      value={form.cr_number}
                      onChange={e => set('cr_number')(e.target.value)}
                      helperText={t('branches:editor.crHelp')}
                      error={fieldErr('cr_number') ?? undefined}
                    />
                  </div>
                </div>
                {/* Flags */}
                <div className="flex gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_main_branch} onChange={e => set('is_main_branch')(e.target.checked)}
                      className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                    <span className="text-sm text-gray-700">{t('branches:editor.mainBranch')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={form.is_active} onChange={e => set('is_active')(e.target.checked)}
                      className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
                    <span className="text-sm text-gray-700">{t('branches:status.active')}</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ── ADDRESS ───────────────────────────────── */}
          <div className={sectionClass(address.open)}>
            <SectionHeader icon={MapPin} title={t('branches:editor.address')} open={address.open} toggle={address.toggle}
              color="text-blue-600" bg="bg-blue-50" />
            {address.open && (
              <div className="px-5 py-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-branch-field="building_number" onBlur={() => touch('building_number')}>
                    <Input
                      label={t('branches:editor.buildingNumber')}
                      value={form.building_number}
                      onChange={e => set('building_number')(e.target.value)}
                      helperText={t('branches:editor.buildingHelp')}
                      error={fieldErr('building_number') ?? undefined}
                    />
                  </div>
                  <div data-branch-field="street" onBlur={() => touch('street')}>
                    <Input label={t('branches:editor.street')} value={form.street} onChange={e => set('street')(e.target.value)}
                      placeholder={t('branches:editor.streetPlaceholder')} error={fieldErr('street') ?? undefined} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-branch-field="district" onBlur={() => touch('district')}>
                    <Input
                      label={t('branches:editor.district')}
                      value={form.district}
                      onChange={e => set('district')(e.target.value)}
                      helperText={t('branches:editor.districtHelp')}
                      error={fieldErr('district') ?? undefined}
                    />
                  </div>
                  <div data-branch-field="city" onBlur={() => touch('city')}>
                    <Input label={t('branches:editor.city')} value={form.city} onChange={e => set('city')(e.target.value)}
                      placeholder={t('branches:editor.cityPlaceholder')} error={fieldErr('city') ?? undefined} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="w-full">
                    <label className="label">{t('branches:editor.country')}</label>
                    <select value={form.country} onChange={e => set('country')(e.target.value)}
                      className="input">
                      <option value="SA">{t('branches:countries.SA')}</option>
                      <option value="AE">{t('branches:countries.AE')}</option>
                      <option value="BH">{t('branches:countries.BH')}</option>
                      <option value="KW">{t('branches:countries.KW')}</option>
                      <option value="OM">{t('branches:countries.OM')}</option>
                      <option value="QA">{t('branches:countries.QA')}</option>
                    </select>
                  </div>
                  <div data-branch-field="postal_code" onBlur={() => touch('postal_code')}>
                    <Input
                      label={t('branches:editor.postalCode')}
                      value={form.postal_code}
                      onChange={e => set('postal_code')(e.target.value)}
                      helperText={t('branches:editor.postalHelp')}
                      error={fieldErr('postal_code') ?? undefined}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── CONTACT ───────────────────────────────── */}
          <div className={sectionClass(contact.open)}>
            <SectionHeader icon={Phone} title={t('branches:editor.contact')} open={contact.open} toggle={contact.toggle}
              color="text-emerald-600" bg="bg-emerald-50" />
            {contact.open && (
              <div className="px-5 py-4 space-y-3">
                <Input label={t('branches:editor.phone')} icon={Phone} type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder={t('branches:editor.phonePlaceholder')} />
                <Input label={t('branches:editor.email')} icon={Mail} type="email" value={form.email} onChange={e => set('email')(e.target.value)} placeholder={t('branches:editor.emailPlaceholder')} />
                <Input label={t('branches:editor.website')} icon={Globe} type="url" value={form.website} onChange={e => set('website')(e.target.value)} placeholder={t('branches:editor.websitePlaceholder')} />
              </div>
            )}
          </div>
          </section>
          )}

          {/* ── POS CHECKOUT ─────────────────────────── */}
          {activeTab === 'pos' && (
          <section id="branch-panel-pos" role="tabpanel" aria-labelledby="branch-tab-pos">
          <div className={sectionClass(checkout.open)}>
            <SectionHeader icon={CreditCard} title={t('branches:editor.posCheckout')} open={checkout.open} toggle={checkout.toggle}
              color="text-indigo-600" bg="bg-indigo-50" />
            {checkout.open && (
              <div className="px-5 py-4 space-y-3">
                <div className="rounded-xl border border-[#e8e1d1] bg-[#faf8f2] p-3">
                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-800">{t('branches:pos.title')}</p>
                    <p className="text-[11px] text-gray-400">{t('branches:pos.help')}</p>
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
                          className={`rounded-xl border px-3 py-2.5 text-start transition-colors active:scale-[0.99] ${
                            selected
                              ? 'border-primary-400 bg-primary-50/60 text-primary-800 ring-1 ring-primary-200'
                              : 'border-gray-100 bg-white/70 text-gray-600 hover:border-gray-200 hover:bg-white'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                            <span className={`h-3.5 w-3.5 rounded-full border ${selected ? 'border-primary-500 bg-primary-500 ring-2 ring-white' : 'border-gray-300 bg-white'}`} aria-hidden="true" />
                            {t(`branches:pos.${option.key}.label`)}
                          </span>
                          <span className="mt-1 block text-[11px] leading-4 text-gray-400">{t(`branches:pos.${option.key}.description`)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="flex cursor-pointer select-none items-center gap-3 rounded-xl border border-[#e8e1d1] bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.allow_split_payments}
                    onChange={e => set('allow_split_payments')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t('branches:pos.split')}</p>
                    <p className="text-[11px] text-gray-400">{t('branches:pos.splitHelp')}</p>
                  </div>
                </label>
                <label className="flex cursor-pointer select-none items-center gap-3 rounded-xl border border-[#e8e1d1] bg-white p-3">
                  <input
                    type="checkbox"
                    checked={form.show_pos_scroll_buttons}
                    onChange={e => set('show_pos_scroll_buttons')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t('branches:pos.arrows')}</p>
                    <p className="text-[11px] text-gray-400">{t('branches:pos.arrowsHelp')}</p>
                  </div>
                </label>
                <p className="text-[11px] leading-5 text-gray-500">{t('branches:tabs.invoiceWorkspaceHelp')}</p>
              </div>
            )}
          </div>
          </section>
          )}

          {activeTab === 'modules' && canEditModuleSettings && (
            <section id="branch-panel-modules" role="tabpanel" aria-labelledby="branch-tab-modules">
            <div className={sectionClass(modules.open)}>
              <SectionHeader icon={Warehouse} title={t('branches:editor.modules')} open={modules.open} toggle={modules.toggle}
                color="text-teal-600" bg="bg-teal-50" />
              {modules.open && (
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t('branches:stock.title')}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {t('branches:stock.help')}
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { key: 'enabled' }, { key: 'disabled' },
                    ] as { key: StockModuleSetting }[]).map(option => {
                      const selected = stockModuleSetting(form.stock_enabled) === option.key
                      const disabled = serviceTenant && option.key === 'enabled'
                      return (
                        <button
                          key={option.key}
                          type="button"
                          disabled={disabled}
                          onClick={() => set('stock_enabled')(stockModuleValue(option.key))}
                          className={`rounded-xl border px-3 py-3 text-start transition-[border-color,background-color,box-shadow] ${
                            selected
                              ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-200'
                              : disabled
                                ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-50'
                                : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-gray-800">{t(`branches:stock.${option.key}.label`)}</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{t(`branches:stock.${option.key}.description`)}</p>
                        </button>
                      )
                    })}
                  </div>

                  <div className="rounded-xl border border-[#e8e1d1] bg-[#faf8f2] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-gray-600">
                      {t(`branches:${stockModuleHintKey(form.stock_enabled, tenantBusinessType)}`)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {t('branches:stock.scopeHelp')}
                    </p>
                  </div>
                </div>
              )}
            </div>
            </section>
          )}

          {/* ── INVOICE SETTINGS ──────────────────────── */}
          {activeTab === 'invoices' && (
          <section id="branch-panel-invoices" role="tabpanel" aria-labelledby="branch-tab-invoices">
          <div className={sectionClass(invoice.open)}>
            <SectionHeader icon={ReceiptText} title={t('branches:editor.invoiceSettings')} open={invoice.open} toggle={invoice.toggle}
              color="text-gold-600" bg="bg-amber-50" />
            {invoice.open && (
              <div className="px-5 py-4 space-y-4">
                {/* VAT mode */}
                <div>
                  <label className="label">{t('branches:invoice.vatMode')}</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(['exclusive', 'inclusive'] as const).map(mode => (
                      <button key={mode} type="button" onClick={() => set('vat_mode')(mode)}
                        className={`border rounded-xl px-4 py-3 text-start transition-[border-color,background-color,box-shadow] ${
                          form.vat_mode === mode
                            ? 'border-primary-400 bg-primary-50/60 ring-1 ring-primary-200'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <p className="text-sm font-semibold text-gray-800">{t(`branches:invoice.${mode}`)}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {t(`branches:invoice.${mode}Help`)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={t('branches:invoice.prefix')} value={form.invoice_prefix} onChange={e => set('invoice_prefix')(e.target.value.toUpperCase())} placeholder={t('branches:invoice.prefixPlaceholder')} maxLength={10} helperText={t('branches:invoice.prefixHelp')} />

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
                  <label className="label">{t('branches:invoice.footer')}</label>
                  <textarea
                    value={form.receipt_footer}
                    onChange={e => set('receipt_footer')(e.target.value)}
                    rows={3}
                    placeholder={t('branches:invoice.footerPlaceholder')}
                    className="input resize-none"
                  />
                </div>

                {/* Show logo */}
                <label className="flex cursor-pointer select-none items-center gap-3 rounded-xl border border-[#e8e1d1] bg-white p-3">
                  <input type="checkbox" checked={form.show_logo} onChange={e => set('show_logo')(e.target.checked)}
                    className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t('branches:invoice.showLogo')}</p>
                    <p className="text-[11px] text-gray-400">{t('branches:invoice.showLogoHelp')}</p>
                  </div>
                </label>
              </div>
            )}
          </div>
          </section>
          )}

          {/* ── BRANCH LOGIN (existing branch — read-only + reset) ─ */}
          {activeTab === 'access' && (
          <section id="branch-panel-access" role="tabpanel" aria-labelledby="branch-tab-access" className="space-y-3">
          {!isNew && (
            <div className={sectionClass(true)}>
              <SectionHeader icon={KeyRound} title={t('branches:editor.login')} open={true} toggle={() => {}}
                color="text-indigo-600" bg="bg-indigo-50" />
              <div className="px-5 py-4 space-y-3">
                {branch && branchLoginCredential(branch) ? (
                  <>
                    <div>
                      <label className="label">{t(`branches:editor.${branchLoginCredential(branch)!.labelKey}`)}</label>
                      <input
                        readOnly
                        value={branchLoginCredential(branch)!.value}
                        className="input w-full bg-gray-50 text-gray-600 cursor-default mt-1.5"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">
                        {branchLoginCredential(branch)!.kind === 'username'
                          ? t('branches:editor.usernameHelp')
                          : t('branches:editor.legacyEmailHelp')}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-500">{t('branches:tabs.readOnlyAccessHelp')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => requestClose(onResetPassword)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <KeyRound size={14} /> {t('branches:editor.resetPassword')}
                    </button>
                  </>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-gray-400">
                    <LogIn size={14} className="flex-shrink-0 mt-0.5" />
                    <p>{t('branches:editor.usernameNotSetBranch')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── BRANCH LOGIN (new branch — set credentials) ──────── */}
          {isNew && (
            <div className={sectionClass(true)}>
              <SectionHeader icon={KeyRound} title={t('branches:editor.login')} open={true} toggle={() => {}}
                color="text-indigo-600" bg="bg-indigo-50" />
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-gray-400">
                  {t('branches:editor.credentialsHelp')}
                </p>
                  <div data-branch-field="login_username" onBlur={() => touch('login_username')}>
                  <Input
                    label={t('branches:editor.branchUsername')}
                    icon={LogIn}
                    type="text"
                    value={form.login_username}
                    onChange={e => set('login_username')(normalizeBranchUsernameInput(e.target.value))}
                    placeholder={t('branches:editor.usernamePlaceholder')}
                    helperText={t('branches:editor.usernameFormatHelp')}
                    error={fieldErr('login_username') ?? undefined}
                    required
                    autoComplete="username"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div data-branch-field="login_password" onBlur={() => touch('login_password')}>
                    <Input label={t('branches:editor.password')} icon={KeyRound} type="password" value={form.login_password}
                      onChange={e => set('login_password')(e.target.value)} placeholder={t('branches:editor.passwordPlaceholder')}
                      error={fieldErr('login_password') ?? undefined} required />
                  </div>
                  <div data-branch-field="login_confirm_password" onBlur={() => touch('login_confirm_password')}>
                    <Input label={t('branches:editor.confirmPassword')} icon={KeyRound} type="password" value={form.login_confirm_password}
                      onChange={e => set('login_confirm_password')(e.target.value)} placeholder={t('branches:editor.repeatPassword')}
                      error={fieldErr('login_confirm_password') ?? undefined} required />
                  </div>
                </div>
              </div>
            </div>
          )}
          </section>
          )}

          {/* Error */}
          {error && (
            <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-xl">
              <span className="text-red-400">⚠</span> {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <footer className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-[#e8e1d1] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex items-center gap-2">
            <p className="hidden text-[11px] text-gray-500 sm:block">{t('branches:tabs.footerHelp')}</p>
            {isDirty && <span className="text-[11px] font-semibold text-amber-700">{t('branches:tabs.unsaved')}</span>}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => requestClose()} className="w-full sm:w-auto">{t('branches:editor.cancel')}</Button>
            <Button type="submit" form="branch-modal-form" loading={saving} disabled={saving} className="w-full sm:w-auto">
              {t(isNew && activeTab !== tabs[tabs.length - 1].id
                ? 'common:next'
                : isNew
                ? 'branches:editor.create'
                : 'branches:editor.saveChanges')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
    <ConfirmDialog
      open={discardOpen}
      kind="discard"
      title={t('branches:tabs.unsavedTitle')}
      body={t('branches:tabs.unsavedBody')}
      confirmLabel={t('branches:tabs.discard')}
      onClose={() => { pendingCloseActionRef.current = null; setDiscardOpen(false) }}
      onConfirm={confirmDiscard}
    />
    </>
  )
}

/* ── Reset password modal ────────────────────────────────────── */

function ResetPasswordModal({ branch, onClose }: { branch: BranchWithLogin; onClose: () => void }) {
  const { t } = useTranslation('branches')
  const [newPwd,     setNewPwd]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [done,       setDone]       = useState(false)

  async function handleSave() {
    setError('')
    if (newPwd.length < 8)      { setError(t('editor.passwordTooShort')); return }
    if (newPwd !== confirmPwd)  { setError(t('editor.passwordMismatch')); return }
    setSaving(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('reset-branch-password', {
        body: { branch_id: branch.id, new_password: newPwd },
      })
      const errMsg = fnErr?.message ?? (data as any)?.error ?? null
      if (errMsg) throw new Error(errMsg)
      setDone(true)
    } catch (err: any) {
      console.error('Failed to reset branch password', err)
      setError(t('editor.resetFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t('editor.resetPassword')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{branch.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-900">{t('editor.resetSuccess')}</p>
            <p className="text-xs text-gray-400 mt-1">{t('editor.resetSuccessBody')}</p>
            <Button className="w-full justify-center mt-4" onClick={onClose}>{t('editor.close')}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {branchLoginCredential(branch) && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-gray-400 font-medium">{t(`editor.${branchLoginCredential(branch)!.labelKey}`)}</p>
                <p className="text-sm text-gray-700 mt-0.5">{branchLoginCredential(branch)!.value}</p>
              </div>
            )}
            <Input label={t('editor.newPassword')} type="password" value={newPwd}
              onChange={e => setNewPwd(e.target.value)} placeholder={t('editor.passwordPlaceholder')} />
            <Input label={t('editor.confirmPassword')} type="password" value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)} placeholder={t('editor.repeatPassword')} />
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>{t('editor.cancel')}</Button>
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
  const { t } = useTranslation('branches')
  const navigate = useNavigate()
  const loginCredential = branchLoginCredential(branch)
  const contactItems = [
    branch.city ? { icon: MapPin, label: t('card.city'), value: branch.city } : null,
    branch.phone ? { icon: Phone, label: t('card.phone'), value: branch.phone } : null,
    branch.email ? { icon: Mail, label: t('card.email'), value: branch.email } : null,
    branch.vat_number ? { icon: FileText, label: t('card.vat'), value: branch.vat_number } : null,
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; value: string }>

  return (
    <div className={`card overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-primary-100 hover:shadow-card-md ${!branch.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4 border-b border-sidebar-border bg-sidebar p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/15">
            {branch.logo_url
              ? <img src={branch.logo_url} alt={branch.name} className="w-full h-full object-cover" />
              : <span className="text-lg font-black text-gold-300">{branch.name.charAt(0)}</span>
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-white text-base break-words" dir="auto">{branch.name}</span>
              {branch.name_ar && <span className="text-white/65 text-sm leading-5" dir="auto" style={{ fontFamily: 'Cairo' }}>{branch.name_ar}</span>}
              {branch.is_main_branch && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-gold-300/15 text-gold-200 px-2 py-0.5 rounded-full ring-1 ring-gold-300/25">
                  <Star size={9} /> {t('detail.main')}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={branch.is_active ? 'success' : 'neutral'} dot className="rounded-md border-0 bg-white/90 px-2 py-1 text-[11px]">
                {t(`status.${branch.is_active ? 'active' : 'inactive'}`)}
              </Badge>
              <span className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-primary-800">
                <ShieldCheck size={11} />
                Phase {branch.zatca_phase ?? 1}
              </span>
            </div>
          </div>
        </div>

        <button onClick={onEdit}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-gold-200 active:scale-[0.97] transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
          title={t('editor.edit')} aria-label={t('editor.edit')}>
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
              <p className="mt-1 truncate text-sm font-semibold text-gray-800" dir="auto" title={item.value}>{item.value}</p>
            </div>
          )) : (
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 text-sm text-gray-400">
              {t('card.noContact')}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('editor.login')}</p>
          {loginCredential ? (
            <div className="mt-2 space-y-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-indigo-600" title={loginCredential.value}>
                <LogIn size={13} /> {loginCredential.value}
              </p>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onResetPassword() }}
                className="text-xs font-semibold text-gray-500 hover:text-primary-700 transition-colors"
              >
                {t('editor.resetPassword')}
              </button>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-sm text-gray-300 italic"><LogIn size={12} /> {t('card.usernameNotSet')}</p>
          )}
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex text-xs font-semibold text-gray-400 hover:text-primary-600 transition-colors"
            title={t('card.deleteHelp')}
          >
            {t('card.contactSupport')}
          </a>
          <button
            type="button"
            onClick={() => navigate(`/settings/branches/${branch.id}`)}
            className="mt-2 block text-xs font-semibold text-primary-700 hover:text-primary-900"
          >
            {t('card.branchSettings')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────── */

export default function BranchesTab() {
  const { t } = useTranslation('branches')
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
      console.error('Failed to load branches', error)
      setLoadError(t('list.loadFailed'))
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

      {/* Capacity and actions */}
      <div className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-card">
        <div className="h-1 bg-gold-500" />
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700">{t('list.directory')}</p>
          <p className="mt-1 text-xl font-black text-gray-950">{t('list.usage', { active: activeBranchCount, max: maxBranches })}</p>
          <div className="mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-primary-50 ring-1 ring-primary-100" role="progressbar" aria-valuemin={0} aria-valuemax={maxBranches} aria-valuenow={activeBranchCount}>
            <div className={`h-full rounded-full ${remainingBranches === 0 ? 'bg-gold-500' : 'bg-primary-500'}`} style={{ width: `${Math.min((activeBranchCount / Math.max(maxBranches, 1)) * 100, 100)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{t('list.total', { count: totalBranchCount })}</span>
            <span className={remainingBranches === 0 ? 'font-semibold text-gold-700' : ''}>{t('list.remaining', { count: remainingBranches })}</span>
            {branchUsageError && <span className="text-amber-600">{t('list.localCount')}</span>}
          </div>
        </div>
        {!canCreateActiveBranch ? (
          <div className="flex flex-col items-end gap-2 text-end">
            <p className="text-xs text-red-600 font-medium">
              {t(sub.status === 'suspended' ? 'list.accountSuspended' : 'list.limitReached')}
            </p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-primary-600 bg-white px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              aria-label={t('list.contactAddBranches')}
            >
              <Phone size={13} className="me-1.5" aria-hidden="true" />
              {t('list.contactAddBranches')}
            </a>
            <p id="add-branch-disabled-reason" className="text-[11px] text-gray-500">{t('list.addDisabledReason')}</p>
            <Button onClick={() => setDrawer('new')} size="sm" disabled aria-describedby="add-branch-disabled-reason">
              <Plus size={14} /> {t('list.addBranch')}
            </Button>
          </div>
        ) : (
          <Button onClick={() => setDrawer('new')} size="sm">
            <Plus size={14} /> {t('list.addBranch')}
          </Button>
        )}
        </div>
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
          <p className="text-sm text-red-600 mb-1">{t('list.loadFailed')}</p>
          <Button size="sm" variant="secondary" onClick={load}>{t('list.retry')}</Button>
        </div>
      ) : branches.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">{t('list.empty')}</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">{t('list.emptyBody')}</p>
          <Button size="sm" onClick={() => setDrawer('new')} disabled={!canCreateActiveBranch}>
            <Plus size={13} /> {t('list.addFirstBranch')}
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

      {/* Centered add/edit modal */}
      {drawerBranch !== null && (
        <BranchModal
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
