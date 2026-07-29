import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, FileText, Receipt, CreditCard, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, AlertCircle, Loader2,
  Package, Banknote, BadgePercent,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatSaudiDate, formatSaudiTime, saudiDateStr } from '@/lib/utils/date'
import { isLowStockProduct } from '@/lib/products/lowStock'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/Badge'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'
import { Rial } from '@/components/ui/RiyalSymbol'
import { productionStatusLabel } from '@/lib/zatca/status'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'
import {
  type RegisterSessionSummary,
  logRegisterSessionRpcError,
  normalizeRegisterSession,
} from '@/lib/registerSessions'
import { resolveBranchDisplayName, resolveBusinessDisplayName } from '@/lib/utils/localizedDisplayName.mjs'

const db = () => supabase as any

const statusConfig = {
  posted:  { variant: 'success' as const, labelKey: 'status.posted',  icon: CheckCircle2 },
  draft:   { variant: 'neutral' as const, labelKey: 'status.draft',   icon: AlertCircle },
  paid:    { variant: 'success' as const, labelKey: 'status.paid',    icon: CheckCircle2 },
  pending: { variant: 'warning' as const, labelKey: 'status.pending', icon: Clock },
}

const BRANCH_KPI_TONES = {
  grossSales: 'bg-gradient-to-br from-[#1B6B3A] to-[#0F2419]',
  creditNotes: 'bg-gradient-to-br from-[#64748b] to-[#334155]',
  netSales: 'bg-gradient-to-br from-[#0e6f53] to-[#0F4A28]',
  sessionInvoices: 'bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]',
  sessionCash: 'bg-gradient-to-br from-[#059669] to-[#047857]',
  sessionCard: 'bg-gradient-to-br from-[#256f7a] to-[#174852]',
  netVat: 'bg-gradient-to-br from-[#b45309] to-[#92400e]',
  expectedCash: 'bg-gradient-to-br from-[#4a5568] to-[#1f2937]',
} as const

const headerStatusStyles = {
  success: {
    pill: 'border-emerald-300/20 bg-emerald-950/25 text-emerald-100',
    dot: 'bg-emerald-300 shadow-[0_0_7px_rgba(110,231,183,0.48)]',
  },
  warning: {
    pill: 'border-amber-300/20 bg-amber-950/25 text-amber-100',
    dot: 'bg-amber-300 shadow-[0_0_7px_rgba(252,211,77,0.38)]',
  },
  danger: {
    pill: 'border-red-300/20 bg-red-950/25 text-red-100',
    dot: 'bg-red-300 shadow-[0_0_7px_rgba(252,165,165,0.36)]',
  },
  neutral: {
    pill: 'border-white/12 bg-black/10 text-white/75',
    dot: 'bg-white/45',
  },
  info: {
    pill: 'border-sky-300/20 bg-sky-950/25 text-sky-100',
    dot: 'bg-sky-300',
  },
} as const

interface DashboardBranchStat {
  id: string
  name: string
  zatca_phase: number
  todaySales: number
  todayCount: number
  todayCash: number
  todayCard: number
  productionStatus?: ProductionOnboardingResponse | null
}

interface DashboardDailySale {
  date: string
  sales: number
}

interface DashboardSummary {
  totalSales: number
  totalCount: number
  totalCash: number
  totalCard: number
  totalVat: number
  totalExpenses: number
  dailySales: DashboardDailySale[]
  branchStats: DashboardBranchStat[]
}

interface RecentInvoiceRow {
  id: string
  invoiceNumber?: string
  invoice_number?: string
  customerName?: string | null
  customer_name?: string | null
  totalAmount?: number
  total_amount?: number
  displayTotal?: number
  display_total?: number
  status: string
  invoiceDate?: string
  invoice_date?: string
  documentType?: string
  zatca_invoice_type?: string
  createdAt?: string
  created_at?: string
}

const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  totalSales: 0,
  totalCount: 0,
  totalCash: 0,
  totalCard: 0,
  totalVat: 0,
  totalExpenses: 0,
  dailySales: [],
  branchStats: [],
}

