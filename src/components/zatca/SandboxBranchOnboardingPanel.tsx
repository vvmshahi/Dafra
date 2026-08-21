import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, RefreshCw, ShieldCheck, Wifi } from 'lucide-react'
import {
  getSandboxBranchOnboardingStatus,
  getZatcaConnectionState,
  runSandboxBranchOnboarding,
  type SandboxBranchOnboardingResponse,
  type ZatcaConnectionResolution,
} from '@/lib/zatca/api'

type SandboxBranch = { id: string; tenant_id: string; name: string }

const STEPS = [
  ['generate_csr', 'CSR'],
  ['request_compliance_csid', 'Compliance CSID'],
  ['submit_compliance_documents', '6 profile-1100 samples'],
  ['request_sandbox_production_csid', 'Operational CSID'],
  ['activate', 'Connected'],
] as const

function cardStatus(
  status: SandboxBranchOnboardingResponse | null,
  connection: ZatcaConnectionResolution | null,
) {
  if (connection?.connection_state === 'connected') return { label: 'ZATCA Sandbox Connected', tone: 'success' }
  if (connection?.connection_state === 'failed' || status?.status === 'failed') return { label: 'Sandbox onboarding failed', tone: 'danger' }
  if (connection?.connection_state === 'not_started' || status?.status === 'not_started' || !status) return { label: 'Sandbox setup pending', tone: 'neutral' }
  return { label: 'Sandbox onboarding', tone: 'warning' }
}

export default function SandboxBranchOnboardingPanel({ branch }: { branch: SandboxBranch }) {
  const [status, setStatus] = useState<SandboxBranchOnboardingResponse | null>(null)
  const [connection, setConnection] = useState<ZatcaConnectionResolution | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [nextStatus, nextConnection] = await Promise.all([
        getSandboxBranchOnboardingStatus(branch.id, branch.tenant_id),
        getZatcaConnectionState(branch.id),
      ])
      setStatus(nextStatus)
      setConnection(nextConnection)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Sandbox onboarding status.')
    }
  }, [branch.id, branch.tenant_id])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!status?.operationInProgress) return
    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => window.clearInterval(timer)
  }, [refresh, status?.operationInProgress])

  const current = status?.status ?? 'not_started'
  const running = !!status?.operationInProgress
  const nextAction = running ? null
    : current === 'not_started' ? 'generate_csr'
      : current === 'csr_ready' ? 'request_compliance_csid'
        : current === 'compliance_csid_ready' ? 'submit_compliance_documents'
          : current === 'compliance_passed' ? 'request_sandbox_production_csid'
            : current === 'sandbox_production_csid_ready' ? 'activate'
              : current === 'failed' ? 'retry_failed_step' : null
  const needsOtp = nextAction === 'request_compliance_csid'
    || (nextAction === 'retry_failed_step' && status?.failedStep === 'request_compliance_csid')
  const completed = useMemo(() => new Set(status?.completedSteps ?? []), [status?.completedSteps])
  const display = cardStatus(status, connection)

  async function runNext() {
    if (!nextAction || (needsOtp && !/^\d{6}$/.test(otp))) {
      setError(needsOtp ? 'Enter the six-digit Developer Portal Sandbox OTP.' : 'This Sandbox step is not available yet.')
      return
    }
    setLoading(true); setError(null)
    try {
      setStatus(await runSandboxBranchOnboarding({
        branchId: branch.id,
        tenantId: branch.tenant_id,
        action: nextAction,
        ...(needsOtp ? { otp } : {}),
        ...(nextAction === 'generate_csr' ? { functionalityMap: '1100' } : {}),
      }))
      if (needsOtp) setOtp('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sandbox onboarding step failed.')
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const tone = display.tone === 'success'
    ? 'bg-emerald-100 text-emerald-700'
    : display.tone === 'danger'
      ? 'bg-red-100 text-red-700'
      : display.tone === 'warning'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-100 text-gray-700'

  return <section data-zatca-branch-card={branch.id} className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-card">
    <div className="flex items-center gap-3 border-b border-sky-100 bg-sky-50/70 px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><ShieldCheck size={18} /></div>
      <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="min-w-0 flex-1 text-start">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-black text-gray-950" dir="auto">{branch.name}</h3><p className="mt-1 text-[11px] leading-relaxed text-gray-600">Developer Portal Integration Sandbox · Profile 1100 · Simplified + Standard</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone}`}>{display.label}</span><ChevronDown size={15} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} /></div></div>
      </button>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label={`Refresh ${branch.name} Sandbox status`} className="rounded-xl border border-sky-200 bg-white p-2 text-sky-700 disabled:opacity-50"><RefreshCw size={13} /></button>
    </div>
    {expanded && <div className="space-y-4 p-5">
      <div className="grid gap-2 sm:grid-cols-5">{STEPS.map(([key, label]) => <div key={key} className={`rounded-xl border px-2 py-2 text-center text-[10px] font-bold ${completed.has(key) || (key === 'activate' && connection?.connection_state === 'connected') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : running && status?.operationInProgress === key ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-gray-200 bg-gray-50 text-gray-400'}`}><CheckCircle2 size={13} className="mx-auto mb-1" />{label}</div>)}</div>
      {running && <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800"><Loader2 size={13} className="animate-spin" />{status?.operationInProgress.replaceAll('_', ' ')} is running. Status refreshes automatically.</div>}
      {(error || status?.lastError) && <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error ?? status?.lastError}</div>}
      {status?.complianceSampleResults?.length ? <div className="space-y-1.5">{status.complianceSampleResults.map(result => <div key={result.type} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[11px]"><span>{result.type.replaceAll('_', ' ')}</span><span className={result.status === 'accepted' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-800'}>{result.status}</span></div>)}</div> : null}
      {needsOtp && <label className="block text-xs font-semibold text-gray-700">Developer Portal Sandbox OTP<input value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-center font-mono text-lg" disabled={loading} /></label>}
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4"><p className="text-xs font-semibold text-gray-700">{display.label}</p>{nextAction && <button type="button" onClick={() => void runNext()} disabled={loading} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}{nextAction === 'generate_csr' ? 'Begin Sandbox onboarding' : nextAction === 'request_compliance_csid' ? 'Request Compliance CSID' : nextAction === 'submit_compliance_documents' ? 'Run compliance samples' : nextAction === 'request_sandbox_production_csid' ? 'Request operational CSID' : nextAction === 'activate' ? 'Activate Sandbox' : 'Retry'}</button>}</div>
    </div>}
  </section>
}
