import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Building2, UserX, UserCheck, ChevronDown, ChevronUp,
  ChevronRight, Plus, MapPin, Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:           string
  name:         string
  name_ar:      string | null
  vat_number:   string
  city:         string | null
  is_active:    boolean
  suspended_at: string | null
  created_at:   string
  plan:         string | null
  subStatus:    string | null
  endsAt:       string | null
  branchCount:  number
  userCount:    number
}

interface BranchSummary {
  id:          string
  name:        string
  city:        string | null
  is_active:   boolean
  invoice_counter: number
}

type ComputedStatus = 'active' | 'lifetime_free' | 'grace_period' | 'expired' | 'suspended' | 'inactive'
type StatusFilter   = 'all' | 'active' | 'grace_period' | 'lifetime_free' | 'suspended' | 'expired'

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRACE_MS = 7 * 86_400_000

function getStatus(c: ClientRow): ComputedStatus {
  if (c.suspended_at) return 'suspended'
  if (!c.is_active)   return 'inactive'
  if (c.subStatus === 'active' && c.endsAt === null) return 'lifetime_free'
  if (c.subStatus === 'active' && c.endsAt !== null) {
    const exp = new Date(c.endsAt).getTime()
    const now = Date.now()
    if (exp >= now) return 'active'
    if (now < exp + GRACE_MS) return 'grace_period'
    return 'expired'
  }
  return 'inactive'
}

