import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, Building2, Users, FileText, CreditCard,
  UserX, UserCheck, Trash2, MapPin, Phone, Mail,
  AlertTriangle, CheckCircle2, Settings, Star,
  Plus, NotebookPen, ClipboardCheck, CalendarDays, ReceiptText,
  Copy, Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import type {
  BranchSetupStatus,
  BusinessType,
  ManualPaymentStatus,
  ManualSubscriptionPlanInterval,
  OwnerSetupStatus,
  SubscriptionLifecycleStatus,
  TenantOnboardingStatusValue,
  TenantSupportNoteType,
  ZatcaSetupStatus,
} from '@/types'
import { BUSINESS_TYPE_OPTIONS, businessTypeLabel, resolveBusinessType } from '@/lib/utils/businessType'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantDetail {
  id: string; name: string; name_ar: string | null
  vat_number: string; cr_number: string | null
  email: string | null; phone: string | null; website: string | null
  business_type: BusinessType | null
  address: string | null; city: string | null; country: string
  is_active: boolean; suspended_at: string | null; suspended_reason: string | null
  last_active_at: string | null; max_branches: number
  created_at: string; updated_at: string
}

interface SubscriptionDetail {
  id: string; status: string; starts_at: string; ends_at: string | null
  trial_ends_at: string | null; payment_info: string | null
  plan_id: string
  plan_interval: ManualSubscriptionPlanInterval
  price_per_branch: number | null
  paid_branch_count: number
  current_period_start: string | null
  current_period_end: string | null
  next_due_date: string | null
  grace_until_date: string | null
  manual_payment_status: ManualPaymentStatus
  subscription_lifecycle_status: SubscriptionLifecycleStatus
  last_payment_at: string | null
  plan: { name: string; price_monthly: number; max_branches: number; max_users: number } | null
}

interface BranchItem {
  id: string; name: string; name_ar: string | null; city: string | null
  is_main_branch: boolean; is_active: boolean; invoice_counter: number
}

interface UserItem {
  id: string; full_name: string | null; role: string
  email: string | null; is_active: boolean; created_at: string
}

interface InvoiceStats {
  total: number; posted: number; revenue: number
}

interface PlanRow {
  id: string; name: string; price_monthly: number; max_branches: number
}

interface BranchUsage {
  tenant_id: string
  max_branches: number
  active_branch_count: number
  total_branch_count: number
  remaining_branches: number
  can_create_branch: boolean
  reason: string
}

interface SubscriptionAccess {
  tenant_id: string
  lifecycle_status: string
  manual_payment_status: string
  max_branches: number
  paid_branch_count: number
  current_period_end: string | null
  next_due_date: string | null
  grace_until_date: string | null
  days_until_due: number | null
  days_overdue: number | null
  can_use_pos: boolean
  can_create_branch: boolean
  reason: string
}

interface ManualPaymentRow {
  id: string
  tenant_id: string
  subscription_id: string | null
  amount: number
  currency: string
  plan_interval: ManualSubscriptionPlanInterval
  paid_branch_count: number
  price_per_branch: number | null
  payment_method: string | null
  payment_reference: string | null
  payment_received_at: string
  coverage_start_date: string
  coverage_end_date: string
  next_due_date: string
  grace_until_date: string
  status: ManualPaymentStatus
  money_back_until_date: string | null
  notes: string | null
  verified_by: string | null
  created_at: string
}

interface OnboardingRow {
  id: string
  tenant_id: string
  onboarding_status: TenantOnboardingStatusValue
  owner_setup_status: OwnerSetupStatus
  branch_setup_status: BranchSetupStatus
  zatca_setup_status: ZatcaSetupStatus
  ready_for_billing: boolean
  owner_setup_link_sent_at: string | null
  owner_setup_completed_at: string | null
  first_branch_created_at: string | null
  first_invoice_created_at: string | null
  notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

interface SupportNoteRow {
  id: string
  tenant_id: string
  note: string
  note_type: TenantSupportNoteType
  created_by: string | null
  created_at: string
}

interface ResendOwnerSetupResponse {
  setupLink?: string
  ownerEmail?: string
  ownerUserId?: string
  ownerName?: string | null
  ownerSetupLinkSentAt?: string
  expiresNote?: string
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{value ?? <span className="text-gray-300">—</span>}</span>
    </div>
  )
}

// ── Subscription modal ────────────────────────────────────────────────────────

const DURATIONS = [
  { key: 'oneMonth', months: 1 }, { key: 'twoMonths', months: 2 },
  { key: 'threeMonths', months: 3 }, { key: 'sixMonths', months: 6 },
  { key: 'oneYear', months: 12 }, { key: 'threeYears', months: 36 },
  { key: 'fiveYears', months: 60 }, { key: 'lifetimeFree', months: 0 },
]

const PHASE_PRICES: Record<string, number> = {
  'Phase 1': 50,
  'Phase 2': 100,
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)
}

function fromDateTimeInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '—'
}

function humanize(value: string | null | undefined) {
  return value ? value.replace(/_/g, ' ') : '—'
}

function accessBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'active' || status === 'manual_verified' || status === 'lifetime_free') return 'success'
  if (status === 'grace_period' || status === 'unpaid') return 'warning'
  if (status === 'payment_due' || status === 'overdue' || status === 'suspended' || status === 'cancelled') return 'danger'
  return 'neutral'
}

const ONBOARDING_STATUS_OPTIONS: { value: TenantOnboardingStatusValue; label: string }[] = [
  { value: 'details_pending', label: 'Details pending' },
  { value: 'owner_invited', label: 'Owner invited' },
  { value: 'owner_setup_complete', label: 'Owner setup complete' },
  { value: 'branch_setup_pending', label: 'Branch setup pending' },
  { value: 'zatca_setup_pending', label: 'ZATCA setup pending' },
  { value: 'ready_for_billing', label: 'Ready for billing' },
  { value: 'live', label: 'Live' },
]

const OWNER_SETUP_OPTIONS: { value: OwnerSetupStatus; label: string }[] = [
  { value: 'owner_invited', label: 'Owner invited' },
  { value: 'owner_setup_complete', label: 'Owner setup complete' },
  { value: 'setup_link_expired', label: 'Setup link expired' },
  { value: 'setup_blocked', label: 'Setup blocked' },
]

const BRANCH_SETUP_OPTIONS: { value: BranchSetupStatus; label: string }[] = [
  { value: 'branch_setup_pending', label: 'Branch setup pending' },
  { value: 'first_branch_created', label: 'First branch created' },
  { value: 'branch_setup_complete', label: 'Branch setup complete' },
]

const ZATCA_SETUP_OPTIONS: { value: ZatcaSetupStatus; label: string }[] = [
  { value: 'zatca_setup_pending', label: 'ZATCA setup pending' },
  { value: 'not_required', label: 'Not required' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'production_ready', label: 'Production ready' },
  { value: 'needs_attention', label: 'Needs attention' },
]

const SUPPORT_NOTE_TYPES: { value: TenantSupportNoteType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'payment', label: 'Payment' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'support', label: 'Support' },
  { value: 'zatca', label: 'ZATCA' },
]

