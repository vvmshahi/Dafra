import { useEffect, useState } from 'react'
import { CreditCard, TrendingUp, Users, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { supabase } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanSummary {
  id:            string
  name:          string
  price_monthly: number
  active:        number
  trial:         number
  expired:       number
  cancelled:     number
  mrr:           number
}

interface SubRow {
  id:         string
  tenantName: string
  plan:       string | null
  status:     string
  starts_at:  string
  ends_at:    string | null
  mrr:        number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  active:    'success',
  trial:     'warning',
  expired:   'danger',
  cancelled: 'default',
}

const PLAN_COLORS: Record<string, string> = {
  Starter:    '#6b7280',
  Business:   '#0F2419',
  Enterprise: '#7c3aed',
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">{sarStr(Number(payload[0].value))} MRR</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [plans,   setPlans]   = useState<PlanSummary[]>([])
  const [rows,    setRows]    = useState<SubRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [{ data: planData }, { data: subData }] = await Promise.all([
        (supabase as any).from('subscription_plans').select('id, name, price_monthly').eq('is_active', true).order('price_monthly'),
        (supabase as any).from('tenant_subscriptions')
          .select('id, status, starts_at, ends_at, subscription_plans(id, name, price_monthly), tenants(name)')
          .order('created_at', { ascending: false }),
      ])

      if (cancelled) return

      // Build plan summaries
      const summaryMap: Record<string, PlanSummary> = {}
      for (const p of (planData ?? [])) {
        summaryMap[p.id] = { id: p.id, name: p.name, price_monthly: p.price_monthly, active: 0, trial: 0, expired: 0, cancelled: 0, mrr: 0 }
      }

      const rowList: SubRow[] = []
      for (const s of (subData ?? [])) {
        const pid  = s.subscription_plans?.id
        const plan = s.subscription_plans?.name ?? '—'
        const price = s.subscription_plans?.price_monthly ?? 0

        if (pid && summaryMap[pid]) {
          const st = s.status as string
          if (st === 'active')    { summaryMap[pid].active++;    summaryMap[pid].mrr += price }
          if (st === 'trial')     { summaryMap[pid].trial++ }
          if (st === 'expired')   { summaryMap[pid].expired++ }
          if (st === 'cancelled') { summaryMap[pid].cancelled++ }
        }

        rowList.push({
          id:         s.id,
          tenantName: s.tenants?.name ?? 'Unknown',
          plan,
          status:     s.status,
          starts_at:  s.starts_at,
          ends_at:    s.ends_at,
          mrr:        s.status === 'active' ? price : 0,
        })
      }

      setPlans(Object.values(summaryMap))
      setRows(rowList)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [])

  const totalMrr   = plans.reduce((s, p) => s + p.mrr, 0)
  const totalActive = plans.reduce((s, p) => s + p.active, 0)
  const totalTrial  = plans.reduce((s, p) => s + p.trial, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Subscriptions</h1>
        <p className="text-sm text-gray-400 mt-0.5">Plan distribution and revenue overview</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-6 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Monthly Recurring Revenue</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5"><Rial amount={totalMrr} /></p>
            <p className="text-xs text-gray-400 mt-0.5">{totalActive} paying clients</p>
          </div>
        </div>
        <div className="card p-6 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={20} className="text-primary-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Active Subscriptions</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{totalActive}</p>
            <p className="text-xs text-gray-400 mt-0.5">{totalTrial} on trial</p>
          </div>
        </div>
        <div className="card p-6 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-gold-50 flex items-center justify-center flex-shrink-0">
            <Users size={20} className="text-gold-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Average Revenue / Client</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">
              {totalActive > 0 ? <Rial amount={Math.round(totalMrr / totalActive)} /> : '0'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">ARPU</p>
          </div>
        </div>
      </div>

      {/* MRR by plan bar chart */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">MRR by Plan</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={plans} margin={{ top: 4, right: 0, left: -20, bottom: 0 }} barSize={40}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
              tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
            <Bar dataKey="mrr" radius={[6, 6, 0, 0]}>
              {plans.map((p, i) => <Cell key={i} fill={PLAN_COLORS[p.name] ?? '#0F2419'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {plans.map(p => (
          <div key={p.id} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
              <span className="text-xs text-gray-400"><><Rial amount={p.price_monthly} />/mo</></span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mb-3"><><Rial amount={p.mrr} /> MRR</></p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-emerald-50 rounded-lg py-1.5">
                <p className="text-sm font-bold text-emerald-700">{p.active}</p>
                <p className="text-[10px] text-emerald-600">Active</p>
              </div>
              <div className="bg-amber-50 rounded-lg py-1.5">
                <p className="text-sm font-bold text-amber-700">{p.trial}</p>
                <p className="text-[10px] text-amber-600">Trial</p>
              </div>
              <div className="bg-red-50 rounded-lg py-1.5">
                <p className="text-sm font-bold text-red-700">{p.expired}</p>
                <p className="text-[10px] text-red-600">Expired</p>
              </div>
              <div className="bg-gray-50 rounded-lg py-1.5">
                <p className="text-sm font-bold text-gray-600">{p.cancelled}</p>
                <p className="text-[10px] text-gray-400">Cancelled</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* All subscriptions table */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">All Subscriptions ({rows.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['Client', 'Plan', 'MRR', 'Started', 'Expires', 'Status'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{r.tenantName}</td>
                  <td className="px-5 py-3.5">
                    {r.plan !== '—' ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.plan === 'Enterprise' ? 'bg-violet-50 text-violet-700'
                        : r.plan === 'Business' ? 'bg-primary-50 text-primary-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>{r.plan}</span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700 tabular-nums">
                    {r.mrr > 0 ? <Rial amount={r.mrr} /> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">{r.starts_at.slice(0, 10)}</td>
                  <td className="px-5 py-3.5 text-xs text-gray-400">{r.ends_at?.slice(0, 10) ?? 'No expiry'}</td>
                  <td className="px-5 py-3.5">
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'default'} dot>{r.status}</Badge>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <AlertCircle size={24} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No subscriptions yet</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
