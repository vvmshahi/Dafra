import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Clock, ExternalLink, FileText,
  RefreshCw, Settings, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation, type TFunction } from 'react-i18next'

type ZatcaDocumentType = 'standard' | 'simplified' | 'credit_note' | 'debit_note'
type ZatcaDocumentStatus = 'not_submitted' | 'pending' | 'reported' | 'cleared' | 'failed'
type ProductionStatus = 'production_connected' | 'disconnected' | 'failed' | 'compliance_failed' | 'not_started' | string

interface BranchRow {
  id: string
  name: string
  city: string | null
  is_active: boolean
  zatca_phase: number | null
}

interface InvoiceHealthRow {
  id: string
  branch_id: string
  invoice_number: string
  invoice_date: string
  created_at: string
  zatca_invoice_type: ZatcaDocumentType
  zatca_status: ZatcaDocumentStatus
  zatca_submitted_at: string | null
  status: string
}

interface ProductionCredentialRow {
  branch_id: string
  onboarding_status: ProductionStatus | null
  connected_at: string | null
  disconnected_at: string | null
  updated_at: string | null
}

interface BranchHealth {
  branch: BranchRow
  productionStatus: ProductionCredentialRow | null
  productionStatusReadable: boolean
  failed: InvoiceHealthRow[]
  pending: InvoiceHealthRow[]
  lastSuccessfulAt: string | null
  oldestUnresolved: InvoiceHealthRow | null
}

type HealthTone = 'success' | 'warning' | 'danger' | 'neutral'

const ALLOWED_ROLES = new Set(['owner', 'admin', 'super_admin'])