function ManageSubscriptionModal({ tenantId, existingSub, plans, onSaved, onCancel }: {
  tenantId:    string
  existingSub: SubscriptionDetail | null
  plans:       PlanRow[]
  onSaved:     () => void
  onCancel:    () => void
}) {
  const { t, i18n } = useTranslation('admin')
  const [planId,     setPlanId]     = useState(existingSub?.plan_id ?? plans[0]?.id ?? '')
  const [branches,   setBranches]   = useState(1)
  const [duration,   setDuration]   = useState(1)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const selectedPlan = plans.find(p => p.id === planId)
  const selectedDur  = DURATIONS.find(d => d.months === duration) ?? DURATIONS[0]
  const isLifetime   = duration === 0

  const expiryDate = isLifetime
    ? null
    : addMonths(new Date(), duration)

  const pricePerBranch = selectedPlan
    ? (PHASE_PRICES[selectedPlan.name] ?? selectedPlan.price_monthly)
    : 0
  const total = isLifetime ? 0 : pricePerBranch * branches * duration

  async function handleSave() {
    if (!planId) { setError(t('validation.planRequired')); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        tenant_id:   tenantId,
        plan_id:     planId,
        status:      'active' as const,
        starts_at:   new Date().toISOString(),
        ends_at:     expiryDate ? expiryDate.toISOString() : null,
        trial_ends_at: null,
        cancelled_at:  null,
        plan_interval: isLifetime ? 'lifetime' : duration >= 12 ? 'yearly' : 'monthly',
        paid_branch_count: branches,
        price_per_branch: pricePerBranch,
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
        next_due_date: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
        grace_until_date: expiryDate ? addDays(expiryDate, 7).toISOString().slice(0, 10) : null,
        manual_payment_status: isLifetime ? 'manual_verified' : 'unpaid',
        subscription_lifecycle_status: isLifetime ? 'lifetime_free' : 'active',
      }

      if (existingSub) {
        const { error: e } = await (supabase as any)
          .from('tenant_subscriptions')
          .update(payload)
          .eq('id', existingSub.id)
        if (e) throw e
      } else {
        const { error: e } = await (supabase as any)
          .from('tenant_subscriptions')
          .insert(payload)
        if (e) throw e
      }

      // Update tenant: restore if suspended, store per-client branch limit
      await (supabase as any)
        .from('tenants')
        .update({ is_active: true, max_branches: branches })
        .eq('id', tenantId)

      onSaved()
    } catch (err: any) {
      console.error('Failed to save subscription:', err)
      setError(t('validation.subscriptionSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-900">{t('billing.manageSubscription')}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.plan')}</label>
            <select
              value={planId}
              onChange={e => setPlanId(e.target.value)}
              className="input w-full text-sm h-9"
            >
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.paidBranches')}</label>
            <input
              type="number"
              min={1}
              value={branches}
              onChange={e => setBranches(Math.max(1, Number(e.target.value)))}
              className="input w-full text-sm h-9"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('create.duration')}</label>
          <select
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="input w-full text-sm h-9"
          >
            {DURATIONS.map(d => (
              <option key={d.months} value={d.months}>{t(`durations.${d.key}`)}</option>
            ))}
          </select>
        </div>

        {!isLifetime && expiryDate && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">{t('billing.endDate')}</span>
              <span className="font-semibold text-gray-900">{expiryDate.toLocaleDateString(i18n.language)}</span>
            </div>
            {total > 0 && (
              <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-gray-200">
                <span className="text-gray-500">
                  {t('billing.total')}: SAR {pricePerBranch} × {branches} × {t(`durations.${selectedDur.key}`)}
                </span>
                <span className="font-bold text-gray-900">SAR {total.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {isLifetime && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
            {t('billing.lifetimeWarning')}
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {t('actions.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? t('clients.saving') : t('billing.saveSubscription')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modals ────────────────────────────────────────────────────────────────────

function SuspendModal({ name, reason, onReasonChange, onConfirm, onCancel, acting }: {
  name: string; reason: string; onReasonChange: (v: string) => void
  onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{t('clients.suspendTitle')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('clients.suspendHelp', { name })}
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
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {t('actions.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {acting ? t('common.processing') : t('actions.suspend')}
          </button>
        </div>
      </div>
    </div>
  )
}

function RestoreModal({ name, onConfirm, onCancel, acting }: {
  name: string; onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{t('clients.restoreTitle')}</h2>
        <p className="text-sm text-gray-500 mb-5">
          {t('clients.restoreHelp', { name })}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {t('actions.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {acting ? t('common.processing') : t('clients.restoreAccess')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteModal({ name, confirmName, onConfirmNameChange, onConfirm, onCancel, acting, error }: {
  name: string; confirmName: string; onConfirmNameChange: (v: string) => void
  onConfirm: () => void; onCancel: () => void; acting: boolean; error: string | null
}) {
  const { t } = useTranslation('admin')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">{t('destructive.deleteClient')}</h2>
        <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 mb-4">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            {t('destructive.deleteWarning')}
          </p>
        </div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          {t('destructive.typeToConfirm', { name })}
        </label>
        <input
          value={confirmName}
          onChange={e => onConfirmNameChange(e.target.value)}
          className="input w-full text-sm h-9 mb-2"
          placeholder={name}
          autoFocus
        />
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            {t('actions.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={acting || confirmName !== name}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {acting ? t('destructive.deleting') : t('destructive.permanentDelete')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SubscriptionOpsCard({ sub, access, usage }: {
  sub: SubscriptionDetail | null
  access: SubscriptionAccess | null
  usage: BranchUsage | null
}) {
  const { t } = useTranslation('admin')
  const lifecycle = access?.lifecycle_status ?? sub?.subscription_lifecycle_status ?? sub?.status ?? 'not_found'
  const payment = access?.manual_payment_status ?? sub?.manual_payment_status ?? 'unpaid'
  const activeBranches = usage?.active_branch_count ?? 0
  const totalBranches = usage?.total_branch_count ?? 0
  const paidBranches = access?.paid_branch_count ?? sub?.paid_branch_count ?? 1
  const exceedsPaid = activeBranches > paidBranches || totalBranches > paidBranches
  const isSuspensionEnforced = lifecycle === 'suspended'
  const wouldBlockIfEnabled = access?.can_use_pos === false && !isSuspensionEnforced

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{t('snapshot.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('snapshot.visibility')}</p>
        </div>
        <Badge variant={accessBadgeVariant(lifecycle)} dot>{humanize(lifecycle)}</Badge>
      </div>

      {!access && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {t('snapshot.unavailable')}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: t('snapshot.payment'), value: t(`status.${payment}`, { defaultValue: t('unknown') }), badge: true },
          { label: t('snapshot.nextDue'), value: formatDate(access?.next_due_date ?? sub?.next_due_date) },
          { label: t('snapshot.graceUntil'), value: formatDate(access?.grace_until_date ?? sub?.grace_until_date) },
          {
            label: access?.days_overdue && access.days_overdue > 0 ? t('snapshot.daysOverdue') : t('snapshot.daysUntilDue'),
            value: access?.days_overdue && access.days_overdue > 0 ? access.days_overdue : access?.days_until_due ?? '—',
          },
        ].map(item => (
          <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {item.badge ? <Badge variant={accessBadgeVariant(payment)}>{item.value}</Badge> : item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('payment.paidBranches'), value: paidBranches },
          { label: t('snapshot.maxBranches'), value: usage?.max_branches ?? access?.max_branches ?? '—' },
          { label: t('snapshot.activeBranches'), value: activeBranches },
          { label: t('snapshot.totalBranches'), value: totalBranches },
        ].map(item => (
          <div key={item.label} className="rounded-xl border border-gray-100 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant={isSuspensionEnforced ? 'danger' : wouldBlockIfEnabled ? 'warning' : 'success'} dot>
          {isSuspensionEnforced ? t('snapshot.enforced') : wouldBlockIfEnabled ? t('snapshot.wouldBlock') : t('snapshot.posAllowed')}
        </Badge>
        <Badge variant={usage?.can_create_branch === false ? 'warning' : 'success'} dot>
          {usage?.can_create_branch === false ? t('snapshot.limitReached') : t('snapshot.canCreateBranch')}
        </Badge>
        {exceedsPaid && <Badge variant="warning" dot>{t('snapshot.exceedsPaid')}</Badge>}
      </div>

      {(isSuspensionEnforced || wouldBlockIfEnabled) && (
        <p className={`mt-3 rounded-xl border px-4 py-3 text-xs font-medium ${
          isSuspensionEnforced
            ? 'border-red-100 bg-red-50 text-red-700'
            : 'border-amber-100 bg-amber-50 text-amber-800'
        }`}>
          {isSuspensionEnforced
            ? t('snapshot.suspensionEffect') : t('snapshot.paymentVisibility')}
        </p>
      )}
      {access?.reason && <p className="mt-3 text-xs text-gray-400">Reason: {humanize(access.reason)}</p>}
    </div>
  )
}

function MarkPaymentCard({ tenant, sub, plans, access, onSaved }: {
  tenant: TenantDetail
  sub: SubscriptionDetail | null
  plans: PlanRow[]
  access: SubscriptionAccess | null
  onSaved: () => void
}) {
  const { t } = useTranslation('admin')
  const initialCount = Math.max(1, access?.paid_branch_count ?? sub?.paid_branch_count ?? tenant.max_branches ?? 1)
  const [interval, setInterval] = useState<ManualSubscriptionPlanInterval>('monthly')
  const [paidBranchCount, setPaidBranchCount] = useState(initialCount)
  const [pricePerBranch, setPricePerBranch] = useState('100.00')
  const [amount, setAmount] = useState((initialCount * 100).toFixed(2))
  const [currency, setCurrency] = useState('SAR')
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentReceivedDate, setPaymentReceivedDate] = useState(toDateInput(new Date()))
  const [coverageStart, setCoverageStart] = useState(toDateInput(new Date()))
  const [coverageEnd, setCoverageEnd] = useState(toDateInput(addMonths(new Date(), 1)))
  const [notes, setNotes] = useState('')
  const [alignMaxBranches, setAlignMaxBranches] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const nextDueDate = coverageEnd
  const graceUntilDate = toDateInput(addDays(new Date(`${nextDueDate}T00:00:00`), 7))

  function applyInterval(nextInterval: ManualSubscriptionPlanInterval) {
    const normalized = nextInterval === 'yearly' ? 'yearly' : 'monthly'
    const nextPrice = normalized === 'yearly' ? 1000 : 100
    const start = new Date(`${coverageStart}T00:00:00`)
    const end = addMonths(start, normalized === 'yearly' ? 12 : 1)
    setInterval(normalized)
    setPricePerBranch(nextPrice.toFixed(2))
    setAmount((paidBranchCount * nextPrice).toFixed(2))
    setCoverageEnd(toDateInput(end))
  }

  function applyPaidBranchCount(value: number) {
    const nextCount = Math.max(1, value || 1)
    setPaidBranchCount(nextCount)
    setAmount((nextCount * Number(pricePerBranch || 0)).toFixed(2))
  }

  function applyCoverageStart(value: string) {
    setCoverageStart(value)
    const start = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(start.getTime())) {
      setCoverageEnd(toDateInput(addMonths(start, interval === 'yearly' ? 12 : 1)))
    }
  }

  async function submitPayment() {
    setError('')
    const start = new Date(`${coverageStart}T00:00:00`)
    const end = new Date(`${coverageEnd}T00:00:00`)
    const grace = new Date(`${graceUntilDate}T00:00:00`)

    if (paidBranchCount < 1) { setError(t('validation.paidBranches')); return }
    if (Number(amount) < 0) { setError(t('validation.amountInvalid')); return }
    if (!currency.trim() || currency.trim().length !== 3) { setError(t('validation.currency')); return }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { setError(t('validation.coverageRequired')); return }
    if (end < start) { setError(t('validation.coverageOrder')); return }
    if (graceUntilDate !== toDateInput(addDays(end, 7))) { setError(t('validation.graceDate')); return }

    setSaving(true)
    try {
      const planId = sub?.plan_id ?? plans[0]?.id
      if (!planId) throw new Error('No active subscription plan is available for this client.')

      let subscriptionId = sub?.id ?? null
      if (!subscriptionId) {
        const { data: insertedSub, error: subInsertError } = await (supabase as any)
          .from('tenant_subscriptions')
          .insert({
            tenant_id: tenant.id,
            plan_id: planId,
            status: 'active',
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            trial_ends_at: null,
            cancelled_at: null,
            plan_interval: interval,
            price_per_branch: Number(pricePerBranch),
            paid_branch_count: paidBranchCount,
            current_period_start: coverageStart,
            current_period_end: coverageEnd,
            next_due_date: nextDueDate,
            grace_until_date: graceUntilDate,
            manual_payment_status: 'manual_verified',
            subscription_lifecycle_status: 'active',
          })
          .select('id')
          .single()
        if (subInsertError) throw subInsertError
        subscriptionId = insertedSub.id
      }

      const { data: userData } = await supabase.auth.getUser()
      const { data: payment, error: paymentError } = await (supabase as any)
        .from('manual_subscription_payments')
        .insert({
          tenant_id: tenant.id,
          subscription_id: subscriptionId,
          amount: Number(amount),
          currency: currency.trim().toUpperCase(),
          plan_interval: interval,
          paid_branch_count: paidBranchCount,
          price_per_branch: Number(pricePerBranch),
          payment_method: paymentMethod.trim() || null,
          payment_reference: paymentReference.trim() || null,
          payment_received_at: new Date(`${paymentReceivedDate}T00:00:00`).toISOString(),
          coverage_start_date: coverageStart,
          coverage_end_date: coverageEnd,
          next_due_date: nextDueDate,
          grace_until_date: graceUntilDate,
          status: 'manual_verified',
          money_back_until_date: toDateInput(addDays(start, 7)),
          notes: notes.trim() || null,
          verified_by: userData.user?.id ?? null,
        })
        .select('id')
        .single()
      if (paymentError) throw paymentError

      const { error: subUpdateError } = await (supabase as any)
        .from('tenant_subscriptions')
        .update({
          status: 'active',
          ends_at: end.toISOString(),
          plan_interval: interval,
          price_per_branch: Number(pricePerBranch),
          paid_branch_count: paidBranchCount,
          current_period_start: coverageStart,
          current_period_end: coverageEnd,
          next_due_date: nextDueDate,
          grace_until_date: graceUntilDate,
          manual_payment_status: 'manual_verified',
          subscription_lifecycle_status: 'active',
          last_payment_id: payment.id,
          last_payment_at: new Date(`${paymentReceivedDate}T00:00:00`).toISOString(),
          suspended_at: null,
          suspended_reason: null,
        })
        .eq('id', subscriptionId)
      if (subUpdateError) throw subUpdateError

      if (alignMaxBranches || paidBranchCount > tenant.max_branches) {
        const { error: tenantError } = await (supabase as any)
          .from('tenants')
          .update({ max_branches: paidBranchCount })
          .eq('id', tenant.id)
        if (tenantError) throw tenantError
      }

      toast.success(t('payment.recorded'))
      setPaymentReference('')
      setNotes('')
      onSaved()
    } catch (err: any) {
      console.error('Failed to record payment:', err)
      setError(t('payment.recordFailed'))
      toast.error(t('payment.recordFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <ReceiptText size={16} className="text-primary-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('payment.recordPayment')}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.interval')}</label>
          <select value={interval} onChange={e => applyInterval(e.target.value as ManualSubscriptionPlanInterval)} className="input h-9 w-full text-sm">
            <option value="monthly">{t('billing.monthly')}</option><option value="yearly">{t('billing.yearly')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.paidBranches')}</label>
          <input type="number" min={1} value={paidBranchCount} onChange={e => applyPaidBranchCount(Number(e.target.value))} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.pricePerBranch')}</label>
          <MoneyInput value={pricePerBranch} onValueChange={(value, numeric) => { setPricePerBranch(value); if (numeric != null) setAmount((numeric * paidBranchCount).toFixed(2)) }} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('billing.amount')}</label>
          <MoneyInput value={amount} onValueChange={setAmount} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.currency')}</label>
          <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} className="input h-9 w-full text-sm uppercase" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.receivedDate')}</label>
          <input type="date" value={paymentReceivedDate} onChange={e => setPaymentReceivedDate(e.target.value)} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.coverageStart')}</label>
          <input type="date" value={coverageStart} onChange={e => applyCoverageStart(e.target.value)} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.coverageEnd')}</label>
          <input type="date" value={coverageEnd} onChange={e => setCoverageEnd(e.target.value)} className="input h-9 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('snapshot.graceUntil')}</label>
          <input type="date" value={graceUntilDate} readOnly className="input h-9 w-full text-sm bg-gray-50 text-gray-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.method')}</label>
          <input value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="input h-9 w-full text-sm" placeholder={t('payment.methodPlaceholder')} dir="auto" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('payment.reference')}</label>
          <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className="input h-9 w-full text-sm" placeholder={t('payment.referencePlaceholder')} dir="ltr" />
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('clients.notes')}</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="input w-full resize-none text-sm" placeholder={t('payment.notesPlaceholder')} dir="auto" />
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs font-medium text-gray-600">
        <input type="checkbox" checked={alignMaxBranches} onChange={e => setAlignMaxBranches(e.target.checked)} className="rounded border-gray-300" />
        {t('payment.alignBranches')}
      </label>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button onClick={submitPayment} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? t('payment.recording') : t('payment.recordPayment')}
        </button>
      </div>
    </div>
  )
}

function PaymentHistoryCard({ payments }: { payments: ManualPaymentRow[] }) {
  const { t } = useTranslation('admin')
  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <CalendarDays size={16} className="text-primary-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('payment.history')}</h2>
      </div>
      {payments.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">{t('payment.none')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {[t('payment.receivedDate'), t('billing.amount'), t('payment.interval'), t('clients.branches'), t('payment.coverage'), t('snapshot.nextDue'), t('payment.methodReference'), t('payment.verifiedBy'), t('clients.notes')].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(p.payment_received_at)}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{p.currency} {Number(p.amount).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{t(`billing.${p.plan_interval}`, { defaultValue: t('unknown') })}</td>
                  <td className="px-5 py-3 text-sm text-gray-700 tabular-nums">{p.paid_branch_count}</td>
                  <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{t('clients.dateRange', { start: formatDate(p.coverage_start_date), end: formatDate(p.coverage_end_date) })}</td>
                  <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(p.next_due_date)}<br /><span className="text-gray-400">{t('snapshot.graceUntil')} {formatDate(p.grace_until_date)}</span></td>
                  <td className="px-5 py-3 text-xs text-gray-500 max-w-[180px]">
                    <p>{p.payment_method ?? '—'}</p>
                    {p.payment_reference && <p className="font-mono text-gray-700 break-all">{p.payment_reference}</p>}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400 font-mono">{p.verified_by ? p.verified_by.slice(0, 8) : '—'}</td>
                  <td className="px-5 py-3 text-xs text-gray-500 max-w-[220px]">{p.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OnboardingCard({ tenantId, row, onSaved }: {
  tenantId: string
  row: OnboardingRow | null
  onSaved: () => void
}) {
  const { t } = useTranslation('admin')
  const [onboardingStatus, setOnboardingStatus] = useState<TenantOnboardingStatusValue>(row?.onboarding_status ?? 'owner_invited')
  const [ownerSetupStatus, setOwnerSetupStatus] = useState<OwnerSetupStatus>(row?.owner_setup_status ?? 'owner_invited')
  const [branchSetupStatus, setBranchSetupStatus] = useState<BranchSetupStatus>(row?.branch_setup_status ?? 'branch_setup_pending')
  const [zatcaSetupStatus, setZatcaSetupStatus] = useState<ZatcaSetupStatus>(row?.zatca_setup_status ?? 'not_required')
  const [readyForBilling, setReadyForBilling] = useState(row?.ready_for_billing ?? false)
  const [ownerSetupLinkSentAt, setOwnerSetupLinkSentAt] = useState(toDateTimeInput(row?.owner_setup_link_sent_at))
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOnboardingStatus(row?.onboarding_status ?? 'owner_invited')
    setOwnerSetupStatus(row?.owner_setup_status ?? 'owner_invited')
    setBranchSetupStatus(row?.branch_setup_status ?? 'branch_setup_pending')
    setZatcaSetupStatus(row?.zatca_setup_status ?? 'not_required')
    setReadyForBilling(row?.ready_for_billing ?? false)
    setOwnerSetupLinkSentAt(toDateTimeInput(row?.owner_setup_link_sent_at))
    setNotes(row?.notes ?? '')
  }, [row])

  async function save() {
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const payload = {
        tenant_id: tenantId,
        onboarding_status: onboardingStatus,
        owner_setup_status: ownerSetupStatus,
        branch_setup_status: branchSetupStatus,
        zatca_setup_status: zatcaSetupStatus,
        ready_for_billing: readyForBilling,
        owner_setup_link_sent_at: fromDateTimeInput(ownerSetupLinkSentAt),
        notes: notes.trim() || null,
        updated_by: userData.user?.id ?? null,
      }
      const query = row
        ? (supabase as any).from('tenant_onboarding_status').update(payload).eq('id', row.id)
        : (supabase as any).from('tenant_onboarding_status').insert(payload)
      const { error } = await query
      if (error) throw error
      toast.success(row ? t('onboarding.updated') : t('onboarding.created'))
      onSaved()
    } catch (err: any) {
      console.error('Failed to save onboarding status:', err); toast.error(t('onboarding.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const selectClass = 'input h-9 w-full text-sm'

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-900">{t('onboarding.title')}</h2>
        </div>
        <button onClick={save} disabled={saving} className="rounded-xl bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50">
          {saving ? t('clients.saving') : row ? t('onboarding.save') : t('onboarding.create')}
        </button>
      </div>

      {!row && (
        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {t('onboarding.emptyHelp')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.status')}</label>
          <select value={onboardingStatus} onChange={e => setOnboardingStatus(e.target.value as TenantOnboardingStatusValue)} className={selectClass}>
            {ONBOARDING_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`onboarding.values.${o.value}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.ownerStatus')}</label>
          <select value={ownerSetupStatus} onChange={e => setOwnerSetupStatus(e.target.value as OwnerSetupStatus)} className={selectClass}>
            {OWNER_SETUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`onboarding.values.${o.value}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.branchStatus')}</label>
          <select value={branchSetupStatus} onChange={e => setBranchSetupStatus(e.target.value as BranchSetupStatus)} className={selectClass}>
            {BRANCH_SETUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`onboarding.values.${o.value}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.zatcaStatus')}</label>
          <select value={zatcaSetupStatus} onChange={e => setZatcaSetupStatus(e.target.value as ZatcaSetupStatus)} className={selectClass}>
            {ZATCA_SETUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`onboarding.values.${o.value}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.linkSent')}</label>
          <input type="datetime-local" value={ownerSetupLinkSentAt} onChange={e => setOwnerSetupLinkSentAt(e.target.value)} className={selectClass} />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <input type="checkbox" checked={readyForBilling} onChange={e => setReadyForBilling(e.target.checked)} className="rounded border-gray-300" />
            {t('onboarding.readyBilling')}
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <InfoRow label={t('onboarding.ownerCompleted')} value={formatDate(row?.owner_setup_completed_at)} />
        <InfoRow label={t('onboarding.firstBranch')} value={formatDate(row?.first_branch_created_at)} />
        <InfoRow label={t('onboarding.firstInvoice')} value={formatDate(row?.first_invoice_created_at)} />
      </div>

      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('onboarding.notes')}</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="input w-full resize-none text-sm" placeholder={t('onboarding.notesPlaceholder')} dir="auto" />
      </div>
    </div>
  )
}

function OwnerSetupLinkCard({ tenantId, owner, row, onSaved }: {
  tenantId: string
  owner: UserItem | null
  row: OnboardingRow | null
  onSaved: () => void
}) {
  const { t } = useTranslation('admin')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState<ResendOwnerSetupResponse | null>(null)

  const ownerEmail = result?.ownerEmail ?? owner?.email ?? null
  const lastSentAt = result?.ownerSetupLinkSentAt ?? row?.owner_setup_link_sent_at ?? null

  async function resendLink() {
    setCopied(false)
    setResult(null)
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke('resend-owner-setup-link', {
        body: { tenant_id: tenantId },
      })
      const payload = (data ?? {}) as ResendOwnerSetupResponse
      const errMsg = error?.message ?? payload.error ?? null
      if (errMsg) throw new Error(errMsg)
      if (!payload.setupLink) throw new Error('Setup link was not returned')
      setResult(payload)
      toast.success(t('setup.generated'))
      onSaved()
    } catch (err: any) {
      console.error('Failed to generate owner setup link:', err); toast.error(t('setup.generateFailed'))
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    if (!result?.setupLink) return
    setCopied(false)
    try {
      await navigator.clipboard.writeText(result.setupLink)
      setCopied(true)
      toast.success(t('setup.copied'))
    } catch {
      toast.error(t('validation.copyFailed'))
    }
  }

  return (
    <div className="card p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Link2 size={16} className="text-primary-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t('create.ownerSetupLink')}</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              {t('setup.help')}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {t('setup.security')}
            </p>
          </div>
        </div>
        <button
          onClick={resendLink}
          disabled={sending || !owner}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {sending ? t('setup.generating') : t('setup.regenerate')}
        </button>
      </div>

      {!owner && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {t('setup.noOwner')}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoRow label={t('create.ownerEmail')} value={ownerEmail ?? '—'} />
        <InfoRow label={t('setup.ownerUser')} value={owner?.full_name ?? result?.ownerName ?? '—'} />
        <InfoRow label={t('setup.status')} value={t(`onboarding.values.${row?.owner_setup_status ?? 'owner_invited'}`)} />
        <InfoRow label={t('setup.lastSent')} value={formatDate(lastSentAt)} />
        <InfoRow label={t('onboarding.ownerCompleted')} value={formatDate(row?.owner_setup_completed_at)} />
        <InfoRow label={t('setup.completion')} value={row?.owner_setup_completed_at ? t('setup.automatic') : t('setup.waiting')} />
      </div>

      {result?.setupLink && (
        <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className="text-xs font-semibold text-primary-800">{t('setup.freshLink')}</label>
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-100 hover:bg-primary-50"
            >
              <Copy size={12} /> {copied ? t('create.copied') : t('create.copySetupLink')}
            </button>
          </div>
          <textarea
            readOnly
            value={result.setupLink}
            rows={3}
            className="input w-full resize-none bg-white text-xs font-mono"
            onFocus={e => e.currentTarget.select()}
          />
          <p className="text-[11px] text-primary-700 mt-2">
            {result.expiresNote ?? t('setup.expiryHelp')}
          </p>
        </div>
      )}
    </div>
  )
}

function SupportNotesCard({ tenantId, notes, onSaved }: {
  tenantId: string
  notes: SupportNoteRow[]
  onSaved: () => void
}) {
  const { t } = useTranslation('admin')
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState<TenantSupportNoteType>('general')
  const [saving, setSaving] = useState(false)

  async function addNote() {
    if (!note.trim()) {
      toast.error(t('support.noteRequired'))
      return
    }
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await (supabase as any).from('tenant_support_notes').insert({
        tenant_id: tenantId,
        note: note.trim(),
        note_type: noteType,
        created_by: userData.user?.id ?? null,
      })
      if (error) throw error
      setNote('')
      toast.success(t('support.added'))
      onSaved()
    } catch (err: any) {
      console.error('Failed to add support note:', err); toast.error(t('support.addFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <NotebookPen size={16} className="text-primary-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('support.title')}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-3">
        <select value={noteType} onChange={e => setNoteType(e.target.value as TenantSupportNoteType)} className="input h-9 text-sm">
          {SUPPORT_NOTE_TYPES.map(o => <option key={o.value} value={o.value}>{t(`support.types.${o.value}`)}</option>)}
        </select>
        <input value={note} onChange={e => setNote(e.target.value)} className="input h-9 text-sm" placeholder={t('support.placeholder')} dir="auto" />
        <button onClick={addNote} disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          <Plus size={14} /> {t('support.add')}
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {notes.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">{t('support.none')}</p>
        ) : notes.map(n => (
          <div key={n.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Badge variant={n.note_type === 'payment' ? 'warning' : n.note_type === 'zatca' ? 'info' : 'neutral'}>
                {humanize(n.note_type)}
              </Badge>
              <span className="text-[11px] text-gray-400">{formatDate(n.created_at)}</span>
            </div>
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{n.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('admin')

  const [tenant,     setTenant]     = useState<TenantDetail | null>(null)
  const [sub,        setSub]        = useState<SubscriptionDetail | null>(null)
  const [branches,   setBranches]   = useState<BranchItem[]>([])
  const [users,      setUsers]      = useState<UserItem[]>([])
  const [stats,      setStats]      = useState<InvoiceStats | null>(null)
  const [access,     setAccess]     = useState<SubscriptionAccess | null>(null)
  const [branchUsage,setBranchUsage]= useState<BranchUsage | null>(null)
  const [payments,   setPayments]   = useState<ManualPaymentRow[]>([])
  const [onboarding, setOnboarding] = useState<OnboardingRow | null>(null)
  const [supportNotes, setSupportNotes] = useState<SupportNoteRow[]>([])
  const [phase4bWarning, setPhase4bWarning] = useState('')
  const [loading,    setLoading]    = useState(true)
  const [acting,     setActing]     = useState(false)
  const [lifetimeOpen, setLifetimeOpen] = useState(false)
  const [plans,      setPlans]      = useState<PlanRow[]>([])

  // Modal state
  const [showSuspend,     setShowSuspend]     = useState(false)
  const [showRestore,     setShowRestore]     = useState(false)
  const [showDelete,      setShowDelete]      = useState(false)
  const [showManageSub,   setShowManageSub]   = useState(false)
  const [modalReason,     setModalReason]     = useState('')
  const [deleteConfirm,   setDeleteConfirm]   = useState('')
  const [deleteError,     setDeleteError]     = useState<string | null>(null)

  const [businessType, setBusinessType] = useState<BusinessType>('trading')
  const [savingBusinessType, setSavingBusinessType] = useState(false)
  const [businessTypeSaved, setBusinessTypeSaved] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)

    // Load available plans once
    if (plans.length === 0) {
      const { data: planRows } = await (supabase as any)
        .from('subscription_plans')
        .select('id, name, price_monthly, max_branches')
        .eq('is_active', true)
        .order('price_monthly')
      setPlans((planRows as PlanRow[]) ?? [])
    }

    const [
      { data: t },
      { data: subscriptions },
      { data: branchRows },
      { data: userRows },
      { data: invRows },
      accessResult,
      usageResult,
      paymentsResult,
      onboardingResult,
      supportNotesResult,
    ] = await Promise.all([
      (supabase as any).from('tenants').select('*').eq('id', id).single(),
      (supabase as any).from('tenant_subscriptions')
        .select('id, plan_id, status, starts_at, ends_at, trial_ends_at, moyasar_subscription_id, plan_interval, price_per_branch, paid_branch_count, current_period_start, current_period_end, next_due_date, grace_until_date, manual_payment_status, subscription_lifecycle_status, last_payment_at, subscription_plans(name, price_monthly, max_branches, max_users)')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1),
      (supabase as any).from('branches')
        .select('id, name, name_ar, city, is_main_branch, is_active, invoice_counter')
        .eq('tenant_id', id)
        .order('is_main_branch', { ascending: false }),
      (supabase as any).from('user_profiles')
        .select('id, full_name, role, email, is_active, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: true }),
      (supabase as any).from('invoices')
        .select('status, total_amount')
        .eq('tenant_id', id),
      (supabase as any).rpc('get_tenant_subscription_access', { p_tenant_id: id }),
      (supabase as any).rpc('get_tenant_branch_usage', { p_tenant_id: id }),
      (supabase as any).from('manual_subscription_payments')
        .select('*')
        .eq('tenant_id', id)
        .order('payment_received_at', { ascending: false }),
      (supabase as any).from('tenant_onboarding_status')
        .select('*')
        .eq('tenant_id', id)
        .maybeSingle(),
      (supabase as any).from('tenant_support_notes')
        .select('*')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false }),
    ])

    setTenant(t)
    setBusinessType(resolveBusinessType(t?.business_type))

    const rawSub = subscriptions?.[0]
    if (rawSub) {
      setSub({
        id:            rawSub.id,
        plan_id:       rawSub.plan_id,
        status:        rawSub.status,
        starts_at:     rawSub.starts_at,
        ends_at:       rawSub.ends_at,
        trial_ends_at: rawSub.trial_ends_at,
        payment_info:  rawSub.moyasar_subscription_id ?? null,
        plan_interval: rawSub.plan_interval ?? 'manual',
        price_per_branch: rawSub.price_per_branch ?? null,
        paid_branch_count: rawSub.paid_branch_count ?? 1,
        current_period_start: rawSub.current_period_start ?? null,
        current_period_end: rawSub.current_period_end ?? null,
        next_due_date: rawSub.next_due_date ?? null,
        grace_until_date: rawSub.grace_until_date ?? null,
        manual_payment_status: rawSub.manual_payment_status ?? 'unpaid',
        subscription_lifecycle_status: rawSub.subscription_lifecycle_status ?? 'active',
        last_payment_at: rawSub.last_payment_at ?? null,
        plan:          rawSub.subscription_plans ?? null,
      })
    } else {
      setSub(null)
    }

    const nextWarnings: string[] = []
    if (accessResult.error) nextWarnings.push('subscription access helper')
    if (usageResult.error) nextWarnings.push('branch usage helper')
    if (paymentsResult.error) nextWarnings.push('payment history')
    if (onboardingResult.error) nextWarnings.push('onboarding status')
    if (supportNotesResult.error) nextWarnings.push('support notes')
    if (nextWarnings.length) console.error('Some client administration data could not load:', nextWarnings)
    setPhase4bWarning(nextWarnings.length ? t('clients.partialLoadWarning') : '')
    setAccess(Array.isArray(accessResult.data) ? accessResult.data[0] ?? null : accessResult.data ?? null)
    setBranchUsage(Array.isArray(usageResult.data) ? usageResult.data[0] ?? null : usageResult.data ?? null)
    setPayments((paymentsResult.data as ManualPaymentRow[] | null) ?? [])
    setOnboarding((onboardingResult.data as OnboardingRow | null) ?? null)
    setSupportNotes((supportNotesResult.data as SupportNoteRow[] | null) ?? [])

    setBranches(branchRows ?? [])
    setUsers(userRows ?? [])

    const invList = invRows ?? []
    setStats({
      total:   invList.length,
      posted:  invList.filter((i: any) => i.status === 'posted').length,
      revenue: invList.filter((i: any) => i.status === 'posted').reduce((s: number, i: any) => s + i.total_amount, 0),
    })

    setLoading(false)
  }

  useEffect(() => { load() }, [id, t])

  async function saveBusinessType() {
    if (!id) return
    setSavingBusinessType(true)
    await (supabase as any)
      .from('tenants')
      .update({ business_type: businessType })
      .eq('id', id)
    setSavingBusinessType(false)
    setBusinessTypeSaved(true)
    setTimeout(() => setBusinessTypeSaved(false), 2000)
    load()
  }

  async function confirmSuspend() {
    if (!tenant) return
    setActing(true)
    await (supabase as any).from('tenants')
      .update({ suspended_at: new Date().toISOString(), suspended_reason: modalReason || null, is_active: false })
      .eq('id', tenant.id)
    setActing(false)
    setShowSuspend(false)
    setModalReason('')
    load()
  }

  async function confirmRestore() {
    if (!tenant) return
    setActing(true)
    await (supabase as any).from('tenants')
      .update({ suspended_at: null, suspended_reason: null, is_active: true })
      .eq('id', tenant.id)
    setActing(false)
    setShowRestore(false)
    load()
  }

  async function confirmLifetimeFree() {
    if (!id) return
    setActing(true)
    const planId = plans[plans.length - 1]?.id ?? plans[0]?.id
    if (!planId) { setActing(false); return }

    const payload = {
      tenant_id:   id,
      plan_id:     planId,
      status:      'active',
      starts_at:   new Date().toISOString(),
      ends_at:     null,
      trial_ends_at: null,
      cancelled_at:  null,
      plan_interval: 'lifetime',
      price_per_branch: 0,
      paid_branch_count: Math.max(1, tenant?.max_branches ?? 1),
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: null,
      next_due_date: null,
      grace_until_date: null,
      manual_payment_status: 'manual_verified',
      subscription_lifecycle_status: 'lifetime_free',
    }
    if (sub) {
      await (supabase as any).from('tenant_subscriptions').update(payload).eq('id', sub.id)
    } else {
      await (supabase as any).from('tenant_subscriptions').insert({ ...payload, tenant_id: id })
    }
    await (supabase as any).from('tenants').update({ is_active: true }).eq('id', id)
    setActing(false)
    setLifetimeOpen(false)
    load()
  }

  async function confirmDelete() {
    if (!tenant || deleteConfirm !== tenant.name) return
    setActing(true)
    setDeleteError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-tenant`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({
            tenantId: tenant.id,
            confirmation: deleteConfirm.trim(),
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        console.error('Failed to delete client:', json.error)
        setDeleteError(t('clients.deleteFailed'))
        setActing(false)
        return
      }
      navigate('/super-admin/clients')
    } catch (err: any) {
      console.error('Failed to delete client:', err)
      setDeleteError(t('clients.deleteFailed'))
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-400 text-sm">{t('clients.notFound')}</p>
        <button onClick={() => navigate('/super-admin/clients')} className="mt-4 text-primary-600 text-sm font-medium">
          ← {t('clients.back')}
        </button>
      </div>
    )
  }

  const isSuspended = !!tenant.suspended_at
  const ownerProfile = users.find(user => user.role === 'owner' && user.is_active !== false) ?? null

  return (
    <div className="space-y-6">

      {/* Modals */}
      {showSuspend && (
        <SuspendModal
          name={tenant.name}
          reason={modalReason}
          onReasonChange={setModalReason}
          onConfirm={confirmSuspend}
          onCancel={() => { setShowSuspend(false); setModalReason('') }}
          acting={acting}
        />
      )}
      {showRestore && (
        <RestoreModal
          name={tenant.name}
          onConfirm={confirmRestore}
          onCancel={() => setShowRestore(false)}
          acting={acting}
        />
      )}
      {showDelete && (
        <DeleteModal
          name={tenant.name}
          confirmName={deleteConfirm}
          onConfirmNameChange={setDeleteConfirm}
          onConfirm={confirmDelete}
          onCancel={() => { setShowDelete(false); setDeleteConfirm(''); setDeleteError(null) }}
          acting={acting}
          error={deleteError}
        />
      )}
      {showManageSub && (
        <ManageSubscriptionModal
          tenantId={tenant.id}
          existingSub={sub}
          plans={plans}
          onSaved={() => { setShowManageSub(false); load() }}
          onCancel={() => setShowManageSub(false)}
        />
      )}

      {/* Back + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          onClick={() => navigate('/super-admin/clients')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-medium"
        >
          <ArrowLeft size={15} /> {t('clients.allClients')}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => isSuspended ? setShowRestore(true) : setShowSuspend(true)}
            disabled={acting}
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors ${
              isSuspended
                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'bg-red-50 text-red-500 hover:bg-red-100'
            }`}
          >
            {isSuspended ? <UserCheck size={14} /> : <UserX size={14} />}
            {isSuspended ? t('clients.restoreAccess') : t('clients.suspendTitle')}
          </button>
          <button
            onClick={() => { setDeleteConfirm(''); setDeleteError(null); setShowDelete(true) }}
            disabled={acting}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            <Trash2 size={14} /> {t('clients.delete')}
          </button>
        </div>
      </div>

      {/* Suspension banner */}
      {isSuspended && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">{t('clients.accountSuspended')}</p>
            <p className="text-xs text-red-600 mt-0.5">
              {t('clients.since', { date: tenant.suspended_at!.slice(0, 10) })}
              {tenant.suspended_reason ? ` · ${tenant.suspended_reason}` : ''}
            </p>
            <p className="text-xs text-red-600 mt-1">
              {t('clients.suspendedEffect')}
            </p>
          </div>
        </div>
      )}

      {phase4bWarning && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-4">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{phase4bWarning}</p>
        </div>
      )}

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Building2 size={22} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{tenant.name}</h1>
              {tenant.name_ar && <span className="text-sm text-gray-400" dir="rtl">{tenant.name_ar}</span>}
              <Badge variant={isSuspended ? 'danger' : tenant.is_active ? 'success' : 'neutral'} dot>
                {t(`status.${isSuspended ? 'suspended' : tenant.is_active ? 'active' : 'inactive'}`)}
              </Badge>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('clients.clientSince', { date: tenant.created_at.slice(0, 10) })}</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {[
            { label: t('clients.activeTotalBranches'), value: branchUsage ? `${branchUsage.active_branch_count}/${branchUsage.total_branch_count}` : branches.length, icon: Building2 },
            { label: t('clients.users'), value: users.length, icon: Users },
            { label: t('clients.invoices'), value: stats?.total ?? 0, icon: FileText },
            { label: t('clients.revenue'), value: <Rial amount={stats?.revenue ?? 0} />, icon: CreditCard },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="text-center">
              <Icon size={18} className="text-gray-300 mx-auto mb-1" />
              <p className="text-lg font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Two columns: company info + subscription */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Company info */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('clients.companyInfo')}</h2>
          <div className="py-2.5 border-b border-gray-50">
            <span className="block text-xs text-gray-400 mb-1.5">{t('clients.businessType')}</span>
            <div className="flex items-center gap-2">
              <select
                value={businessType}
                onChange={e => setBusinessType(e.target.value as BusinessType)}
                className="input h-9 text-sm flex-1"
              >
                {BUSINESS_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                onClick={saveBusinessType}
                disabled={savingBusinessType || businessType === resolveBusinessType(tenant.business_type)}
                className="px-3 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {savingBusinessType ? t('clients.saving') : t('actions.save')}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {businessTypeSaved ? t('clients.saved') : businessTypeLabel(businessType)}
            </p>
          </div>
          <InfoRow label={t('clients.vatNumber')} value={tenant.vat_number} />
          <InfoRow label={t('clients.crNumber')} value={tenant.cr_number} />
          <InfoRow label={t('clients.email')} value={tenant.email
            ? <a href={`mailto:${tenant.email}`} className="text-primary-600 hover:underline flex items-center gap-1"><Mail size={12} />{tenant.email}</a>
            : null} />
          <InfoRow label={t('clients.phone')} value={tenant.phone
            ? <span className="flex items-center gap-1"><Phone size={12} />{tenant.phone}</span>
            : null} />
          <InfoRow label={t('clients.city')} value={tenant.city
            ? <span className="flex items-center gap-1"><MapPin size={12} />{tenant.city}</span>
            : null} />
          <InfoRow label={t('clients.country')} value={tenant.country} />
          {tenant.address && <InfoRow label={t('clients.legacyAddress')} value={<span dir="auto">{tenant.address}</span>} />}
          <InfoRow label={t('clients.lastActive')} value={tenant.last_active_at
            ? <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" />{tenant.last_active_at.slice(0, 10)}</span>
            : t('clients.noActivity')} />
        </div>

        {/* Subscription */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">{t('clients.subscription')}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLifetimeOpen(true)}
                disabled={acting}
                title={t('clients.markLifetime')}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <Star size={12} /> {t('status.lifetime_free')}
              </button>
              <button
                onClick={() => setShowManageSub(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
              >
                <Settings size={12} /> {t('clients.manage')}
              </button>
            </div>
          </div>
          {sub ? (
            <>
              <InfoRow label={t('clients.plan')} value={
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
                  {sub.plan?.name ?? '—'}
                </span>
              } />
              <InfoRow label={t('clients.status')} value={
                <Badge variant={
                  sub.status === 'active' ? 'success'
                  : sub.status === 'trial' ? 'warning'
                  : 'danger'
                } dot>{t(`status.${sub.status}`, { defaultValue: t('unknown') })}</Badge>
              } />
              <InfoRow label={t('clients.lifecycle')} value={
                <Badge variant={accessBadgeVariant(access?.lifecycle_status ?? sub.subscription_lifecycle_status)} dot>
                  {t(`status.${access?.lifecycle_status ?? sub.subscription_lifecycle_status}`, { defaultValue: t('unknown') })}
                </Badge>
              } />
              <InfoRow label={t('clients.paymentStatus')} value={
                <Badge variant={accessBadgeVariant(access?.manual_payment_status ?? sub.manual_payment_status)} dot>
                  {t(`status.${access?.manual_payment_status ?? sub.manual_payment_status}`, { defaultValue: t('unknown') })}
                </Badge>
              } />
              <InfoRow label={t('subscriptions.started')} value={sub.starts_at.slice(0, 10)} />
              <InfoRow label={t('clients.currentPeriod')} value={
                sub.current_period_start || sub.current_period_end
                  ? t('clients.dateRange', { start: formatDate(sub.current_period_start), end: formatDate(sub.current_period_end) })
                  : '—'
              } />
              <InfoRow label={t('subscriptions.expires')} value={
                sub.ends_at
                  ? sub.ends_at.slice(0, 10)
                  : <span className="text-emerald-600 font-medium">{t('status.lifetime_free')}</span>
              } />
              <InfoRow label={t('snapshot.nextDue')} value={formatDate(access?.next_due_date ?? sub.next_due_date)} />
              <InfoRow label={t('snapshot.graceUntil')} value={formatDate(access?.grace_until_date ?? sub.grace_until_date)} />
              <InfoRow label={t('payment.paidBranches')} value={access?.paid_branch_count ?? sub.paid_branch_count} />
              <InfoRow label={t('snapshot.maxBranches')} value={branchUsage?.max_branches ?? tenant.max_branches ?? sub.plan?.max_branches} />
              {sub.payment_info && (
                <InfoRow label={t('clients.legacyPayment')} value={
                  <span className="text-xs font-mono text-gray-600 break-all">{sub.payment_info}</span>
                } />
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-400 mb-3">{t('clients.noSubscription')}</p>
              <button
                onClick={() => setShowManageSub(true)}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                {t('clients.addSubscription')}
              </button>
            </div>
          )}
        </div>
      </div>

      <SubscriptionOpsCard sub={sub} access={access} usage={branchUsage} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MarkPaymentCard
          tenant={tenant}
          sub={sub}
          plans={plans}
          access={access}
          onSaved={load}
        />
        <OwnerSetupLinkCard
          tenantId={tenant.id}
          owner={ownerProfile}
          row={onboarding}
          onSaved={load}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OnboardingCard
          tenantId={tenant.id}
          row={onboarding}
          onSaved={load}
        />
      </div>

      <PaymentHistoryCard payments={payments} />

      <SupportNotesCard
        tenantId={tenant.id}
        notes={supportNotes}
        onSaved={load}
      />

      {/* Branches */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('clients.branchesCount', { count: branches.length })}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {[t('clients.branchName'), t('clients.city'), t('clients.invoices'), t('clients.main'), t('clients.status')].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {branches.map(b => (
                <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-gray-900">{b.name}</p>
                    {b.name_ar && <p className="text-xs text-gray-400" dir="rtl">{b.name_ar}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">{b.city ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 tabular-nums">{b.invoice_counter}</td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">
                    {b.is_main_branch ? <Badge variant="neutral">{t('clients.main')}</Badge> : ''}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={b.is_active ? 'success' : 'default'} dot>
                      {t(`status.${b.is_active ? 'active' : 'inactive'}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-400">{t('clients.noBranches')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('clients.usersCount', { count: users.length })}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {[t('clients.name'), t('clients.role'), t('clients.joined'), t('clients.status')].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                    {u.full_name ?? <span className="text-gray-400 italic">{t('clients.unnamed')}</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-medium capitalize text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                      {u.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">{u.created_at.slice(0, 10)}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={u.is_active ? 'success' : 'default'} dot>
                      {t(`status.${u.is_active ? 'active' : 'inactive'}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-gray-400">{t('clients.noUsers')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDialog open={lifetimeOpen} kind="lifetimeAccess" busy={acting} onClose={() => setLifetimeOpen(false)} onConfirm={() => void confirmLifetimeFree()} />

    </div>
  )
}
