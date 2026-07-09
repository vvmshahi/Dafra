import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Clock, ExternalLink, FileText,
  RefreshCw, Settings, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

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

function fmtDateTime(value: string | null): string {
  if (!value) return 'None yet'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function docLabel(value: ZatcaDocumentType): string {
  if (value === 'credit_note') return 'Credit note'
  if (value === 'debit_note') return 'Debit note'
  return 'Invoice'
}

function statusBadge(health: BranchHealth): { label: string; detail: string; tone: HealthTone; icon: typeof CheckCircle2 } {
  const phase = health.branch.zatca_phase ?? 1
  const productionStatus = health.productionStatus?.onboarding_status ?? null

  if (phase >= 2 && health.productionStatusReadable && productionStatus !== 'production_connected') {
    return {
      label: productionStatus === 'disconnected' ? 'Disconnected' : 'Not connected',
      detail: 'Open ZATCA',
      tone: 'neutral',
      icon: ShieldAlert,
    }
  }

  if (health.failed.length > 0) {
    return {
      label: 'Needs attention',
      detail: 'Some invoices failed',
      tone: 'danger',
      icon: AlertTriangle,
    }
  }

  if (health.pending.length > 0) {
    return {
      label: 'Pending reports',
      detail: 'Open invoices to retry',
      tone: 'warning',
      icon: Clock,
    }
  }

  return {
    label: 'Healthy',
    detail: 'All good',
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
        if (!cancelled) setLoadError(err?.message ?? 'Unable to load operations health')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [canView, tenantId])

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
        <h1 className="text-xl font-bold text-gray-900">Operations</h1>
        <div className="card p-6">
          <p className="text-sm font-semibold text-gray-800">Tenant-scoped health only</p>
          <p className="text-sm text-gray-500 mt-1">
            This pilot page does not include a cross-tenant super-admin console. Open a tenant context before reviewing branch ZATCA health.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Operations</h1>
          <p className="text-sm text-gray-400 mt-0.5">Pilot ZATCA health by branch</p>
        </div>
        <Link
          to="/zatca"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Settings size={14} />
          Go to ZATCA
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Failed reports" value={totals.failed} tone={totals.failed > 0 ? 'danger' : 'success'} />
        <SummaryCard label="Pending reports" value={totals.pending} tone={totals.pending > 0 ? 'warning' : 'success'} />
        <SummaryCard label="Needs connection" value={totals.needsConnection} tone={totals.needsConnection > 0 ? 'neutral' : 'success'} />
      </div>

      {!productionStatusReadable && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Production connection metadata is not readable from the browser in this environment. Invoice health is still shown from existing invoice records.
        </div>
      )}

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        If repeated failures continue, contact support with the branch name and invoice number.
      </div>

      {loadError ? (
        <div className="card p-6 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-800">Unable to load operations health</p>
          <p className="text-sm text-gray-500 mt-1">{loadError}</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : healthRows.length === 0 ? (
        <div className="card p-10 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No branches found</p>
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
  const badge = statusBadge(health)
  const Icon = badge.icon
  const failedCreditNotes = countCreditNotes(health.failed)
  const pendingCreditNotes = countCreditNotes(health.pending)
  const phase = health.branch.zatca_phase ?? 1
  const productionStatus = health.productionStatus?.onboarding_status ?? 'not_started'
  const productionLabel = phase >= 2 && !health.productionStatusReadable
    ? 'not readable'
    : phase >= 2
      ? productionStatus.replace(/_/g, ' ')
      : 'not required'

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">{health.branch.name}</h2>
            {!health.branch.is_active && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
            )}
            {health.branch.city && <span className="text-xs text-gray-400">{health.branch.city}</span>}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {phase >= 2 && !health.productionStatusReadable
              ? 'Phase 2 · Production status not readable'
              : phase >= 2
              ? `Phase 2 · ${productionStatus === 'production_connected' ? 'Production connected' : 'Production not connected'}`
              : 'Phase 1 · QR invoices only'}
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
        <Metric label="Failed" value={health.failed.length} sub={`${failedCreditNotes} credit note${failedCreditNotes !== 1 ? 's' : ''}`} tone={health.failed.length > 0 ? 'danger' : 'success'} />
        <Metric label="Pending" value={health.pending.length} sub={`${pendingCreditNotes} credit note${pendingCreditNotes !== 1 ? 's' : ''}`} tone={health.pending.length > 0 ? 'warning' : 'success'} />
        <Metric label="Last successful report" value={fmtDateTime(health.lastSuccessfulAt)} small />
        <Metric label="Production" value={productionLabel} small />
      </div>

      {health.oldestUnresolved ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-800">
              Oldest unresolved: {health.oldestUnresolved.invoice_number}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {docLabel(health.oldestUnresolved.zatca_invoice_type)} · {health.oldestUnresolved.zatca_status} · {fmtDateTime(health.oldestUnresolved.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/invoices/${health.oldestUnresolved.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink size={12} />
              Open invoice
            </Link>
            <Link
              to="/invoices"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={12} />
              View affected invoices
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-600" />
          <p className="text-xs font-semibold text-emerald-800">All good</p>
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
