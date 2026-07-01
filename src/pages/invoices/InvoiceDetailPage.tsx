import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw, Loader2, AlertCircle, CheckCircle2, Bug, FileText } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { Rial } from '@/components/ui/RiyalSymbol'
import { buildZatcaQR, decodeTLV } from '@/lib/zatca/qr'
import { toSaudiTime } from '@/lib/utils/date'
import ThermalReceipt, { printThermal } from '@/components/print/ThermalReceipt'
import type { Invoice, InvoiceItem, Payment, Branch, PaymentRefund, PaymentMethod, ZatcaStatus } from '@/types/database'
import { printSilent } from '@/lib/electron'
import { submitInvoiceToZatca } from '@/lib/zatca/submission'
import CreateCreditNoteModal, { type CreditNoteCreatedResult } from './CreateCreditNoteModal'

function WhatsAppIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Tenant {
  name: string
  name_ar: string | null
  vat_number: string
  cr_number: string | null
  address: string | null
}

interface Customer {
  name: string
  name_ar: string | null
  vat_number: string | null
  customer_type: string
  company_name: string | null
  business_name: string | null
  business_name_ar: string | null
  phone: string | null
}

interface LinkedCreditNote {
  id: string
  invoice_number: string
  total_amount: number
  zatca_status: ZatcaStatus
  payment_status: string | null
  credit_reason: string | null
  created_at: string
}

interface OriginalInvoiceLink {
  id: string
  invoice_number: string
  total_amount: number
  zatca_status: ZatcaStatus
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true }),
  }
}

const ZATCA_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  not_submitted: { label: 'Not Required (Phase 1)',  color: 'text-blue-600',    icon: '●' },
  pending:       { label: 'Pending Submission',       color: 'text-gray-500',    icon: '◷' },
  reported:      { label: 'Reported to ZATCA',        color: 'text-green-600',   icon: '✓' },
  cleared:       { label: 'Cleared by ZATCA',         color: 'text-emerald-600', icon: '✓' },
  failed:        { label: 'Submission Failed',        color: 'text-red-600',     icon: '✗' },
}

const PAY_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card / POS', bank_transfer: 'Bank Transfer', other: 'Other',
}

function paymentLabel(method: string | null | undefined): string {
  return method ? (PAY_LABEL[method] ?? method) : '—'
}

function isSplitPaymentRows(payments: Payment[]): boolean {
  return payments.length > 1
    && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
    && payments.some(payment => payment.method === 'card' && Number(payment.amount) > 0)
}

function paymentRowsTotal(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
}

function creditStatusLabel(linkedCreditNote: LinkedCreditNote | null): string {
  if (!linkedCreditNote) return 'Not credited'
  if (linkedCreditNote.zatca_status === 'reported' || linkedCreditNote.zatca_status === 'cleared') return 'Fully credited'
  if (linkedCreditNote.zatca_status === 'failed') return 'Credit note failed'
  return 'Credit note pending'
}

const INVOICE_DETAIL_SELECT = `
  id, tenant_id, branch_id, customer_id, created_by,
  invoice_number, invoice_reference, original_invoice_id, credit_reason,
  credit_note_idempotency_key, zatca_uuid, zatca_invoice_type, zatca_type_code,
  zatca_counter_number, zatca_prev_invoice_hash, zatca_xml_hash, zatca_qr_code,
  zatca_status, zatca_submission_id, zatca_submitted_at, zatca_clearance_status,
  zatca_warnings,
  subtotal, discount_amount, taxable_amount, tax_amount, total_amount, currency_code,
  invoice_date, supply_date, due_date, status, payment_status,
  notes, notes_ar, cancelled_at, cancellation_reason, created_at, updated_at
`

interface SafeZatcaFailureSummary {
  statusString?: string
  message?: string
  httpStatus?: number
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  errorCodes?: string[]
  errors?: Array<{ code?: string; message?: string }>
}

function safeFailureText(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength)
  if (!text) return undefined
  if (/private[_ -]?key|secret|token|authorization|certificate|csid|xml|signedInvoice/i.test(text)) {
    return 'Sensitive detail redacted.'
  }
  return text
}

function getZatcaFailureSummary(invoice: Invoice): SafeZatcaFailureSummary | null {
  const summary = (invoice.zatca_warnings as any)?.failureSummary
  if (!summary || typeof summary !== 'object') return null

  const errors = Array.isArray(summary.errors)
    ? summary.errors.slice(0, 3).map((item: any) => ({
      code: safeFailureText(item?.code, 80),
      message: safeFailureText(item?.message, 220),
    })).filter((item: any) => item.code || item.message)
    : undefined

  const errorCodes = Array.isArray(summary.errorCodes)
    ? summary.errorCodes.map((code: unknown) => safeFailureText(code, 80)).filter(Boolean) as string[]
    : undefined

  return {
    statusString: safeFailureText(summary.statusString, 120),
    message: safeFailureText(summary.message, 220),
    httpStatus: typeof summary.httpStatus === 'number' ? summary.httpStatus : undefined,
    validationStatus: safeFailureText(summary.validationStatus, 80),
    reportingStatus: safeFailureText(summary.reportingStatus, 80),
    clearanceStatus: safeFailureText(summary.clearanceStatus, 80),
    errorCodes,
    errors,
  }
}

