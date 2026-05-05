import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Building2, Users, FileText, CreditCard,
  UserX, UserCheck, Trash2, MapPin, Phone, Mail,
  AlertTriangle, CheckCircle2, Settings, Star,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantDetail {
  id: string; name: string; name_ar: string | null
  vat_number: string; cr_number: string | null
  email: string | null; phone: string | null; website: string | null
  address: string | null; city: string | null; country: string
  is_active: boolean; suspended_at: string | null; suspended_reason: string | null
  last_active_at: string | null; created_at: string; updated_at: string
}

interface SubscriptionDetail {
  id: string; status: string; starts_at: string; ends_at: string | null
  trial_ends_at: string | null; payment_info: string | null
  plan: { name: string; price_monthly: number; max_branches: number; max_users: number } | null
}

interface BranchItem {
  id: string; name: string; name_ar: string | null; city: string | null
  is_main_branch: boolean; is_active: boolean; invoice_counter: number
}

interface UserItem {
  id: string; full_name: string | null; role: string
  is_active: boolean; created_at: string
}

interface InvoiceStats {
  total: number; posted: number; revenue: number
}

interface PlanRow {
  id: string; name: string; price_monthly: number; max_branches: number
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
  { label: '1 Month',   months: 1  },
  { label: '2 Months',  months: 2  },
  { label: '3 Months',  months: 3  },
  { label: '6 Months',  months: 6  },
  { label: '1 Year',    months: 12 },
  { label: '3 Years',   months: 36 },
  { label: '5 Years',   months: 60 },
  { label: 'Lifetime Free', months: 0 },
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

function ManageSubscriptionModal({ tenantId, existingSub, plans, onSaved, onCancel }: {
  tenantId:    string
  existingSub: SubscriptionDetail | null
  plans:       PlanRow[]
  onSaved:     () => void
  onCancel:    () => void
}) {
  const [planId,     setPlanId]     = useState(existingSub?.plan ? '' : plans[0]?.id ?? '')
  const [branches,   setBranches]   = useState(1)
  const [duration,   setDuration]   = useState(1)
  const [payMethod,  setPayMethod]  = useState('Manual')
  const [payRef,     setPayRef]     = useState('')
  const [notes,      setNotes]      = useState('')
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
    if (!planId) { setError('Select a plan'); return }
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
        moyasar_subscription_id: payRef.trim() || `${payMethod} · ${notes.trim()}` || null,
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

      // Restore tenant if suspended
      await (supabase as any).from('tenants').update({ is_active: true }).eq('id', tenantId)

      onSaved()
    } catch (err: any) {
      setError(err.message ?? 'Failed to save subscription')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-900">Manage Subscription</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Plan</label>
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
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Number of branches</label>
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
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Duration</label>
          <select
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="input w-full text-sm h-9"
          >
            {DURATIONS.map(d => (
              <option key={d.months} value={d.months}>{d.label}</option>
            ))}
          </select>
        </div>

        {!isLifetime && expiryDate && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Expiry date</span>
              <span className="font-semibold text-gray-900">{expiryDate.toLocaleDateString('en-SA')}</span>
            </div>
            {total > 0 && (
              <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-gray-200">
                <span className="text-gray-500">
                  Total: SAR {pricePerBranch} × {branches} branch{branches !== 1 ? 'es' : ''} × {selectedDur.label}
                </span>
                <span className="font-bold text-gray-900">SAR {total.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {isLifetime && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
            This will set a Lifetime Free subscription (no expiry).
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Payment method</label>
            <select
              value={payMethod}
              onChange={e => setPayMethod(e.target.value)}
              className="input w-full text-sm h-9"
            >
              {['Manual', 'Bank Transfer', 'Cash'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Payment reference</label>
            <input
              type="text"
              value={payRef}
              onChange={e => setPayRef(e.target.value)}
              className="input w-full text-sm h-9"
              placeholder="e.g. TXN123"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input w-full text-sm h-9"
            placeholder="Internal notes"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Subscription'}
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
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Suspend Client</h2>
        <p className="text-sm text-gray-500 mb-4">
          Suspending <strong>{name}</strong> will block all their users from logging in.
        </p>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">Reason (optional)</label>
        <input
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          className="input w-full text-sm h-9 mb-5"
          placeholder="e.g. Payment overdue"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            Suspend
          </button>
        </div>
      </div>
    </div>
  )
}

function RestoreModal({ name, onConfirm, onCancel, acting }: {
  name: string; onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Restore Client Access</h2>
        <p className="text-sm text-gray-500 mb-5">
          Are you sure you want to restore access for <strong>{name}</strong>?
          Their users will be able to log in again.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={acting}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            Restore Access
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
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Delete Client</h2>
        <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 mb-4">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            This action cannot be undone. All data for this client including branches,
            users, invoices, and expenses will be permanently deleted.
          </p>
        </div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          Type <strong>{name}</strong> to confirm
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
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={acting || confirmName !== name}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {acting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tenant,     setTenant]     = useState<TenantDetail | null>(null)
  const [sub,        setSub]        = useState<SubscriptionDetail | null>(null)
  const [branches,   setBranches]   = useState<BranchItem[]>([])
  const [users,      setUsers]      = useState<UserItem[]>([])
  const [stats,      setStats]      = useState<InvoiceStats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [acting,     setActing]     = useState(false)
  const [plans,      setPlans]      = useState<PlanRow[]>([])

  // Modal state
  const [showSuspend,     setShowSuspend]     = useState(false)
  const [showRestore,     setShowRestore]     = useState(false)
  const [showDelete,      setShowDelete]      = useState(false)
  const [showManageSub,   setShowManageSub]   = useState(false)
  const [modalReason,     setModalReason]     = useState('')
  const [deleteConfirm,   setDeleteConfirm]   = useState('')
  const [deleteError,     setDeleteError]     = useState<string | null>(null)

  // Notes (stored in tenants.address field)
  const [notes,        setNotes]        = useState('')
  const [savingNotes,  setSavingNotes]  = useState(false)
  const [notesSaved,   setNotesSaved]   = useState(false)

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
    ] = await Promise.all([
      (supabase as any).from('tenants').select('*').eq('id', id).single(),
      (supabase as any).from('tenant_subscriptions')
        .select('id, status, starts_at, ends_at, trial_ends_at, moyasar_subscription_id, subscription_plans(name, price_monthly, max_branches, max_users)')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1),
      (supabase as any).from('branches')
        .select('id, name, name_ar, city, is_main_branch, is_active, invoice_counter')
        .eq('tenant_id', id)
        .order('is_main_branch', { ascending: false }),
      (supabase as any).from('user_profiles')
        .select('id, full_name, role, is_active, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: true }),
      (supabase as any).from('invoices')
        .select('status, total_amount')
        .eq('tenant_id', id),
    ])

    setTenant(t)
    setNotes(t?.address ?? '')

    const rawSub = subscriptions?.[0]
    if (rawSub) {
      setSub({
        id:            rawSub.id,
        status:        rawSub.status,
        starts_at:     rawSub.starts_at,
        ends_at:       rawSub.ends_at,
        trial_ends_at: rawSub.trial_ends_at,
        payment_info:  rawSub.moyasar_subscription_id ?? null,
        plan:          rawSub.subscription_plans ?? null,
      })
    }

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

  useEffect(() => { load() }, [id])

  async function saveNotes() {
    if (!id) return
    setSavingNotes(true)
    await (supabase as any).from('tenants').update({ address: notes.trim() || null }).eq('id', id)
    setSavingNotes(false)
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2000)
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
    if (!id || !confirm('Set this account as Lifetime Free? This gives permanent access with no expiry.')) return
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
      moyasar_subscription_id: 'Lifetime Free',
    }
    if (sub) {
      await (supabase as any).from('tenant_subscriptions').update(payload).eq('id', sub.id)
    } else {
      await (supabase as any).from('tenant_subscriptions').insert({ ...payload, tenant_id: id })
    }
    await (supabase as any).from('tenants').update({ is_active: true }).eq('id', id)
    setActing(false)
    load()
  }

  async function confirmDelete() {
    if (!tenant || deleteConfirm !== tenant.name) return
    setActing(true)
    setDeleteError(null)
    const { error } = await (supabase as any).from('tenants').delete().eq('id', tenant.id)
    if (error) {
      setDeleteError('Failed to delete client: ' + error.message)
      setActing(false)
      return
    }
    navigate('/super-admin/clients')
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
        <p className="text-gray-400 text-sm">Client not found.</p>
        <button onClick={() => navigate('/super-admin/clients')} className="mt-4 text-primary-600 text-sm font-medium">
          ← Back to Clients
        </button>
      </div>
    )
  }

  const isSuspended = !!tenant.suspended_at

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
          <ArrowLeft size={15} /> All Clients
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
            {isSuspended ? 'Restore Access' : 'Suspend Client'}
          </button>
          <button
            onClick={() => { setDeleteConfirm(''); setDeleteError(null); setShowDelete(true) }}
            disabled={acting}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Suspension banner */}
      {isSuspended && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Account suspended</p>
            <p className="text-xs text-red-600 mt-0.5">
              Since {tenant.suspended_at!.slice(0, 10)}
              {tenant.suspended_reason ? ` · ${tenant.suspended_reason}` : ''}
            </p>
          </div>
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
              <Badge variant={isSuspended ? 'danger' : tenant.is_active ? 'success' : 'default'} dot>
                {isSuspended ? 'Suspended' : tenant.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-xs text-gray-400 mt-1">Client since {tenant.created_at.slice(0, 10)}</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {[
            { label: 'Branches', value: branches.length, icon: Building2 },
            { label: 'Users',    value: users.length,    icon: Users },
            { label: 'Invoices', value: stats?.total ?? 0, icon: FileText },
            { label: 'Revenue',  value: <Rial amount={stats?.revenue ?? 0} />, icon: CreditCard },
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
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Company Information</h2>
          <InfoRow label="VAT Number"  value={tenant.vat_number} />
          <InfoRow label="CR Number"   value={tenant.cr_number} />
          <InfoRow label="Email"       value={tenant.email
            ? <a href={`mailto:${tenant.email}`} className="text-primary-600 hover:underline flex items-center gap-1"><Mail size={12} />{tenant.email}</a>
            : null} />
          <InfoRow label="Phone"       value={tenant.phone
            ? <span className="flex items-center gap-1"><Phone size={12} />{tenant.phone}</span>
            : null} />
          <InfoRow label="City"        value={tenant.city
            ? <span className="flex items-center gap-1"><MapPin size={12} />{tenant.city}</span>
            : null} />
          <InfoRow label="Country"     value={tenant.country} />
          <InfoRow label="Last Active" value={tenant.last_active_at
            ? <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" />{tenant.last_active_at.slice(0, 10)}</span>
            : 'No activity yet'} />
        </div>

        {/* Subscription */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Subscription</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={confirmLifetimeFree}
                disabled={acting}
                title="Mark Lifetime Free"
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <Star size={12} /> Lifetime Free
              </button>
              <button
                onClick={() => setShowManageSub(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
              >
                <Settings size={12} /> Manage
              </button>
            </div>
          </div>
          {sub ? (
            <>
              <InfoRow label="Plan"      value={
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
                  {sub.plan?.name ?? '—'}
                </span>
              } />
              <InfoRow label="Status"    value={
                <Badge variant={
                  sub.status === 'active' ? 'success'
                  : sub.status === 'trial' ? 'warning'
                  : 'danger'
                } dot>{sub.status}</Badge>
              } />
              <InfoRow label="Started"   value={sub.starts_at.slice(0, 10)} />
              <InfoRow label="Expires"   value={
                sub.ends_at
                  ? sub.ends_at.slice(0, 10)
                  : <span className="text-emerald-600 font-medium">Lifetime Free</span>
              } />
              <InfoRow label="Max branches" value={sub.plan?.max_branches} />
              {sub.payment_info && (
                <InfoRow label="Payment info" value={
                  <span className="text-xs font-mono text-gray-600 break-all">{sub.payment_info}</span>
                } />
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-400 mb-3">No subscription found</p>
              <button
                onClick={() => setShowManageSub(true)}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                Add subscription
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Branches */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Branches ({branches.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['Branch Name', 'City', 'Invoices', 'Main', 'Status'].map(h => (
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
                    {b.is_main_branch ? <Badge variant="default">Main</Badge> : ''}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={b.is_active ? 'success' : 'default'} dot>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-400">No branches</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Users ({users.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['Name', 'Role', 'Joined', 'Status'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                    {u.full_name ?? <span className="text-gray-400 italic">Unnamed</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-medium capitalize text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                      {u.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">{u.created_at.slice(0, 10)}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={u.is_active ? 'success' : 'default'} dot>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-gray-400">No users</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account notes */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Account Notes</h2>
          <button
            onClick={saveNotes}
            disabled={savingNotes}
            className="text-xs font-medium px-3 py-1.5 rounded-xl bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
          >
            {savingNotes ? 'Saving…' : notesSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          className="input w-full text-sm resize-none"
          placeholder="Internal notes about this client — payment history, special agreements, follow-up reminders…"
        />
      </div>

    </div>
  )
}