function getRegisterDuration(openedAt: string | null, now: number) {
  if (!openedAt) return null
  const openedTime = Date.parse(openedAt)
  if (!Number.isFinite(openedTime) || openedTime > now) return null
  const totalMinutes = Math.floor((now - openedTime) / 60_000)
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  }
}

function StatCard({ label, value, sub, icon: Icon, tone, loading }: {
  label: string; value: React.ReactNode; sub: string
  icon: React.ElementType; tone: string; loading?: boolean
}) {
  return (
    <article className={`relative min-h-[124px] overflow-hidden rounded-2xl border border-[#173f2a] p-4 shadow-card-md sm:min-h-[132px] sm:p-5 [@media(max-height:740px)]:min-h-[116px] [@media(max-height:740px)]:p-4 ${tone}`}>
      <div className="flex h-full items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase leading-4 tracking-wide text-white/65 [overflow-wrap:anywhere] rtl:normal-case rtl:tracking-normal">
            {label}
          </p>
          {loading
            ? <div className="mt-2 h-7 w-24 rounded bg-white/20 animate-pulse" />
            : (
              <p
                dir="ltr"
                className="mt-2 text-xl font-black tracking-tight text-white tabular-nums sm:text-2xl [&>span>span:first-child]:text-[0.72em] [&>span>span:first-child]:opacity-80"
              >
                {value}
              </p>
            )
          }
          <p className="mt-2 text-[11px] font-medium leading-4 text-white/60 [overflow-wrap:anywhere]">{sub}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
          <Icon size={17} className="text-white/90" aria-hidden="true" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gold-400/70" />
    </article>
  )
}