// ── Print style injector ──────────────────────────────────────────────────────

function usePrintStyle() {
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'invoice-print-style'
    style.textContent = `
      @media print {
        @page { size: A4; margin: 15mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { visibility: hidden !important; }
        #invoice-printable, #invoice-printable * { visibility: visible !important; }
        #invoice-printable {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          background: white !important;
          z-index: 99999 !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .no-print { display: none !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('invoice-print-style')?.remove() }
  }, [])
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const location   = useLocation()
  const debugMode  = new URLSearchParams(location.search).get('debug') === 'true'
  const autoPrint  = new URLSearchParams(location.search).get('print') === '1'
  usePrintStyle()

  const [invoice,  setInvoice]  = useState<Invoice | null>(null)
  const [items,    setItems]    = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [refunds,  setRefunds]  = useState<PaymentRefund[]>([])
  const [branch,   setBranch]   = useState<Branch | null>(null)
  const [tenant,   setTenant]   = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [linkedCreditNote, setLinkedCreditNote] = useState<LinkedCreditNote | null>(null)
  const [originalInvoiceLink, setOriginalInvoiceLink] = useState<OriginalInvoiceLink | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [qrDataUrl,    setQrDataUrl]    = useState<string | null>(null)
  const [qrPayload,    setQrPayload]    = useState<string | null>(null)
  const [resubmitting, setResubmitting] = useState(false)
  const [isPhase2,     setIsPhase2]     = useState(false)
  const [isPrinting,   setIsPrinting]   = useState(false)
  const [creditModalOpen, setCreditModalOpen] = useState(false)

  useEffect(() => {
    const before = () => setIsPrinting(true)
    const after  = () => setIsPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint',  after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint',  after)
    }
  }, [])

  // Load data
  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Round 1: invoice + items + payments in parallel
        const [{ data: inv, error: invErr }, { data: itemData }, { data: pmtData }] = await Promise.all([
          supabase.from('invoices').select(INVOICE_DETAIL_SELECT).eq('id', id).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order'),
          supabase.from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: true }).order('created_at', { ascending: true }),
        ])

        if (invErr || !inv) { setError('Invoice not found'); setLoading(false); return }
        if (cancelled) return

        // Round 2: branch + tenant + customer in parallel
        const fetches: Promise<any>[] = [
          supabase.from('branches').select('*').eq('id', inv.branch_id).single(),
          supabase.from('tenants').select('name, name_ar, vat_number, cr_number, address').eq('id', inv.tenant_id).single(),
        ]
        if (inv.customer_id) {
          fetches.push(
            supabase.from('customers')
              .select('name, name_ar, vat_number, customer_type, company_name, business_name, business_name_ar, phone')
              .eq('id', inv.customer_id)
              .single()
          )
        }

        const results = await Promise.all(fetches)
        if (cancelled) return

        const branchData = results[0].data as Branch
        const tenantData = results[1].data as Tenant
        const custData   = results[2]?.data as Customer | null ?? null

        const [creditNoteResult, originalInvoiceResult, refundResult] = await Promise.all([
          inv.zatca_invoice_type === 'credit_note'
            ? Promise.resolve({ data: null })
            : supabase
              .from('invoices')
              .select('id, invoice_number, total_amount, zatca_status, payment_status, credit_reason, created_at')
              .eq('original_invoice_id', inv.id)
              .eq('zatca_invoice_type', 'credit_note')
              .neq('status', 'cancelled')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          inv.original_invoice_id
            ? supabase
              .from('invoices')
              .select('id, invoice_number, total_amount, zatca_status')
              .eq('id', inv.original_invoice_id)
              .maybeSingle()
            : Promise.resolve({ data: null }),
          (supabase as any)
            .from('payment_refunds')
            .select('*')
            .or(`original_invoice_id.eq.${inv.id},credit_note_invoice_id.eq.${inv.id}`)
            .order('created_at', { ascending: false }),
        ])

        setInvoice(inv as Invoice)
        setItems((itemData ?? []) as InvoiceItem[])
        setPayments((pmtData ?? []) as Payment[])
        setRefunds((refundResult.data ?? []) as PaymentRefund[])
        setBranch(branchData)
        setTenant(tenantData)
        setCustomer(custData)
        setLinkedCreditNote((creditNoteResult.data ?? null) as LinkedCreditNote | null)
        setOriginalInvoiceLink((originalInvoiceResult.data ?? null) as OriginalInvoiceLink | null)

        const [{ data: sandboxCert }] = await Promise.all([
          (supabase as any)
            .from('zatca_certificates')
            .select('id')
            .eq('branch_id', inv.branch_id)
            .eq('status', 'active')
            .maybeSingle(),
        ])
        setIsPhase2((branchData.zatca_phase ?? 1) === 2 || !!sandboxCert || inv.zatca_status !== 'not_submitted')
      } catch (e) {
        if (!cancelled) setError('Failed to load invoice')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  // Generate QR code after data loads
  useEffect(() => {
    if (!invoice || !branch || !tenant) return
    let cancelled = false

    async function generateQR() {
      // Use the stored TLV from DB when available — guarantees debug panel shows
      // the exact same payload that was encoded into the QR at creation time.
      const storedPayload = invoice!.zatca_qr_code

      const payload = storedPayload ?? buildZatcaQR({
        // QR tag 1: always use legal business_name, never display_name (ZATCA requirement)
        sellerName:  branch!.business_name || branch!.name,
        vatNumber:   branch!.vat_number || tenant!.vat_number || '',
        timestamp:   invoice!.created_at,
        totalAmount: Number(invoice!.total_amount),
        vatAmount:   Number(invoice!.tax_amount),
      })

      if (!cancelled) setQrPayload(payload)

      try {
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          width: 200,
          margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        })
        if (cancelled) return
        setQrDataUrl(url)

        // Persist QR payload to DB if not yet stored (e.g. invoices created before this fix)
        if (!storedPayload) {
          const q = supabase as unknown as { from: (t: string) => any }
          q.from('invoices').update({ zatca_qr_code: payload }).eq('id', invoice!.id)
        }
      } catch {}
    }

    generateQR()
    return () => { cancelled = true }
  }, [invoice, branch, tenant])

  // Auto-print when ?print=1 is in the URL
  useEffect(() => {
    if (!autoPrint || loading || !invoice || !branch) return
    const t = setTimeout(() => printSilent(), 500)
    return () => clearTimeout(t)
  }, [autoPrint, loading, invoice, branch])

  // ── Actions ────────────────────────────────────────────────────────────────

  function handlePrintA4() {
    printSilent()
  }

  function handlePrintThermal() {
    printThermal()
  }

  function handleWhatsApp() {
    if (!customer?.phone) return
    const digits = customer.phone.replace(/\D/g, '')
    const wa = digits.startsWith('966') ? digits : digits.startsWith('0') ? '966' + digits.slice(1) : digits
    const date = fmtDateTime(invoice!.created_at).date
    const m = (n: number) => `SAR ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const lines = items.map(i => `${i.name} × ${Number(i.quantity)}  ${m(Number(i.total))}`).join('\n')
    const bizName = brandName
    const msg = `${isCreditNote ? 'إشعارك الدائن' : 'فاتورتك'} من ${bizName}
━━━━━━━━━━━━━━━
${isCreditNote ? 'رقم الإشعار الدائن' : 'رقم الفاتورة'}: ${invoice!.invoice_number}
${isCreditNote && invoice!.invoice_reference ? `الفاتورة الأصلية: ${invoice!.invoice_reference}\n` : ''}التاريخ: ${date}
━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━
المجموع: ${m(Number(invoice!.subtotal))}
الضريبة: ${m(Number(invoice!.tax_amount))}
${isCreditNote ? 'إجمالي الإشعار الدائن' : 'الإجمالي'}: ${m(Number(invoice!.total_amount))}
━━━━━━━━━━━━━━━
شكراً لزيارتكم 🌿`
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleResend() {
    if (!invoice) return
    setResubmitting(true)
    try {
      setInvoice(prev => prev ? { ...prev, zatca_status: 'pending' } : prev)
      await submitInvoiceToZatca(invoice.id, invoice.branch_id, { source: 'manual_retry' })
      const { data: refreshed } = await supabase.from('invoices').select(INVOICE_DETAIL_SELECT).eq('id', invoice.id).single()
      if (refreshed) setInvoice(refreshed as Invoice)
    } catch {
      const { data: refreshed } = await supabase.from('invoices').select(INVOICE_DETAIL_SELECT).eq('id', invoice.id).single()
      if (refreshed) setInvoice(refreshed as Invoice)
    } finally {
      setResubmitting(false)
    }
  }

  function openCreditModal() {
    if (!invoice) return
    setCreditModalOpen(true)
  }

  function handleCreditNoteCreated(result: CreditNoteCreatedResult) {
    if (!invoice) return
    setLinkedCreditNote({
      id: result.creditNoteId,
      invoice_number: result.creditNoteNumber,
      total_amount: result.total,
      zatca_status: result.zatcaStatus,
      payment_status: result.refundStatus,
      credit_reason: result.reason,
      created_at: result.createdAt,
    })
    setRefunds(prev => [{
      id: `local-${result.creditNoteId}`,
      tenant_id: invoice.tenant_id,
      branch_id: invoice.branch_id,
      original_invoice_id: invoice.id,
      credit_note_invoice_id: result.creditNoteId,
      payment_id: payment?.id ?? null,
      method: result.refundMethod,
      amount: result.total,
      reason: result.reason,
      status: 'completed',
      created_by: null,
      created_at: result.createdAt,
    }, ...prev])

    void (async () => {
      const [creditNoteResult, refundResult] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, total_amount, zatca_status, payment_status, credit_reason, created_at')
          .eq('id', result.creditNoteId)
          .maybeSingle(),
        (supabase as any)
          .from('payment_refunds')
          .select('*')
          .or(`original_invoice_id.eq.${invoice.id},credit_note_invoice_id.eq.${result.creditNoteId}`)
          .order('created_at', { ascending: false }),
      ])

      if (creditNoteResult.data) {
        setLinkedCreditNote(creditNoteResult.data as LinkedCreditNote)
      }
      if (refundResult.data) {
        setRefunds(refundResult.data as PaymentRefund[])
      }
    })()
  }

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-gray-300" />
      </div>
    )
  }

  if (error || !invoice || !branch) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
        <AlertCircle size={32} />
        <p className="text-sm">{error ?? 'Invoice not found'}</p>
        <button onClick={() => navigate('/invoices')}
          className="text-xs text-primary-500 underline">← Back to Invoices</button>
      </div>
    )
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const invDate = new Date(invoice.created_at).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Riyadh', day: '2-digit', month: 'long', year: 'numeric',
  })
  const invTime = toSaudiTime(invoice.created_at)
  const zatcaMeta = ZATCA_STATUS[invoice.zatca_status] ?? ZATCA_STATUS.pending
  const zatcaFailureSummary = invoice.zatca_status === 'failed' ? getZatcaFailureSummary(invoice) : null
  const payment   = payments[0] ?? null
  const isSplitPayment = isSplitPaymentRows(payments)
  const payLabel  = payments.length > 0 ? (isSplitPayment ? 'Split Payment' : paymentLabel(payment?.method)) : null
  const cashPayment = payments.find(p => p.method === 'cash')
  const cardPayment = payments.find(p => p.method === 'card')
  const cashReceived = payment?.method === 'cash'
    ? Number(payment.amount_received ?? payment.amount ?? invoice.total_amount)
    : null
  const changeAmount = payment?.method === 'cash'
    ? Number(payment.change_amount ?? 0)
    : null
  const isCancelled = invoice.status === 'cancelled'
  const isCreditNote = invoice.zatca_invoice_type === 'credit_note'
  const hasRefunds = refunds.length > 0
  const isStandardDocument = invoice.zatca_invoice_type === 'standard'
    || (isCreditNote && customer?.customer_type === 'business' && !!customer?.vat_number)
  const documentTitleAr = isCreditNote
    ? (isStandardDocument ? 'إشعار دائن ضريبي' : 'إشعار دائن ضريبي مبسط')
    : (isStandardDocument ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة')
  const documentTitleEn = isCreditNote
    ? (isStandardDocument ? 'Tax Credit Note' : 'Simplified Tax Credit Note')
    : (isStandardDocument ? 'Standard Tax Invoice' : 'Simplified Tax Invoice')
  const documentNumberLabel = isCreditNote ? 'Credit Note #' : 'Invoice #'
  const creditLabel = creditStatusLabel(linkedCreditNote)
  const creditLabelClass = linkedCreditNote
    ? linkedCreditNote.zatca_status === 'failed'
      ? 'text-red-600 bg-red-50 border-red-100'
      : linkedCreditNote.zatca_status === 'reported' || linkedCreditNote.zatca_status === 'cleared'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
      : 'text-amber-700 bg-amber-50 border-amber-100'
    : 'text-gray-600 bg-gray-50 border-gray-100'
  const canCreateCreditNote = !isCreditNote
    && !isCancelled
    && invoice.status === 'posted'
    && (invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    && !linkedCreditNote
  const creditDisabledReason = isCreditNote
    ? 'Credit notes cannot be credited in this MVP.'
    : linkedCreditNote
    ? 'This invoice already has a full credit note.'
    : invoice.status !== 'posted'
    ? 'Only posted invoices can be credited.'
    : !(invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    ? 'Only reported or cleared invoices can be credited.'
    : isCancelled
    ? 'Cancelled invoices cannot be credited here.'
    : null
  const canSubmitCurrentDocument = invoice.zatca_status === 'failed'
    || (isCreditNote && invoice.zatca_status === 'pending')

  const brandName = branch.display_name || branch.business_name || branch.name
  const legalName = branch.business_name || branch.name
  const vatNumber    = branch.vat_number || tenant?.vat_number || '—'
  const crNumber     = branch.cr_number  || tenant?.cr_number  || '—'

  const addressParts = [
    branch.building_number ? `Building ${branch.building_number}` : null,
    branch.street,
    branch.district,
    branch.city,
    branch.country,
    branch.postal_code,
  ].filter(Boolean).join(', ')

  // ── Build thermal receipt data ────────────────────────────────────────────

  const thermalItems = items.map(i => ({
    name:      i.name_ar?.trim() ? i.name_ar : i.name,
    qty:       Number(i.quantity),
    unitPrice: Number(i.unit_price),
    lineTotal: Number(i.total),
  }))

  const thermalAddress = [
    branch.building_number ? `Building ${branch.building_number}` : null,
    branch.street, branch.district, branch.city,
  ].filter(Boolean).join(', ')

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* ── Hidden thermal receipt (for print) ──────────── */}
      <ThermalReceipt
        businessNameAr={brandName}
        businessNameEn={legalName}
        branchName={null}
        address={thermalAddress || null}
        vatNumber={vatNumber}
        phone={branch.phone}
        website={branch.website}
        showWebsite={branch.show_website ?? false}
        email={branch.email}
        showEmail={branch.show_email ?? false}
        invoiceNumber={invoice.invoice_number}
        date={invDate}
        time={invTime}
        items={thermalItems}
        subtotal={Number(invoice.subtotal)}
        taxAmount={Number(invoice.tax_amount)}
        total={Number(invoice.total_amount)}
        paymentMethod={isSplitPayment ? 'split' : (payment?.method ?? 'card')}
        payments={payments.map(p => ({ method: p.method, amount: Number(p.amount) }))}
        cashReceived={cashReceived}
        change={changeAmount}
        customerName={
          customer?.customer_type === 'business' && (customer.business_name ?? customer.company_name)
            ? (customer.business_name ?? customer.company_name)
            : (customer?.name ?? null)
        }
        buyerVatNumber={isStandardDocument ? (customer?.vat_number ?? null) : null}
        isStandardInvoice={isStandardDocument}
        documentType={isCreditNote ? 'credit_note' : 'invoice'}
        originalInvoiceNumber={invoice.invoice_reference ?? originalInvoiceLink?.invoice_number ?? null}
        creditReason={invoice.credit_reason}
        logoUrl={branch.logo_url}
        showLogo={branch.show_logo ?? true}
        qrDataUrl={qrDataUrl}
        receiptFooter={branch.receipt_footer}
        showFooter={branch.show_footer ?? true}
        showCashChange={branch.show_cash_change ?? true}
      />

      {/* ── Action bar (screen only) ─────────────────────── */}
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={16} />
          Back to Invoices
        </button>

        <div className="flex items-center gap-2">
          {canSubmitCurrentDocument && (
            <button onClick={handleResend} disabled={resubmitting}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={resubmitting ? 'animate-spin' : ''} />
              {isCreditNote && invoice.zatca_status === 'pending' ? 'Submit Credit Note to ZATCA' : 'Resend to ZATCA'}
            </button>
          )}
          {customer?.phone && (
            <button onClick={handleWhatsApp}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#25D366] rounded-xl hover:bg-[#22c55e] transition-colors">
              <WhatsAppIcon size={13} />
              WhatsApp
            </button>
          )}
          <button onClick={handlePrintThermal}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <Printer size={13} />
            Print Receipt
          </button>
          <button onClick={handlePrintA4}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2419] rounded-xl hover:bg-[#1a3a28] transition-colors">
            <Printer size={13} />
            Print {isCreditNote ? 'Credit Note' : 'Invoice'} (PDF)
          </button>
        </div>
      </div>

      {/* ── Cancelled banner ─────────────────────────────── */}
      {isCancelled && (
        <div className="no-print bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          This invoice has been cancelled and is void.
        </div>
      )}

      {/* ── Refund / Credit Note status ─────────────────── */}
      <div className="no-print bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-[#0F2419]" />
              <h2 className="text-sm font-bold text-gray-900">Refund / Credit Note</h2>
              {!isCreditNote && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${creditLabelClass}`}>
                  {creditLabel}
                </span>
              )}
            </div>

            {isCreditNote ? (
              <div className="space-y-1 text-xs text-gray-600">
                <p>This document credits original invoice <span className="font-semibold text-gray-900">{invoice.invoice_reference ?? originalInvoiceLink?.invoice_number ?? '—'}</span>.</p>
                {invoice.credit_reason && <p><span className="font-semibold text-gray-800">Reason:</span> {invoice.credit_reason}</p>}
                {originalInvoiceLink && (
                  <button
                    type="button"
                    onClick={() => navigate(`/invoices/${originalInvoiceLink.id}`)}
                    className="text-xs font-semibold text-[#0F2419] underline underline-offset-2"
                  >
                    Open original invoice
                  </button>
                )}
              </div>
            ) : linkedCreditNote ? (
              <div className="space-y-1 text-xs text-gray-600">
                <p>Full credit note <span className="font-semibold text-gray-900">{linkedCreditNote.invoice_number}</span> exists for this invoice.</p>
                <p>ZATCA status: <span className="font-semibold">{ZATCA_STATUS[linkedCreditNote.zatca_status]?.label ?? linkedCreditNote.zatca_status}</span></p>
                {linkedCreditNote.credit_reason && <p><span className="font-semibold text-gray-800">Reason:</span> {linkedCreditNote.credit_reason}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Create a full credit note only after the original invoice has been reported or cleared.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            {linkedCreditNote && !isCreditNote && (
              <button
                type="button"
                onClick={() => navigate(`/invoices/${linkedCreditNote.id}`)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Open Credit Note
              </button>
            )}
            {!isCreditNote && !linkedCreditNote && (
              <button
                type="button"
                onClick={openCreditModal}
                disabled={!canCreateCreditNote}
                title={creditDisabledReason ?? undefined}
                className="rounded-xl bg-[#0F2419] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
              >
                Create Full Credit Note / Refund
              </button>
            )}
          </div>
        </div>

        {creditDisabledReason && !isCreditNote && !linkedCreditNote && (
          <p className="mt-3 text-[11px] text-gray-400">{creditDisabledReason}</p>
        )}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* PRINTABLE INVOICE AREA                            */}
      {/* ══════════════════════════════════════════════════ */}
      <div id="invoice-printable" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

        {/* ── Invoice header ─────────────────────────────── */}
        <div className="px-8 pt-8 pb-6 border-b border-gray-100">
          <div className="flex items-start justify-between gap-6">

            {/* Seller info (left) */}
            <div className="flex items-start gap-4 flex-1">
              {branch.logo_url && (branch.show_logo ?? true) ? (
                <img src={branch.logo_url} alt="logo" className="w-14 h-14 object-contain rounded-xl flex-shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[#0F2419] flex items-center justify-center flex-shrink-0">
                  <span className="text-gold-400 font-black text-2xl leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
                </div>
              )}
              <div>
                <p className="text-xl font-bold text-gray-900" dir="auto" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  {brandName}
                </p>
                {legalName !== brandName && <p className="text-sm text-gray-400 font-medium">{legalName}</p>}
                {addressParts && <p className="text-xs text-gray-400 mt-1 max-w-xs">{addressParts}</p>}
                <div className="flex flex-wrap gap-3 mt-2">
                  <span className="text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-700">VAT:</span> {vatNumber}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-700">CR:</span> {crNumber}
                  </span>
                </div>
                {(branch.show_website ?? false) && branch.website && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{branch.website}</p>
                )}
                {(branch.show_email ?? false) && branch.email && (
                  <p className="text-[10px] text-gray-400">{branch.email}</p>
                )}
              </div>
            </div>

            {/* Invoice info + QR (right) */}
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-[#0F2419]" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>
                {documentTitleAr}
              </p>
              <p className="text-xs text-gray-400 mb-3">{documentTitleEn}</p>

              <div className="space-y-1">
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs font-semibold text-gray-800 font-mono">{invoice.invoice_number}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">{documentNumberLabel}</span>
                </div>
                {isCreditNote && (invoice.invoice_reference || originalInvoiceLink?.invoice_number) && (
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-xs text-gray-700">{invoice.invoice_reference ?? originalInvoiceLink?.invoice_number}</span>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Original Invoice</span>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-gray-700">{invDate}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Date</span>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-gray-700">{invTime}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Time</span>
                </div>
              </div>

              <p className="text-[9px] text-gray-300 mt-2 font-mono break-all max-w-[200px] text-right no-print">
                {invoice.zatca_uuid}
              </p>
            </div>
          </div>
        </div>

        {/* ── Customer section ────────────────────────────── */}
        <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/50">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Bill To</p>
          {customer ? (
            <>
              {customer.customer_type === 'business' && (customer.business_name ?? customer.company_name) ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">
                    {customer.business_name ?? customer.company_name}
                  </p>
                  {customer.business_name_ar && (
                    <p className="text-xs text-gray-400" dir="rtl">{customer.business_name_ar}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">Contact: {customer.name}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
                  {customer.name_ar && (
                    <p className="text-xs text-gray-400" dir="rtl">{customer.name_ar}</p>
                  )}
                </>
              )}
              {customer.vat_number && (
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-semibold">VAT:</span> {customer.vat_number}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-600">Walk-in Customer</p>
          )}
        </div>

        {isCreditNote && (
          <div className="px-8 py-4 border-b border-gray-100 bg-amber-50/40">
            <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest mb-2">Credit Note Reference</p>
            <div className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2">
              <span><span className="font-semibold">Original Invoice:</span> {invoice.invoice_reference ?? originalInvoiceLink?.invoice_number ?? '—'}</span>
              <span><span className="font-semibold">Credit Amount:</span> <Rial amount={Number(invoice.total_amount)} /></span>
              {invoice.credit_reason && (
                <span className="sm:col-span-2"><span className="font-semibold">Reason:</span> {invoice.credit_reason}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Line items table ─────────────────────────────── */}
        <div className="px-8 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-6">#</th>
                <th className="text-left py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-16">Unit</th>
                <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-12">Qty</th>
                <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-28">Unit Price</th>
                <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-16">VAT %</th>
                <th className="text-right py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="py-3 text-[10px] text-gray-300">{i + 1}</td>
                  <td className="py-3">
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    {item.name_ar && (
                      <p className="text-[10px] text-gray-400" dir="rtl">{item.name_ar}</p>
                    )}
                  </td>
                  <td className="py-3 text-right text-xs text-gray-500">{item.unit ?? '—'}</td>
                  <td className="py-3 text-right text-xs text-gray-800 tabular-nums font-medium">{Number(item.quantity)}</td>
                  <td className="py-3 text-right text-xs text-gray-700 tabular-nums"><Rial amount={Number(item.unit_price)} /></td>
                  <td className="py-3 text-right text-xs text-gray-500">
                    {item.tax_rate > 0 ? `${(Number(item.tax_rate) * 100).toFixed(0)}%` : 'Exempt'}
                  </td>
                  <td className="py-3 text-right text-sm font-semibold text-gray-900 tabular-nums">
                    <Rial amount={Number(item.total)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Totals block ─────────────────────────────────── */}
        <div className="px-8 pb-6">
          <div className="flex justify-end">
            <div className="w-72 space-y-2 bg-gray-50 rounded-xl px-5 py-4">
              <div className="flex justify-between text-xs text-gray-600">
                <span>Subtotal (net)</span>
                <span className="tabular-nums font-medium"><Rial amount={Number(invoice.subtotal)} /></span>
              </div>
              {Number(invoice.discount_amount) > 0 && (
                <div className="flex justify-between text-xs text-red-500">
                  <span>Discount</span>
                  <span className="tabular-nums">− <Rial amount={Number(invoice.discount_amount)} /></span>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-600">
                <span>Taxable Amount</span>
                <span className="tabular-nums"><Rial amount={Number(invoice.taxable_amount)} /></span>
              </div>
              <div className="flex justify-between text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
                <span className="font-semibold">VAT (15%)</span>
                <span className="tabular-nums font-semibold"><Rial amount={Number(invoice.tax_amount)} /></span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1.5 border-t border-gray-200">
                <span>{isCreditNote ? 'Credit Total' : 'Total'}</span>
                <span className="tabular-nums text-[#0F2419]"><Rial amount={Number(invoice.total_amount)} /></span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Payment info ─────────────────────────────────── */}
        {payments.length > 0 && (
          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/40">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Payment</p>
            <div className="flex flex-wrap gap-6 text-xs text-gray-700">
              <span><span className="font-semibold">Method:</span> {payLabel}</span>
              {isSplitPayment ? (
                <>
                  {cashPayment && <span><span className="font-semibold">Cash:</span> <Rial amount={Number(cashPayment.amount)} /></span>}
                  {cardPayment && <span><span className="font-semibold">Card:</span> <Rial amount={Number(cardPayment.amount)} /></span>}
                  <span><span className="font-semibold">Total paid:</span> <Rial amount={paymentRowsTotal(payments)} /></span>
                </>
              ) : (
                <span><span className="font-semibold">Amount:</span> <Rial amount={Number(payment?.amount ?? 0)} /></span>
              )}
              {!isSplitPayment && payment?.method === 'cash' && cashReceived !== null && (
                <span><span className="font-semibold">Received:</span> <Rial amount={cashReceived} /></span>
              )}
              {!isSplitPayment && (branch.show_cash_change ?? true) && payment?.method === 'cash' && (changeAmount ?? 0) > 0.005 && (
                <span><span className="font-semibold">Change:</span> <Rial amount={changeAmount ?? 0} /></span>
              )}
              {payment && <span><span className="font-semibold">Date:</span> {fmtDateTime(payment.paid_at).date}</span>}
              {payment?.reference && <span><span className="font-semibold">Ref:</span> {payment.reference}</span>}
            </div>
          </div>
        )}

        {isCreditNote && hasRefunds && (
          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/40">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Refund</p>
            <div className="space-y-1.5 text-xs text-gray-700">
              {refunds.map(refund => (
                <div key={refund.id} className="flex flex-wrap gap-6">
                  <span><span className="font-semibold">Method:</span> {paymentLabel(refund.method)}</span>
                  <span><span className="font-semibold">Amount:</span> <Rial amount={Number(refund.amount)} /></span>
                  <span><span className="font-semibold">Status:</span> {refund.status}</span>
                  <span><span className="font-semibold">Date:</span> {fmtDateTime(refund.created_at).date}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Notes ────────────────────────────────────────── */}
        {invoice.notes && (
          <div className="px-8 py-3 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Notes</p>
            <p className="text-xs text-gray-600">{invoice.notes}</p>
          </div>
        )}

        {/* ── ZATCA + QR footer ────────────────────────────── */}
        <div className="px-8 py-6 border-t-2 border-gray-100">
          <div className="flex items-start gap-8">

            {/* QR code */}
            <div className="flex-shrink-0 text-center">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="ZATCA QR Code" className="w-28 h-28 border border-gray-100 rounded-xl p-1" />
              ) : (
                <div className="w-28 h-28 border border-gray-100 rounded-xl flex items-center justify-center bg-gray-50">
                  <Loader2 size={20} className="animate-spin text-gray-300" />
                </div>
              )}
              <p className="text-[9px] text-gray-400 mt-1.5">Scan to verify {isCreditNote ? 'credit note' : 'invoice'}</p>
            </div>

            {/* ZATCA info — screen only, not required on printed invoices */}
            {!isPrinting && <div className="flex-1 space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">ZATCA e-Invoice</p>
                <div className="flex items-center gap-2">
                  {invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared'
                    ? <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                    : invoice.zatca_status === 'failed'
                    ? <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                    : <span className={`text-sm ${zatcaMeta.color}`}>{zatcaMeta.icon}</span>
                  }
                  <span className={`text-sm font-semibold ${zatcaMeta.color}`}>{zatcaMeta.label}</span>
                </div>
                {zatcaFailureSummary && (
                  <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400">Safe failure summary</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-red-700">
                      {[
                        zatcaFailureSummary.statusString,
                        zatcaFailureSummary.validationStatus,
                        zatcaFailureSummary.reportingStatus,
                        zatcaFailureSummary.clearanceStatus,
                        zatcaFailureSummary.httpStatus ? `HTTP ${zatcaFailureSummary.httpStatus}` : undefined,
                      ].filter(Boolean).join(' · ') || 'ZATCA rejected the submission.'}
                    </p>
                    {(zatcaFailureSummary.message || zatcaFailureSummary.errors?.length || zatcaFailureSummary.errorCodes?.length) && (
                      <p className="mt-1 text-[11px] leading-relaxed text-red-600">
                        {zatcaFailureSummary.message ??
                          zatcaFailureSummary.errors?.map(item => [item.code, item.message].filter(Boolean).join(': ')).join('; ') ??
                          zatcaFailureSummary.errorCodes?.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Invoice UUID</p>
                  <p className="font-mono text-[10px] break-all">{invoice.zatca_uuid}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Invoice Type</p>
                  <p>{documentTitleEn}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Phase</p>
                  <p>{isPhase2 ? 'Phase 2 — Integrated' : 'Phase 1 — QR Only'}</p>
                </div>
                {invoice.zatca_submitted_at && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Submitted</p>
                    <p>{fmtDateTime(invoice.zatca_submitted_at).date}</p>
                  </div>
                )}
              </div>
            </div>}

          </div>
        </div>

        {/* Footer note */}
        <div className="px-8 pb-6 text-center">
          <p className="text-[9px] text-gray-300">
            This is a computer-generated {isCreditNote ? 'credit note' : 'invoice'}.
          </p>
        </div>
      </div>

      {/* ── ZATCA QR Debug Panel (?debug=true) ──────────── */}
      {debugMode && (
        <div className="no-print mt-4 rounded-2xl overflow-hidden border border-gray-800 bg-gray-950 text-xs font-mono">

          {/* Header */}
          <div className="flex items-center gap-2 px-5 py-3 bg-gray-900 border-b border-gray-800">
            <Bug size={14} className="text-yellow-400" />
            <span className="text-yellow-400 font-bold text-sm">ZATCA QR Debug Panel</span>
            <span className="ml-auto text-gray-500 text-[10px]">?debug=true</span>
          </div>

          {!qrPayload ? (
            <div className="px-5 py-6 text-gray-500">Generating QR payload…</div>
          ) : (() => {
            let fields: ReturnType<typeof decodeTLV> = []
            let decodeError: string | null = null
            try { fields = decodeTLV(qrPayload) }
            catch (e) { decodeError = String(e) }

            const tag2 = fields.find(f => f.tag === 2)?.value ?? ''
            const tag3 = fields.find(f => f.tag === 3)?.value ?? ''
            const tag4 = fields.find(f => f.tag === 4)?.value ?? ''
            const tag5 = fields.find(f => f.tag === 5)?.value ?? ''

            const checks = [
              {
                label: 'Tag 2 is 15 digits starting with 3',
                ok:    /^3\d{14}$/.test(tag2),
              },
              {
                label: 'Tag 3 matches YYYY-MM-DDTHH:MM:SSZ',
                ok:    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(tag3),
              },
              {
                label: 'Tag 4 is a valid decimal',
                ok:    /^\d+\.\d+$/.test(tag4),
              },
              {
                label: 'Tag 5 is a valid decimal',
                ok:    /^\d+\.\d+$/.test(tag5),
              },
            ]

            return (
              <div className="divide-y divide-gray-800">

                {/* Section 1: Raw Base64 */}
                <div className="px-5 py-4 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                    1 · Raw Base64 TLV
                  </p>
                  <p className="text-green-400 break-all leading-relaxed">{qrPayload}</p>
                  <p className="text-gray-600 text-[10px]">{qrPayload.length} chars · source: {invoice.zatca_qr_code ? 'database' : 'generated on-the-fly'}</p>
                </div>

                {/* Section 2: Decoded fields */}
                <div className="px-5 py-4 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    2 · Decoded TLV Fields
                  </p>
                  {decodeError ? (
                    <p className="text-red-400">Decode error: {decodeError}</p>
                  ) : fields.length === 0 ? (
                    <p className="text-gray-500">No fields decoded</p>
                  ) : (
                    <div className="space-y-1">
                      {fields.map(f => (
                        <div key={f.tag} className="flex gap-3">
                          <span className="text-gray-500 flex-shrink-0 w-40">
                            Tag {f.tag} — {f.label}:
                          </span>
                          <span className="text-cyan-300 break-all">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 3: Validation */}
                <div className="px-5 py-4 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    3 · Validation Checks
                  </p>
                  <div className="space-y-1">
                    {checks.map(c => (
                      <div key={c.label} className="flex items-center gap-2">
                        <span className={c.ok ? 'text-green-400' : 'text-red-400'}>
                          {c.ok ? '✅' : '❌'}
                        </span>
                        <span className={c.ok ? 'text-gray-300' : 'text-red-300'}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )
          })()}
        </div>
      )}

      <CreateCreditNoteModal
        open={creditModalOpen}
        invoice={{
          id: invoice.id,
          branch_id: invoice.branch_id,
          invoice_number: invoice.invoice_number,
          total_amount: Number(invoice.total_amount),
        }}
        defaultRefundMethod={(isSplitPayment ? 'other' : (payment?.method ?? invoice.payment_method ?? 'cash')) as PaymentMethod}
        onClose={() => setCreditModalOpen(false)}
        onCreated={handleCreditNoteCreated}
      />
    </div>
  )
}
