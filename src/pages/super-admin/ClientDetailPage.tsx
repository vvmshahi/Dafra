import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Building2, Users, FileText, CreditCard,
  UserX, UserCheck, Trash2, RefreshCw, MapPin, Phone, Mail, Globe,
  AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
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
  trial_ends_at: string | null
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{value ?? <span className="text-gray-300">—</span>}</span>
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

  async function load() {
    if (!id) return
    setLoading(true)

    const [
      { data: t },
      { data: subscriptions },
      { data: branchRows },
      { data: userRows },
      { data: invRows },
    ] = await Promise.all([
      (supabase as any).from('tenants').select('*').eq('id', id).single(),
      (supabase as any).from('tenant_subscriptions')
        .select('id, status, starts_at, ends_at, trial_ends_at, subscription_plans(name, price_monthly, max_branches, max_users)')
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

    const rawSub = subscriptions?.[0]
    if (rawSub) {
      setSub({
        id:           rawSub.id,
        status:       rawSub.status,
        starts_at:    rawSub.starts_at,
        ends_at:      rawSub.ends_at,
        trial_ends_at:rawSub.trial_ends_at,
        plan:         rawSub.subscription_plans ?? null,
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

  async function toggleSuspend() {
    if (!tenant) return
    setActing(true)
    if (tenant.suspended_at) {
      await (supabase as any).from('tenants')
        .update({ suspended_at: null, suspended_reason: null, is_active: true })
        .eq('id', tenant.id)
    } else {
      const reason = window.prompt('Reason for suspension (optional):') ?? ''
      await (supabase as any).from('tenants')
        .update({ suspended_at: new Date().toISOString(), suspended_reason: reason || null, is_active: false })
        .eq('id', tenant.id)
    }
    setActing(false)
    load()
  }

  async function deleteTenant() {
    if (!tenant) return
    const confirmed = window.confirm(
      `Permanently delete "${tenant.name}" and ALL their data? This cannot be undone.`
    )
    if (!confirmed) return
    setActing(true)
    await (supabase as any).from('tenants').delete().eq('id', tenant.id)
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
            onClick={toggleSuspend} disabled={acting}
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
            onClick={deleteTenant} disabled={acting}
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
            { label: 'Revenue',  value: `SAR ${(stats?.revenue ?? 0).toLocaleString()}`, icon: CreditCard },
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
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Subscription</h2>
          {sub ? (
            <>
              <InfoRow label="Plan"      value={
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  sub.plan?.name === 'Enterprise' ? 'bg-violet-50 text-violet-700'
                  : sub.plan?.name === 'Business' ? 'bg-primary-50 text-primary-700'
                  : 'bg-gray-100 text-gray-600'
                }`}>{sub.plan?.name ?? '—'}</span>
              } />
              <InfoRow label="Status"    value={
                <Badge variant={
                  sub.status === 'active' ? 'success'
                  : sub.status === 'trial' ? 'warning'
                  : 'danger'
                } dot>{sub.status}</Badge>
              } />
              <InfoRow label="Monthly"   value={sub.plan ? `SAR ${sub.plan.price_monthly.toLocaleString()}` : '—'} />
              <InfoRow label="Started"   value={sub.starts_at.slice(0, 10)} />
              <InfoRow label="Expires"   value={sub.ends_at?.slice(0, 10) ?? 'No expiry'} />
              {sub.trial_ends_at && (
                <InfoRow label="Trial ends" value={sub.trial_ends_at.slice(0, 10)} />
              )}
              <InfoRow label="Max branches" value={sub.plan?.max_branches} />
              <InfoRow label="Max users"    value={sub.plan?.max_users} />
            </>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">No active subscription</p>
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
    </div>
  )
}