const STATUS_META: Record<ComputedStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'default' }> = {
  active:        { label: 'Active',        variant: 'success'  },
  lifetime_free: { label: 'Lifetime Free', variant: 'success'  },
  grace_period:  { label: 'Grace Period',  variant: 'warning'  },
  expired:       { label: 'Expired',       variant: 'danger'   },
  suspended:     { label: 'Suspended',     variant: 'danger'   },
  inactive:      { label: 'Inactive',      variant: 'default'  },
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
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Suspend Client</h2>
        <p className="text-sm text-gray-500 mb-4">
          Suspending <strong>{client.name}</strong> will block all their users from logging in.
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
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">Cancel</button>
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

function RestoreModal({ client, onConfirm, onCancel, acting }: {
  client: ClientRow; onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Restore Client Access</h2>
        <p className="text-sm text-gray-500 mb-5">
          Restore access for <strong>{client.name}</strong>? Their users will be able to log in again.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">Cancel</button>
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

// ── Create Account modal ──────────────────────────────────────────────────────

interface PlanOption { id: string; name: string; price_monthly: number }

const DURATIONS = [
  { label: '1 Month',        months: 1  },
  { label: '2 Months',       months: 2  },
  { label: '3 Months',       months: 3  },
  { label: '6 Months',       months: 6  },
  { label: '1 Year',         months: 12 },
  { label: '3 Years',        months: 36 },
  { label: '5 Years',        months: 60 },
  { label: 'Lifetime Free',  months: 0  },
]

function CreateAccountModal({ onCreated, onCancel }: {
  onCreated: () => void
  onCancel:  () => void
}) {
  const [plans,   setPlans]   = useState<PlanOption[]>([])
  const [loading, setLoading] = useState(true)

  const [companyName,   setCompanyName]   = useState('')
  const [companyNameAr, setCompanyNameAr] = useState('')
  const [email,         setEmail]         = useState('')
  const [phone,         setPhone]         = useState('')
  const [city,          setCity]          = useState('')
  const [planId,        setPlanId]        = useState('')
  const [branchCount,   setBranchCount]   = useState(1)
  const [duration,      setDuration]      = useState(1)
  const [payMethod,     setPayMethod]     = useState('Manual')
  const [payRef,        setPayRef]        = useState('')
  const [notes,         setNotes]         = useState('')

  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [warning, setWarning] = useState('')

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

  const isLifetime    = duration === 0
  const selectedPlan  = plans.find(p => p.id === planId)
  const pricePerBranch = selectedPlan?.price_monthly ?? 0
  const totalAmount   = isLifetime ? 0 : pricePerBranch * branchCount * duration

  function computeExpiry() {
    if (isLifetime) return null
    const d = new Date()
    d.setMonth(d.getMonth() + duration)
    return d.toISOString()
  }

  async function handleCreate() {
    setError('')
    setWarning('')
    if (!companyName.trim()) { setError('Business name is required'); return }
    if (!email.trim())       { setError('Owner email is required');   return }
    if (!planId)             { setError('Select a plan');             return }

    setSaving(true)
    try {
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-owner-account', {
        body: {
          company_name:    companyName.trim(),
          company_name_ar: companyNameAr.trim() || null,
          email:           email.trim().toLowerCase(),
          phone:           phone.trim() || null,
          city:            city.trim() || null,
          plan_id:         planId,
          branch_count:    branchCount,
          duration_months: duration,
          ends_at:         computeExpiry(),
          pay_method:      payMethod,
          pay_ref:         payRef.trim() || null,
          notes:           notes.trim() || null,
        },
      })

      const errMsg = fnErr?.message ?? (fnData as any)?.error ?? null
      if (errMsg) throw new Error(errMsg)

      const warn = (fnData as any)?.warning ?? null
      if (warn) {
        setWarning(warn)
        return  // Stay open so super admin sees the warning before closing
      }

      onCreated()
    } catch (err: any) {
      setError(err.message ?? 'Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create New Client Account</h2>
          <p className="text-xs text-gray-400 mt-0.5">Creates the owner user, tenant, and subscription in one step.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="md" />
          </div>
        ) : (
          <div className="p-6 space-y-5">

            {/* Business info */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Business Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Business Name (English) *</label>
                  <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="Al-Faris Trading Co." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Business Name (Arabic)</label>
                  <input value={companyNameAr} onChange={e => setCompanyNameAr(e.target.value)}
                    className="input w-full text-sm h-9" dir="rtl" placeholder="شركة الفارس" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">City</label>
                  <input value={city} onChange={e => setCity(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="Riyadh" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    className="input w-full text-sm h-9" placeholder="+966 5x xxx xxxx" />
                </div>
              </div>
            </div>

            {/* Owner login */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Owner Login</p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Email *</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                  className="input w-full text-sm h-9" placeholder="owner@company.com" />
              </div>
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 mt-3">
                <span className="text-blue-500 text-sm flex-shrink-0">✉</span>
                <p className="text-xs text-blue-700">
                  A password setup email will be sent to the client automatically.
                  They click the link to set their own password and log in.
                </p>
              </div>
            </div>

            {/* Subscription */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Subscription</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Plan *</label>
                  <select value={planId} onChange={e => setPlanId(e.target.value)} className="input w-full text-sm h-9">
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} — SAR {p.price_monthly}/branch/mo</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Number of Branches</label>
                  <input
                    type="number" min={1} value={branchCount}
                    onChange={e => setBranchCount(Math.max(1, Number(e.target.value)))}
                    className="input w-full text-sm h-9"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Duration *</label>
                  <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="input w-full text-sm h-9">
                    {DURATIONS.map(d => <option key={d.months} value={d.months}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Payment Method</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input w-full text-sm h-9">
                    {['Manual', 'Bank Transfer', 'Cash'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Payment Reference</label>
                <input value={payRef} onChange={e => setPayRef(e.target.value)}
                  className="input w-full text-sm h-9" placeholder="e.g. TXN123456" />
              </div>

              {/* Dynamic pricing breakdown */}
              {isLifetime ? (
                <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-700 font-medium">
                  Lifetime Free — no expiry, no charge
                </div>
              ) : (
                <div className="mt-3 bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between items-center text-gray-500">
                    <span>
                      SAR {pricePerBranch} × {branchCount} branch{branchCount !== 1 ? 'es' : ''} × {duration} month{duration !== 1 ? 's' : ''}
                    </span>
                    <span className="font-bold text-gray-900">= SAR {totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400 border-t border-gray-200 pt-1.5">
                    <span>Expiry date</span>
                    <span className="font-semibold text-gray-700">
                      {(() => { const d = new Date(); d.setMonth(d.getMonth() + duration); return d.toLocaleDateString('en-SA') })()}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Internal Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                className="input w-full text-sm h-9" placeholder="Anything to remember about this client…" />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            {warning && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-800 mb-0.5">Account created — action needed</p>
                <p className="text-xs text-amber-700">{warning}</p>
                <button onClick={onCreated} className="text-xs font-medium text-amber-800 underline mt-2">
                  Close and view client list
                </button>
              </div>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const navigate = useNavigate()

  const [clients,  setClients]  = useState<ClientRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState<StatusFilter>('all')
  const [acting,   setActing]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [branches, setBranches] = useState<Record<string, BranchSummary[]>>({})
  const [loadingBranch, setLoadingBranch] = useState<Set<string>>(new Set())

  const [suspendTarget, setSuspendTarget] = useState<ClientRow | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<ClientRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [showCreate,    setShowCreate]    = useState(false)

  async function fetchClients() {
    const { data } = await (supabase as any)
      .from('tenants')
      .select(`
        id, name, name_ar, vat_number, city, is_active, suspended_at, created_at,
        tenant_subscriptions(status, ends_at, subscription_plans(name)),
        branches(id),
        user_profiles(id)
      `)
      .order('created_at', { ascending: false })
      .limit(200)

    const rows: ClientRow[] = (data ?? []).map((r: any) => {
      const sub = r.tenant_subscriptions?.[0]
      return {
        id:           r.id,
        name:         r.name,
        name_ar:      r.name_ar,
        vat_number:   r.vat_number,
        city:         r.city,
        is_active:    r.is_active,
        suspended_at: r.suspended_at,
        created_at:   r.created_at,
        plan:         sub?.subscription_plans?.name ?? null,
        subStatus:    sub?.status ?? null,
        endsAt:       sub?.ends_at ?? null,
        branchCount:  r.branches?.length ?? 0,
        userCount:    r.user_profiles?.length ?? 0,
      }
    })

    setClients(rows)
    setLoading(false)
  }

  useEffect(() => { fetchClients() }, [])

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
    expired:      clients.filter(c => getStatus(c) === 'expired').length,
  }), [clients])

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all',          label: `All (${counts.all})` },
    { key: 'active',       label: `Active (${counts.active})` },
    { key: 'grace_period', label: `Grace Period (${counts.grace_period})` },
    { key: 'lifetime_free',label: `Lifetime (${counts.lifetime_free})` },
    { key: 'suspended',    label: `Suspended (${counts.suspended})` },
    { key: 'expired',      label: `Expired (${counts.expired})` },
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
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {clients.length} registered tenants
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Plus size={15} /> Create Account
        </button>
      </div>

      {/* Search + filter tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, VAT…"
            className="input pl-9 text-sm h-9 w-full"
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
                  {['', 'Business', 'City', 'Plan', 'Branches', 'Users', 'Joined', 'Status', ''].map((h, i) => (
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
                        <td className="px-4 py-3.5 text-sm text-gray-600 tabular-nums">{c.branchCount}</td>
                        <td className="px-4 py-3.5 text-sm text-gray-600 tabular-nums">{c.userCount}</td>
                        <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">{c.created_at.slice(0, 10)}</td>
                        <td className="px-4 py-3.5">
                          <Badge variant={st.variant} dot>{st.label}</Badge>
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
                              {c.suspended_at ? 'Restore' : 'Suspend'}
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
                          <td colSpan={9} className="px-8 py-3">
                            {isBranchLoading || !clientBranches ? (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" /> Loading branches…
                              </div>
                            ) : clientBranches.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No branches</p>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                {clientBranches.map(b => (
                                  <div key={b.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs shadow-sm">
                                    <Building2 size={12} className="text-gray-300 flex-shrink-0" />
                                    <div>
                                      <p className="font-medium text-gray-800">{b.name}</p>
                                      <p className="text-gray-400 mt-0.5">
                                        {b.city ? `${b.city} · ` : ''}{b.invoice_counter} invoices
                                        {!b.is_active && <span className="text-red-400 ml-1">· Inactive</span>}
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
                    <td colSpan={9} className="px-5 py-10 text-center">
                      <Building2 size={28} className="text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No clients found</p>
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
