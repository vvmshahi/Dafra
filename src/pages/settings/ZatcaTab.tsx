import { useState, useEffect } from 'react'
import {
  ShieldCheck, ShieldAlert, ShieldX, Clock, Building2,
  CheckCircle2, AlertTriangle, ExternalLink, Upload,
  Info, Lock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import type { Branch, ZatcaCertificate, CertificateStatus } from '@/types'

/* ── Types ──────────────────────────────────────────────────── */

type BranchWithCert = Branch & { cert: ZatcaCertificate | null }

/* ── Status config ───────────────────────────────────────────── */

const CERT_CONFIG: Record<CertificateStatus, {
  icon: React.ElementType
  variant: 'success' | 'warning' | 'danger' | 'neutral'
  label: string
  desc: string
  iconClass: string
  bgClass: string
}> = {
  pending:  { icon: Clock,        variant: 'warning', label: 'Pending',    desc: 'Certificate not yet requested',   iconClass: 'text-amber-500', bgClass: 'bg-amber-50' },
  active:   { icon: ShieldCheck,  variant: 'success', label: 'Active',     desc: 'Certificate valid and in use',    iconClass: 'text-emerald-500', bgClass: 'bg-emerald-50' },
  revoked:  { icon: ShieldX,      variant: 'danger',  label: 'Revoked',   desc: 'Certificate has been revoked',    iconClass: 'text-red-500', bgClass: 'bg-red-50' },
  expired:  { icon: ShieldAlert,  variant: 'danger',  label: 'Expired',   desc: 'Certificate has expired',         iconClass: 'text-red-500', bgClass: 'bg-red-50' },
}

/* ── Branch cert card ────────────────────────────────────────── */

function BranchCertCard({ bc }: { bc: BranchWithCert }) {
  const cert   = bc.cert
  const phase  = bc.zatca_phase ?? 1
  const status = cert?.status ?? 'pending'
  const cfg    = CERT_CONFIG[status]
  const Icon   = cfg.icon

  return (
    <div className="card p-5 space-y-4">
      {/* Branch header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
            <Building2 size={16} className="text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{bc.name}</p>
            {bc.name_ar && <p className="text-xs text-gray-400" style={{ fontFamily: 'Cairo' }}>{bc.name_ar}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Certificate details grid */}
      <div className="grid grid-cols-2 gap-3">
        <InfoRow label="Environment" value={cert?.environment ?? '—'} mono />
        <InfoRow label="Serial Number" value={cert?.serial_number ?? '—'} mono />
        <InfoRow
          label="Valid From"
          value={cert?.valid_from ? new Date(cert.valid_from).toLocaleDateString('en-SA') : '—'}
        />
        <InfoRow
          label="Valid To"
          value={cert?.valid_to ? new Date(cert.valid_to).toLocaleDateString('en-SA') : '—'}
        />
        <InfoRow label="Compliance CSID" value={cert?.compliance_csid ? 'Issued ✓' : '—'} />
        <InfoRow label="Production CSID" value={cert?.production_csid ? 'Issued ✓' : '—'} />
      </div>

      {/* Status strip */}
      <div className={`flex items-center gap-3 rounded-xl p-3 ${cfg.bgClass}`}>
        <div className="flex-shrink-0">
          <Icon size={16} className={cfg.iconClass} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${cfg.iconClass}`}>{cfg.label}</p>
          <p className="text-[11px] text-gray-500">{cfg.desc}</p>
        </div>
        {phase === 2 && status !== 'active' && (
          <button className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1 flex-shrink-0">
            <Upload size={11} /> Upload CSID
          </button>
        )}
      </div>

      {/* Phase 2 actions (only show for phase 2 branches) */}
      {phase === 2 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-xl py-2.5 hover:bg-gray-100 transition-colors">
            <Upload size={12} /> Upload OTP
          </button>
          <button className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-xl py-2.5 hover:bg-gray-100 transition-colors">
            <ExternalLink size={12} /> ZATCA Portal
          </button>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2">
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
      <p className={`text-xs text-gray-700 mt-0.5 ${mono ? 'font-mono' : 'font-medium'} truncate`}>{value}</p>
    </div>
  )
}

/* ── Phase guide ─────────────────────────────────────────────── */

function PhaseGuide() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Info size={14} className="text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900">ZATCA e-Invoicing Guide</h3>
      </div>

      <div className="space-y-3">
        {/* Phase 1 */}
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center mt-0.5">
            <CheckCircle2 size={13} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">Phase 1 — Generation (فاتورة)</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Invoices include a QR code encoded in TLV format. No internet connection to ZATCA is required.
              Each simplified invoice and credit/debit note must have a valid QR.
            </p>
          </div>
        </div>

        {/* Phase 2 */}
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center mt-0.5">
            <ShieldCheck size={13} className="text-primary-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">Phase 2 — Integration (ربط)</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Real-time clearance/reporting of UBL 2.1 XML invoices to ZATCA API.
              Requires a valid CSID certificate per branch (ECDSA P-256).
              Standard invoices: clearance. Simplified invoices: reporting (within 24h).
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Phase 2 Onboarding Steps</p>
          {[
            'Configure branch with VAT number and address',
            'Generate CSR (Certificate Signing Request) via ZATCA Portal',
            'Enter the OTP received from ZATCA',
            'Receive Compliance CSID — run compliance checks',
            'Request Production CSID — go live',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <p className="text-[11px] text-gray-600">{step}</p>
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

/* ── Main tab ─────────────────────────────────────────────────── */

export default function ZatcaTab() {
  const { profile } = useAuth()
  const [data, setData]     = useState<BranchWithCert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.tenant_id) return
    const tid = profile.tenant_id
    ;(async () => {
      setLoading(true)
      const [branchesRes, certsRes] = await Promise.all([
        supabase.from('branches').select('*').eq('tenant_id', tid).order('is_main_branch', { ascending: false }),
        supabase.from('zatca_certificates').select('*').eq('tenant_id', tid),
      ])
      const branches  = (branchesRes.data as Branch[]) ?? []
      const certs     = (certsRes.data as ZatcaCertificate[]) ?? []
      const merged: BranchWithCert[] = branches.map(b => ({
        ...b,
        cert: certs.find(c => c.branch_id === b.id) ?? null,
      }))
      setData(merged)
      setLoading(false)
    })()
  }, [profile?.tenant_id])

  const phase2Count  = data.filter(b => (b.zatca_phase ?? 1) === 2).length
  const activeCount  = data.filter(b => b.cert?.status === 'active').length

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">ZATCA Certificates</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.length} branch{data.length !== 1 ? 'es' : ''} · {phase2Count} on Phase 2 · {activeCount} active certificate{activeCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <Lock size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Private keys are encrypted at rest</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            ECDSA P-256 private keys are AES-encrypted and never exposed to the client.
            Certificate management actions are processed server-side via Edge Functions.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="card p-5 h-36 animate-pulse bg-gray-50" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="card p-12 text-center">
          <ShieldCheck size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No branches configured</p>
          <p className="text-xs text-gray-400 mt-1">Add branches in the Branches tab first</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(bc => <BranchCertCard key={bc.id} bc={bc} />)}
        </div>
      )}

      <PhaseGuide />

      {/* Warning for missing fields */}
      {data.some(b => !b.vat_number && (b.zatca_phase ?? 1) === 2) && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl p-4">
          <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Incomplete branch data</p>
            <p className="text-[11px] text-red-600 mt-0.5">
              Some Phase 2 branches are missing VAT number or address fields required for ZATCA registration. Edit those branches to complete setup.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
