import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Search, Building2, UserX, UserCheck, ChevronDown, ChevronUp,
  ChevronRight, Plus, MapPin, Loader2, Copy, CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import type { BusinessType, SuperAdminClientBillingSummary } from '@/types'
import { BUSINESS_TYPE_OPTIONS, businessTypeLabel, resolveBusinessType } from '@/lib/utils/businessType'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:           string
  name:         string
  name_ar:      string | null
  vat_number:   string
  city:         string | null
  business_type: BusinessType | null
  is_active:    boolean
  suspended_at: string | null
  created_at:   string
  maxBranches:  number
  plan:         string | null
  subStatus:    string | null
  endsAt:       string | null
  branchCount:  number
  userCount:    number
  lifecycleStatus: string
  manualPaymentStatus: string
  nextDueDate: string | null
  graceUntilDate: string | null
  paidBranchCount: number
  activeBranchCount: number
  totalBranchCount: number
  billingSignal: string | null
  ownerSetupStatus?: string | null
  ownerSetupLinkSentAt?: string | null
  branchUsageError?: boolean
}

interface BranchSummary {
  id:          string
  name:        string
  city:        string | null
  is_active:   boolean
  invoice_counter: number
}

type ComputedStatus = 'active' | 'lifetime_free' | 'grace_period' | 'payment_due' | 'suspended' | 'cancelled' | 'inactive'
type StatusFilter   = 'all' | 'active' | 'grace_period' | 'lifetime_free' | 'suspended' | 'payment_due'

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRACE_MS = 7 * 86_400_000
const MAX_OWNER_BRANCH_ALLOWANCE = 100

function getStatus(c: ClientRow): ComputedStatus {
  if (c.suspended_at) return 'suspended'
  if (!c.is_active)   return 'inactive'
  if (c.lifecycleStatus === 'cancelled') return 'cancelled'
  if (c.lifecycleStatus === 'suspended') return 'suspended'
  if (c.lifecycleStatus === 'payment_due') return 'payment_due'
  if (c.lifecycleStatus === 'grace_period') return 'grace_period'
  if (c.lifecycleStatus === 'lifetime_free') return 'lifetime_free'
  if (c.subStatus === 'lifetime_free' || (c.subStatus === 'active' && c.endsAt === null)) return 'lifetime_free'
  if (c.subStatus === 'active' && c.endsAt !== null) {
    const exp = new Date(c.endsAt).getTime()
    const now = Date.now()
    if (exp >= now) return 'active'
    if (now < exp + GRACE_MS) return 'grace_period'
    return 'payment_due'
  }
  return 'inactive'
}

const STATUS_META: Record<ComputedStatus, { variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active:        { variant: 'success'  },
  lifetime_free: { variant: 'success'  },
  grace_period:  { variant: 'warning'  },
  payment_due:   { variant: 'danger'   },
  suspended:     { variant: 'danger'   },
  cancelled:     { variant: 'danger'   },
  inactive:      { variant: 'neutral'  },
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10) : '—'
}

