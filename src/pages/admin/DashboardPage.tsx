import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, ShoppingBag, Users, FileText,
  Plus, ArrowRight, CheckCircle2, Clock, AlertCircle,
  Receipt, Package,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useNavigate } from 'react-router-dom'

/* ── Mock data ──────────────────────────────────────────────── */
const salesData = [
  { day: 'Mon', sales: 4200 },
  { day: 'Tue', sales: 6800 },
  { day: 'Wed', sales: 5100 },
  { day: 'Thu', sales: 9300 },
  { day: 'Fri', sales: 11400 },
  { day: 'Sat', sales: 14200 },
  { day: 'Sun', sales: 8700 },
]

const recentInvoices = [
  { id: 'INV-0042', customer: 'محمد العمري', amount: 1850.00, status: 'paid',    date: '2026-04-30' },
  { id: 'INV-0041', customer: 'شركة الفلق',  amount: 6420.50, status: 'pending', date: '2026-04-29' },
  { id: 'INV-0040', customer: 'نوره السالم',  amount:  975.00, status: 'paid',    date: '2026-04-29' },
  { id: 'INV-0039', customer: 'Ahmed Al-Rashid', amount: 3200.00, status: 'draft', date: '2026-04-28' },
  { id: 'INV-0038', customer: 'Khalid Trading',  amount: 8850.75, status: 'paid',  date: '2026-04-27' },
]

const statusConfig = {
  paid:    { variant: 'success' as const,  label: 'Paid',    icon: CheckCircle2 },
  pending: { variant: 'warning' as const,  label: 'Pending', icon: Clock },
  draft:   { variant: 'neutral' as const,  label: 'Draft',   icon: AlertCircle },
}

/* ── Stat card ──────────────────────────────────────────────── */
interface StatCardProps {
  label: string
  value: string
  sub: string
  icon: React.ElementType
  gradient: string
  iconBg: string
}

function StatCard({ label, value, sub, icon: Icon, gradient, iconBg }: StatCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-6 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/70">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-white tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-white/60">{sub}</p>
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      {/* Subtle circle decoration */}
      <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full bg-white/5" />
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
export default function DashboardPage() {
  const navigate = useNavigate()
  const [_period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')

  return (
    <div className="space-y-6">

      {/* ── KPI grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Today's Sales"
          value="SAR 8,700"
          sub="+12.4% vs yesterday"
          icon={TrendingUp}
          gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
          iconBg="bg-white/15"
        />
        <StatCard
          label="Monthly Revenue"
          value="SAR 60,120"
          sub="April 2026"
          icon={ShoppingBag}
          gradient="bg-gradient-to-br from-[#C8A96E] to-[#a8893e]"
          iconBg="bg-white/15"
        />
        <StatCard
          label="Total Invoices"
          value="42"
          sub="8 pending approval"
          icon={FileText}
          gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
          iconBg="bg-white/15"
        />
        <StatCard
          label="Active Customers"
          value="138"
          sub="+5 this month"
          icon={Users}
          gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]"
          iconBg="bg-white/15"
        />
      </div>

      {/* ── Charts + ZATCA row ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Sales chart */}
        <div className="xl:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Sales Trend</h2>
              <p className="text-xs text-gray-400 mt-0.5">Daily revenue this week</p>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    _period === p
                      ? 'bg-white text-gray-900 shadow-card'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={salesData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#1B6B3A" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#1B6B3A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#1B6B3A', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Area
                type="monotone" dataKey="sales"
                stroke="#1B6B3A" strokeWidth={2}
                fill="url(#salesGrad)"
                dot={false} activeDot={{ r: 5, fill: '#1B6B3A', strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ZATCA widget */}
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">ZATCA Compliance</h2>
            <p className="text-xs text-gray-400 mt-0.5">هيئة الزكاة والضريبة والجمارك</p>
          </div>

          {/* Phase badges */}
          <div className="space-y-3">
            {[
              { label: 'Phase 1', desc: 'QR Code (TLV)', ok: true },
              { label: 'Phase 2', desc: 'e-Invoice UBL 2.1', ok: true },
              { label: 'Clearance', desc: 'API Connected', ok: false },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  item.ok ? 'bg-emerald-50' : 'bg-amber-50'
                }`}>
                  {item.ok
                    ? <CheckCircle2 size={16} className="text-emerald-500" />
                    : <Clock size={16} className="text-amber-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{item.label}</p>
                  <p className="text-[10px] text-gray-400">{item.desc}</p>
                </div>
                <Badge variant={item.ok ? 'success' : 'warning'}>
                  {item.ok ? 'Active' : 'Pending'}
                </Badge>
              </div>
            ))}
          </div>

          {/* Stat */}
          <div className="mt-auto bg-primary-500/5 border border-primary-500/10 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-primary-600">42</p>
            <p className="text-xs text-gray-500 mt-0.5">Invoices submitted this month</p>
          </div>
        </div>
      </div>

      {/* ── Recent invoices + Quick actions ─────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Recent invoices */}
        <div className="xl:col-span-2 card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Recent Invoices</h2>
            <button
              onClick={() => navigate('/pos')}
              className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Invoice</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Customer</th>
                  <th className="px-6 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentInvoices.map(inv => {
                  const cfg = statusConfig[inv.status as keyof typeof statusConfig]
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                      <td className="px-6 py-3.5 text-xs font-mono font-semibold text-primary-600">{inv.id}</td>
                      <td className="px-6 py-3.5 text-sm text-gray-700">{inv.customer}</td>
                      <td className="px-6 py-3.5 text-sm font-semibold text-gray-900 text-right tabular-nums">
                        SAR {inv.amount.toLocaleString('en-SA', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-gray-400">{inv.date}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick actions */}
        <div className="card p-6 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Quick Actions</h2>

          {[
            { label: 'New Invoice',   desc: 'Open POS terminal',       icon: Receipt,  path: '/pos',      primary: true },
            { label: 'Add Product',   desc: 'Add to catalog',          icon: Package,  path: '/products', primary: false },
            { label: 'Add Customer',  desc: 'Register new customer',   icon: Users,    path: '/customers',primary: false },
            { label: 'View Reports',  desc: 'Sales & tax reports',     icon: TrendingUp, path: '/reports', primary: false },
          ].map(action => (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left transition-all ${
                action.primary
                  ? 'bg-primary-500 hover:bg-primary-600 text-white shadow-sm'
                  : 'bg-gray-50 hover:bg-gray-100 border border-gray-100'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                action.primary ? 'bg-white/20' : 'bg-white border border-gray-200'
              }`}>
                <action.icon size={15} className={action.primary ? 'text-white' : 'text-gray-500'} />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold truncate ${action.primary ? 'text-white' : 'text-gray-800'}`}>
                  {action.label}
                </p>
                <p className={`text-[11px] truncate ${action.primary ? 'text-white/70' : 'text-gray-400'}`}>
                  {action.desc}
                </p>
              </div>
              <Plus size={14} className={action.primary ? 'text-white/70' : 'text-gray-300'} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
