/**
 * ZATCA Phase 2 — Settings Tab
 *
 * Per-branch certificate management:
 *   - Sandbox uses the legacy 4-step browser CSR flow.
 *   - Production uses backend-only onboarding through zatca-onboard-production.
 *
 * Each branch operates independently and maintains separate certs per environment.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ShieldX, ShieldAlert, Clock, Building2,
  CheckCircle2, AlertTriangle, ExternalLink, Lock,
  Key, Loader2, Copy, Info, ChevronDown,
  Cpu, Wifi, BadgeCheck, FlaskConical, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { generateKeyPair, encryptPrivateKey } from '@/lib/zatca/crypto'
import { generateCSR } from '@/lib/zatca/csr'
import {
  getProductionOnboardingStatus,
  onboardProductionZatca,
  requestComplianceCsid,
  requestProductionCsid,
  type ProductionOnboardingResponse,
  type ProductionOnboardingStatus,
  type ZatcaFunctionalityMap,
} from '@/lib/zatca/api'
import type { Branch, ZatcaCertificate, CertificateStatus } from '@/types'

/* ── Types ───────────────────────────────────────────────────────────────── */

type BranchWithCert = Branch & { allCerts: ZatcaCertificate[] }
type OnboardingStep = 1 | 2 | 3 | 4

/* ── Step helpers ────────────────────────────────────────────────────────── */

