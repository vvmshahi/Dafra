/**
 * ZATCA Phase 2 — Settings Tab
 *
 * Per-branch certificate management:
 *   - Production uses backend-only onboarding through zatca-onboard-production.
 *   - Legacy sandbox certificate rows are displayed as safe metadata only.
 *
 * Each branch operates independently and maintains separate certs per environment.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ShieldX, ShieldAlert, Clock, Building2,
  CheckCircle2, AlertTriangle, ExternalLink, Lock,
  Loader2, Info, ChevronDown,
  Cpu, Wifi, FlaskConical, X, Trash2, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import {
  getProductionOnboardingStatus,
  disconnectProductionZatca,
  onboardProductionZatca,
  preflightProductionZatca,
  listZatcaCertificateStatus,
  type ProductionOnboardingResponse,
  type ProductionOnboardingTraceEntry,
  type ProductionOnboardingStatus,
  type SafeZatcaCertificateStatus,
  type ZatcaFunctionalityMap,
} from '@/lib/zatca/api'
import { getCachedProductionStatus, readCachedProductionStatus, writeCachedProductionStatus } from '@/lib/zatca/status'
import type { Branch, CertificateStatus } from '@/types'

/* ── Types ───────────────────────────────────────────────────────────────── */

type BranchWithCert = Branch & {
  allCerts: SafeZatcaCertificateStatus[]
  productionStatus?: ProductionOnboardingResponse | null
}

/* ── Status config ───────────────────────────────────────────────────────── */

const CERT_CONFIG: Record<CertificateStatus, {
  icon: React.ElementType
  variant: 'success' | 'warning' | 'danger' | 'neutral'
  label: string
}> = {
  pending:    { icon: Clock,       variant: 'warning', label: 'Pending' },
  compliance: { icon: ShieldCheck, variant: 'warning', label: 'Compliance' },
  active:     { icon: ShieldCheck, variant: 'success', label: 'Active' },
  revoked:    { icon: ShieldX,     variant: 'danger',  label: 'Revoked' },
  expired:    { icon: ShieldAlert, variant: 'danger',  label: 'Expired' },
}

/* ── Tiny helpers ────────────────────────────────────────────────────────── */

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50/80 rounded-xl px-3 py-2 ring-1 ring-gray-100">
      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
      <p className={`text-xs text-gray-800 mt-1 truncate ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</p>
    </div>
  )
}

/* ── Guide modal (FIX 5) ─────────────────────────────────────────────────── */

function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-primary-500" />
            <h3 className="text-sm font-bold text-gray-900">ZATCA e-Invoicing Guide</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center mt-0.5">
              <CheckCircle2 size={13} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800">Phase 1 — QR Code (فاتورة)</p>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                Invoices include a TLV QR code with seller details.
                No internet connection to ZATCA required.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center mt-0.5">
              <ShieldCheck size={13} className="text-primary-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800">Phase 2 — Integration (ربط)</p>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                Invoices are digitally signed and reported to ZATCA within 24 hours.
                Requires certificate setup.
              </p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Phase 2 Setup Steps</p>
            {[
              'Generate Security Certificate (this page)',
              'Register device in Fatoorah portal → get OTP',
              'Enter OTP → ZATCA issues compliance certificate',
              'Activate → invoices now automatically reported',
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary-100 text-[9px] font-bold text-primary-700 flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-[11px] text-gray-600">{s}</p>
              </div>
            ))}
          </div>

          <a
            href="https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 pt-1"
          >
            <ExternalLink size={12} /> ZATCA Official Documentation
          </a>
        </div>
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Legacy sandbox status ───────────────────────────────────────────────── */

function LegacySandboxStatusPanel({
  cert,
  productionConnected,
}: {
  cert: SafeZatcaCertificateStatus | null
  productionConnected: boolean
}) {
  if (!cert) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
          <Info size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-gray-800">No sandbox certificate metadata</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Browser-based sandbox certificate setup is no longer available from this page.
              Use the production onboarding flow for live Phase 2 connectivity.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const activatedDate = cert.activated_at
    ? new Date(cert.activated_at).toLocaleDateString('en-SA', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
  const lastUpdated = formatDateTime(cert.updated_at ?? cert.created_at)

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl p-4 ${
        productionConnected
          ? 'bg-gray-50 border border-gray-100'
          : cert.status === 'active'
          ? 'bg-amber-50 border border-amber-100'
          : 'bg-gray-50 border border-gray-100'
      }`}>
        <Info size={15} className={productionConnected ? 'text-gray-500 mt-0.5 flex-shrink-0' : 'text-amber-600 mt-0.5 flex-shrink-0'} />
        <div>
          <p className="text-xs font-semibold text-gray-800">Sandbox certificate metadata</p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
            Legacy sandbox setup is read-only here. Sensitive certificate material is not loaded in the browser.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoRow
          label="Certificate Row"
          value={cert.certificate_exists ? 'Exists' : 'Not found'}
        />
        <InfoRow
          label="Active Certificate"
          value={cert.status === 'active' ? 'Active' : 'Not active'}
        />
        <InfoRow
          label="Environment"
          value={cert.environment === 'production' ? 'Production' : 'Sandbox'}
        />
        <InfoRow
          label="Activated"
          value={activatedDate}
        />
        <InfoRow
          label="Invoice Counter"
          value={String(cert.invoice_counter ?? 0)}
        />
        <InfoRow
          label="Status"
          value={CERT_CONFIG[cert.status]?.label ?? cert.status}
        />
        <InfoRow
          label="Updated"
          value={lastUpdated}
        />
        <InfoRow
          label="Serial Number"
          value={cert.serial_number ?? '—'}
          mono
        />
      </div>

    </div>
  )
}