function fmtDateTime(value: string | null, locale: string, t: TFunction): string {
  if (!value) return t('noneYet')
  return new Date(value).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function docLabel(value: ZatcaDocumentType, t: TFunction): string {
  return t(`documents.${value}`, { defaultValue: t('documents.invoice') })
}

function statusBadge(health: BranchHealth, t: TFunction): { label: string; detail: string; tone: HealthTone; icon: typeof CheckCircle2 } {
  const phase = health.branch.zatca_phase ?? 1
  const productionStatus = health.productionStatus?.onboarding_status ?? null

  if (phase >= 2 && health.productionStatusReadable && productionStatus !== 'production_connected') {
    return {
      label: productionStatus === 'disconnected' ? t('status.disconnected') : t('status.notConnected'),
      detail: t('openZatca'),
      tone: 'neutral',
      icon: ShieldAlert,
    }
  }

  if (health.failed.length > 0) {
    return {
      label: t('status.needsAttention'),
      detail: t('someInvoicesFailed'),
      tone: 'danger',
      icon: AlertTriangle,
    }
  }

  if (health.pending.length > 0) {
    return {
      label: t('status.pendingReports'),
      detail: t('openInvoicesToRetry'),
      tone: 'warning',
      icon: Clock,
    }
  }

  return {
    label: t('status.healthy'),
    detail: t('allGood'),
    tone: 'success',
    icon: CheckCircle2,
  }
}

function badgeClasses(tone: HealthTone): string {
  if (tone === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  if (tone === 'warning') return 'bg-amber-50 text-amber-700 border-amber-100'
  if (tone === 'danger') return 'bg-red-50 text-red-700 border-red-100'
  return 'bg-gray-50 text-gray-600 border-gray-100'
}

function countCreditNotes(rows: InvoiceHealthRow[]): number {
  return rows.filter(row => row.zatca_invoice_type === 'credit_note').length
}

export default function OperationsPage() {
  const { t } = useTranslation('operations')
  const { profile } = useAuth()
  const role = String(profile?.role ?? '')
  const canView = ALLOWED_ROLES.has(role)
  const tenantId = profile?.tenant_id

  const [branches, setBranches] = useState<BranchRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceHealthRow[]>([])
  const [productionRows, setProductionRows] = useState<ProductionCredentialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [productionStatusReadable, setProductionStatusReadable] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!canView || !tenantId) {
        setLoading(false)
        return
      }

      setLoading(true)
      setLoadError(null)
      try {
        const [branchRes, invoiceRes, productionRes] = await Promise.all([
          supabase
            .from('branches')
            .select('id, name, city, is_active, zatca_phase')
            .eq('tenant_id', tenantId)
            .order('is_main_branch', { ascending: false })
            .order('name', { ascending: true }),
          supabase
            .from('invoices')
            .select('id, branch_id, invoice_number, invoice_date, created_at, zatca_invoice_type, zatca_status, zatca_submitted_at, status')
            .eq('tenant_id', tenantId)
            .neq('status', 'cancelled')
            .in('zatca_status', ['pending', 'failed', 'reported', 'cleared'])
            .order('created_at', { ascending: false })
            .limit(1000),
          (supabase as any)
            .from('zatca_production_credentials')
            .select('branch_id, onboarding_status, connected_at, disconnected_at, updated_at')
            .eq('tenant_id', tenantId)
            .eq('environment', 'production'),
        ])

        if (cancelled) return

        if (branchRes.error) throw branchRes.error
        if (invoiceRes.error) throw invoiceRes.error

        setBranches((branchRes.data ?? []) as BranchRow[])
        setInvoices((invoiceRes.data ?? []) as InvoiceHealthRow[])

        if (productionRes.error) {
          setProductionRows([])
          setProductionStatusReadable(false)
        } else {
          setProductionRows((productionRes.data ?? []) as ProductionCredentialRow[])
          setProductionStatusReadable(true)
        }
      } catch (err: any) {
        console.error('Unable to load operations health', err)
        if (!cancelled) setLoadError(t('loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [canView, tenantId, t])

  const healthRows = useMemo<BranchHealth[]>(() => {
    const productionByBranch = new Map(productionRows.map(row => [row.branch_id, row]))
    return branches.map(branch => {
      const branchInvoices = invoices.filter(row => row.branch_id === branch.id)
      const failed = branchInvoices.filter(row => row.zatca_status === 'failed')
      const pending = branchInvoices.filter(row => row.zatca_status === 'pending')
      const successful = branchInvoices
        .filter(row => row.zatca_status === 'reported' || row.zatca_status === 'cleared')
        .map(row => row.zatca_submitted_at ?? row.created_at)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())

      const unresolved = [...failed, ...pending]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      return {
        branch,
        productionStatus: productionByBranch.get(branch.id) ?? null,
        productionStatusReadable,
        failed,
        pending,
        lastSuccessfulAt: successful[0] ?? null,
        oldestUnresolved: unresolved[0] ?? null,
      }
    })
  }, [branches, invoices, productionRows, productionStatusReadable])

  const totals = useMemo(() => {
    return healthRows.reduce((acc, row) => {
      acc.failed += row.failed.length
      acc.pending += row.pending.length
      acc.needsConnection += (row.branch.zatca_phase ?? 1) >= 2
        && row.productionStatusReadable
        && row.productionStatus?.onboarding_status !== 'production_connected'
        ? 1
        : 0
      return acc
    }, { failed: 0, pending: 0, needsConnection: 0 })
  }, [healthRows])

  if (!canView) return <Navigate to={role === 'branch' ? '/branch' : '/dashboard'} replace />

  if (role === 'super_admin' && !tenantId) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
        <div className="card p-6">
          <p className="text-sm font-semibold text-gray-800">{t('tenantOnly')}</p>
          <p className="text-sm text-gray-500 mt-1">
            {t('tenantOnlyBody')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('subtitle')}</p>
        </div>
        <Link
          to="/zatca"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Settings size={14} />
          {t('goToZatca')}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label={t('failedReports')} value={totals.failed} tone={totals.failed > 0 ? 'danger' : 'success'} />
        <SummaryCard label={t('pendingReports')} value={totals.pending} tone={totals.pending > 0 ? 'warning' : 'success'} />
        <SummaryCard label={t('needsConnection')} value={totals.needsConnection} tone={totals.needsConnection > 0 ? 'neutral' : 'success'} />
      </div>

      {!productionStatusReadable && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('metadataUnavailable')}
        </div>
      )}

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        {t('supportGuidance')}
      </div>

      {loadError ? (
        <div className="card p-6 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-800">{t('loadError')}</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : healthRows.length === 0 ? (
        <div className="card p-10 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">{t('noBranches')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {healthRows.map(row => <BranchHealthCard key={row.branch.id} health={row} />)}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: HealthTone }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${badgeClasses(tone)}`}>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-black mt-1">{value}</p>
    </div>
  )
}

function BranchHealthCard({ health }: { health: BranchHealth }) {
  const { t, i18n } = useTranslation('operations')
  const badge = statusBadge(health, t)
  const locale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-GB'
  const Icon = badge.icon
  const failedCreditNotes = countCreditNotes(health.failed)
  const pendingCreditNotes = countCreditNotes(health.pending)
  const phase = health.branch.zatca_phase ?? 1
  const productionStatus = health.productionStatus?.onboarding_status ?? 'not_started'
  const productionLabel = phase >= 2 && !health.productionStatusReadable
    ? t('status.notReadable')
    : phase >= 2
      ? t(`production.${productionStatus}`, { defaultValue: t('unknown') })
      : t('status.notRequired')

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-gray-900" dir="auto">{health.branch.name}</h2>
            {!health.branch.is_active && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{t('status.inactive')}</span>
            )}
            {health.branch.city && <span className="text-xs text-gray-400" dir="auto">{health.branch.city}</span>}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {phase >= 2 && !health.productionStatusReadable
              ? t('phase2Unreadable')
              : phase >= 2
              ? t(productionStatus === 'production_connected' ? 'phase2Connected' : 'phase2NotConnected')
              : t('phase1QrOnly')}
          </p>
        </div>

        <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${badgeClasses(badge.tone)}`}>
          <Icon size={15} />
          <div>
            <p className="text-xs font-bold">{badge.label}</p>
            <p className="text-[10px] opacity-80">{badge.detail}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Metric label={t('status.failed')} value={health.failed.length} sub={t('creditNotes', { count: failedCreditNotes })} tone={health.failed.length > 0 ? 'danger' : 'success'} />
        <Metric label={t('status.pending')} value={health.pending.length} sub={t('creditNotes', { count: pendingCreditNotes })} tone={health.pending.length > 0 ? 'warning' : 'success'} />
        <Metric label={t('lastSuccessful')} value={fmtDateTime(health.lastSuccessfulAt, locale, t)} small />
        <Metric label={t('productionLabel')} value={productionLabel} small />
      </div>

      {health.oldestUnresolved ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-800">
              {t('oldestUnresolved', { number: health.oldestUnresolved.invoice_number })}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {docLabel(health.oldestUnresolved.zatca_invoice_type, t)} · {t(`status.${health.oldestUnresolved.zatca_status}`, { defaultValue: t('unknown') })} · {fmtDateTime(health.oldestUnresolved.created_at, locale, t)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/invoices/${health.oldestUnresolved.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink size={12} />
              {t('openInvoice')}
            </Link>
            <Link
              to="/invoices"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={12} />
              {t('viewAffected')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-600" />
          <p className="text-xs font-semibold text-emerald-800">{t('allGood')}</p>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
  small = false,
}: {
  label: string
  value: number | string
  sub?: string
  tone?: HealthTone
  small?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`${small ? 'text-xs font-bold' : 'text-xl font-black'} mt-1 ${tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-emerald-600' : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
