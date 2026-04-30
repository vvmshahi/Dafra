import type React from 'react'

// ── Formatting ────────────────────────────────────────────────────────────────

export const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtQty = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })

export const fmtMonth = (yyyymm: string) => {
  const [y, m] = yyyymm.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ── Date range helpers ────────────────────────────────────────────────────────

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom'

const pad = (d: Date) => d.toISOString().split('T')[0]

export function getDateRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date()
  switch (preset) {
    case 'today':     return { start: pad(now), end: pad(now) }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1)
      return { start: pad(d), end: pad(d) }
    }
    case 'this_week': {
      const d = new Date(now)
      const day = d.getDay()
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
      return { start: pad(d), end: pad(now) }
    }
    case 'this_month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: pad(d), end: pad(now) }
    }
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last  = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: pad(first), end: pad(last) }
    }
    default: return { start: pad(now), end: pad(now) }
  }
}

export function generateMonths(start: string, end: string): string[] {
  const months: string[] = []
  const e = new Date(end + 'T00:00:00')
  const curr = new Date(start + 'T00:00:00')
  curr.setDate(1)
  while (curr <= e) {
    months.push(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`)
    curr.setMonth(curr.getMonth() + 1)
  }
  return months
}

// ── Chart colors ──────────────────────────────────────────────────────────────

export const CHART_COLORS = [
  '#10b981', '#6366f1', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316',
  '#ec4899', '#06b6d4',
]

// ── Shared props type ─────────────────────────────────────────────────────────

export interface ReportProps {
  startDate: string
  endDate:   string
  branchId:  string | null
}

// ── StatCard ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   string
  sub?:    string
  accent?: 'emerald' | 'amber' | 'red' | 'blue' | 'primary'
  primary?: boolean
}

export function StatCard({ label, value, sub, accent, primary }: StatCardProps) {
  const clx =
    accent === 'emerald' ? 'text-emerald-600' :
    accent === 'amber'   ? 'text-amber-600'   :
    accent === 'red'     ? 'text-red-500'      :
    accent === 'blue'    ? 'text-blue-600'     :
    accent === 'primary' ? 'text-primary-600'  :
    'text-gray-900'

  if (primary) {
    return (
      <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-primary-500 text-white shadow-card">
        <p className="text-xs font-medium text-white/70">{label}</p>
        <p className="text-lg font-bold mt-0.5">{value}</p>
        {sub && <p className="text-[10px] text-white/60 mt-0.5">{sub}</p>}
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${clx}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-xl ${className ?? ''}`} />
}

export function SkeletonCard() {
  return (
    <div className="flex-1 min-w-36 rounded-xl p-4 bg-white border border-gray-100 shadow-card space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-2 w-16" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <Skeleton className="h-3 w-48" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100 last:border-0">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart() {
  return <Skeleton className="h-64 w-full" />
}

// ── Empty chart state ─────────────────────────────────────────────────────────

export function EmptyChart({ message = 'No data for this period' }: { message?: string }) {
  return (
    <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  )
}

// ── Recharts custom tooltip ───────────────────────────────────────────────────

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-3 py-2 text-xs">
      {label && <p className="font-semibold text-gray-700 mb-1.5">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-semibold text-gray-800 tabular-nums">
            SAR {typeof p.value === 'number'
              ? p.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-sm font-bold text-gray-800">{title}</h3>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}