/* ── Production onboarding orchestrator ─────────────────────────────────── */

const PRODUCTION_STEPS: Array<{ key: ProductionOnboardingStatus; label: string }> = [
  { key: 'generating_csr', label: 'Generate CSR' },
  { key: 'compliance_csid_requested', label: 'Compliance request' },
  { key: 'compliance_samples_passed', label: 'Sample invoices' },
  { key: 'production_csid_requested', label: 'Production request' },
  { key: 'production_connected', label: 'Connected' },
]

const FUNCTIONALITY_OPTIONS: Array<{
  value: ZatcaFunctionalityMap
  label: string
  hint: string
}> = [
  { value: '0100', label: 'Simplified/B2C only', hint: 'POS and retail invoices' },
  { value: '1000', label: 'Standard/B2B only', hint: 'Tax invoices for business buyers' },
  { value: '1100', label: 'Both', hint: 'Standard and simplified invoices' },
]

const DISCONNECT_CONFIRMATION = 'DELETE ZATCA CONNECTION'
const SHOW_ZATCA_TRACE = import.meta.env.DEV && import.meta.env.VITE_SHOW_ZATCA_DEBUG_TRACE === 'true'

function functionalityLabel(value?: ZatcaFunctionalityMap | string): string {
  return FUNCTIONALITY_OPTIONS.find(option => option.value === value)?.label ?? 'Not selected'
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-SA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function safeStatusText(value?: string | null): string {
  if (!value) return '—'
  return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function stepComplete(status: ProductionOnboardingStatus | undefined, step: ProductionOnboardingStatus): boolean {
  if (!status || status === 'failed' || status === 'compliance_failed' || status === 'not_started' || status === 'disconnected') return false
  return PRODUCTION_STEPS.findIndex(item => item.key === status) >=
    PRODUCTION_STEPS.findIndex(item => item.key === step)
}

function formatSampleType(type: string): string {
  return type.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function formatTraceStage(stage: string): string {
  return stage.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function formatTraceMessages(values: ProductionOnboardingTraceEntry['errors']): string | null {
  if (!values?.length) return null
  return values
    .map(item => [item.code, item.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ') || null
}

function ZatcaDebugTrace({ trace }: { trace?: ProductionOnboardingTraceEntry[] }) {
  const [open, setOpen] = useState(true)
  if (!SHOW_ZATCA_TRACE || !trace?.length) return null

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div>
          <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wide">Development</p>
          <p className="text-xs font-semibold text-amber-900">ZATCA Trace</p>
        </div>
        <ChevronDown size={14} className={`text-amber-800 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-amber-200 bg-white/60 p-3 space-y-2">
          {trace.map((entry, index) => {
            const errors = formatTraceMessages(entry.errors)
            const warnings = formatTraceMessages(entry.warnings)
            const color =
              entry.status === 'success' ? 'text-emerald-700' :
              entry.status === 'failed' ? 'text-red-700' :
              entry.status === 'skipped' ? 'text-gray-500' :
              'text-amber-700'
            return (
              <div key={`${entry.stage}-${index}`} className="rounded-lg border border-amber-100 bg-white px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-semibold text-gray-800">{formatTraceStage(entry.stage)}</p>
                  <span className={`text-[10px] font-bold uppercase ${color}`}>{entry.status}</span>
                </div>
                <pre className="mt-1 text-[10px] leading-relaxed text-gray-600 whitespace-pre-wrap font-mono">
{[
  entry.timestamp,
  entry.message,
  entry.httpStatus ? `HTTP ${entry.httpStatus}` : undefined,
  warnings ? `Warnings: ${warnings}` : undefined,
  errors ? `Errors: ${errors}` : undefined,
].filter(Boolean).join('\n')}
                </pre>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProductionConnectionStatus({
  branch,
  status,
  onReconnect,
  onRemove,
}: {
  branch: BranchWithCert
  status: ProductionOnboardingResponse
  onReconnect: () => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
        <ShieldCheck size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-800">Connected to ZATCA Production / FATOORA</p>
          <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
            This branch can submit Phase 2 invoices through its stored production connection.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoRow label="Branch" value={branch.name} />
        <InfoRow label="VAT Number" value={branch.vat_number || '—'} mono />
        <InfoRow label="CR Number" value={branch.cr_number || '—'} mono />
        <InfoRow label="Environment" value="Production" />
        <InfoRow label="Functionality" value={functionalityLabel(status.functionalityMap)} />
        <InfoRow label="Connected At" value={formatDateTime(status.connectedAt)} />
        <InfoRow label="Production CSID" value={status.productionCsidExists ? 'Stored' : 'Missing'} />
        <InfoRow label="Status" value={safeStatusText(status.onboardingStatus)} />
        <InfoRow label="Last Updated" value={formatDateTime(status.updatedAt)} />
      </div>

      <div className="rounded-2xl border border-gold-200 bg-gold-50 px-3.5 py-3">
        <p className="text-[11px] text-gold-900 leading-relaxed">
          Production onboarding can stay disabled for normal live use. Existing connected branches continue to submit invoices;
          only onboarding or re-onboarding requires the production onboarding feature flag.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onReconnect}
          className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 transition-colors"
        >
          <RefreshCw size={13} />
          Reconnect / Re-onboard
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
          Remove local connection
        </button>
      </div>
    </div>
  )
}

function DisconnectedStatus({
  branch,
  status,
}: {
  branch: BranchWithCert
  status: ProductionOnboardingResponse
}) {
  return (
    <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
      <ShieldX size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold text-gray-800">Local ZATCA production connection removed</p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
          {branch.name} will not submit invoices through this local connection. The FATOORA device may still exist in the portal.
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Removed: {formatDateTime(status.disconnectedAt)}
        </p>
      </div>
    </div>
  )
}

function DisconnectConnectionModal({
  branch,
  loading,
  error,
  phrase,
  onPhraseChange,
  onCancel,
  onConfirm,
}: {
  branch: BranchWithCert
  loading: boolean
  error: string | null
  phrase: string
  onPhraseChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const canConfirm = phrase === DISCONNECT_CONFIRMATION && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Trash2 size={15} className="text-red-500" />
            <h3 className="text-sm font-bold text-gray-900">Remove local ZATCA connection</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3.5">
            <p className="text-xs font-semibold text-red-800">This affects only {branch.name}.</p>
            <p className="mt-1 text-[11px] leading-relaxed text-red-700">
              This removes the production credentials from Kubri and stops this branch from submitting invoices through this connection.
              It may not remove or revoke the device from the FATOORA portal. Manage the device in FATOORA separately if required.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-gray-700">
              Type <span className="font-mono text-red-600">{DISCONNECT_CONFIRMATION}</span> to confirm.
            </p>
            <input
              value={phrase}
              onChange={event => onPhraseChange(event.target.value)}
              className="input mt-2 font-mono text-sm"
              placeholder={DISCONNECT_CONFIRMATION}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-red-500" />
              <p className="text-[11px] leading-relaxed text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Remove connection
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductionOnboardingPanel({
  branch,
  initialStatus,
  onStatusChange,
}: {
  branch: BranchWithCert
  initialStatus?: ProductionOnboardingResponse | null
  onStatusChange: (status: ProductionOnboardingResponse) => void
}) {
  const { profile } = useAuth()
  const [otp, setOtp] = useState('')
  const [functionalityMap, setFunctionalityMap] = useState<ZatcaFunctionalityMap | ''>('')
  const [dryRun, setDryRun] = useState(true)
  const [status, setStatus] = useState<ProductionOnboardingResponse | null>(initialStatus ?? null)
  const [loading, setLoading] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [showReconnect, setShowReconnect] = useState(false)
  const [showDisconnect, setShowDisconnect] = useState(false)
  const [disconnectPhrase, setDisconnectPhrase] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isOwner = profile?.role === 'owner'
  const currentStatus = status?.onboardingStatus ?? 'not_started'
  const isConnected = currentStatus === 'production_connected'
  const isDisconnected = currentStatus === 'disconnected'
  const showOnboardingForm = !isConnected || showReconnect

  useEffect(() => {
    setStatus(initialStatus ?? null)
    if (initialStatus?.functionalityMap) setFunctionalityMap(initialStatus.functionalityMap)
  }, [initialStatus])

  useEffect(() => {
    let mounted = true
    async function loadStatus() {
      if (!isOwner) return
      setStatusLoading(true)
      setError(null)
      try {
        const res = await getProductionOnboardingStatus(branch.id)
        if (mounted) {
          setStatus(res)
          if (res.functionalityMap) setFunctionalityMap(res.functionalityMap)
          onStatusChange(res)
        }
      } catch (err: any) {
        if (mounted) setError(err.message ?? 'Unable to load production onboarding status')
      } finally {
        if (mounted) setStatusLoading(false)
      }
    }
    loadStatus()
    return () => { mounted = false }
  }, [branch.id, isOwner, onStatusChange])

  const connect = async () => {
    if (!isOwner) {
      setError('Only the tenant owner can connect ZATCA production.')
      return
    }
    if (isConnected && !showReconnect) {
      setError('This branch is already connected. Open the advanced reconnect action before replacing production credentials.')
      return
    }
    if (isConnected && showReconnect && !window.confirm(
      'Reconnect / Re-onboard may replace the production credentials used for invoice submission. Continue?'
    )) {
      return
    }
    if (!/^[0-9]{6}$/.test(otp)) {
      setError('Enter the 6-digit OTP from the FATOORA portal.')
      return
    }
    if (!functionalityMap) {
      setError('Choose what this billing system will issue before connecting to ZATCA production.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await onboardProductionZatca({
        branchId: branch.id,
        otp,
        functionalityMap,
        dryRun,
        forceReconnect: isConnected && showReconnect,
      })
      setStatus(res)
      onStatusChange(res)
      setOtp('')
      if (res.onboardingStatus === 'production_connected') setShowReconnect(false)
    } catch (err: any) {
      const payload = err?.payload as ProductionOnboardingResponse | undefined
      if (payload?.trace) {
        const nextStatus = {
          ok: false,
          branchId: branch.id,
          environment: 'production',
          onboardingStatus: payload.onboardingStatus ?? 'failed',
          functionalityMap: payload.functionalityMap ?? (functionalityMap || undefined),
          complianceSampleResults: payload.complianceSampleResults,
          trace: payload.trace,
        }
        setStatus(nextStatus)
        onStatusChange(nextStatus)
      }
      setError(err.message ?? 'ZATCA production onboarding failed')
    } finally {
      setLoading(false)
    }
  }

  const runPreflight = async () => {
    if (!isOwner) {
      setError('Only the tenant owner can run ZATCA production preflight.')
      return
    }
    if (!functionalityMap) {
      setError('Choose what this billing system will issue before running preflight.')
      return
    }
    setPreflightLoading(true)
    setError(null)
    try {
      const res = await preflightProductionZatca({
        branchId: branch.id,
        functionalityMap,
      })
      setStatus(res)
      onStatusChange(res)
    } catch (err: any) {
      const payload = err?.payload as ProductionOnboardingResponse | undefined
      if (payload?.trace) {
        const nextStatus = {
          ok: false,
          preflight: true,
          branchId: branch.id,
          environment: 'production',
          onboardingStatus: payload.onboardingStatus ?? 'failed',
          functionalityMap: payload.functionalityMap ?? functionalityMap,
          trace: payload.trace,
        }
        setStatus(nextStatus)
        onStatusChange(nextStatus)
      }
      setError(err.message ?? 'ZATCA production preflight failed')
    } finally {
      setPreflightLoading(false)
    }
  }

  const removeLocalConnection = async () => {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      const res = await disconnectProductionZatca({
        branchId: branch.id,
        confirmation: disconnectPhrase,
      })
      setStatus(res)
      onStatusChange(res)
      setShowDisconnect(false)
      setDisconnectPhrase('')
      setShowReconnect(false)
    } catch (err: any) {
      setDisconnectError(err.message ?? 'Unable to remove local ZATCA connection')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-4">
      {showDisconnect && (
        <DisconnectConnectionModal
          branch={branch}
          loading={disconnecting}
          error={disconnectError}
          phrase={disconnectPhrase}
          onPhraseChange={setDisconnectPhrase}
          onCancel={() => {
            if (disconnecting) return
            setShowDisconnect(false)
            setDisconnectPhrase('')
            setDisconnectError(null)
          }}
          onConfirm={removeLocalConnection}
        />
      )}

      {!isOwner && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <Lock size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-800">
            Production onboarding is restricted to the tenant owner.
          </p>
        </div>
      )}

      {statusLoading && !status && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <Loader2 size={14} className="animate-spin text-gray-400" />
          <p className="text-[11px] font-medium text-gray-500">Checking ZATCA production connection...</p>
        </div>
      )}

      {isConnected && status && !showReconnect && (
        <ProductionConnectionStatus
          branch={branch}
          status={status}
          onReconnect={() => {
            setShowReconnect(true)
            setError(null)
          }}
          onRemove={() => {
            setShowDisconnect(true)
            setDisconnectError(null)
            setDisconnectPhrase('')
          }}
        />
      )}

      {isDisconnected && status && !showReconnect && (
        <DisconnectedStatus branch={branch} status={status} />
      )}

      {showOnboardingForm && !(statusLoading && !status) && (
        <>
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
            <ShieldCheck size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-emerald-800">
                {isConnected ? 'Advanced reconnect / re-onboard' : 'Production setup'}
              </p>
              <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
                Log in to FATOORA portal, generate OTP from Onboard New Solution Unit/Device,
                paste OTP here within 1 hour.
              </p>
            </div>
          </div>

          {isConnected && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-xs font-semibold text-amber-900">Reconnect warning</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                Re-onboarding may replace this branch&apos;s production credentials and can affect invoice submission.
                Continue only when you intentionally created a new OTP in FATOORA.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Invoice capability</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Choose what this billing system will issue. For normal retail/POS invoices, usually choose Simplified/B2C only.
              If you issue tax invoices to VAT-registered businesses, choose Standard/B2B or Both.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {FUNCTIONALITY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFunctionalityMap(option.value)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    functionalityMap === option.value
                      ? 'border-primary-300 bg-primary-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <span className="block text-xs font-semibold text-gray-800">{option.label}</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">FATOORA OTP</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={event => setOtp(event.target.value.replace(/\D/g, '').substring(0, 6))}
              disabled={!isOwner || loading}
              className="input text-center text-2xl font-mono disabled:opacity-50"
            />
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={event => setDryRun(event.target.checked)}
                disabled={!isOwner || loading}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Dry run only. Do not call ZATCA production.
            </label>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-700 leading-relaxed whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {showOnboardingForm && !(statusLoading && !status) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={runPreflight}
            disabled={!isOwner || preflightLoading || loading || !functionalityMap}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-amber-200 text-amber-800 text-sm font-semibold hover:bg-amber-50 disabled:opacity-50 transition-colors"
          >
            {preflightLoading ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            {preflightLoading ? 'Running preflight…' : 'Preflight only'}
          </button>

          <button
            onClick={connect}
            disabled={!isOwner || loading || preflightLoading || otp.length !== 6 || !functionalityMap}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {loading ? 'Connecting to ZATCA…' : isConnected ? 'Reconnect Production' : 'Connect to ZATCA Production'}
          </button>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Safe status</p>
          {statusLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          {PRODUCTION_STEPS.map(step => {
            const done = stepComplete(currentStatus, step.key) ||
              (status?.steps?.includes(step.key) ?? false)
            return (
              <div
                key={step.key}
                className={`rounded-xl border px-2.5 py-2 text-center ${
                  done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`}
              >
                <CheckCircle2 size={13} className="mx-auto mb-1" />
                <p className="text-[10px] font-semibold">{step.label}</p>
              </div>
            )
          })}
        </div>
        {status?.complianceSampleResults?.length ? (
          <div className="space-y-1.5">
            {status.complianceSampleResults.map(result => (
              <div key={result.type} className="flex items-center justify-between text-[11px] bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-600">{formatSampleType(result.type)}</span>
                <span className={`font-semibold ${result.status === 'accepted' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {result.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {status?.message && (
          <p className="text-[11px] text-gray-500 leading-relaxed">{status.message}</p>
        )}
        <ZatcaDebugTrace trace={status?.trace} />
      </div>
    </div>
  )
}

/* ── Branch accordion row (FIX 2) ────────────────────────────────────────── */

function branchSummaryText(bc: BranchWithCert): string {
  const phase = bc.zatca_phase ?? 1
  if (phase < 2) return 'Phase 1 — QR code only'
  if (bc.productionStatus === undefined) return 'Checking ZATCA production status'
  if (bc.productionStatus?.onboardingStatus === 'production_connected') {
    return 'Connected to ZATCA Production / FATOORA'
  }
  if (bc.productionStatus?.onboardingStatus === 'disconnected') {
    return 'Local production connection removed'
  }
  const bestCert = (
    bc.allCerts.find(c => c.status === 'active') ??
    bc.allCerts.find(c => c.status === 'compliance') ??
    bc.allCerts[0] ??
    null
  )
  if (!bestCert) return 'Production onboarding available'
  if (bestCert.status === 'active') return 'Sandbox metadata: active'
  if (bestCert.status === 'compliance') return 'Sandbox metadata: compliance issued'
  if (bestCert.certificate_exists) return 'Sandbox metadata available'
  return 'Production onboarding available'
}

function BranchAccordionRow({
  bc, isExpanded, onToggle, onProductionStatusUpdate,
}: {
  bc: BranchWithCert
  isExpanded: boolean
  onToggle: () => void
  onProductionStatusUpdate: (branchId: string, status: ProductionOnboardingResponse) => void
}) {
  const phase = bc.zatca_phase ?? 1
  const productionConnected = bc.productionStatus?.onboardingStatus === 'production_connected'
  const productionDisconnected = bc.productionStatus?.onboardingStatus === 'disconnected'

  // Best cert for the collapsed summary badges
  const bestCert = (
    bc.allCerts.find(c => c.status === 'active') ??
    bc.allCerts.find(c => c.status === 'compliance') ??
    bc.allCerts[0] ??
    null
  )
  const status = bestCert?.status ?? 'pending'
  const cfg    = CERT_CONFIG[status] ?? CERT_CONFIG.pending
  const summaryCfg = productionConnected
    ? { variant: 'success' as const, label: 'Connected' }
    : productionDisconnected
    ? { variant: 'neutral' as const, label: 'Disconnected' }
    : cfg

  // Full card state (only needed when expanded)
  const initialEnv = (
    productionConnected || productionDisconnected ? 'production' :
    bc.allCerts.find(c => c.status === 'active')?.environment ??
    bc.allCerts.find(c => c.status === 'compliance')?.environment ??
    bc.allCerts[0]?.environment ??
    'sandbox'
  ) as 'sandbox' | 'production'
  const [environment,  setEnvironment]  = useState<'sandbox' | 'production'>(initialEnv)

  const cert     = bc.allCerts.find(c => c.environment === environment) ?? null
  const isEnvironmentLocked = productionConnected
  const handleProductionStatusChange = useCallback((nextStatus: ProductionOnboardingResponse) => {
    onProductionStatusUpdate(bc.id, nextStatus)
  }, [bc.id, onProductionStatusUpdate])

  return (
    <div className="card overflow-hidden transition-all duration-150 hover:border-primary-100 hover:shadow-card-md">
      {/* Collapsed header row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-primary-50/50 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-2xl bg-primary-50 ring-1 ring-primary-100 flex items-center justify-center flex-shrink-0">
          <Building2 size={16} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-gray-950 truncate">{bc.name}</p>
          <p className="text-[11px] text-gray-500 mt-1 truncate">{branchSummaryText(bc)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {phase >= 2 && (productionConnected || bestCert) && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              productionConnected
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {productionConnected ? 'Production' : 'Sandbox'}
            </span>
          )}
          {phase >= 2 && <Badge variant={summaryCfg.variant} dot>{summaryCfg.label}</Badge>}
          {phase < 2 && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Phase 1
            </span>
          )}
          <ChevronDown
            size={15}
            className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-white p-5 space-y-5">
          {/* Phase 1 — info card (FIX 4) */}
          {phase < 2 ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-primary-50 border border-primary-100 rounded-2xl p-4">
                <Info size={14} className="text-primary-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-primary-900">This branch is on Phase 1</p>
                  <p className="text-[11px] text-primary-800 leading-relaxed">
                    Phase 1 invoices include a ZATCA QR code with seller details.
                    No certificate registration is required.
                  </p>
                  <p className="text-[11px] text-primary-800 leading-relaxed">
                    Upgrade to Phase 2 to enable digital signing and automatic ZATCA reporting.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const el = document.querySelector('[data-tab="subscription"]') as HTMLElement | null
                  el?.click()
                }}
                className="w-full py-2.5 rounded-xl border border-primary-200 text-primary-700 text-sm font-semibold hover:bg-primary-50 transition-colors"
              >
                Upgrade to Phase 2 →
              </button>
            </div>
          ) : (
            <>
              {/* Environment toggle / locked */}
              <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/80 px-3.5 py-3">
                <p className="text-[11px] text-gray-500">Environment</p>
                {isEnvironmentLocked ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-gray-200 bg-gray-50 text-gray-500">
                    <Lock size={9} />
                    {environment === 'production' ? 'Production' : 'Sandbox'} — Locked
                  </span>
                ) : (
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
                    <button
                      onClick={() => setEnvironment('sandbox')}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                        environment === 'sandbox'
                          ? 'bg-amber-400 text-amber-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Sandbox
                    </button>
                    <button
                      onClick={() => setEnvironment('production')}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                        environment === 'production'
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Production
                    </button>
                  </div>
                )}
              </div>

              {environment === 'production' ? (
                <div className="rounded-2xl border border-gray-100 p-4">
                  <ProductionOnboardingPanel
                    branch={bc}
                    initialStatus={bc.productionStatus}
                    onStatusChange={handleProductionStatusChange}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-100 p-4">
                  <LegacySandboxStatusPanel
                    cert={cert}
                    productionConnected={productionConnected}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────────────────── */

export default function ZatcaTab() {
  const { profile } = useAuth()
  const [data, setData]         = useState<BranchWithCert[]>([])
  const [loading, setLoading]   = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showGuide, setShowGuide]   = useState(false)

  const load = useCallback(async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    const tid = profile.tenant_id
    const [branchesRes, certs] = await Promise.all([
      (supabase as any).from('branches').select('*').eq('tenant_id', tid)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true }),
      listZatcaCertificateStatus(),
    ])
    const branches = (branchesRes.data as Branch[]) ?? []
    const productionStatuses = new Map<string, ProductionOnboardingResponse | null>()
    if (profile.role === 'owner') {
      await Promise.all(branches
        .filter(branch => (branch.zatca_phase ?? 1) === 2)
        .map(async branch => {
          const cached = readCachedProductionStatus(branch.id)
          if (cached) productionStatuses.set(branch.id, cached)
          try {
            productionStatuses.set(branch.id, await getCachedProductionStatus(branch.id))
          } catch {
            if (!cached) productionStatuses.delete(branch.id)
          }
        }))
    }
    setData(branches.map(b => ({
      ...b,
      allCerts: certs.filter(c => c.tenant_id === tid && c.branch_id === b.id),
      productionStatus: productionStatuses.has(b.id) ? productionStatuses.get(b.id) ?? null : undefined,
    })))
    // Auto-expand first branch if only one
    setExpandedId(prev => branches.length === 1 && !prev ? branches[0].id : prev)
    setLoading(false)
  }, [profile?.tenant_id, profile?.role])

  useEffect(() => { load() }, [load])

  const handleProductionStatusUpdate = useCallback((branchId: string, status: ProductionOnboardingResponse) => {
    writeCachedProductionStatus(branchId, status)
    setData(prev => prev.map(branch => (
      branch.id === branchId
        ? { ...branch, productionStatus: status }
        : branch
    )))
  }, [])

  const handleToggle = (branchId: string) => {
    setExpandedId(prev => prev === branchId ? null : branchId)
  }

  const phase2Count = data.filter(b => (b.zatca_phase ?? 1) === 2).length
  const activeCount = data.filter(b =>
    b.productionStatus?.onboardingStatus === 'production_connected' ||
    b.allCerts.some(c => c.status === 'active')
  ).length

  const phase2Branches  = data.filter(b => (b.zatca_phase ?? 1) === 2)
  const unknownProductionCount = phase2Branches.filter(b => b.productionStatus === undefined).length
  const allProduction   = phase2Branches.length > 0 &&
    phase2Branches.every(b => b.productionStatus?.onboardingStatus === 'production_connected')
  const showSandboxBanner = phase2Branches.length > 0 && unknownProductionCount === 0 && !allProduction

  return (
    <div className="space-y-5">
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}

      {/* Sandbox banner */}
      {showSandboxBanner && (
        <div className="flex items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3">
          <FlaskConical size={16} className="text-amber-900 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-bold text-gold-900 uppercase tracking-wide">Sandbox Mode - Not Live</p>
            <p className="text-[11px] text-gold-900/75 mt-0.5">
              Calls go to the ZATCA developer portal (test environment). No real invoices are submitted.
              Switch each branch to Production when ready to go live.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-gray-950">Branch ZATCA connections</h3>
          <p className="text-xs text-gray-500 mt-1">
            {data.length} branch{data.length !== 1 ? 'es' : ''} · {phase2Count} on Phase 2 · {activeCount} active
          </p>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          title="ZATCA e-Invoicing Guide"
        >
          <Info size={13} />
          Guide
        </button>
        </div>
      </div>

      {/* Branch list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="card h-14 animate-pulse bg-gray-50" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No branches configured</p>
          <p className="text-xs text-gray-400 mt-1">Add branches in the Branches page first</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(bc => (
            <BranchAccordionRow
              key={bc.id}
              bc={bc}
              isExpanded={expandedId === bc.id}
              onToggle={() => handleToggle(bc.id)}
              onProductionStatusUpdate={handleProductionStatusUpdate}
            />
          ))}
        </div>
      )}

      {data.some(b => !b.vat_number && (b.zatca_phase ?? 1) === 2) && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl p-4">
          <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Incomplete branch data</p>
            <p className="text-[11px] text-red-600 mt-0.5">
              Some Phase 2 branches are missing VAT number or address. Edit those branches to complete setup.
            </p>
          </div>
        </div>
      )}

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3.5 shadow-card">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <Lock size={14} />
        </div>
        <div>
          <p className="text-xs font-bold text-gray-900">Connection details are protected</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            Private keys are encrypted before storage, and ZATCA API credentials stay on the server instead of being exposed in the browser.
          </p>
        </div>
      </div>
    </div>
  )
}
