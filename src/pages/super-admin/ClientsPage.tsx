import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Building2, UserX, UserCheck, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:            string
  name:          string
  name_ar:       string | null
  vat_number:    string
  city:          string | null
  is_active:     boolean
  suspended_at:  string | null
  created_at:    string
  plan:          string | null
  subStatus:     string | null
  branchCount:   number
  userCount:     number
}

type StatusFilter = 'all' | 'active' | 'trial' | 'suspended' | 'inactive'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientStatus(c: ClientRow): { label: string; variant: 'success' | 'warning' | 'danger' | 'default' } {
  if (c.suspended_at)                          return { label: 'Suspended', variant: 'danger' }
  if (c.subStatus === 'trial')                 return { label: 'Trial',     variant: 'warning' }
  if (c.is_active && c.subStatus === 'active') return { label: 'Active',    variant: 'success' }
  return { label: 'Inactive', variant: 'default' }
}

function matchesFilter(c: ClientRow, f: StatusFilter): boolean {
  if (f === 'all')       return true
  if (f === 'suspended') return !!c.suspended_at
  if (f === 'trial')     return c.subStatus === 'trial' && !c.suspended_at
  if (f === 'active')    return c.is_active && c.subStatus === 'active' && !c.suspended_at
  if (f === 'inactive')  return !c.is_active && !c.suspended_at
  return true
}

// ── Modals ────────────────────────────────────────────────────────────────────

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

function RestoreModal({ client, onConfirm, onCancel, acting }: {
  client: ClientRow; onConfirm: () => void; onCancel: () => void; acting: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Restore Client Access</h2>
        <p className="text-sm text-gray-500 mb-5">
          Are you sure you want to restore access for <strong>{client.name}</strong>?
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState<StatusFilter>('all')
  const [acting,  setActing]  = useState(false)

  // Modal state
  const [suspendTarget, setSuspendTarget] = useState<ClientRow | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<ClientRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')

  async function fetchClients() {
    const { data } = await (supabase as any)
      .from('tenants')
      .select(`
        id, name, name_ar, vat_number, city, is_active, suspended_at, created_at,
        tenant_subscriptions(status, subscription_plans(name)),
        branches(id),
        user_profiles(id)
      `)
      .order('created_at', { ascending: false })
      .limit(100)

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
        branchCount:  r.branches?.length ?? 0,
        userCount:    r.user_profiles?.filter((u: any) => u).length ?? 0,
      }
    })
    setClients(rows)
    setLoading(false)
  }

  useEffect(() => { fetchClients() }, [])

  async function confirmSuspend() {
    if (!suspendTarget) return
    setActing(true)
    await (supabase as any)
      .from('tenants')
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
    await (supabase as any)
      .from('tenants')
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
    all:       clients.length,
    active:    clients.filter(c => c.is_active && c.subStatus === 'active' && !c.suspended_at).length,
    trial:     clients.filter(c => c.subStatus === 'trial' && !c.suspended_at).length,
    suspended: clients.filter(c => !!c.suspended_at).length,
    inactive:  clients.filter(c => !c.is_active && !c.suspended_at).length,
  }), [clients])

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all',       label: `All (${counts.all})` },
    { key: 'active',    label: `Active (${counts.active})` },
    { key: 'trial',     label: `Trial (${counts.trial})` },
    { key: 'suspended', label: `Suspended (${counts.suspended})` },
    { key: 'inactive',  label: `Inactive (${counts.inactive})` },
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

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Clients</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {clients.length} registered tenants
          {clients.length >= 100 && ' · showing first 100'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, VAT number…"
            className="input pl-9 text-sm h-9 w-full"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
                  {['Business Name', 'VAT Number', 'City', 'Plan', 'Branches', 'Users', 'Joined', 'Status', ''].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(c => {
                  const st = clientStatus(c)
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                      onClick={() => navigate(`/super-admin/clients/${c.id}`)}
                    >
                      <td className="px-5 py-3.5">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.name}</p>
                          {c.name_ar && <p className="text-xs text-gray-400 mt-0.5" dir="rtl">{c.name_ar}</p>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono text-gray-500">{c.vat_number}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-500">{c.city ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        {c.plan ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            c.plan === 'Enterprise' ? 'bg-violet-50 text-violet-700'
                            : c.plan === 'Business' ? 'bg-primary-50 text-primary-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}>{c.plan}</span>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 tabular-nums">{c.branchCount}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 tabular-nums">{c.userCount}</td>
                      <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap">{c.created_at.slice(0, 10)}</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={st.variant} dot>{st.label}</Badge>
                      </td>
                      <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={e => handleToggle(e, c)}
                            className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                              c.suspended_at
                                ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                : 'text-red-500 bg-red-50 hover:bg-red-100'
                            }`}
                          >
                            {c.suspended_at ? <UserCheck size={12} /> : <UserX size={12} />}
                            {c.suspended_at ? 'Restore' : 'Suspend'}
                          </button>
                          <button
                            onClick={() => navigate(`/super-admin/clients/${c.id}`)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
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
