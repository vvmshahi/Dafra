/**
 * ZATCA Phase 2 — Settings Tab
 *
 * Per-branch 4-step onboarding flow:
 *   Step 1: Generate Keys (ECDSA P-256, CSR, encrypt private key → DB)
 *   Step 2: Enter OTP  (Fatoorah portal → OTP → compliance CSID via Edge Function)
 *   Step 3: Activate   (production CSID via Edge Function)
 *   Step 4: Done       (certificate details, invoice stats)
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ShieldX, ShieldAlert, Clock, Building2,
  CheckCircle2, AlertTriangle, ExternalLink, Lock,
  Key, Loader2, Copy, Eye, EyeOff, Info, ChevronRight,
  Cpu, Wifi, BadgeCheck, FlaskConical,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { generateKeyPair, encryptPrivateKey } from '@/lib/zatca/crypto'
import { generateCSR } from '@/lib/zatca/csr'
import { requestComplianceCsid, requestProductionCsid } from '@/lib/zatca/api'
import type { Branch, ZatcaCertificate, CertificateStatus } from '@/types'

/* ── Types ───────────────────────────────────────────────────────────────── */

type BranchWithCert = Branch & { cert: ZatcaCertificate | null }

type OnboardingStep = 1 | 2 | 3 | 4

/* ── Step helpers ────────────────────────────────────────────────────────── */

function certStep(cert: ZatcaCertificate | null): OnboardingStep {
  if (!cert || !cert.csr)             return 1
  if (cert.status === 'compliance')   return 3
  if (cert.status === 'active')       return 4
  // has csr but not yet compliance
  return 2
}

/* ── Status config ───────────────────────────────────────────────────────── */

const CERT_CONFIG: Record<CertificateStatus, {
  icon: React.ElementType
  variant: 'success' | 'warning' | 'danger' | 'neutral'
  label: string
  iconClass: string
  bgClass: string
}> = {
  pending:    { icon: Clock,       variant: 'warning', label: 'Pending',    iconClass: 'text-amber-500',   bgClass: 'bg-amber-50' },
  compliance: { icon: ShieldCheck, variant: 'warning', label: 'Compliance', iconClass: 'text-blue-500',    bgClass: 'bg-blue-50' },
  active:     { icon: ShieldCheck, variant: 'success', label: 'Active',     iconClass: 'text-emerald-500', bgClass: 'bg-emerald-50' },
  revoked:    { icon: ShieldX,     variant: 'danger',  label: 'Revoked',    iconClass: 'text-red-500',     bgClass: 'bg-red-50' },
  expired:    { icon: ShieldAlert, variant: 'danger',  label: 'Expired',    iconClass: 'text-red-500',     bgClass: 'bg-red-50' },
}

/* ── Tiny helpers ────────────────────────────────────────────────────────── */

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2">
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
      <p className={`text-xs text-gray-700 mt-0.5 truncate ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  )
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-all ${
      done   ? 'bg-emerald-500 border-emerald-500 text-white' :
      active ? 'bg-primary-600 border-primary-600 text-white' :
               'bg-white border-gray-200 text-gray-400'
    }`}>
      {done ? <CheckCircle2 size={14} /> : n}
    </div>
  )
}

/* ── Copyable code block ─────────────────────────────────────────────────── */