function RegisterSessionPanel({ session, loading, error, duration, onManageRegister, children }: {
  session: RegisterSessionSummary | null
  loading: boolean
  error: string
  duration: string | null
  onManageRegister: () => void
  children?: React.ReactNode
}) {
  const { t, i18n } = useTranslation('dashboard')
  const title = session?.sessionId ? session.status === 'open' ? t('register.current') : t('register.last') : t('register.none')
  const hasSession = !!session?.sessionId
  const isOpen = session?.status === 'open'
  const labelPrefix = isOpen ? t('register.session') : t('register.lastShort')
  const cashFinalLabel = session?.status === 'closed' && session.actualCash !== null ? t('register.difference') : t('register.expectedCash')
  const cashFinalValue = session?.status === 'closed' && session.actualCash !== null
    ? session.cashDifference ?? 0
    : session?.expectedCash ?? 0
  const grossSales = session ? session.totalSales + session.creditNoteTotal : 0
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="branch-register-session-heading">
      <h2
        id="branch-register-session-heading"
        className="text-xs font-bold uppercase tracking-[0.16em] text-gray-500 rtl:normal-case rtl:tracking-normal"
      >
        {t('branch.registerSnapshot')}
      </h2>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-[136px] rounded-2xl border border-gray-100 bg-white animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : error ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-card" role="alert">
            {error}
          </div>
          {children}
        </div>
      ) : !hasSession ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-card">
            <h3 className="text-sm font-bold text-gray-900">{t('register.none')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('register.openPrompt')}</p>
          </div>
          {children}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('kpi.grossSales')}
              value={<Rial amount={grossSales} />}
              sub={t('kpi.invoiceCount', { count: session.invoiceCount })}
              icon={TrendingUp}
              tone={BRANCH_KPI_TONES.grossSales}
            />
            <StatCard
              label={t('kpi.creditNotes')}
              value={<Rial amount={session.creditNoteTotal} />}
              sub={t('kpi.refundDocuments')}
              icon={Receipt}
              tone={BRANCH_KPI_TONES.creditNotes}
            />
            <StatCard
              label={t('kpi.netSales')}
              value={<Rial amount={session.totalSales} />}
              sub={t('kpi.grossLessCredits')}
              icon={TrendingUp}
              tone={BRANCH_KPI_TONES.netSales}
            />
            <StatCard
              label={t('kpi.sessionInvoicesLabel', { prefix: labelPrefix })}
              value={String(session.invoiceCount)}
              sub={isOpen ? t('register.registerCurrent') : t('register.registerClosed')}
              icon={FileText}
              tone={BRANCH_KPI_TONES.sessionInvoices}
            />
            <StatCard
              label={t('kpi.sessionCashLabel', { prefix: labelPrefix })}
              value={<Rial amount={session.cashTotal} />}
              sub={t('kpi.cashAndSplit')}
              icon={Banknote}
              tone={BRANCH_KPI_TONES.sessionCash}
            />
            <StatCard
              label={t('kpi.sessionCardLabel', { prefix: labelPrefix })}
              value={<Rial amount={session.cardTotal} />}
              sub={t('kpi.cardAndSplit')}
              icon={CreditCard}
              tone={BRANCH_KPI_TONES.sessionCard}
            />
            <StatCard
              label={t('kpi.netVat')}
              value={<Rial amount={session.vatTotal} />}
              sub={t('kpi.sessionNetVat')}
              icon={BadgePercent}
              tone={BRANCH_KPI_TONES.netVat}
            />
            <StatCard
              label={cashFinalLabel}
              value={<Rial amount={cashFinalValue} />}
              sub={session.status === 'closed' && session.actualCash !== null ? t('register.actualVsExpected') : t('register.expectedDrawer')}
              icon={Receipt}
              tone={BRANCH_KPI_TONES.expectedCash}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
              <div className="border-b border-gray-100 bg-gradient-to-r from-[#F7FAF6] to-white px-5 py-4 rtl:bg-gradient-to-l">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-gray-950 [overflow-wrap:anywhere] sm:text-lg">{title}</h3>
                    <p className="mt-1 text-xs text-gray-500">{session.openedAt
                      ? session.status === 'open'
                        ? t('register.timeOpen', { opened: new Date(session.openedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
                        : session.closedAt
                        ? t('register.timeClosed', { opened: new Date(session.openedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }), closed: new Date(session.closedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
                        : t('register.timeOpened', { opened: new Date(session.openedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
                      : t('register.noneYet')}</p>
                  </div>
                  <span className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                    session.isLongOpen
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : session.status === 'open'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.isLongOpen
                        ? 'bg-amber-500'
                        : session.status === 'open'
                        ? 'bg-emerald-500'
                        : 'bg-gray-400'
                    }`} aria-hidden="true" />
                    {session.isLongOpen ? t('status.longOpen') : session.status === 'open' ? t('status.open') : t('status.closed')}
                    {session.status === 'open' && duration ? <span className="opacity-70">· {duration}</span> : null}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {(session.status === 'open'
                  ? [
                    { label: t('register.opened'), value: session.openedAt ? new Date(session.openedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('register.earlier') },
                    { label: t('register.openingCash'), value: <Rial amount={session.openingCash} /> },
                    { label: t('register.expectedCash'), value: <Rial amount={session.expectedCash} />, emphasis: true },
                    { label: t('kpi.creditNotesRefunds'), value: <Rial amount={session.creditNoteTotal} /> },
                    { label: t('kpi.expenses'), value: <Rial amount={session.expensesTotal} /> },
                  ]
                  : [
                    { label: t('register.closed'), value: session.closedAt ? new Date(session.closedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('register.registerClosed') },
                    { label: t('register.openingCash'), value: <Rial amount={session.openingCash} /> },
                    { label: t('register.actualCash'), value: <Rial amount={session.actualCash ?? 0} /> },
                    { label: t('register.difference'), value: <Rial amount={session.cashDifference ?? 0} />, emphasis: true },
                    { label: t('kpi.creditNotesRefunds'), value: <Rial amount={session.creditNoteTotal} /> },
                    { label: t('kpi.expenses'), value: <Rial amount={session.expensesTotal} /> },
                  ]).map(item => (
                  <div key={item.label} className={`min-w-0 rounded-xl border px-4 py-3 ${
                    item.emphasis
                      ? 'border-primary-100 bg-primary-50'
                      : 'border-gray-100 bg-gray-50/70'
                  }`}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 [overflow-wrap:anywhere] rtl:normal-case rtl:tracking-normal">{item.label}</p>
                    <p dir="ltr" className={`mt-1 text-sm font-black tabular-nums [overflow-wrap:anywhere] ${item.emphasis ? 'text-primary-700' : 'text-gray-900'}`}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {session.isLongOpen && (
                <div className="mx-5 mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-[#fffbeb] px-4 py-3 sm:flex-row sm:items-center">
                  <AlertTriangle size={16} className="flex-shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-amber-950">{t('register.longOpenRisk', { age: duration ?? t('register.earlier') })}</p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      {t('register.longOpenWarning', { time: session.openedAt ? new Date(session.openedAt).toLocaleString(i18n.language === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('register.earlier') })}
                    </p>
                  </div>
                  <button type="button" onClick={onManageRegister} className="min-h-10 shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
                    {t('register.manage')}
                  </button>
                </div>
              )}
            </div>
            {children}
          </div>
        </>
      )}
    </section>
  )
}

function QuickActionsPanel({ onNavigate, lowStock, lowStockLoading }: {
  onNavigate: (path: string) => void
  lowStock: Array<{ name: string }>
  lowStockLoading: boolean
}) {
  const { t, i18n } = useTranslation('dashboard')
  const actions = [
    { label: t('branch.newSale'), desc: t('branch.openPos'), icon: Receipt, path: '/pos', primary: true },
    { label: t('kpi.expenses'), desc: t('branch.recordCosts'), icon: CreditCard, path: '/expenses', primary: false },
    { label: t('kpi.invoices'), desc: t('branch.reviewReceipts'), icon: FileText, path: '/invoices', primary: false },
  ]

  return (
    <aside className="min-w-0 rounded-2xl border border-gray-100 bg-white p-5 shadow-card" aria-labelledby="branch-quick-actions-heading">
      <div className="mb-4">
        <h2 id="branch-quick-actions-heading" className="text-sm font-black text-gray-900">{t('branch.quickActions')}</h2>
        <p className="mt-0.5 text-xs text-gray-400">{t('branch.workflow')}</p>
      </div>

      <div className="grid gap-2.5">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            onClick={() => onNavigate(action.path)}
            className={`group flex min-h-[64px] w-full items-center gap-3 rounded-xl px-3.5 py-3 text-start transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 active:scale-[0.98] ${
              action.primary
                ? 'bg-[#0F2419] text-white shadow-card hover:bg-[#173F2F]'
                : 'border border-gray-100 bg-gray-50/80 hover:border-primary-100 hover:bg-primary-50/60'
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              action.primary ? 'bg-gold-400/20 text-gold-200' : 'border border-gray-200 bg-white text-gray-500 group-hover:text-primary-600'
            }`}>
              <action.icon size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-black [overflow-wrap:anywhere] ${action.primary ? 'text-white' : 'text-gray-900'}`}>
                {action.label}
              </p>
              <p className={`mt-0.5 text-[11px] font-medium leading-4 [overflow-wrap:anywhere] ${action.primary ? 'text-white/65' : 'text-gray-400'}`}>
                {action.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      {!lowStockLoading && lowStock.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-800">{t('branch.lowStock', { count: lowStock.length })}</p>
            <p className="mt-0.5 truncate text-[11px] text-amber-600">
              {lowStock.map(p => p.name).join(', ')}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}

function numberOrZero(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function normalizeProductionStatus(value: unknown): ProductionOnboardingResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const onboardingStatus = typeof record.onboardingStatus === 'string'
    ? record.onboardingStatus
    : typeof record.onboarding_status === 'string'
    ? record.onboarding_status
    : null

  if (!onboardingStatus) return null

  return {
    ok: onboardingStatus === 'production_connected',
    branchId: typeof record.branchId === 'string' ? record.branchId : typeof record.branch_id === 'string' ? record.branch_id : '',
    environment: 'production',
    onboardingStatus: onboardingStatus as ProductionOnboardingResponse['onboardingStatus'],
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : typeof record.connected_at === 'string' ? record.connected_at : null,
    disconnectedAt: typeof record.disconnectedAt === 'string' ? record.disconnectedAt : typeof record.disconnected_at === 'string' ? record.disconnected_at : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : typeof record.updated_at === 'string' ? record.updated_at : null,
  }
}

function hasObject(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBranchSummary(value: unknown): DashboardBranchStat | null {
  if (!isRecord(value)) return null
  const id = typeof pick(value, 'id', 'branch_id') === 'string'
    ? String(pick(value, 'id', 'branch_id'))
    : ''
  return {
    id,
    todaySales: numberOrZero(pick(value, 'todaySales', 'today_sales')),
    todayCount: Math.trunc(numberOrZero(pick(value, 'todayCount', 'invoice_count', 'today_count'))),
    todayCash: numberOrZero(pick(value, 'todayCash', 'cash_total', 'cash_today')),
    todayCard: numberOrZero(pick(value, 'todayCard', 'card_total', 'card_today')),
    productionStatus: normalizeProductionStatus(pick(value, 'productionStatus', 'production_status')),
  }
}

function rpcErrorDebug(error: unknown) {
  if (error && typeof error === 'object') {
    const rpcError = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return {
      code: typeof rpcError.code === 'string' ? rpcError.code : null,
      message: typeof rpcError.message === 'string' ? rpcError.message : null,
      details: typeof rpcError.details === 'string' ? rpcError.details : null,
      hint: typeof rpcError.hint === 'string' ? rpcError.hint : null,
      error,
    }
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : String(error ?? ''),
    details: null,
    hint: null,
    error,
  }
}

function logBranchDashboardFailure(name: string, params: Record<string, unknown>, error: unknown) {
  console.error('[BranchDashboardPage] data load failed', {
    name,
    params,
    ...rpcErrorDebug(error),
  })
}

function registerSessionErrorKey(error: unknown): string {
  const combined = Object.values(rpcErrorDebug(error)).filter(value => typeof value === 'string').join(' ')
  if (/PGRST202|schema cache|could not find the function|function .* not found/i.test(combined)) return 'errors.registerSchema'
  if (/permission|42501|unauthorized|jwt|session/i.test(combined)) return 'errors.registerPermission'
  if (/22023|invalid/i.test(combined)) return 'errors.registerInvalid'
  return 'errors.registerLoad'
}

export default function BranchDashboardPage() {
  const { locale, isRtl } = useLocale()
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { profile, tenant, branch } = useAuth()

  const tid = profile?.tenant_id
  const bid = profile?.branch_id

  const [statsLoading, setStatsLoading] = useState(true)
  const [invLoading,   setInvLoading]   = useState(true)
  const [lowStockLoading, setLowStockLoading] = useState(true)

  const [recentInvs,   setRecentInvs]   = useState<any[]>([])
  const [lowStock,     setLowStock]     = useState<any[]>([])
  const [zatcaPhase,   setZatcaPhase]   = useState<1 | 2>(1)
  const [hasActiveCert, setHasActiveCert] = useState(false)
  const [productionStatus, setProductionStatus] = useState<ProductionOnboardingResponse | null>(null)
  const [productionStatusReadable, setProductionStatusReadable] = useState(true)
  const [registerSession, setRegisterSession] = useState<RegisterSessionSummary | null>(null)
  const [registerSessionError, setRegisterSessionError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [invoiceError, setInvoiceError] = useState('')
  const [durationNow, setDurationNow] = useState(() => Date.now())

  const loadStats = useCallback(async () => {
    if (!tid || !bid) { setStatsLoading(false); return }
    setStatsLoading(true)
    setStatsError('')
    setRegisterSessionError('')
    const today = saudiDateStr()
    const summaryParams = { p_branch_id: bid, p_start_date: today, p_end_date: today }
    try {
      const [branchRes, registerRes] = await Promise.all([
        db().from('branches').select('zatca_phase').eq('id', bid).maybeSingle(),
        (supabase as any).rpc('get_register_session_summary', {
          p_branch_id: bid,
        }),
      ])

      if (registerRes.error) {
        logRegisterSessionRpcError('get_register_session_summary', { p_branch_id: bid }, registerRes.error)
        setRegisterSession(null)
        setRegisterSessionError(registerSessionErrorKey(registerRes.error))
      } else {
        const sessionValue = isRecord(registerRes.data)
          ? pick(registerRes.data, 'session')
          : null
        setRegisterSession(normalizeRegisterSession(sessionValue))
      }

      const branchZatcaPhase = branchRes.data?.zatca_phase ?? 1
      setZatcaPhase(branchZatcaPhase)
      setHasActiveCert(false)

      try {
        const summary = await loadReportSummary<DashboardSummary>(
          'get_dashboard_summary',
          summaryParams,
          EMPTY_DASHBOARD_SUMMARY,
        )
        const summaryRecord = summary as Record<string, unknown>
        const branchSummary = asArray<unknown>(pick(summaryRecord, 'branchStats', 'branch_stats'))
          .map(normalizeBranchSummary)
          .find(row => row?.id === bid) ?? null
        setProductionStatus(normalizeProductionStatus(branchSummary?.productionStatus))
        setProductionStatusReadable(branchZatcaPhase === 2
          ? hasObject(branchSummary?.productionStatus)
          : true)
      } catch (summaryError) {
        logBranchDashboardFailure('get_dashboard_summary', summaryParams, summaryError)
        setStatsError('errors.metadata')
        setProductionStatus(null)
        setProductionStatusReadable(branchZatcaPhase !== 2)
      }
    } catch (error) {
      logBranchDashboardFailure('branch_register_session_load', { p_branch_id: bid }, error)
      setStatsError('errors.branchLoad')
      setRegisterSession(null)
      try {
        const { data } = await db().from('branches').select('zatca_phase').eq('id', bid).maybeSingle()
        setZatcaPhase(data?.zatca_phase ?? 1)
      } catch {}
    } finally {
      setStatsLoading(false)
    }
  }, [tid, bid])

  const loadInvoices = useCallback(async () => {
    if (!tid || !bid) { setInvLoading(false); return }
    setInvLoading(true)
    setInvoiceError('')
    const params = { p_branch_id: bid, p_limit: 6 }
    try {
      const { data, error } = await (supabase as any).rpc('get_branch_dashboard_recent_invoices', params)
      if (error) throw error
      setRecentInvs(asArray<RecentInvoiceRow>(data))
    } catch (error) {
      logBranchDashboardFailure('get_branch_dashboard_recent_invoices', params, error)
      setInvoiceError('errors.recentLoad')
      setRecentInvs([])
    } finally {
      setInvLoading(false)
    }
  }, [tid, bid])

  const loadLowStock = useCallback(async () => {
    if (!tid || !bid) { setLowStockLoading(false); return }
    setLowStockLoading(true)
    const { data } = await db()
      .from('products')
      .select('id, name, stock_quantity, min_stock_alert, track_stock, is_service, is_active, is_available')
      .eq('tenant_id', tid)
      .eq('branch_id', bid)
      .eq('is_active', true)
      .eq('is_available', true)
      .eq('track_stock', true)
      .eq('is_service', false)
      .gt('min_stock_alert', 0)
      .not('min_stock_alert', 'is', null)
      .order('stock_quantity', { ascending: true })
      .limit(50)
    setLowStock((data ?? []).filter(isLowStockProduct).slice(0, 5))
    setLowStockLoading(false)
  }, [tid])

  useEffect(() => { loadStats() },    [loadStats])
  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { loadLowStock() }, [loadLowStock])
  useEffect(() => {
    if (registerSession?.status !== 'open' || !registerSession.openedAt) return
    setDurationNow(Date.now())
    const interval = window.setInterval(() => setDurationNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [registerSession?.sessionId, registerSession?.status, registerSession?.openedAt])

  const demoSandbox = isPermanentDemoSandboxBranch(tid, bid)
  const productionKey = productionStatus?.onboardingStatus === 'production_connected'
    ? 'zatca.productionConnected'
    : productionStatus?.onboardingStatus === 'compliance_failed' || productionStatus?.onboardingStatus === 'failed'
    ? 'zatca.productionFailed'
    : productionStatus ? 'zatca.productionPending' : 'zatca.productionUnavailable'
  const zatcaStatus = demoSandbox
    ? { label: t('zatca.connected'), tone: 'success' as const }
    : zatcaPhase === 2 && !productionStatusReadable
    ? { label: t('zatca.phase2Unavailable'), tone: 'danger' as const }
    : { ...productionStatusLabel(productionStatus, hasActiveCert), label: t(productionKey) }
  const registerDurationParts = registerSession?.status === 'open'
    ? getRegisterDuration(registerSession.openedAt, durationNow)
    : null
  const registerDuration = registerDurationParts
    ? registerDurationParts.hours > 0
      ? t('register.durationHoursMinutes', registerDurationParts)
      : t('register.durationMinutes', registerDurationParts)
    : null
  const displayedZatcaTone = demoSandbox || zatcaPhase === 2 ? zatcaStatus.tone : 'info'
  const displayedZatcaLabel = demoSandbox || zatcaPhase === 2 ? zatcaStatus.label : t('zatca.phase1Qr')
  const zatcaHeaderStyle = headerStatusStyles[displayedZatcaTone]
  const companyName = resolveBusinessDisplayName({
    business_name_ar: branch?.business_name_ar,
    business_name: branch?.business_name,
    name_ar: tenant?.name_ar,
    name: tenant?.name,
    display_name: branch?.display_name,
  }, isRtl, '')
  const dashboardTitle = resolveBranchDisplayName(
    branch,
    isRtl,
    companyName || t('branch.myBranch'),
  )
  const dashboardContextName = companyName && companyName !== dashboardTitle
    ? companyName
    : ''
  const dashboardDate = new Date().toLocaleDateString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (!bid) return
    const channel = supabase
      .channel('branch-dashboard-' + bid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_sessions',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [bid, loadStats])

  return (
    <div className="min-h-screen min-w-0 bg-gray-50">

      {/* Header */}
      <header
        data-branch-dashboard-header
        className="relative overflow-hidden bg-[#0F2419] px-6 py-4 shadow-card sm:py-[18px]"
        aria-labelledby="branch-dashboard-title"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gold-500" />
        <div className="relative mx-auto flex max-w-6xl min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative z-10 min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gold-300 rtl:normal-case rtl:tracking-normal">{t('branch.operations')}</p>
            <h1
              id="branch-dashboard-title"
              dir="auto"
              className="mt-1 text-2xl font-black tracking-tight text-white [overflow-wrap:anywhere] sm:text-3xl"
            >
              {statsLoading ? t('branch.loading') : dashboardTitle}
            </h1>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/70">
              {dashboardContextName ? (
                <>
                  <span className="font-semibold text-white/85 [overflow-wrap:anywhere]" dir="auto">
                    {dashboardContextName}
                  </span>
                  <span className="hidden text-white/30 sm:inline" aria-hidden="true">/</span>
                </>
              ) : null}
              <span>{dashboardDate}</span>
            </div>
          </div>

          <div
            data-branch-header-action-stack
            className="relative z-10 flex w-full min-w-0 flex-col items-stretch gap-2 md:w-auto md:min-w-[10.5rem] md:shrink-0 md:items-end"
          >
            <button
              type="button"
              onClick={() => navigate('/pos')}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-black text-[#0F2419] shadow-card transition-[background-color,transform,box-shadow] duration-150 ease-out hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F2419] active:scale-[0.97] md:w-auto"
            >
              <Receipt size={16} aria-hidden="true" />
              {t('branch.newSale')}
            </button>
            <div
              data-branch-zatca-status
              className={`inline-flex min-h-7 max-w-full items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] md:self-end ${zatcaHeaderStyle.pill}`}
              role="status"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${zatcaHeaderStyle.dot}`} aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{displayedZatcaLabel}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 pb-6 pt-4 sm:px-6 [@media(max-height:740px)]:space-y-4">

        {(statsError || invoiceError) && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">{t('errors.branchRefresh')}</p>
              <p className="text-xs text-amber-800 mt-0.5">{t(statsError || invoiceError)}</p>
            </div>
            <button
              type="button"
              onClick={() => { loadStats(); loadInvoices() }}
              className="min-h-9 rounded-lg px-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              {t('errors.retry')}
            </button>
          </div>
        )}

        <RegisterSessionPanel
          session={registerSession}
          loading={statsLoading && !registerSession}
          error={registerSessionError ? t(registerSessionError) : ''}
          duration={registerDuration}
          onManageRegister={() => navigate('/pos')}
        >
          <QuickActionsPanel
            onNavigate={navigate}
            lowStock={lowStock}
            lowStockLoading={lowStockLoading}
          />
        </RegisterSessionPanel>

        {/* Recent invoices */}
        <section className="min-w-0 rounded-2xl border border-gray-100 bg-white shadow-card" aria-labelledby="recent-invoices-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
            <h2 id="recent-invoices-heading" className="text-sm font-semibold text-gray-900">{t('recent.title')}</h2>
            <button
              type="button"
              onClick={() => navigate('/invoices')}
              className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('recent.viewAll')} <DirectionalIcon icon={ArrowRight} size={12} />
            </button>
          </div>

          {invLoading ? (
            <div className="divide-y divide-gray-50">
              {[1, 2, 3].map(i => (
                <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="flex-1 h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </div>
              ))}
            </div>
          ) : invoiceError ? (
            <div className="py-10 text-center">
              <AlertCircle size={28} className="text-amber-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{t(invoiceError)}</p>
              <button
                type="button"
                onClick={loadInvoices}
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {t('errors.retry')}
              </button>
            </div>
          ) : recentInvs.length === 0 ? (
            <div className="py-10 text-center">
              <Package size={28} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{t('recent.none')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('recent.startSale')}</p>
              <button
                type="button"
                onClick={() => navigate('/pos')}
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <Receipt size={14} aria-hidden="true" /> {t('branch.openPos')}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto" role="region" aria-label={t('recent.title')} tabIndex={0}>
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr className="border-b border-gray-50">
                    {[t('recent.invoice'), t('recent.customer'), t('recent.amount'), t('recent.status'), t('recent.date')].map((h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 rtl:normal-case rtl:tracking-normal ${
                          i === 2 ? 'text-end' : 'text-start'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentInvs.map(inv => {
                    const cfg = statusConfig[inv.status as keyof typeof statusConfig] ?? statusConfig.draft
                    const invoiceNumber = inv.invoiceNumber ?? inv.invoice_number ?? ''
                    const customerName = inv.customerName ?? inv.customer_name ?? t('recent.walkIn')
                    const amount = numberOrZero(inv.displayTotal ?? inv.display_total ?? inv.totalAmount ?? inv.total_amount)
                    const invoiceDate = inv.invoiceDate ?? inv.invoice_date ?? ''
                    const invoiceTimestamp = inv.createdAt ?? inv.created_at
                    const documentType = inv.documentType ?? inv.zatca_invoice_type ?? 'simplified'
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                        className="cursor-pointer transition-colors hover:bg-gray-50/60"
                      >
                        <td dir="ltr" className="px-6 py-3.5">
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation()
                              navigate(`/invoices/${inv.id}`)
                            }}
                            aria-label={t('recent.openInvoice', { number: invoiceNumber })}
                            className="inline-flex min-h-9 items-center rounded-lg px-1 text-xs font-mono font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          >
                            {invoiceNumber}
                            {documentType === 'credit_note' && (
                              <span className="ms-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                                {t('status.credit')}
                              </span>
                            )}
                          </button>
                        </td>
                        <td dir="auto" className="px-6 py-3.5 text-sm text-gray-700 [overflow-wrap:anywhere]">
                          {customerName}
                        </td>
                        <td dir="ltr" className="px-6 py-3.5 text-end text-sm font-semibold text-gray-900 tabular-nums">
                          <Rial amount={amount} />
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge variant={cfg.variant} dot>{t(cfg.labelKey)}</Badge>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-gray-500">
                          {invoiceTimestamp ? (
                            <span className="grid gap-0.5 whitespace-nowrap">
                              <span>{formatSaudiDate(invoiceTimestamp, i18n.language)}</span>
                              <span className="font-medium text-gray-400" dir="ltr">{formatSaudiTime(invoiceTimestamp, i18n.language)}</span>
                            </span>
                          ) : <span dir="ltr">{invoiceDate}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