function certStep(cert: ZatcaCertificate | null): OnboardingStep {
  if (!cert || !cert.csr)             return 1
  if (cert.status === 'compliance')   return 3
  if (cert.status === 'active')       return 4
  return 2
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

/* ── CSR display block (FIX 3) ───────────────────────────────────────────── */

function CsrBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className="space-y-2">
      <textarea
        readOnly
        value={value}
        rows={6}
        className="w-full text-[10px] font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none leading-relaxed"
      />
      <button
        onClick={copy}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
          copied
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-white border-gray-200 text-gray-700 hover:border-primary-300 hover:text-primary-700'
        }`}
      >
        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        {copied ? 'Copied!' : 'Copy Certificate Request'}
      </button>
    </div>
  )
}

/* ── Stepper ─────────────────────────────────────────────────────────────── */

const STEPS = [
  { n: 1, label: 'Generate' },
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

/* ── Step 1: Generate Security Certificate (FIX 1 + FIX 2) ──────────────── */

type FieldCheck = { label: string; valid: boolean; hint: string }

function Step1GenerateKeys({
  branch, environment, onDone,
}: {
  branch: BranchWithCert
  environment: 'sandbox'
  onDone: (cert: ZatcaCertificate) => void
}) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [csrPem, setCsrPem]   = useState<string | null>(null)

  const fieldChecks: FieldCheck[] = [
    {
      label: 'Company Name',
      valid: !!((branch.business_name || branch.name) ?? '').trim(),
      hint:  'missing',
    },
    {
      label: 'VAT Number',
      valid: !!(branch.vat_number && /^3\d{13}3$/.test(branch.vat_number)),
      hint:  'must be 15 digits, starting and ending with 3',
    },
    {
      label: 'CR / License Number',
      valid: !!(branch.cr_number && /^[a-zA-Z0-9]+$/.test(branch.cr_number)),
      hint:  'alphanumeric characters only',
    },
    {
      label: 'Building Number',
      valid: !!(branch.building_number && /^\d{4}$/.test(branch.building_number)),
      hint:  'must be exactly 4 digits',
    },
    {
      label: 'Postal Code',
      valid: !!(branch.postal_code && /^\d{5}$/.test(branch.postal_code)),
      hint:  'must be exactly 5 digits',
    },
    {
      label: 'Street Name',
      valid: !!branch.street?.trim(),
      hint:  'missing',
    },
    {
      label: 'City',
      valid: !!branch.city?.trim(),
      hint:  'missing',
    },
    {
      label: 'District',
      valid: !!branch.district?.trim(),
      hint:  'missing',
    },
  ]
  const invalidFields   = fieldChecks.filter(f => !f.valid)
  const branchDataValid = invalidFields.length === 0

  const navigateToBranches = () => {
    const el = document.querySelector('[data-tab="branches"]') as HTMLElement | null
    el?.click()
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const keyPair      = await generateKeyPair()
      const businessName = branch.business_name || branch.name
      const location     = [branch.building_number, branch.street, branch.district, branch.city, branch.postal_code]
        .filter(Boolean).join(', ') || branch.city || 'Riyadh, SA'
      const csr = await generateCSR({
        commonName:   businessName,
        branchId:     branch.id,
        vatNumber:    branch.vat_number ?? '',
        branchName:   branch.name,
        businessName: businessName,
        invoiceType:  '1100',
        location,
        industry:     'Supply activities',
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
          environment,
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
      {branchDataValid ? (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
          <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
          <p className="text-[11px] font-semibold text-emerald-700">✓ Branch details complete</p>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] font-semibold text-amber-800">
              Complete branch details before generating certificate. The following fields need attention:
            </p>
          </div>
          <ul className="space-y-1 pl-5">
            {invalidFields.map(f => (
              <li key={f.label} className="text-[11px] text-amber-700">
                ❌ <span className="font-semibold">{f.label}</span>
                {f.hint === 'missing' ? ' — missing' : ` — ${f.hint}`}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={navigateToBranches}
            className="text-[11px] font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-800 transition-colors"
          >
            Update Branch Settings →
          </button>
        </div>
      )}

      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3.5">
        <Info size={13} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          This will generate a sandbox digital signature key in your browser and create a sandbox security certificate request.
          The private key is encrypted before being stored securely in the database.
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
        disabled={loading || !branchDataValid}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
        {loading ? 'Generating…' : 'Generate Security Certificate'}
      </button>

      {csrPem && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={14} />
            <span className="text-xs font-semibold">Security certificate generated and stored</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Proceed to Step 2 to register this certificate with ZATCA.
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Device details block (shown in Step 2) ──────────────────────────────── */

function DeviceDetailsBlock({ branch }: { branch: BranchWithCert }) {
  const serial = `1-Meem|2-POS|3-${branch.id.substring(0, 8)}`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(serial)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5 space-y-3">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        When registering in Fatoorah Portal, use these details:
      </p>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 flex-shrink-0">Device Name</span>
          <span className="text-[11px] font-medium text-gray-800 text-right">Enter any name (e.g. {branch.name})</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 flex-shrink-0">Model</span>
          <span className="text-[11px] font-medium text-gray-800">POS</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 flex-shrink-0">Serial Number</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-medium text-gray-800">{serial}</span>
            <button
              onClick={copy}
              className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                copied ? 'text-emerald-600' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed border-t border-gray-200 pt-2.5">
        The serial number above is already embedded in your Certificate Request.
        Make sure to use the exact same serial number when adding a new device in the Fatoorah portal.
      </p>
    </div>
  )
}

/* ── Step 2: Enter OTP (FIX 3 — 2a/2b layout) ───────────────────────────── */

function Step2EnterOTP({
  branch, cert, environment, onDone,
}: {
  branch: BranchWithCert
  cert: ZatcaCertificate
  environment: 'sandbox'
  onDone: (updated: ZatcaCertificate) => void
}) {
  const [otp, setOtp]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const register = async () => {
    if (otp.length < 6) { setError('OTP must be 6 digits'); return }
    setLoading(true)
    setError(null)
    try {
      await requestComplianceCsid(cert.csr!, otp, branch.id, environment)
      const { data, error: dbErr } = await (supabase as any)
        .from('zatca_certificates')
        .select('*')
        .eq('branch_id', branch.id)
        .eq('environment', environment)
        .single()
      if (dbErr) throw new Error(dbErr.message)
      onDone(data)
    } catch (err: any) {
      setError(err.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Step 2a — Copy CSR */}
      {cert.csr && (
        <div className="space-y-2.5">
          <div>
            <p className="text-xs font-bold text-gray-800">Step 2a — Copy this into Fatoorah Portal</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Go to{' '}
              <a
                href="https://fatoorah.zatca.gov.sa"
                target="_blank" rel="noopener noreferrer"
                className="font-semibold text-primary-600 underline"
              >
                fatoorah.zatca.gov.sa
              </a>
              {' → '}E-Invoicing → My Devices → Add New Device → paste this Security Certificate Request:
            </p>
          </div>
          <CsrBlock value={cert.csr} />
          <DeviceDetailsBlock branch={branch} />
        </div>
      )}

      {/* Step 2b — Enter OTP */}
      <div className="space-y-2.5 border-t border-gray-100 pt-4">
        <div>
          <p className="text-xs font-bold text-gray-800">Step 2b — Enter the OTP you received</p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
            After pasting above, the Fatoorah portal shows a 6-digit OTP. Enter it here:
          </p>
        </div>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').substring(0, 6))}
          className="input text-center text-2xl tracking-[0.5em] font-mono"
        />
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          For sandbox testing, use OTP: <span className="font-mono font-bold tracking-widest">123345</span>
        </p>
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

/* ── Step 3: Activate sandbox certificate ───────────────────────────────── */

function Step3Activate({
  branch, environment, onDone,
}: {
  branch: BranchWithCert
  environment: 'sandbox'
  onDone: (updated: ZatcaCertificate) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const activate = async () => {
    setLoading(true)
    setError(null)
    try {
      await requestProductionCsid(branch.id, environment)
      const { data, error: dbErr } = await (supabase as any)
        .from('zatca_certificates')
        .select('*')
        .eq('branch_id', branch.id)
        .eq('environment', environment)
        .single()
      if (dbErr) throw new Error(dbErr.message)
      onDone(data)
    } catch (err: any) {
      setError(err.message ?? 'Activation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
        <CheckCircle2 size={13} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-emerald-700 leading-relaxed">
          Compliance certificate registered successfully. Click below to activate it.
          This will activate the branch in the ZATCA sandbox.
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
        {loading ? 'Activating certificate…' : 'Activate Certificate'}
      </button>

      <p className="text-[11px] text-gray-400 text-center">
        This contacts the ZATCA sandbox to issue your active sandbox certificate.
      </p>
    </div>
  )
}

/* ── Step 4: Done (FIX 1 — rename "CSID" terms) ─────────────────────────── */

function Step4Done({ cert }: { cert: ZatcaCertificate }) {
  const activatedDate = cert.activated_at
    ? new Date(cert.activated_at).toLocaleDateString('en-SA', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
        <ShieldCheck size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-emerald-800">Branch is Phase 2 compliant</p>
          <p className="text-[11px] text-emerald-700 mt-0.5">
            Active sandbox certificate is configured for test submissions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoRow
          label="Compliance Certificate"
          value={cert.compliance_csid ? '✅ Issued' : '❌ Not registered'}
        />
        <InfoRow
          label="Active Certificate"
          value={cert.production_csid ? '✅ Active' : '❌ Not activated'}
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
          label="Serial Number"
          value={cert.serial_number ?? '—'}
          mono
        />
      </div>

      {cert.last_invoice_hash && (
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
            Last Invoice Hash
          </p>
          <p className="text-[10px] text-green-400 font-mono break-all">{cert.last_invoice_hash}</p>
        </div>
      )}
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

function stepComplete(status: ProductionOnboardingStatus | undefined, step: ProductionOnboardingStatus): boolean {
  if (!status || status === 'failed' || status === 'compliance_failed' || status === 'not_started') return false
  return PRODUCTION_STEPS.findIndex(item => item.key === status) >=
    PRODUCTION_STEPS.findIndex(item => item.key === step)
}

function formatSampleType(type: string): string {
  return type.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function ProductionOnboardingPanel({ branch }: { branch: BranchWithCert }) {
  const { profile } = useAuth()
  const [otp, setOtp] = useState('')
  const [functionalityMap, setFunctionalityMap] = useState<ZatcaFunctionalityMap | ''>('')
  const [dryRun, setDryRun] = useState(true)
  const [status, setStatus] = useState<ProductionOnboardingResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwner = profile?.role === 'owner'
  const currentStatus = status?.onboardingStatus ?? 'not_started'

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
        }
      } catch (err: any) {
        if (mounted) setError(err.message ?? 'Unable to load production onboarding status')
      } finally {
        if (mounted) setStatusLoading(false)
      }
    }
    loadStatus()
    return () => { mounted = false }
  }, [branch.id, isOwner])

  const connect = async () => {
    if (!isOwner) {
      setError('Only the tenant owner can connect ZATCA production.')
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
      })
      setStatus(res)
      setOtp('')
    } catch (err: any) {
      setError(err.message ?? 'ZATCA production onboarding failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
        <ShieldCheck size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-emerald-800">Production setup</p>
          <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
            Log in to FATOORA portal, generate OTP from Onboard New Solution Unit/Device,
            paste OTP here within 1 hour.
          </p>
        </div>
      </div>

      {!isOwner && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <Lock size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-800">
            Production onboarding is restricted to the tenant owner.
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

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-700 leading-relaxed">{error}</p>
        </div>
      )}

      <button
        onClick={connect}
        disabled={!isOwner || loading || otp.length !== 6 || !functionalityMap}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
        {loading ? 'Connecting to ZATCA…' : 'Connect to ZATCA Production'}
      </button>

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
      </div>
    </div>
  )
}

/* ── Branch accordion row (FIX 2) ────────────────────────────────────────── */

function branchSummaryText(bc: BranchWithCert): string {
  const phase = bc.zatca_phase ?? 1
  if (phase < 2) return 'Phase 1 — QR code only'
  const bestCert = (
    bc.allCerts.find(c => c.status === 'active') ??
    bc.allCerts.find(c => c.status === 'compliance') ??
    bc.allCerts[0] ??
    null
  )
  if (!bestCert || !bestCert.csr) return 'Certificate not configured'
  if (bestCert.status === 'active')     return '✅ Certificate Active — Phase 2 Enabled'
  if (bestCert.status === 'compliance') return '🔄 Activation Pending'
  return '⏳ OTP Registration Pending'
}

function BranchAccordionRow({
  bc, isExpanded, onToggle, onCertUpdate,
}: {
  bc: BranchWithCert
  isExpanded: boolean
  onToggle: () => void
  onCertUpdate: (branchId: string, cert: ZatcaCertificate) => void
}) {
  const phase = bc.zatca_phase ?? 1

  // Best cert for the collapsed summary badges
  const bestCert = (
    bc.allCerts.find(c => c.status === 'active') ??
    bc.allCerts.find(c => c.status === 'compliance') ??
    bc.allCerts[0] ??
    null
  )
  const status = bestCert?.status ?? 'pending'
  const cfg    = CERT_CONFIG[status] ?? CERT_CONFIG.pending

  // Full card state (only needed when expanded)
  const initialEnv = (
    bc.allCerts.find(c => c.status === 'active')?.environment ??
    bc.allCerts.find(c => c.status === 'compliance')?.environment ??
    bc.allCerts[0]?.environment ??
    'sandbox'
  ) as 'sandbox' | 'production'
  const [environment,  setEnvironment]  = useState<'sandbox' | 'production'>(initialEnv)
  const [regenerating, setRegenerating] = useState(false)

  const cert     = bc.allCerts.find(c => c.environment === environment) ?? null
  const isActive = cert?.status === 'active'
  const step     = certStep(cert)

  const handleRegenerate = async () => {
    if (!window.confirm(
      'This will discard the current certificate and all credentials for this environment. Are you sure?'
    )) return
    setRegenerating(true)
    try {
      if (cert?.id) {
        const { data, error: dbErr } = await (supabase as any)
          .from('zatca_certificates')
          .update({
            csr:                   null,
            private_key_encrypted: null,
            public_key_pem:        null,
            compliance_csid:       null,
            compliance_secret:     null,
            compliance_request_id: null,
            production_csid:       null,
            production_secret:     null,
            status:                'pending',
          })
          .eq('id', cert.id)
          .select()
          .single()
        if (!dbErr && data) onCertUpdate(bc.id, data)
      }
    } finally {
      setRegenerating(false)
    }
  }

  const handleDone = (updated: ZatcaCertificate) => {
    onCertUpdate(bc.id, updated)
  }

  return (
    <div className="card overflow-hidden">
      {/* Collapsed header row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
          <Building2 size={14} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{bc.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{branchSummaryText(bc)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {phase >= 2 && bestCert && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              bestCert.environment === 'production'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {bestCert.environment === 'production' ? 'Production' : 'Sandbox'}
            </span>
          )}
          {phase >= 2 && <Badge variant={cfg.variant} dot>{cfg.label}</Badge>}
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
        <div className="border-t border-gray-100 p-5 space-y-5">
          {/* Phase 1 — info card (FIX 4) */}
          {phase < 2 ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
                <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-blue-800">This branch is on Phase 1</p>
                  <p className="text-[11px] text-blue-700 leading-relaxed">
                    Phase 1 invoices include a ZATCA QR code with seller details.
                    No certificate registration is required.
                  </p>
                  <p className="text-[11px] text-blue-700 leading-relaxed">
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
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-gray-500">Environment</p>
                {isActive ? (
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
                <div className="border-t border-gray-100 pt-4">
                  <ProductionOnboardingPanel branch={bc} />
                </div>
              ) : (
                <>
                  <Stepper current={step} />

                  <div className="border-t border-gray-100 pt-4">
                    {step === 1 && (
                      <Step1GenerateKeys branch={bc} environment={environment} onDone={handleDone} />
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

                  {cert && (
                    <div className="pt-3 border-t border-gray-100">
                      <button
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                      >
                        {regenerating ? <Loader2 size={11} className="animate-spin" /> : <Key size={11} />}
                        Regenerate certificate (discard current{isActive ? ' — unlocks environment toggle' : ''})
                      </button>
                    </div>
                  )}
                </>
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
    const [branchesRes, certsRes] = await Promise.all([
      (supabase as any).from('branches').select('*').eq('tenant_id', tid)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true }),
      (supabase as any).from('zatca_certificates').select('*').eq('tenant_id', tid),
    ])
    const branches = (branchesRes.data as Branch[]) ?? []
    const certs    = (certsRes.data as ZatcaCertificate[]) ?? []
    setData(branches.map(b => ({
      ...b,
      allCerts: certs.filter(c => c.branch_id === b.id),
    })))
    // Auto-expand first branch if only one
    if (branches.length === 1 && !expandedId) setExpandedId(branches[0].id)
    setLoading(false)
  }, [profile?.tenant_id])

  useEffect(() => { load() }, [load])

  const handleCertUpdate = (branchId: string, cert: ZatcaCertificate) => {
    setData(prev => prev.map(b => {
      if (b.id !== branchId) return b
      const idx = b.allCerts.findIndex(c => c.environment === cert.environment)
      const newCerts = idx >= 0
        ? b.allCerts.map((c, i) => i === idx ? cert : c)
        : [...b.allCerts, cert]
      return { ...b, allCerts: newCerts }
    }))
  }

  const handleToggle = (branchId: string) => {
    setExpandedId(prev => prev === branchId ? null : branchId)
  }

  const phase2Count = data.filter(b => (b.zatca_phase ?? 1) === 2).length
  const activeCount = data.filter(b => b.allCerts.some(c => c.status === 'active')).length

  const phase2Branches  = data.filter(b => (b.zatca_phase ?? 1) === 2)
  const allProduction   = phase2Branches.length > 0 &&
    phase2Branches.every(b => b.allCerts.some(c => c.environment === 'production' && c.status === 'active'))
  const showSandboxBanner = !allProduction

  return (
    <div className="space-y-4">
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}

      {/* Sandbox banner */}
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
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-primary-600 transition-colors border border-gray-200 hover:border-primary-200 px-2.5 py-1.5 rounded-lg"
          title="ZATCA e-Invoicing Guide"
        >
          <Info size={13} />
          Guide
        </button>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <Lock size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Private keys are encrypted at rest</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            Your private keys are encrypted with AES-256-GCM before storage.
            ZATCA API credentials are stored server-side and never exposed to the browser.
          </p>
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
          <p className="text-xs text-gray-400 mt-1">Add branches in the Branches tab first</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(bc => (
            <BranchAccordionRow
              key={bc.id}
              bc={bc}
              isExpanded={expandedId === bc.id}
              onToggle={() => handleToggle(bc.id)}
              onCertUpdate={handleCertUpdate}
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
    </div>
  )
}
