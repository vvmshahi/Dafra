/**
 * ZATCA Phase 2 — Settings Tab
 *
 * Per-branch certificate management:
 *   - Production uses backend-only onboarding through zatca-onboard-production.
 *
 * Each branch operates independently and maintains its production connection.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ShieldCheck, ShieldX, Building2,
  CheckCircle2, AlertTriangle, ExternalLink, Lock,
  Loader2, Info, ChevronDown,
  Cpu, Wifi, X, Trash2, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import ComplianceReadinessCard from '@/components/compliance/ComplianceReadinessCard'
import { ENABLE_OFFICIAL_SELLER_IDENTITY } from '@/lib/releaseFlags'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  getProductionOnboardingStatus,
  getSandboxDemoConnectionStatus,
  getSandboxDemoOnboardingStatus,
  runSandboxDemoOnboarding,
  activateSandboxDemoConnection,
  disconnectProductionZatca,
  isZatcaOtpRejection,
  onboardProductionZatca,
  ZatcaAuthError,
  type ProductionOnboardingResponse,
  type ProductionOnboardingTraceEntry,
  type ProductionOnboardingStatus,
  type ZatcaFunctionalityMap,
  type SandboxDemoConnectionStatus,
  type SandboxOnboardingStatus,
} from '@/lib/zatca/api'
import { getCachedProductionStatus, readCachedProductionStatus, writeCachedProductionStatus } from '@/lib/zatca/status'
import type { Branch } from '@/types'

/* ── Types ───────────────────────────────────────────────────────────────── */

type BranchWithCert = Branch & {
  productionStatus?: ProductionOnboardingResponse | null
}

const FATOORA_PORTAL_URL = 'https://fatoora.zatca.gov.sa/'
const DEMO_TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'
const TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'
const SERVICE_BRANCH_ID = 'c30094d7-40ca-4d2e-833a-07aa18c4fa46'

/* ── Tiny helpers ────────────────────────────────────────────────────────── */

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50/80 rounded-xl px-3 py-2 ring-1 ring-gray-100">
      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
      <p className={`text-xs text-gray-800 mt-1 truncate ${mono ? 'font-mono' : 'font-semibold'}`} dir="auto">{value}</p>
    </div>
  )
}

/* ── Guide modal ─────────────────────────────────────────────────────────── */

function GuideModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('zatca')
  const steps = Array.from({ length: 10 }, (_, index) => t(`guide.step${index + 1}`))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-primary-500" />
            <h3 className="text-sm font-bold text-gray-900">{t('guide.title')}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center mt-0.5">
              <ShieldCheck size={13} className="text-primary-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-800">{t('guide.onboarding')}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                {t('guide.intro')}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('guide.steps')}</p>
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary-100 text-[9px] font-bold text-primary-700 flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-[11px] text-gray-600">{s}</p>
              </div>
            ))}
          </div>

          <a
            href={FATOORA_PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-600"
          >
            <ExternalLink size={12} /> {t('guide.openPortal')}
          </a>
        </div>
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('guide.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TradingSandboxReconnect({
  status,
  connectionActive,
  onStatusChange,
  onConnectionChange,
}: {
  status: SandboxOnboardingStatus | null
  connectionActive: boolean
  onStatusChange: (status: SandboxOnboardingStatus) => void
  onConnectionChange: (status: SandboxDemoConnectionStatus) => void
}) {
  const { t } = useTranslation('zatca')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const statusLabel = status?.status ?? 'not_started'
  const canResume = !connectionActive && (!status || ['not_started', 'csr_ready', 'compliance_csid_ready', 'compliance_checks_pending', 'compliance_passed', 'sandbox_production_csid_ready', 'failed'].includes(statusLabel))
  const requiresOtp = !status || ['not_started', 'csr_ready', 'failed'].includes(statusLabel)
  const otpValid = /^\d{6}$/.test(otp)

  async function reconnect() {
    setError(null)
    setSuccess(null)
    setProgress(null)
    if (requiresOtp && !otpValid) {
      setError(t('sandbox.reconnectOtpRequired'))
      return
    }
    const enteredOtp = otp
    let next = status
    if (next?.status === 'failed') next = null
    try {
      setBusy(true)
      setProgress(t('sandbox.reconnectProgressIdentity'))
      if (!next || next.status === 'not_started') {
        next = await runSandboxDemoOnboarding({ action: 'generate_csr', functionalityMap: '0100' })
        onStatusChange(next)
      }

      if (next.status === 'csr_ready') {
        setProgress(t('sandbox.reconnectProgressCompliance'))
        setOtp('')
        next = await runSandboxDemoOnboarding({
          action: 'request_compliance_csid',
          reconnect: { otp: enteredOtp },
        })
        onStatusChange(next)
      }

      if (next.status === 'compliance_csid_ready') {
        setProgress(t('sandbox.reconnectProgressValidation'))
        next = await runSandboxDemoOnboarding({
          action: 'submit_compliance_documents',
        })
        onStatusChange(next)
      }

      if (next.status === 'compliance_passed') {
        setProgress(t('sandbox.reconnectProgressProduction'))
        next = await runSandboxDemoOnboarding({ action: 'request_sandbox_production_csid' })
        onStatusChange(next)
      }

      if (next.status === 'sandbox_production_csid_ready') {
        next = await runSandboxDemoOnboarding({ action: 'activate' })
        onStatusChange(next)
      }

      if (next.status === 'active') {
        const connection = await activateSandboxDemoConnection()
        onConnectionChange(connection)
        setSuccess(t('sandbox.reconnectSuccess'))
        setProgress(null)
        setOpen(false)
        return
      }

      if (next.status === 'failed') {
        setError(next.lastError || t('sandbox.reconnectFailed'))
        setProgress(null)
      } else if (next.status === 'csr_ready' || next.status === 'compliance_csid_ready' || next.status === 'compliance_checks_pending' || next.status === 'compliance_passed' || next.status === 'sandbox_production_csid_ready') {
        setSuccess(t('sandbox.reconnectChecksRunning'))
        setProgress(null)
      } else if (next.status !== 'active') {
        setError(t('sandbox.reconnectNeedsReview'))
        setProgress(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sandbox.reconnectFailed'))
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-card">
      <div className="flex flex-col gap-4 border-b border-amber-100 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-gray-950">{t('sandbox.reconnectTitle')}</h3>
            <Badge variant={connectionActive ? 'success' : 'warning'} dot>
              {connectionActive ? t('status.active') : t(`sandbox.onboardingStatus.${statusLabel}`, { defaultValue: statusLabel })}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{t('sandbox.reconnectHelp')}</p>
        </div>
        {canResume && (
          <button
            type="button"
            onClick={() => { setError(null); setSuccess(null); setOpen(value => !value) }}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1a3a28] disabled:opacity-50"
          >
            <Wifi size={13} /> {t('sandbox.reconnectButton')}
          </button>
        )}
      </div>
      <div className="grid gap-2 p-5 sm:grid-cols-2">
        <InfoRow label={t('fields.business')} value="Kubri Demo" />
        <InfoRow label={t('fields.branch')} value="Kubri Trading Demo" />
        <InfoRow label={t('fields.environment')} value={t('sandbox.zatcaSandbox')} />
        <InfoRow label={t('sandbox.currentCredential')} value={status?.lastError || statusLabel} />
      </div>
      {open && (
        <div className="border-t border-amber-100 bg-gray-50/70 px-5 py-4">
          <p className="text-xs font-semibold text-gray-900">{t('sandbox.reconnectTitle')}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{t('sandbox.reconnectHelp')}</p>
          {requiresOtp && (
            <div className="mt-4">
              <label htmlFor="trading-sandbox-otp" className="block text-xs font-bold text-gray-900">
                {t('sandbox.reconnectOtpTitle')}
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                {t('sandbox.reconnectOtpHelp')}
              </p>
              <input
                id="trading-sandbox-otp"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={6}
                value={otp}
                onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('sandbox.reconnectOtpPlaceholder')}
                aria-describedby="trading-sandbox-otp-help"
                className="mt-2 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold tracking-[0.25em] text-gray-900 outline-none ring-[#0F2419] placeholder:tracking-normal focus:ring-2"
              />
              <p id="trading-sandbox-otp-help" className="mt-1 text-[11px] text-gray-500">
                {t('sandbox.reconnectOtpFormat')}
              </p>
            </div>
          )}
          {busy && progress && (
            <p role="status" className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-700">
              <Loader2 size={13} className="animate-spin" /> {progress}
            </p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <button type="button" onClick={() => void reconnect()} disabled={busy || (requiresOtp && !otpValid)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0F2419] px-4 text-xs font-bold text-white hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? t('sandbox.reconnectSubmitting') : t('sandbox.reconnectSubmit')}
            </button>
            {requiresOtp && (
              <button type="button" onClick={() => setOtp('')} disabled={busy || otp.length === 0} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                {t('sandbox.reconnectOtpClear')}
              </button>
            )}
          </div>
          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
        </div>
      )}
      {success && <p className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-xs font-semibold text-emerald-800">{success}</p>}
    </section>
  )
}

/* ── Production onboarding orchestrator ─────────────────────────────────── */

const PRODUCTION_STEPS: Array<{ key: ProductionOnboardingStatus }> = [
  { key: 'generating_csr' }, { key: 'compliance_csid_requested' }, { key: 'compliance_samples_passed' },
  { key: 'production_csid_requested' }, { key: 'production_connected' },
]

const FUNCTIONALITY_OPTIONS: Array<{
  value: ZatcaFunctionalityMap
  key: 'simplified' | 'standard' | 'both'
}> = [
  { value: '0100', key: 'simplified' }, { value: '1000', key: 'standard' }, { value: '1100', key: 'both' },
]

const DISCONNECT_CONFIRMATION = 'DELETE ZATCA CONNECTION'
const SHOW_ZATCA_TRACE = import.meta.env.DEV && import.meta.env.VITE_SHOW_ZATCA_DEBUG_TRACE === 'true'

function functionalityLabel(value: ZatcaFunctionalityMap | string | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  const option = FUNCTIONALITY_OPTIONS.find(item => item.value === value)
  return option ? t(`functionality.${option.key}.label`) : t('functionality.notSelected')
}

function formatDateTime(value: string | null | undefined, locale = 'en-SA'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function safeStatusText(value: string | null | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  if (!value) return '—'
  return t(`onboardingStatus.${value}`, { defaultValue: t('unknown') })
}

function stepComplete(status: ProductionOnboardingStatus | undefined, step: ProductionOnboardingStatus): boolean {
  if (!status || status === 'failed' || status === 'compliance_failed' || status === 'not_started' || status === 'disconnected') return false
  return PRODUCTION_STEPS.findIndex(item => item.key === status) >=
    PRODUCTION_STEPS.findIndex(item => item.key === step)
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
  const { t, i18n } = useTranslation('zatca')
  const dateLocale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-SA'
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
          <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wide">{t('trace.development')}</p>
          <p className="text-xs font-semibold text-amber-900">{t('trace.title')}</p>
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
  const { t, i18n } = useTranslation('zatca')
  const dateLocale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-SA'
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
        <ShieldCheck size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-800">{t('connection.connected')}</p>
          <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
            {t('connection.connectedHelp')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoRow label={t('fields.branch')} value={branch.name} />
        <InfoRow label={t('fields.vat')} value={branch.vat_number || '—'} mono />
        <InfoRow label={t('fields.cr')} value={branch.cr_number || '—'} mono />
        <InfoRow label={t('fields.environment')} value={t('environment.production')} />
        <InfoRow label={t('fields.functionality')} value={functionalityLabel(status.functionalityMap, t)} />
        <InfoRow label={t('fields.connectedAt')} value={formatDateTime(status.connectedAt, dateLocale)} />
        <InfoRow label={t('fields.productionCsid')} value={status.productionCsidExists ? t('status.stored') : t('status.missing')} />
        <InfoRow label={t('fields.status')} value={safeStatusText(status.onboardingStatus, t)} />
        <InfoRow label={t('fields.lastUpdated')} value={formatDateTime(status.updatedAt, dateLocale)} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onReconnect}
          className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 transition-colors"
        >
          <RefreshCw size={13} />
          {t('connection.reconnect')}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
          {t('connection.remove')}
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
  const { t, i18n } = useTranslation('zatca')
  return (
    <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
      <ShieldX size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold text-gray-800">{t('connection.removed')}</p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
          {t('connection.removedHelp', { branch: branch.name })}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          {t('connection.removedAt', { date: formatDateTime(status.disconnectedAt, i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-SA') })}
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
  const { t } = useTranslation('zatca')
  const canConfirm = phrase === DISCONNECT_CONFIRMATION && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Trash2 size={15} className="text-red-500" />
            <h3 className="text-sm font-bold text-gray-900">{t('disconnect.title')}</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3.5">
            <p className="text-xs font-semibold text-red-800">{t('disconnect.branchOnly', { branch: branch.name })}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-red-700">
              {t('disconnect.help')}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-gray-700">
              {t('disconnect.type')} <span className="font-mono text-red-600" dir="ltr">{DISCONNECT_CONFIRMATION}</span> {t('disconnect.toConfirm')}
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
            {t('disconnect.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {t('disconnect.confirm')}
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
  const { t } = useTranslation('zatca')
  const { profile } = useAuth()
  const [otp, setOtp] = useState('')
  const [functionalityMap, setFunctionalityMap] = useState<ZatcaFunctionalityMap | ''>('')
  const [status, setStatus] = useState<ProductionOnboardingResponse | null>(initialStatus ?? null)
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [showReconnect, setShowReconnect] = useState(false)
  const [reconnectConfirmOpen, setReconnectConfirmOpen] = useState(false)
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
        if (mounted) {
          setError(err instanceof ZatcaAuthError
            ? t('errors.sessionExpired')
            : t('errors.loadStatus'))
        }
      } finally {
        if (mounted) setStatusLoading(false)
      }
    }
    loadStatus()
    return () => { mounted = false }
  }, [branch.id, isOwner, onStatusChange])

  const connect = async (reconnectConfirmed = false) => {
    if (!isOwner) {
      setError(t('errors.ownerOnly'))
      return
    }
    if (isConnected && !showReconnect) {
      setError(t('errors.alreadyConnected'))
      return
    }
    if (isConnected && showReconnect && !reconnectConfirmed) {
      setReconnectConfirmOpen(true)
      return
    }
    if (!/^[0-9]{6}$/.test(otp)) {
      setError(t('errors.otp'))
      return
    }
    if (!functionalityMap) {
      setError(t('errors.capability'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await onboardProductionZatca({
        branchId: branch.id,
        otp,
        functionalityMap,
        dryRun: false,
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
      if (err instanceof ZatcaAuthError) {
        setError(t('errors.sessionExpired'))
      } else if (isZatcaOtpRejection(err)) {
        setError(t('errors.invalidOrExpiredOtp'))
      } else {
        console.error('ZATCA production onboarding failed safely')
        setError(t('errors.onboardingFailed'))
      }
    } finally {
      setLoading(false)
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
      console.error('Unable to remove local ZATCA connection', err)
      setDisconnectError(t('errors.disconnectFailed'))
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
            {t('onboarding.ownerOnly')}
          </p>
        </div>
      )}

      {statusLoading && !status && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <Loader2 size={14} className="animate-spin text-gray-400" />
          <p className="text-[11px] font-medium text-gray-500">{t('connection.checking')}</p>
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
                {t(isConnected ? 'onboarding.advancedReconnect' : 'onboarding.productionSetup')}
              </p>
              <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
                {t('onboarding.connectHelp')}
              </p>
            </div>
          </div>

          {isConnected && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-xs font-semibold text-amber-900">{t('connection.reconnectWarning')}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                {t('onboarding.reconnectHelp')}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('onboarding.capability')}</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              {t('onboarding.capabilityHelp')}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {FUNCTIONALITY_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFunctionalityMap(option.value)}
                  role="radio"
                  aria-checked={functionalityMap === option.value}
                  className={`text-start rounded-xl border px-3 py-3 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    functionalityMap === option.value
                      ? 'border-primary-300 bg-primary-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <span className="block text-xs font-semibold text-gray-800">{t(`functionality.${option.key}.label`)}</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">{t(`functionality.${option.key}.hint`)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('onboarding.productionSetup')}</p>
              <div className="mt-3 space-y-2">
                {[1, 2, 3].map((stepNumber, index) => (
                  <div key={stepNumber} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700">
                      {index + 1}
                    </span>
                    <p className="text-[11px] leading-relaxed text-gray-600">{t(`onboarding.setupStep${stepNumber}`)}</p>
                  </div>
                ))}
              </div>
              <a
                href={FATOORA_PORTAL_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                <ExternalLink size={12} /> {t('guide.openPortal')}
              </a>
            </div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('onboarding.fatooraOtp')}</p>
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
        <div>
          <button
            onClick={() => void connect()}
            disabled={!isOwner || loading || otp.length !== 6 || !functionalityMap}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {t(loading ? 'onboarding.starting' : isConnected ? 'onboarding.reconnectProduction' : 'onboarding.startProduction')}
          </button>
        </div>
      )}
      <ConfirmDialog open={reconnectConfirmOpen} kind="zatcaReconnect" busy={loading} onClose={() => setReconnectConfirmOpen(false)} onConfirm={() => { setReconnectConfirmOpen(false); void connect(true) }} />

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t('onboarding.safeStatus')}</p>
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
                <p className="text-[10px] font-semibold">{t(`steps.${step.key}`)}</p>
              </div>
            )
          })}
        </div>
        {status?.complianceSampleResults?.length ? (
          <div className="space-y-1.5">
            {status.complianceSampleResults.map(result => (
              <div key={result.type} className="flex items-center justify-between text-[11px] bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-600">{t(`documents.${result.type}`, { defaultValue: t('unknown') })}</span>
                <span className={`font-semibold ${result.status === 'accepted' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {t(`status.${result.status}`, { defaultValue: t('unknown') })}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {status?.message && <p className="text-[11px] text-gray-500 leading-relaxed">{t(`onboardingStatus.${currentStatus}`, { defaultValue: t('unknown') })}</p>}
        <ZatcaDebugTrace trace={status?.trace} />
      </div>
    </div>
  )
}

/* ── Branch accordion row (FIX 2) ────────────────────────────────────────── */

function branchSummaryKey(bc: BranchWithCert): string {
  const phase = bc.zatca_phase ?? 1
  if (phase < 2) return 'summary.requiresPhase2'
  if (bc.productionStatus === undefined) return 'summary.checking'
  if (bc.productionStatus?.onboardingStatus === 'production_connected') {
    return 'summary.connected'
  }
  if (bc.productionStatus?.onboardingStatus === 'disconnected') {
    return 'summary.removed'
  }
  return 'summary.available'
}

function BranchRow({
  bc, onOpen,
}: {
  bc: BranchWithCert
  onOpen: (branchId: string, trigger: HTMLButtonElement) => void
}) {
  const { t } = useTranslation('zatca')
  const phase = bc.zatca_phase ?? 1
  const productionConnected = bc.productionStatus?.onboardingStatus === 'production_connected'
  const productionDisconnected = bc.productionStatus?.onboardingStatus === 'disconnected'
  const summaryCfg = productionConnected
    ? { variant: 'success' as const, label: t('status.connected') }
    : productionDisconnected
    ? { variant: 'neutral' as const, label: t('status.disconnected') }
    : { variant: 'neutral' as const, label: t('status.ready') }
  return (
    <div className="overflow-hidden rounded-2xl border border-primary-950/10 bg-white shadow-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-card-md">
      <button
        onClick={event => onOpen(bc.id, event.currentTarget)}
        className="w-full flex items-center gap-3 border-s-4 border-gold-500 px-4 py-4 hover:bg-primary-50/50 transition-colors text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
        aria-haspopup="dialog"
      >
        <div className="w-10 h-10 rounded-2xl bg-primary-50 ring-1 ring-primary-100 flex items-center justify-center flex-shrink-0">
          <Building2 size={16} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-gray-950 truncate" dir="auto">{bc.name}</p>
          <p className="text-[11px] text-gray-500 mt-1 truncate">{t(branchSummaryKey(bc))}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {phase >= 2 && productionConnected && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              productionConnected
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {t('environment.production')}
            </span>
          )}
          {phase >= 2 && <Badge variant={summaryCfg.variant} dot>{summaryCfg.label}</Badge>}
          {phase < 2 && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {t('phase.notPhase2')}
            </span>
          )}
          <ChevronDown
            size={15}
            className="text-gray-400"
          />
        </div>
      </button>
    </div>
  )
}

function ZatcaBranchModal({
  branch, onClose, onProductionStatusUpdate, returnFocusRef,
}: {
  branch: BranchWithCert
  onClose: () => void
  onProductionStatusUpdate: (branchId: string, status: ProductionOnboardingResponse) => void
  returnFocusRef: React.MutableRefObject<HTMLButtonElement | null>
}) {
  const { t } = useTranslation('zatca')
  const dialogRef = useRef<HTMLDivElement>(null)
  const phase = branch.zatca_phase ?? 1
  const handleProductionStatusChange = useCallback((nextStatus: ProductionOnboardingResponse) => {
    onProductionStatusUpdate(branch.id, nextStatus)
  }, [branch.id, onProductionStatusUpdate])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button, input, [href]')?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [returnFocusRef])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-2 sm:p-4"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`zatca-dialog-${branch.id}`}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[min(760px,calc(100dvh-2rem))]"
      >
        <header className="flex flex-shrink-0 items-center justify-between gap-4 bg-sidebar px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gold-300">{t(branchSummaryKey(branch))}</p>
            <h2 id={`zatca-dialog-${branch.id}`} className="mt-1 truncate text-base font-black text-white" dir="auto">
              {branch.name || t('fields.branch')}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('guide.close')}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fffdf7] p-4 sm:p-6">
          {phase < 2 ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50 p-4">
                <Info size={14} className="mt-0.5 flex-shrink-0 text-primary-600" />
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-primary-900">{t('phase.notYet')}</p>
                  <p className="text-[11px] leading-relaxed text-primary-800">{t('phase.upgradeHelp')}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const el = document.querySelector('[data-tab="subscription"]') as HTMLElement | null
                  el?.click()
                }}
                className="w-full rounded-xl border border-primary-200 py-2.5 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50"
              >
                {t('phase.upgrade')}
              </button>
            </div>
          ) : (
            <ProductionOnboardingPanel
              branch={branch}
              initialStatus={branch.productionStatus}
              onStatusChange={handleProductionStatusChange}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Main tab ─────────────────────────────────────────────────────────────── */

export default function ZatcaTab() {
  const { t } = useTranslation('zatca')
  const { profile } = useAuth()
  const [data, setData]         = useState<BranchWithCert[]>([])
  const [loading, setLoading]   = useState(true)
  const [sandboxStatuses, setSandboxStatuses] = useState<Record<string, SandboxDemoConnectionStatus | null>>({})
  const [tradingSandboxOnboardingStatus, setTradingSandboxOnboardingStatus] = useState<SandboxOnboardingStatus | null>(null)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const modalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [showGuide, setShowGuide]   = useState(false)
  const [showServiceSandboxStart, setShowServiceSandboxStart] = useState(false)

  const load = useCallback(async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    const tid = profile.tenant_id
    const branchesRes = await (supabase as any).from('branches').select('*').eq('tenant_id', tid)
      .order('is_main_branch', { ascending: false })
      .order('created_at', { ascending: true })
    const branches = (branchesRes.data as Branch[]) ?? []
    const productionStatuses = new Map<string, ProductionOnboardingResponse | null>()
    if (profile.role === 'owner') {
      await Promise.all(branches
        .filter(branch => (branch.zatca_phase ?? 1) === 2 && !(
          tid === DEMO_TENANT_ID && [TRADING_BRANCH_ID, SERVICE_BRANCH_ID].includes(branch.id)
        ))
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
      productionStatus: productionStatuses.has(b.id) ? productionStatuses.get(b.id) ?? null : undefined,
    })))
    setLoading(false)
  }, [profile?.tenant_id, profile?.role])

  useEffect(() => { load() }, [load])

  const isPermanentDemo = profile?.tenant_id === DEMO_TENANT_ID

  useEffect(() => {
    if (profile?.tenant_id !== DEMO_TENANT_ID || !['owner', 'super_admin'].includes(profile?.role ?? '')) return
    let mounted = true
    Promise.all([
      ...[TRADING_BRANCH_ID, SERVICE_BRANCH_ID].map(async branchId => {
        try {
          return [branchId, await getSandboxDemoConnectionStatus(branchId)] as const
        } catch {
          return [branchId, null] as const
        }
      }),
      getSandboxDemoOnboardingStatus().then(status => ['onboarding', status] as const).catch(() => ['onboarding', null] as const),
    ]).then(entries => {
      if (!mounted) return
      const onboarding = entries.find(entry => entry[0] === 'onboarding')?.[1]
      if (onboarding && typeof onboarding === 'object' && 'status' in onboarding) {
        setTradingSandboxOnboardingStatus(onboarding as SandboxOnboardingStatus)
      }
      setSandboxStatuses(Object.fromEntries(entries.filter(entry => entry[0] !== 'onboarding')))
    })
    return () => { mounted = false }
  }, [profile?.tenant_id, profile?.role])

  const updateTradingSandboxConnection = useCallback((status: SandboxDemoConnectionStatus) => {
    setSandboxStatuses(prev => ({ ...prev, [TRADING_BRANCH_ID]: status }))
  }, [])

  const isPermanentDemoOwner = isPermanentDemo && ['owner', 'super_admin'].includes(profile?.role ?? '')

  /*
   * The reconnect control is intentionally scoped to the exact permanent-demo
   * tenant/Trading branch. The Edge Function repeats the same authorization and
   * scope checks, so this client condition is only a visibility gate.
   */
  const reconnectPanel = isPermanentDemoOwner ? (
    <TradingSandboxReconnect
      status={tradingSandboxOnboardingStatus}
      connectionActive={sandboxStatuses[TRADING_BRANCH_ID]?.active === true}
      onStatusChange={setTradingSandboxOnboardingStatus}
      onConnectionChange={updateTradingSandboxConnection}
    />
  ) : null

  const handleProductionStatusUpdate = useCallback((branchId: string, status: ProductionOnboardingResponse) => {
    writeCachedProductionStatus(branchId, status)
    setData(prev => prev.map(branch => (
      branch.id === branchId
        ? { ...branch, productionStatus: status }
        : branch
    )))
  }, [])

  const openBranchModal = useCallback((branchId: string, trigger: HTMLButtonElement) => {
    modalTriggerRef.current = trigger
    setSelectedBranchId(branchId)
  }, [])
  const closeBranchModal = useCallback(() => setSelectedBranchId(null), [])
  const selectedBranch = useMemo(
    () => selectedBranchId ? data.find(branch => branch.id === selectedBranchId) ?? null : null,
    [data, selectedBranchId],
  )

  const phase2Count = data.filter(b => (b.zatca_phase ?? 1) === 2).length
  const activeCount = data.filter(b =>
    b.productionStatus?.onboardingStatus === 'production_connected'
  ).length
  const tradingSandboxStatus = sandboxStatuses[TRADING_BRANCH_ID]
  const serviceSandboxStatus = sandboxStatuses[SERVICE_BRANCH_ID]
  const regularBranches = isPermanentDemo
    ? data.filter(branch => ![TRADING_BRANCH_ID, SERVICE_BRANCH_ID].includes(branch.id))
    : data

  return (
    <div className="space-y-5">
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}

      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-gray-950">{t('connections')}</h3>
          <p className="text-xs text-gray-500 mt-1">{t('subtitle')}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-gray-600">{t('summary.counts', { count: data.length, phase2: phase2Count, active: activeCount })}</span>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-emerald-700">{t('status.connected')}: {activeCount}</span>
            <span className="rounded-lg bg-gold-50 px-2.5 py-1.5 text-gold-800">{t('status.ready')}: {Math.max(phase2Count - activeCount, 0)}</span>
          </div>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          title={t('guide.button')}
        >
          <Info size={13} />
          {t('guide.short')}
        </button>
        </div>
      </div>

      {reconnectPanel}

      {isPermanentDemoOwner && (
        <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-card">
          <div className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/70 px-5 py-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <ShieldCheck size={18} />
            </div>
            <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-gray-950">{t('sandbox.tradingTitle')}</h3>
              <Badge variant={tradingSandboxStatus?.active ? 'success' : 'neutral'} dot>
                {tradingSandboxStatus?.active
                  ? t('status.active')
                  : tradingSandboxOnboardingStatus?.status
                    ? t(`sandbox.onboardingStatus.${tradingSandboxOnboardingStatus.status}`, { defaultValue: tradingSandboxOnboardingStatus.status })
                    : tradingSandboxStatus
                      ? t('status.notConnected')
                      : t('status.checking')}
              </Badge>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                {t('sandbox.demoHelp')}
              </p>
            </div>
          </div>
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            <InfoRow label={t('fields.environment')} value={t('sandbox.zatcaSandbox')} />
            <InfoRow label={t('sandbox.connection')} value={tradingSandboxStatus ? t(tradingSandboxStatus.active ? 'status.active' : 'status.notActive') : t('status.checking')} />
            <InfoRow label={t('sandbox.complianceChecks')} value={tradingSandboxStatus?.complianceChecks ?? t('status.checking')} />
            <InfoRow label={t('sandbox.productionSubmission')} value={t('status.disabled')} />
          </div>
        </section>
      )}

      {isPermanentDemo && profile?.role === 'owner' && data.some(branch => branch.id === SERVICE_BRANCH_ID) && (
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-500">
                <Building2 size={17} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black text-gray-950">{t('sandbox.serviceTitle')}</h3>
                  <Badge variant={serviceSandboxStatus?.active ? 'success' : 'neutral'} dot>
                    {t(serviceSandboxStatus?.active ? 'status.active' : 'status.notConnected')}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{t('sandbox.environmentLine')}</p>
              </div>
            </div>
            {!serviceSandboxStatus?.active && <button
              type="button"
              onClick={() => setShowServiceSandboxStart(value => !value)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-100 active:scale-[0.98]"
            >
              <Wifi size={13} /> {t('sandbox.beginOnboarding')}
            </button>}
          </div>
          {serviceSandboxStatus?.active ? (
            <div className="grid gap-2 border-t border-gray-100 p-5 sm:grid-cols-2">
              <InfoRow label={t('fields.environment')} value={t('sandbox.zatcaSandbox')} />
              <InfoRow label={t('sandbox.connection')} value={t(serviceSandboxStatus.active ? 'status.active' : 'status.notActive')} />
              <InfoRow label={t('sandbox.complianceChecks')} value={serviceSandboxStatus.complianceChecks} />
              <InfoRow label={t('sandbox.productionSubmission')} value={t('status.disabled')} />
            </div>
          ) : showServiceSandboxStart && (
            <div className="border-t border-gray-100 bg-gray-50/70 px-5 py-4">
              <p className="text-xs font-semibold text-gray-800">{t('sandbox.secureOtp')}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                {t('sandbox.secureOtpHelp')}
              </p>
              <a
                href={FATOORA_PORTAL_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:text-sky-800"
              >
                <ExternalLink size={12} /> {t('sandbox.openDeveloperPortal')}
              </a>
            </div>
          )}
        </section>
      )}

      {/* Official seller readiness */}
      {ENABLE_OFFICIAL_SELLER_IDENTITY && data.map(branch => <ComplianceReadinessCard key={`identity-${branch.id}`} branchId={branch.id} manage={profile?.role === 'owner'} />)}

      {/* Branch list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="card h-14 animate-pulse bg-gray-50" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">{t('empty')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {regularBranches.map(bc => (
            <BranchRow
              key={bc.id}
              bc={bc}
              onOpen={openBranchModal}
            />
          ))}
        </div>
      )}

      {selectedBranch && (
        <ZatcaBranchModal
          branch={selectedBranch}
          onClose={closeBranchModal}
          onProductionStatusUpdate={handleProductionStatusUpdate}
          returnFocusRef={modalTriggerRef}
        />
      )}

      {data.some(b => !b.vat_number && (b.zatca_phase ?? 1) === 2) && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl p-4">
          <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">{t('incomplete')}</p>
            <p className="text-[11px] text-red-600 mt-0.5">
              {t('incompleteHelp')}
            </p>
          </div>
        </div>
      )}

      {/* Security note */}
      <div className="flex items-start gap-2.5 px-1 py-2">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <Lock size={14} />
        </div>
        <div>
          <p className="text-xs font-bold text-gray-900">{t('protected')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            {t('protectedHelp')}
          </p>
        </div>
      </div>
    </div>
  )
}