function getBillingSignal(c: ClientRow): { key: string; className: string } {
  if (c.billingSignal === 'suspended') return { key: 'status.suspended', className: 'bg-red-50 text-red-700 ring-red-200' }
  if (c.billingSignal === 'overdue') return { key: 'status.overdue', className: 'bg-red-50 text-red-700 ring-red-200' }
  if (c.billingSignal === 'in_grace') return { key: 'clients.inGrace', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  if (c.billingSignal === 'due_soon') return { key: 'clients.dueSoon', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  if (c.billingSignal === 'paid') return { key: 'status.paid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  const status = getStatus(c)
  if (status === 'suspended') return { key: 'status.suspended', className: 'bg-red-50 text-red-700 ring-red-200' }
  if (status === 'payment_due') return { key: 'status.overdue', className: 'bg-red-50 text-red-700 ring-red-200' }
  if (status === 'grace_period') return { key: 'clients.inGrace', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  if (status === 'lifetime_free') return { key: 'clients.lifetime', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  if (c.nextDueDate) {
    const days = Math.ceil((new Date(c.nextDueDate).getTime() - Date.now()) / GRACE_MS)
    if (days >= 0 && days <= 7) return { key: 'clients.dueSoon', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  }
  if (c.manualPaymentStatus === 'manual_verified') return { key: 'status.paid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  return { key: 'status.unpaid', className: 'bg-gray-50 text-gray-600 ring-gray-200' }
}

function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <span className="text-xs text-gray-400">—</span>
  const cls = plan === 'Phase 2'
    ? 'bg-primary-50 text-primary-700'
    : 'bg-amber-50 text-amber-700'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{plan}</span>
}

function matchesFilter(c: ClientRow, f: StatusFilter): boolean {
  if (f === 'all') return true
  return getStatus(c) === f
}

// ── Suspend / Restore modals ──────────────────────────────────────────────────

function SuspendModal({ client, reason, onReasonChange, onConfirm, onCancel, acting }: {
  client: ClientRow; reason: string; onReasonChange: (v: string) => void
  onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{t('clients.suspendTitle')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('clients.suspendHelp', { name: client.name })}
        </p>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.reasonOptional')}</label>
        <input
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          className="input w-full text-sm h-9 mb-5"
          placeholder={t('clients.reasonPlaceholder')}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">{t('actions.cancel')}</button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {t('actions.suspend')}
          </button>
        </div>
      </div>
    </div>
  )
}

function RestoreModal({ client, onConfirm, onCancel, acting }: {
  client: ClientRow; onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{t('clients.restoreTitle')}</h2>
        <p className="text-sm text-gray-500 mb-5">
          {t('clients.restoreHelp', { name: client.name })}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">{t('actions.cancel')}</button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {t('clients.restoreAccess')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create Account modal ──────────────────────────────────────────────────────

interface PlanOption { id: string; name: string; price_monthly: number }

interface CreateOwnerAccountResponse {
  code?: string
  provisioning_id?: string
  user_id?: string
  tenant_id?: string
  email?: string
  setup_link?: string
  setup_link_generated?: boolean
  warning?: string
}

const DURATIONS = [
  { key: 'oneMonth',         months: 1  },
  { key: 'twoMonths',        months: 2  },
  { key: 'threeMonths',      months: 3  },
  { key: 'sixMonths',        months: 6  },
  { key: 'oneYear',          months: 12 },
  { key: 'threeYears',       months: 36 },
  { key: 'fiveYears',        months: 60 },
  { key: 'lifetimeFree',     months: 0  },
]

type PaymentType = 'lifetime_free' | 'one_time' | 'recurring'

const PAYMENT_TYPE_OPTIONS: { type: PaymentType; labelKey: string; subKey: string; color: string }[] = [
  {
    type:  'lifetime_free',
    labelKey: 'create.lifetimePayment', subKey: 'create.lifetimePaymentHelp',
    color: 'border-emerald-500 bg-emerald-50 ring-emerald-500/20',
  },
  {
    type:  'one_time',
    labelKey: 'create.oneTimePayment', subKey: 'create.oneTimePaymentHelp',
    color: 'border-primary-500 bg-primary-50 ring-primary-500/20',
  },
  {
    type:  'recurring',
    labelKey: 'create.recurringManual', subKey: 'create.recurringManualHelp',
    color: 'border-primary-500 bg-primary-50 ring-primary-500/20',
  },
]

const PAID_DURATIONS = DURATIONS.filter(d => d.months > 0)

function CreateAccountModal({ onCreated, onCancel }: {
  onCreated: () => void
  onCancel:  () => void
}) {
  const { t, i18n } = useTranslation('admin')
  const [plans,   setPlans]   = useState<PlanOption[]>([])
  const [loading, setLoading] = useState(true)

  const [companyName,   setCompanyName]   = useState('')
  const [companyNameAr, setCompanyNameAr] = useState('')
  const [email,         setEmail]         = useState('')
  const [phone,         setPhone]         = useState('')
  const [city,          setCity]          = useState('')
  const [businessType,  setBusinessType]  = useState<BusinessType>('trading')
  const [isDemo,        setIsDemo]        = useState(false)
  const [fiscalRegime, setFiscalRegime] = useState<'generation' | 'integration'>('generation')
  const [planId,        setPlanId]        = useState('')
  const [branchCount,   setBranchCount]   = useState(1)
  const [paymentType,   setPaymentType]   = useState<PaymentType>('one_time')
  const [duration,      setDuration]      = useState(1)
  const [payMethod,     setPayMethod]     = useState('Manual')
  const [payRef,        setPayRef]        = useState('')
  const [notes,         setNotes]         = useState('')

  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [warning, setWarning] = useState('')
  const [created, setCreated] = useState<CreateOwnerAccountResponse | null>(null)
  const [copied,  setCopied]  = useState(false)

  useEffect(() => {
    ;(supabase as any)
      .from('subscription_plans')
      .select('id, name, price_monthly')
      .eq('is_active', true)
      .order('price_monthly')
      .then(({ data }: { data: PlanOption[] | null }) => {
        const list = data ?? []
        setPlans(list)
        if (list.length) setPlanId(list[0].id)
        setLoading(false)
      })
  }, [])

  const isLifetime     = paymentType === 'lifetime_free'
  const selectedPlan   = plans.find(p => p.id === planId)
  const pricePerBranch = selectedPlan?.price_monthly ?? 0
  const totalAmount    = isLifetime ? 0 : pricePerBranch * branchCount * duration

  function computeExpiry() {
    if (isLifetime) return null
    const d = new Date()
    d.setMonth(d.getMonth() + duration)
    return d.toISOString()
  }

  async function handleCreate() {
    setError('')
    setWarning('')
    if (!companyName.trim()) { setError(t('validation.companyRequired')); return }
    if (!email.trim())       { setError(t('validation.ownerEmailRequired')); return }
    if (!planId)             { setError(t('validation.planRequired')); return }
    if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > MAX_OWNER_BRANCH_ALLOWANCE) {
      setError(`Branch allowance must be a whole number from 1 to ${MAX_OWNER_BRANCH_ALLOWANCE}.`)
      return
    }

    setSaving(true)
    try {
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-owner-account', {
        body: {
          company_name:    companyName.trim(),
          company_name_ar: companyNameAr.trim() || null,
          email:           email.trim().toLowerCase(),
          phone:           phone.trim() || null,
          city:            city.trim() || null,
          business_type:    businessType,
          is_demo:         isDemo,
          fiscal_regime:    fiscalRegime,
          plan_id:         planId,
          branch_count:    branchCount,
          payment_type:    paymentType,
          duration_months: isLifetime ? 0 : duration,
          ends_at:         computeExpiry(),
          pay_method:      isLifetime ? null : payMethod,
          pay_ref:         isLifetime ? null : (payRef.trim() || null),
          notes:           notes.trim() || null,
        },
      })

      const result = (fnData ?? {}) as CreateOwnerAccountResponse
      if (result.code === 'CORE_COMPLETE_SETUP_LINK_FAILED') {
        setWarning(t('validation.setupLinkRetry'))
        return
      }
      if (!['COMPLETE', 'RESUMED_AND_COMPLETE', 'COMPLETE_SETUP_LINK_REGENERATED'].includes(result.code ?? '')) {
        throw new Error(result.code ?? fnErr?.message ?? 'FAILED_RECOVERABLE')
      }
      setCreated(result)
      setWarning(result.code === 'COMPLETE_SETUP_LINK_REGENERATED' ? t('validation.setupLinkRegenerated') : '')
    } catch (err: any) {
      console.error('Failed to create client account:', err)
      setError(t('validation.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function copySetupLink() {
    if (!created?.setup_link) return
    setCopied(false)
    try {
      await navigator.clipboard.writeText(created.setup_link)
      setCopied(true)
    } catch {
      setError(t('validation.copyFailed'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{t('create.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('create.subtitle')}</p>
        </div>

        {created ? (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">{t('create.created')}</p>
                <p className="text-xs text-emerald-700 mt-0.5">{t('create.createdHelp')}</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('create.ownerEmail')}</p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{created.email ?? email.trim().toLowerCase()}</p>
            </div>

            {created.setup_link ? (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-700">{t('create.ownerSetupLink')}</label>
                <textarea
                  readOnly
                  value={created.setup_link}
                  rows={4}
                  className="input w-full resize-none text-xs font-mono"
                  onFocus={e => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={copySetupLink}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  <Copy size={14} />
                  {copied ? t('create.copied') : t('create.copySetupLink')}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {t('create.setupLinkMissing')}
              </div>
            )}

            {warning && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {warning}
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="md" />
          </div>
        ) : (
          <div className="p-6 space-y-5">

            {/* Business info */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('create.businessInfo')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('create.businessNameEn')} *</label>
                  <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="Al-Faris Trading Co." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('create.businessNameAr')}</label>
                  <input value={companyNameAr} onChange={e => setCompanyNameAr(e.target.value)}
                    className="input w-full text-sm h-9" dir="rtl" placeholder="شركة الفارس" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.city')}</label>
                  <input value={city} onChange={e => setCity(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="Riyadh" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.phone')}</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="+966 5x xxx xxxx" />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Account type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: false, label: 'Production', help: 'Uses the production account contract.' },
                    { value: true, label: 'Demo', help: 'Uses the demo account contract.' },
                  ].map(option => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setIsDemo(option.value)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isDemo === option.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-xs font-semibold">{option.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{option.help}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.businessType')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {BUSINESS_TYPE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setBusinessType(option.value)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        businessType === option.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-xs font-semibold">{t(`businessTypes.${option.value}.short`)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{t(`businessTypes.${option.value}.description`)}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Owner login */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('create.ownerLogin')}</p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.email')} *</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                  className="input w-full text-sm h-9" placeholder="owner@company.com" />
              </div>
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 mt-3">
                <span className="text-blue-500 text-sm flex-shrink-0">✉</span>
                <p className="text-xs text-blue-700">
                  {t('create.setupLinkGuidance')}
                </p>
              </div>
            </div>

            {/* Fiscal intent is independent of the commercial plan; the server applies the resulting branch policy. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('create.fiscalMode')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => setFiscalRegime('generation')}
                  className={`text-left rounded-xl border-2 p-3 transition-all ${fiscalRegime === 'generation' ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <p className="text-xs font-semibold text-gray-900">{t('create.generationMode')}</p>
                  <p className="text-[10px] text-gray-500 mt-1 leading-tight">{t('create.generationModeHelp')}</p>
                </button>
                <button type="button" onClick={() => setFiscalRegime('integration')}
                  className={`text-left rounded-xl border-2 p-3 transition-all ${fiscalRegime === 'integration' ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <p className="text-xs font-semibold text-gray-900">{t('create.integrationMode')}</p>
                  <p className="text-[10px] text-gray-500 mt-1 leading-tight">{t('create.integrationModeHelp')}</p>
                </button>
              </div>
            </div>

            {/* Plan + branches */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('clients.subscription')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.plan')} *</label>
                  <select value={planId} onChange={e => setPlanId(e.target.value)} className="input w-full text-sm h-9">
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} — SAR {p.price_monthly}/branch/mo</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('create.branchesAllowed')}</label>
                  <input
                    type="number" min={1} max={MAX_OWNER_BRANCH_ALLOWANCE} step={1} value={branchCount}
                    onChange={e => {
                      const value = Number(e.target.value)
                      setBranchCount(Number.isInteger(value)
                        ? Math.min(MAX_OWNER_BRANCH_ALLOWANCE, Math.max(1, value))
                        : 1)
                    }}
                    className="input w-full text-sm h-9"
                  />
                </div>
              </div>
            </div>

            {/* Payment type */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">{t('create.paymentType')}</p>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setPaymentType(opt.type)}
                    className={`text-left rounded-xl border-2 p-3 transition-all ${
                      paymentType === opt.type
                        ? `${opt.color} ring-2 shadow-sm`
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <p className="text-xs font-semibold text-gray-900 leading-tight">{t(opt.labelKey)}</p>
                    <p className="text-[10px] text-gray-500 mt-1 leading-tight">{t(opt.subKey)}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Paid-only fields */}
            {!isLifetime && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('create.duration')} *</label>
                    <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="input w-full text-sm h-9">
                      {PAID_DURATIONS.map(d => <option key={d.months} value={d.months}>{t(`durations.${d.key}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.method')}</label>
                    <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input w-full text-sm h-9">
                      {['Manual', 'Bank Transfer', 'Cash'].map(m => <option key={m} value={m}>{t(`payment.${m === 'Manual' ? 'manual' : m === 'Cash' ? 'cash' : 'bank_transfer'}`)}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.reference')}</label>
                  <input value={payRef} onChange={e => setPayRef(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="e.g. TXN123456" />
                </div>

                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between items-center text-gray-500">
                    <span>
                      SAR {pricePerBranch} × {branchCount} branch{branchCount !== 1 ? 'es' : ''} × {duration} month{duration !== 1 ? 's' : ''}
                    </span>
                    <span className="font-bold text-gray-900">= SAR {totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400 border-t border-gray-200 pt-1.5">
                    <span>{t('billing.endDate')}</span>
                    <span className="font-semibold text-gray-700">
                      {(() => { const d = new Date(); d.setMonth(d.getMonth() + duration); return d.toLocaleDateString(i18n.language) })()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {isLifetime && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
                {t('create.lifetimeSummary')}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.internalNotes')}</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                className="input w-full text-sm h-9" placeholder={t('create.notesPlaceholder')} dir="auto" />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={created ? onCreated : onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            {created ? t('create.closeAndView') : t('actions.cancel')}
          </button>
          {!created && (
            <button
              onClick={handleCreate}
              disabled={saving || loading}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? t('create.creating') : t('clients.createAccount')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('admin')

  const [clients,  setClients]  = useState<ClientRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState<StatusFilter>('all')
  const [acting,   setActing]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [branches, setBranches] = useState<Record<string, BranchSummary[]>>({})
  const [loadingBranch, setLoadingBranch] = useState<Set<string>>(new Set())
  const [billingSummaryWarning, setBillingSummaryWarning] = useState('')

  const [suspendTarget, setSuspendTarget] = useState<ClientRow | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<ClientRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [showCreate,    setShowCreate]    = useState(false)

  function mapBillingSummaryRow(r: SuperAdminClientBillingSummary): ClientRow {
    return {
      id: r.tenant_id,
      name: r.business_name,
      name_ar: r.business_name_ar,
      vat_number: r.vat_number,
      city: r.city,
      business_type: resolveBusinessType(r.business_type),
      is_active: r.tenant_is_active,
      suspended_at: r.suspended_at,
      created_at: r.created_at,
      maxBranches: r.max_branches,
      plan: r.subscription_plan_name,
      subStatus: r.lifecycle_status,
      endsAt: r.current_period_end,
      branchCount: r.total_branch_count,
      userCount: r.user_count,
      lifecycleStatus: r.lifecycle_status,
      manualPaymentStatus: r.manual_payment_status,
      nextDueDate: r.next_due_date,
      graceUntilDate: r.grace_until_date,
      paidBranchCount: r.paid_branch_count,
      activeBranchCount: r.active_branch_count,
      totalBranchCount: r.total_branch_count,
      billingSignal: r.billing_signal,
      ownerSetupStatus: r.owner_setup_status,
      ownerSetupLinkSentAt: null,
    }
  }

  async function fetchClientsFallback() {
    const { data } = await (supabase as any)
      .from('tenants')
      .select(`
        id, name, name_ar, vat_number, city, business_type, is_active, suspended_at, created_at, max_branches,
        tenant_subscriptions(status, ends_at, manual_payment_status, subscription_lifecycle_status, next_due_date, grace_until_date, paid_branch_count, subscription_plans(name)),
        branches(id, is_active),
        user_profiles(id)
      `)
      .order('created_at', { ascending: false })
      .limit(200)

    return (data ?? []).map((r: any) => {
      const sub = r.tenant_subscriptions?.[0]
      const activeBranchCount = (r.branches ?? []).filter((b: any) => b.is_active !== false).length
      return {
        id:           r.id,
        name:         r.name,
        name_ar:      r.name_ar,
        vat_number:   r.vat_number,
        city:         r.city,
        business_type: resolveBusinessType(r.business_type),
        is_active:    r.is_active,
        suspended_at: r.suspended_at,
        created_at:   r.created_at,
        maxBranches:  r.max_branches ?? 999,
        plan:         sub?.subscription_plans?.name ?? null,
        subStatus:    sub?.status ?? null,
        endsAt:       sub?.ends_at ?? null,
        branchCount:  r.branches?.length ?? 0,
        userCount:    r.user_profiles?.length ?? 0,
        lifecycleStatus: sub?.subscription_lifecycle_status ?? (sub?.status === 'active' ? 'active' : 'inactive'),
        manualPaymentStatus: sub?.manual_payment_status ?? 'unpaid',
        nextDueDate: sub?.next_due_date ?? sub?.ends_at ?? null,
        graceUntilDate: sub?.grace_until_date ?? null,
        paidBranchCount: Math.max(1, sub?.paid_branch_count ?? r.max_branches ?? 1),
        activeBranchCount,
        totalBranchCount: r.branches?.length ?? 0,
        billingSignal: null,
        ownerSetupStatus: null,
        ownerSetupLinkSentAt: null,
        branchUsageError: true,
      } satisfies ClientRow
    })
  }

  async function fetchClients() {
    setLoading(true)
    const { data, error } = await (supabase as any).rpc('get_super_admin_clients_billing_summary')

    if (!error && Array.isArray(data)) {
      setClients((data as SuperAdminClientBillingSummary[]).map(mapBillingSummaryRow))
      setBillingSummaryWarning('')
      setLoading(false)
      return
    }

    const rows = await fetchClientsFallback()
    setClients(rows)
    setBillingSummaryWarning(t('clients.fallbackWarning'))
    setLoading(false)
  }

  useEffect(() => { fetchClients() }, [t])

  async function toggleExpand(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (expanded.has(id)) {
      setExpanded(prev => { const s = new Set(prev); s.delete(id); return s })
      return
    }
    setExpanded(prev => new Set(prev).add(id))
    if (branches[id]) return

    setLoadingBranch(prev => new Set(prev).add(id))
    const { data } = await (supabase as any)
      .from('branches')
      .select('id, name, city, is_active, invoice_counter')
      .eq('tenant_id', id)
      .order('is_main_branch', { ascending: false })
    setBranches(prev => ({ ...prev, [id]: data ?? [] }))
    setLoadingBranch(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function confirmSuspend() {
    if (!suspendTarget) return
    setActing(true)
    await (supabase as any).from('tenants')
      .update({ suspended_at: new Date().toISOString(), suspended_reason: suspendReason || null, is_active: false })
      .eq('id', suspendTarget.id)
    setActing(false)
    setSuspendTarget(null)
    setSuspendReason('')
    fetchClients()
  }

  async function confirmRestore() {
    if (!restoreTarget) return
    setActing(true)
    await (supabase as any).from('tenants')
      .update({ suspended_at: null, suspended_reason: null, is_active: true })
      .eq('id', restoreTarget.id)
    setActing(false)
    setRestoreTarget(null)
    fetchClients()
  }

  function handleToggle(e: React.MouseEvent, c: ClientRow) {
    e.stopPropagation()
    if (c.suspended_at) {
      setRestoreTarget(c)
    } else {
      setSuspendReason('')
      setSuspendTarget(c)
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clients.filter(c =>
      matchesFilter(c, filter) &&
      (!q || c.name.toLowerCase().includes(q) || (c.name_ar ?? '').includes(q) || c.vat_number.includes(q))
    )
  }, [clients, search, filter])

  const counts = useMemo(() => ({
    all:          clients.length,
    active:       clients.filter(c => getStatus(c) === 'active').length,
    grace_period: clients.filter(c => getStatus(c) === 'grace_period').length,
    lifetime_free:clients.filter(c => getStatus(c) === 'lifetime_free').length,
    suspended:    clients.filter(c => getStatus(c) === 'suspended').length,
    payment_due:  clients.filter(c => getStatus(c) === 'payment_due').length,
  }), [clients])

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all',          label: t('clients.filter', { status: t('clients.all'), count: counts.all }) },
    { key: 'active',       label: t('clients.filter', { status: t('status.active'), count: counts.active }) },
    { key: 'grace_period', label: t('clients.filter', { status: t('status.grace_period'), count: counts.grace_period }) },
    { key: 'lifetime_free',label: t('clients.filter', { status: t('clients.lifetime'), count: counts.lifetime_free }) },
    { key: 'suspended',    label: t('clients.filter', { status: t('status.suspended'), count: counts.suspended }) },
    { key: 'payment_due',  label: t('clients.filter', { status: t('status.payment_due'), count: counts.payment_due }) },
  ]

  return (
    <div className="space-y-6">

      {/* Modals */}
      {suspendTarget && (
        <SuspendModal
          client={suspendTarget}
          reason={suspendReason}
          onReasonChange={setSuspendReason}
          onConfirm={confirmSuspend}
          onCancel={() => { setSuspendTarget(null); setSuspendReason('') }}
          acting={acting}
        />
      )}
      {restoreTarget && (
        <RestoreModal
          client={restoreTarget}
          onConfirm={confirmRestore}
          onCancel={() => setRestoreTarget(null)}
          acting={acting}
        />
      )}
      {showCreate && (
        <CreateAccountModal
          onCreated={() => { setShowCreate(false); fetchClients() }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('clients.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {t('clients.registered', { count: clients.length })}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Plus size={15} /> {t('clients.createAccount')}
        </button>
      </div>

      {billingSummaryWarning && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {billingSummaryWarning}
        </div>
      )}

      {/* Search + filter tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('clients.searchNameVat')}
            className="input ltr:pl-9 rtl:pr-9 text-sm h-9 w-full"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                filter === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="md" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['', t('clients.business'), t('clients.city'), t('clients.plan'), t('clients.billing'), t('clients.branches'), t('clients.users'), t('clients.joined'), t('clients.status'), ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const st         = STATUS_META[getStatus(c)]
                  const isExpanded = expanded.has(c.id)
                  const isBranchLoading = loadingBranch.has(c.id)
                  const clientBranches  = branches[c.id]
                  const signal = getBillingSignal(c)
                  const branchWarning = c.activeBranchCount > c.paidBranchCount || c.totalBranchCount > c.paidBranchCount

                  return (
                    <React.Fragment key={c.id}>
                      <tr
                        className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors cursor-pointer"
                        onClick={() => navigate(`/super-admin/clients/${c.id}`)}
                      >
                        {/* Expand toggle */}
                        <td className="px-4 py-3.5 w-8" onClick={e => toggleExpand(e, c.id)}>
                          <button className="text-gray-400 hover:text-gray-600 transition-colors">
                            {isBranchLoading ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : isExpanded ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3.5">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{c.name}</p>
                            {c.name_ar && <p className="text-xs text-gray-400 mt-0.5" dir="rtl">{c.name_ar}</p>}
                            <p className="text-[10px] text-gray-400 mt-0.5">{businessTypeLabel(c.business_type)}</p>
                            {c.ownerSetupStatus === 'owner_setup_complete' ? (
                              <p className="text-[10px] text-emerald-600 mt-0.5">
                                Owner setup complete
                              </p>
                            ) : c.ownerSetupStatus ? (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                Owner setup: {c.ownerSetupStatus.replace(/_/g, ' ')}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-gray-500">
                          {c.city ? (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} className="text-gray-300" />{c.city}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3.5"><PlanBadge plan={c.plan} /></td>
                        <td className="px-4 py-3.5 min-w-[180px]">
                          <div className="flex flex-col gap-1.5">
                            <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${signal.className}`}>
                              {t(signal.key)}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {c.suspended_at ? t('clients.enforcementActive') : t('clients.visibilityOnly')}
                            </span>
                            <div className="text-[11px] leading-4 text-gray-500">
                              <span className="font-medium text-gray-700">{c.manualPaymentStatus.replace(/_/g, ' ')}</span>
                              <span className="text-gray-300"> · </span>
                              {t('clients.due', { date: formatDate(c.nextDueDate) })}
                              {c.graceUntilDate && (
                                <span className="block text-gray-400">{t('clients.graceUntil', { date: formatDate(c.graceUntilDate) })}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-gray-600 tabular-nums">
                          <div className={branchWarning ? 'text-amber-700' : ''}>
                            <span className="font-semibold">{c.activeBranchCount}</span>
                            <span className="text-gray-400">/{t('clients.paidCount', { count: c.paidBranchCount })}</span>
                          </div>
                          <p className="text-[11px] text-gray-400">
                            {t('clients.branchTotals', { total: c.totalBranchCount, max: c.maxBranches })}
                            {c.branchUsageError ? ` · ${t('clients.fallback')}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-gray-600 tabular-nums">{c.userCount}</td>
                        <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">{c.created_at.slice(0, 10)}</td>
                        <td className="px-4 py-3.5">
                          <Badge variant={st.variant} dot>{t(`status.${getStatus(c)}`)}</Badge>
                        </td>
                        <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={e => handleToggle(e, c)}
                              className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                                c.suspended_at
                                  ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                  : 'text-red-500 bg-red-50 hover:bg-red-100'
                              }`}
                            >
                              {c.suspended_at ? <UserCheck size={11} /> : <UserX size={11} />}
                              {c.suspended_at ? t('clients.restore') : t('actions.suspend')}
                            </button>
                            <button
                              onClick={() => navigate(`/super-admin/clients/${c.id}`)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                              <ChevronRight size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded branches row */}
                      {isExpanded && (
                        <tr className="border-b border-gray-100 bg-gray-50/40">
                          <td colSpan={10} className="px-8 py-3">
                            {isBranchLoading || !clientBranches ? (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" /> {t('clients.loadingBranches')}
                              </div>
                            ) : clientBranches.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">{t('clients.noBranches')}</p>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                {clientBranches.map(b => (
                                  <div key={b.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs shadow-sm">
                                    <Building2 size={12} className="text-gray-300 flex-shrink-0" />
                                    <div>
                                      <p className="font-medium text-gray-800">{b.name}</p>
                                      <p className="text-gray-400 mt-0.5">
                                        {b.city ? `${b.city} · ` : ''}{t('clients.invoiceCount', { count: b.invoice_counter })}
                                        {!b.is_active && <span className="text-red-400 ms-1">· {t('status.inactive')}</span>}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-5 py-10 text-center">
                      <Building2 size={28} className="text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">{t('clients.noClients')}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
