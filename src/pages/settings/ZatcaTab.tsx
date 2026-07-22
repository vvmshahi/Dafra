/**
 * ZATCA Phase 2 — Settings Tab
 *
 * Per-branch certificate management:
 *   - Production uses backend-only onboarding through zatca-onboard-production.
 *
 * Each branch operates independently and maintains its production connection.
 */

import { useState, useEffect, useCallback } from 'react'
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
import {
  getProductionOnboardingStatus,
  getSandboxDemoConnectionStatus,
  disconnectProductionZatca,
  onboardProductionZatca,
  type ProductionOnboardingResponse,
  type ProductionOnboardingTraceEntry,
  type ProductionOnboardingStatus,
  type ZatcaFunctionalityMap,
  type SandboxDemoConnectionStatus,
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
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
  return new Date(value).toLocaleString(locale, {
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
  const { t } = useTranslation('zatca')
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

      <div className="rounded-2xl border border-gold-200 bg-gold-50 px-3.5 py-3">
        <p className="text-[11px] text-gold-900 leading-relaxed">
          {t('connection.featureFlagHelp')}
        </p>
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
        console.error('Unable to load production onboarding status', err)
        if (mounted) setError(t('errors.loadStatus'))
      } finally {
        if (mounted) setStatusLoading(false)
      }
    }
    loadStatus()
    return () => { mounted = false }
  }, [branch.id, isOwner, onStatusChange])

  const connect = async () => {
    if (!isOwner) {
      setError(t('errors.ownerOnly'))
      return
    }
    if (isConnected && !showReconnect) {
      setError(t('errors.alreadyConnected'))
      return
    }
    if (isConnected && showReconnect && !window.confirm(t('connection.reconnectConfirm'))) {
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
      console.error('ZATCA production onboarding failed', err)
      setError(t('errors.onboardingFailed'))
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
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
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
            onClick={connect}
            disabled={!isOwner || loading || otp.length !== 6 || !functionalityMap}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {t(loading ? 'onboarding.starting' : isConnected ? 'onboarding.reconnectProduction' : 'onboarding.startProduction')}
          </button>
        </div>
      )}

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

function BranchAccordionRow({
  bc, isExpanded, onToggle, onProductionStatusUpdate,
}: {
  bc: BranchWithCert
  isExpanded: boolean
  onToggle: () => void
  onProductionStatusUpdate: (branchId: string, status: ProductionOnboardingResponse) => void
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
            className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-white p-5 space-y-5">
          {phase < 2 ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-primary-50 border border-primary-100 rounded-2xl p-4">
                <Info size={14} className="text-primary-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-primary-900">{t('phase.notYet')}</p>
                  <p className="text-[11px] text-primary-800 leading-relaxed">
                    {t('phase.upgradeHelp')}
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
                {t('phase.upgrade')}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 p-4">
              <ProductionOnboardingPanel
                branch={bc}
                initialStatus={bc.productionStatus}
                onStatusChange={handleProductionStatusChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────────────────── */

export default function ZatcaTab() {
  const { t } = useTranslation('zatca')
  const { profile } = useAuth()
  const [data, setData]         = useState<BranchWithCert[]>([])
  const [loading, setLoading]   = useState(true)
  const [sandboxStatuses, setSandboxStatuses] = useState<Record<string, SandboxDemoConnectionStatus | null>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
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
    // Auto-expand first branch if only one
    setExpandedId(prev => branches.length === 1 && !prev ? branches[0].id : prev)
    setLoading(false)
  }, [profile?.tenant_id, profile?.role])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (profile?.tenant_id !== DEMO_TENANT_ID || profile.role !== 'owner') return
    let mounted = true
    Promise.all([TRADING_BRANCH_ID, SERVICE_BRANCH_ID].map(async branchId => {
      try {
        return [branchId, await getSandboxDemoConnectionStatus(branchId)] as const
      } catch {
        return [branchId, null] as const
      }
    })).then(entries => { if (mounted) setSandboxStatuses(Object.fromEntries(entries)) })
    return () => { mounted = false }
  }, [profile?.tenant_id, profile?.role])

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
    b.productionStatus?.onboardingStatus === 'production_connected'
  ).length
  const isPermanentDemo = profile?.tenant_id === DEMO_TENANT_ID
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
          <p className="text-xs text-gray-500 mt-1">
            {t('summary.counts', { count: data.length, phase2: phase2Count, active: activeCount })}
          </p>
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

      {isPermanentDemo && profile?.role === 'owner' && (
        <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-card">
          <div className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/70 px-5 py-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <ShieldCheck size={18} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-black text-gray-950">{t('sandbox.tradingTitle')}</h3>
                <Badge variant={tradingSandboxStatus?.active ? 'success' : 'neutral'} dot>
                  {t(tradingSandboxStatus?.active ? 'status.active' : 'status.checking')}
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
            <p className="text-xs font-semibold text-red-700">{t('incomplete')}</p>
            <p className="text-[11px] text-red-600 mt-0.5">
              {t('incompleteHelp')}
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
          <p className="text-xs font-bold text-gray-900">{t('protected')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            {t('protectedHelp')}
          </p>
        </div>
      </div>
    </div>
  )
}