function CodeBlock({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [show, setShow]     = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const preview = show ? value : value.substring(0, 80) + '…'

  return (
    <div className="bg-gray-900 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShow(s => !s)} className="text-gray-400 hover:text-gray-200 transition-colors">
            {show ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-white transition-colors"
          >
            <Copy size={11} /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="text-[10px] text-green-400 font-mono break-all whitespace-pre-wrap leading-relaxed">
        {preview}
      </pre>
    </div>
  )
}

/* ── Step 1: Generate Keys ───────────────────────────────────────────────── */

function Step1GenerateKeys({
  branch, onDone,
}: {
  branch: BranchWithCert
  onDone: (cert: ZatcaCertificate) => void
}) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [csrPem, setCsrPem]   = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const keyPair = await generateKeyPair()
      const csr = await generateCSR({
        commonName:   branch.name,
        branchId:     branch.id,
        vatNumber:    branch.vat_number ?? profile?.tenant_id ?? '',
        branchName:   branch.name,
        businessName: branch.name,
        invoiceType:  '1100',         // supports both standard + simplified
        location:     [branch.address, branch.city].filter(Boolean).join(', ') || 'Riyadh, SA',
        industry:     'Technology',
      }, keyPair)

      const encryptedKey = await encryptPrivateKey(keyPair.privateKeyPem)

      const { data, error: dbErr } = await (supabase as any)
        .from('zatca_certificates')
        .upsert({
          tenant_id:             profile?.tenant_id,
          branch_id:             branch.id,
          csr,
          private_key_encrypted: encryptedKey,
          public_key_pem:        keyPair.publicKeyPem,
          status:                'pending',
          environment:           'sandbox',
        }, { onConflict: 'branch_id,environment' })
        .select()
        .single()

      if (dbErr) throw new Error(dbErr.message)
      setCsrPem(csr)
      onDone(data)
    } catch (err: any) {
      setError(err.message ?? 'Key generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3.5">
        <Info size={13} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          This will generate an ECDSA P-256 key pair in your browser and create a PKCS#10 CSR.
          The private key is encrypted with AES-256-GCM before being stored securely in the database.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-700">{error}</p>
        </div>
      )}

      <button
        onClick={generate}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
        {loading ? 'Generating keys…' : 'Generate ECDSA Key Pair & CSR'}
      </button>

      {csrPem && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={14} />
            <span className="text-xs font-semibold">Keys generated and stored securely</span>
          </div>
          <CodeBlock value={csrPem} label="Certificate Signing Request (CSR)" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            The CSR has been saved. Proceed to Step 2 to register with ZATCA.
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Step 2: Enter OTP ───────────────────────────────────────────────────── */

function Step2EnterOTP({
  branch, cert, environment, onDone,
}: {
  branch: BranchWithCert
  cert: ZatcaCertificate
  environment: 'sandbox' | 'production'
  onDone: (updated: ZatcaCertificate) => void
}) {
  const [otp, setOtp]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [csrVisible, setCsrVisible] = useState(false)

  const register = async () => {
    if (otp.length < 6) { setError('OTP must be 6 digits'); return }
    setLoading(true)
    setError(null)
    try {
      await requestComplianceCsid(cert.csr!, otp, branch.id, environment)
      // Edge Function updates the DB — re-fetch
      const { data, error: dbErr } = await (supabase as any)
        .from('zatca_certificates')
        .select('*')
        .eq('branch_id', branch.id)
        .single()
      if (dbErr) throw new Error(dbErr.message)
      onDone(data)
    } catch (err: any) {
      setError(err.message ?? 'Compliance registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Portal instructions */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
        <p className="text-[11px] font-semibold text-gray-700">How to get your OTP:</p>
        {[
          'Log in to the Fatoorah (فاتورة) portal at my.zatca.gov.sa',
          `Register a new EGS device with serial: 1-Dafra|2-POS|3-${branch.id.substring(0, 8)}…`,
          'Paste the CSR below into the portal',
          'The portal will show you a 6-digit OTP — enter it here',
        ].map((s, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary-100 text-[9px] font-bold text-primary-700 flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <p className="text-[11px] text-gray-600">{s}</p>
          </div>
        ))}
        <a
          href="https://my.zatca.gov.sa"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
        >
          <ExternalLink size={11} /> Open Fatoorah Portal
        </a>
      </div>

      {/* CSR display */}
      {cert.csr && (
        <div className="space-y-1.5">
          <button
            onClick={() => setCsrVisible(v => !v)}
            className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            {csrVisible ? <EyeOff size={11} /> : <Eye size={11} />}
            {csrVisible ? 'Hide' : 'Show'} CSR
          </button>
          {csrVisible && <CodeBlock value={cert.csr} label="Your CSR — paste into ZATCA portal" />}
        </div>
      )}

      {/* OTP input */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-600 mb-1.5">
          6-digit OTP from ZATCA portal
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').substring(0, 6))}
          className="input text-center text-2xl tracking-[0.5em] font-mono"
        />
        {environment === 'sandbox' && (
          <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            For sandbox testing, use OTP: <span className="font-mono font-bold tracking-widest">123456</span>
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
          <pre className="text-[11px] text-red-700 whitespace-pre-wrap break-all font-mono leading-relaxed">{error}</pre>
        </div>
      )}

      <button
        onClick={register}
        disabled={loading || otp.length < 6}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
        {loading ? 'Registering with ZATCA…' : 'Register Device with ZATCA'}
      </button>
    </div>
  )
}

/* ── Step 3: Activate Production ─────────────────────────────────────────── */

function Step3Activate({
  branch, environment, onDone,
}: {
  branch: BranchWithCert
  environment: 'sandbox' | 'production'
  onDone: (updated: ZatcaCertificate) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const activate = async () => {
    setLoading(true)
    setError(null)
    try {
      await requestProductionCsid(branch.id)
      const { data, error: dbErr } = await (supabase as any)
        .from('zatca_certificates')
        .select('*')
        .eq('branch_id', branch.id)
        .single()
      if (dbErr) throw new Error(dbErr.message)
      onDone(data)
    } catch (err: any) {
      setError(err.message ?? 'Production activation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
        <CheckCircle2 size={13} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-emerald-700 leading-relaxed">
          Compliance CSID registered successfully. Click below to convert it to a Production CSID.
          This will make the branch live on the ZATCA system.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-700">{error}</p>
        </div>
      )}

      <button
        onClick={activate}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
        {loading ? 'Activating production certificate…' : 'Activate Production CSID'}
      </button>

      <p className="text-[11px] text-gray-400 text-center">
        This action contacts ZATCA to issue your production certificate.
      </p>
    </div>
  )
}

/* ── Step 4: Done ────────────────────────────────────────────────────────── */

function Step4Done({ cert }: { cert: ZatcaCertificate }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
        <ShieldCheck size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-emerald-800">Branch is Phase 2 compliant</p>
          <p className="text-[11px] text-emerald-700 mt-0.5">
            Production CSID is active. Invoices are automatically signed and submitted to ZATCA.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoRow label="Environment"     value={cert.environment ?? 'sandbox'} mono />
        <InfoRow label="Serial Number"   value={cert.serial_number ?? '—'} mono />
        <InfoRow label="Invoice Counter" value={String(cert.invoice_counter ?? 0)} />
        <InfoRow label="Activated"       value={cert.activated_at ? new Date(cert.activated_at).toLocaleDateString('en-SA') : '—'} />
        <InfoRow label="Compliance CSID" value={cert.compliance_csid ? 'Issued ✓' : '—'} />
        <InfoRow label="Production CSID" value={cert.production_csid ? 'Active ✓' : '—'} />
      </div>

      {cert.last_invoice_hash && (
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
            Last Invoice Hash (PIH)
          </p>
          <p className="text-[10px] text-green-400 font-mono break-all">{cert.last_invoice_hash}</p>
        </div>
      )}
    </div>
  )
}

/* ── Stepper bar ─────────────────────────────────────────────────────────── */

const STEPS = [
  { n: 1, label: 'Generate Keys' },
  { n: 2, label: 'Enter OTP' },
  { n: 3, label: 'Activate' },
  { n: 4, label: 'Done' },
] as const

function Stepper({ current }: { current: OnboardingStep }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map(({ n, label }, i) => (
        <div key={n} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <StepDot n={n} active={current === n} done={current > n} />
            <span className={`text-[9px] font-semibold whitespace-nowrap ${
              current === n ? 'text-primary-600' : current > n ? 'text-emerald-600' : 'text-gray-400'
            }`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-4 rounded-full transition-colors ${
              current > n ? 'bg-emerald-400' : 'bg-gray-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Branch onboarding card ──────────────────────────────────────────────── */

function BranchOnboardingCard({
  bc, onCertUpdate,
}: {
  bc: BranchWithCert
  onCertUpdate: (branchId: string, cert: ZatcaCertificate) => void
}) {
  const cert    = bc.cert
  const phase   = bc.zatca_phase ?? 1
  const status  = cert?.status ?? 'pending'
  const cfg     = CERT_CONFIG[status] ?? CERT_CONFIG.pending
  const step    = certStep(cert)

  // Environment toggle — reads from DB cert, defaults to sandbox
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>(
    (cert?.environment as 'sandbox' | 'production') ?? 'sandbox'
  )
  const [envSaving, setEnvSaving] = useState(false)

  const switchEnvironment = async (env: 'sandbox' | 'production') => {
    setEnvironment(env)
    setEnvSaving(true)
    // Persist to DB if cert row exists
    if (cert?.id) {
      await (supabase as any)
        .from('zatca_certificates')
        .update({ environment: env })
        .eq('branch_id', bc.id)
    }
    setEnvSaving(false)
  }

  const handleDone = (updated: ZatcaCertificate) => {
    setEnvironment((updated.environment as 'sandbox' | 'production') ?? 'sandbox')
    onCertUpdate(bc.id, updated)
  }

  return (
    <div className="card p-5 space-y-5">
      {/* Branch header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
            <Building2 size={16} className="text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{bc.name}</p>
            {bc.name_ar && (
              <p className="text-xs text-gray-400" style={{ fontFamily: 'Cairo' }}>{bc.name_ar}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Environment toggle — only shown for Phase 2 */}
          {phase >= 2 && status !== 'active' && (
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
              <button
                onClick={() => switchEnvironment('sandbox')}
                disabled={envSaving}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                  environment === 'sandbox'
                    ? 'bg-amber-400 text-amber-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Sandbox
              </button>
              <button
                onClick={() => switchEnvironment('production')}
                disabled={envSaving}
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
          {phase >= 2 && status === 'active' && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              environment === 'production'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {environment === 'production' ? 'Production' : 'Sandbox'}
            </span>
          )}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            phase === 2
              ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
              : 'bg-gray-100 text-gray-600'
          }`}>
            Phase {phase}
          </span>
          <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
        </div>
      </div>

      {/* Phase 1 — no setup needed */}
      {phase < 2 ? (
        <div className="flex items-start gap-3 bg-gray-50 border border-gray-100 rounded-xl p-3.5">
          <Info size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            This branch is on Phase 1. ZATCA integration is not required.
            QR codes are generated locally. Upgrade to Phase 2 in the Branches tab when ready.
          </p>
        </div>
      ) : (
        <>
          <Stepper current={step} />

          <div className="border-t border-gray-100 pt-4">
            {step === 1 && (
              <Step1GenerateKeys branch={bc} onDone={handleDone} />
            )}
            {step === 2 && cert && (
              <Step2EnterOTP branch={bc} cert={cert} environment={environment} onDone={handleDone} />
            )}
            {step === 3 && (
              <Step3Activate branch={bc} environment={environment} onDone={handleDone} />
            )}
            {step === 4 && cert && (
              <Step4Done cert={cert} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Phase guide sidebar ─────────────────────────────────────────────────── */

function PhaseGuide() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Info size={14} className="text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900">ZATCA e-Invoicing Guide</h3>
      </div>

      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center mt-0.5">
            <CheckCircle2 size={13} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">Phase 1 — Generation (فاتورة)</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Invoices carry a TLV QR code. No real-time connection to ZATCA required.
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
              Real-time clearance / reporting of UBL 2.1 XML invoices via ECDSA P-256 signed XAdES signatures.
              Standard invoices: clearance. Simplified: reporting within 24h.
            </p>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Phase 2 Onboarding</p>
          {[
            'Generate ECDSA P-256 key pair and CSR (Step 1)',
            'Register EGS in Fatoorah portal → get OTP (Step 2)',
            'Compliance CSID is issued by ZATCA',
            'Convert to Production CSID (Step 3)',
            'Invoices are now signed and submitted automatically',
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <ChevronRight size={11} className="text-gray-300 mt-0.5 flex-shrink-0" />
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
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────────────────── */

export default function ZatcaTab() {
  const { profile } = useAuth()
  const [data, setData]       = useState<BranchWithCert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!profile?.tenant_id) return
    setLoading(true)
    const tid = profile.tenant_id
    const [branchesRes, certsRes] = await Promise.all([
      (supabase as any).from('branches').select('*').eq('tenant_id', tid).order('is_main_branch', { ascending: false }),
      (supabase as any).from('zatca_certificates').select('*').eq('tenant_id', tid),
    ])
    const branches = (branchesRes.data as Branch[]) ?? []
    const certs    = (certsRes.data as ZatcaCertificate[]) ?? []
    setData(branches.map(b => ({ ...b, cert: certs.find(c => c.branch_id === b.id) ?? null })))
    setLoading(false)
  }, [profile?.tenant_id])

  useEffect(() => { load() }, [load])

  const handleCertUpdate = (branchId: string, cert: ZatcaCertificate) => {
    setData(prev => prev.map(b => b.id === branchId ? { ...b, cert } : b))
  }

  const phase2Count  = data.filter(b => (b.zatca_phase ?? 1) === 2).length
  const activeCount  = data.filter(b => b.cert?.status === 'active').length

  const allProduction = data.filter(b => (b.zatca_phase ?? 1) === 2).every(b => b.cert?.environment === 'production')
  const showSandboxBanner = !allProduction || data.filter(b => (b.zatca_phase ?? 1) === 2).length === 0

  return (
    <div className="space-y-4">

      {/* SANDBOX MODE banner */}
      {showSandboxBanner && (
        <div className="flex items-center gap-3 bg-amber-400 rounded-2xl px-4 py-3">
          <FlaskConical size={16} className="text-amber-900 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">Sandbox Mode — Not Live</p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              Calls go to the ZATCA developer portal (test environment). No real invoices are submitted.
              Switch each branch to Production when ready to go live.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">ZATCA Phase 2 — Certificate Management</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.length} branch{data.length !== 1 ? 'es' : ''} · {phase2Count} on Phase 2 · {activeCount} active
          </p>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <Lock size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Private keys are encrypted at rest</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            ECDSA P-256 private keys are AES-256-GCM encrypted before storage.
            ZATCA API credentials are stored server-side and never exposed to the browser.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card p-5 h-48 animate-pulse bg-gray-50" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No branches configured</p>
          <p className="text-xs text-gray-400 mt-1">Add branches in the Branches tab first</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(bc => (
            <BranchOnboardingCard key={bc.id} bc={bc} onCertUpdate={handleCertUpdate} />
          ))}
        </div>
      )}

      <PhaseGuide />

      {/* Warning for incomplete branch data */}
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
    </div>
  )
}
