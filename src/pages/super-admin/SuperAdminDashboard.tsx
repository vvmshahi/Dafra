import {
  Building2, Users, CreditCard, AlertTriangle,
  CheckCircle2, XCircle, TrendingUp, ArrowRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

/* ── Mock data ──────────────────────────────────────────────── */
const revenueData = [
  { month: 'Nov', mrr: 8200 },
  { month: 'Dec', mrr: 11400 },
  { month: 'Jan', mrr: 9800 },
  { month: 'Feb', mrr: 13200 },
  { month: 'Mar', mrr: 15600 },
  { month: 'Apr', mrr: 18900 },
]

const tenants = [
  { id: 'T-001', name: 'شركة النخيل التجارية',  plan: 'Business', status: 'active',   invoices: 284, joined: '2025-11-14' },
  { id: 'T-002', name: 'مؤسسة الفجر',           plan: 'Starter',  status: 'active',   invoices: 91,  joined: '2025-12-02' },
  { id: 'T-003', name: 'Al-Faris Trading Co.',  plan: 'Business', status: 'trial',    invoices: 12,  joined: '2026-04-15' },
  { id: 'T-004', name: 'مجموعة الأندلس',        plan: 'Enterprise', status: 'active', invoices: 1240,joined: '2025-09-07' },
  { id: 'T-005', name: 'Star Retail LLC',       plan: 'Starter',  status: 'inactive', invoices: 0,   joined: '2026-01-20' },
]

const statusConfig = {
  active:   { variant: 'success' as const, label: 'Active' },
  trial:    { variant: 'warning' as const, label: 'Trial' },
  inactive: { variant: 'danger'  as const, label: 'Inactive' },
}

const systemHealth = [
  { service: 'Database',       ok: true },
  { service: 'Auth (GoTrue)',  ok: true },
  { service: 'Storage',        ok: true },
  { service: 'ZATCA API',      ok: false },
  { service: 'Edge Functions', ok: true },
]

/* ── Stat card ──────────────────────────────────────────────── */
interface StatCardProps {
  label: string
  value: string
  sub: string
  icon: React.ElementType
  iconClass: string
  bgClass: string
}

function StatCard({ label, value, sub, icon: Icon, iconClass, bgClass }: StatCardProps) {
  return (
    <div className="card p-6 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${bgClass}`}>
        <Icon size={20} className={iconClass} />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 tracking-tight">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

/* ── Custom tooltip ─────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3.5 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">
        SAR {Number(payload[0].value).toLocaleString()}
      </p>
    </div>
  )
}

/* ── Page ───────────────────────────────────────────────────── */
export default function SuperAdminDashboard() {
  return (
    <div className="space-y-6">

      {/* ── KPI row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Tenants"
          value="5"
          sub="4 active · 1 inactive"
          icon={Building2}
          iconClass="text-primary-600"
          bgClass="bg-primary-50"
        />
        <StatCard
          label="Active Subscriptions"
          value="4"
          sub="1 on trial"
          icon={CreditCard}
          iconClass="text-gold-600"
          bgClass="bg-gold-50"
        />
        <StatCard
          label="MRR"
          value="SAR 18,900"
          sub="+21% vs last month"
          icon={TrendingUp}
          iconClass="text-emerald-600"
          bgClass="bg-emerald-50"
        />
        <StatCard
          label="Total Users"
          value="38"
          sub="across all tenants"
          icon={Users}
          iconClass="text-violet-600"
          bgClass="bg-violet-50"
        />
      </div>

      {/* ── MRR chart + System health ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* MRR chart */}
        <div className="xl:col-span-2 card p-6">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900">Monthly Recurring Revenue</h2>
            <p className="text-xs text-gray-400 mt-0.5">Nov 2025 – Apr 2026</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#C8A96E" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#C8A96E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#C8A96E', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Area
                type="monotone" dataKey="mrr"
                stroke="#C8A96E" strokeWidth={2}
                fill="url(#mrrGrad)"
                dot={false} activeDot={{ r: 5, fill: '#C8A96E', strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* System health */}
        <div className="card p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">System Health</h2>
            <p className="text-xs text-gray-400 mt-0.5">Live service status</p>
          </div>
          <div className="space-y-2.5 flex-1">
            {systemHealth.map(({ service, ok }) => (
              <div key={service} className="flex items-center gap-3">
                {ok
                  ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                  : <XCircle     size={16} className="text-red-400    flex-shrink-0" />
                }
                <span className="text-sm text-gray-700 flex-1">{service}</span>
                <span className={`text-xs font-medium ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {ok ? 'Operational' : 'Degraded'}
                </span>
              </div>
            ))}
          </div>

          {/* ZATCA alert */}
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-700">ZATCA API unavailable</p>
              <p className="text-[10px] text-amber-600 mt-0.5">Clearance submissions queued locally</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tenants table ───────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">All Tenants</h2>
          <button className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1">
            Manage <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['ID', 'Business Name', 'Plan', 'Invoices', 'Joined', 'Status'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tenants.map(t => {
                const cfg = statusConfig[t.status as keyof typeof statusConfig]
                return (
                  <tr key={t.id} className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                    <td className="px-6 py-3.5 text-xs font-mono text-gray-400">{t.id}</td>
                    <td className="px-6 py-3.5 text-sm font-medium text-gray-800">{t.name}</td>
                    <td className="px-6 py-3.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        t.plan === 'Enterprise' ? 'bg-violet-50 text-violet-700'
                        : t.plan === 'Business' ? 'bg-primary-50 text-primary-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {t.plan}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-600 tabular-nums">{t.invoices.toLocaleString()}</td>
                    <td className="px-6 py-3.5 text-xs text-gray-400">{t.joined}</td>
                    <td className="px-6 py-3.5">
                      <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
