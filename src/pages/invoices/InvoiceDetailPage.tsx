import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw, Loader2, AlertCircle, FileText } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Rial } from '@/components/ui/RiyalSymbol'
import { buildZatcaQR } from '@/lib/zatca/qr'
import { saudiDateStr, toSaudiTime } from '@/lib/utils/date'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { Invoice, InvoiceItem, Payment, Branch, PaymentRefund, PaymentMethod, ZatcaStatus } from '@/types/database'
import { isElectron, printA4Invoice, printReceipt } from '@/lib/electron'
import { printReceiptInHiddenFrame } from '@/lib/receiptPrint'
import { submitInvoiceToZatca } from '@/lib/zatca/submission'
import CreateCreditNoteModal, { type CreditNoteCreatedResult } from './CreateCreditNoteModal'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import { getSandboxValidationStatus, type SandboxValidationResponse } from '@/lib/zatca/api'
import { updateCachedInvoiceRows, upsertInvoiceListRow } from '@/lib/invoices/invoiceListCache'

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

interface RefundableItemSummary {
  original_invoice_item_id: string
  name: string
  unit: string | null
  original_quantity: number
  credited_quantity: number
  remaining_quantity: number
  remaining_total: number
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

function creditStatusLabel(status: 'none' | 'partial' | 'full'): string {
  if (status === 'full') return 'Fully credited'
  if (status === 'partial') return 'Partially credited'
  return 'Not credited'
}

function fmtQty(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })
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
  const autoPrint  = new URLSearchParams(location.search).get('print') === '1'
  const autoPrintRef = useRef(false)
  usePrintStyle()

  const [invoice,  setInvoice]  = useState<Invoice | null>(null)
  const [items,    setItems]    = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [refunds,  setRefunds]  = useState<PaymentRefund[]>([])
  const [branch,   setBranch]   = useState<Branch | null>(null)
  const [tenant,   setTenant]   = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [linkedCreditNotes, setLinkedCreditNotes] = useState<LinkedCreditNote[]>([])
  const [refundableItems, setRefundableItems] = useState<RefundableItemSummary[]>([])
  const [originalInvoiceLink, setOriginalInvoiceLink] = useState<OriginalInvoiceLink | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [qrDataUrl,    setQrDataUrl]    = useState<string | null>(null)
  const [qrPayload,    setQrPayload]    = useState<string | null>(null)
  const [resubmitting, setResubmitting] = useState(false)
  const [thermalPrinting, setThermalPrinting] = useState(false)
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [sandboxValidation, setSandboxValidation] = useState<SandboxValidationResponse | null>(null)

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

	        const [creditNoteResult, originalInvoiceResult, refundResult, refundableResult] = await Promise.all([
	          inv.zatca_invoice_type === 'credit_note'
	            ? Promise.resolve({ data: [] })
	            : supabase
	              .from('invoices')
	              .select('id, invoice_number, total_amount, zatca_status, payment_status, credit_reason, created_at')
	              .eq('original_invoice_id', inv.id)
	              .eq('zatca_invoice_type', 'credit_note')
	              .neq('status', 'cancelled')
	              .order('created_at', { ascending: false }),
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
	          inv.zatca_invoice_type === 'credit_note'
	            ? Promise.resolve({ data: [] })
	            : (supabase as any)
	              .rpc('get_invoice_refundable_items', { p_invoice_id: inv.id }),
	        ])

        setInvoice(inv as Invoice)
        setItems((itemData ?? []) as InvoiceItem[])
        setPayments((pmtData ?? []) as Payment[])
        setRefunds((refundResult.data ?? []) as PaymentRefund[])
        setBranch(branchData)
        setTenant(tenantData)
        setCustomer(custData)
	        setLinkedCreditNotes((creditNoteResult.data ?? []) as LinkedCreditNote[])
	        setOriginalInvoiceLink((originalInvoiceResult.data ?? null) as OriginalInvoiceLink | null)
	        if ((refundableResult as any).error) {
	          console.error('[InvoiceDetailPage] failed to load refundable items', (refundableResult as any).error)
	          setRefundableItems([])
	        } else {
	          setRefundableItems(((refundableResult as any).data ?? []).map((row: any) => ({
	            original_invoice_item_id: String(row.original_invoice_item_id),
	            name: String(row.name ?? 'Item'),
	            unit: row.unit ?? null,
	            original_quantity: Number(row.original_quantity ?? 0),
	            credited_quantity: Number(row.credited_quantity ?? 0),
	            remaining_quantity: Number(row.remaining_quantity ?? 0),
	            remaining_total: Number(row.remaining_total ?? 0),
	          })))
	        }

      } catch (e) {
        if (!cancelled) setError('Failed to load invoice')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!invoice || !isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)) return
    let cancelled = false
    getSandboxValidationStatus(invoice.id)
      .then(result => { if (!cancelled) setSandboxValidation(result) })
      .catch(() => { if (!cancelled) setSandboxValidation(null) })
    return () => { cancelled = true }
  }, [invoice])

  // Generate QR code after data loads
  useEffect(() => {
    if (!invoice || !branch || !tenant) return
    let cancelled = false

    async function generateQR() {
      // Use the stored TLV from DB when available — guarantees debug panel shows
      // the exact same payload that was encoded into the QR at creation time.
      const storedPayload = sandboxValidation?.qrCode ?? invoice!.zatca_qr_code

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
  }, [invoice, branch, tenant, sandboxValidation?.qrCode])

  // Auto-print when ?print=1 is in the URL
  useEffect(() => {
    if (!autoPrint || autoPrintRef.current || loading || !invoice || !branch || !qrDataUrl) return
    autoPrintRef.current = true
    const t = setTimeout(() => {
      if (isElectron()) {
        void printA4Invoice()
      } else {
        window.print()
      }
    }, 500)
    return () => clearTimeout(t)
  }, [autoPrint, loading, invoice, branch, qrDataUrl])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handlePrintA4() {
    if (!isElectron()) {
      window.print()
      return
    }

    const result = await printA4Invoice()
    if (!result.success) {
      toast.error(result.message || result.errorType || 'A4 print failed.')
    }
  }

  async function handlePrintThermal() {
    if (!invoice || thermalPrinting) return

    setThermalPrinting(true)
    try {
      if (!isElectron()) {
        await printReceiptInHiddenFrame(invoice.id)
        return
      }

      const result = await printReceipt({ invoiceId: invoice.id })
      if (result.success) {
        toast.success('Receipt sent to printer', { duration: 1800 })
      } else {
        toast.error(result.message || result.errorType || 'Receipt print failed.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Receipt print failed.')
    } finally {
      setThermalPrinting(false)
    }
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
    const demo = isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)
    upsertInvoiceListRow(invoice.tenant_id, {
      id: result.creditNoteId,
      branchId: invoice.branch_id,
      invoiceNumber: result.creditNoteNumber,
      date: saudiDateStr(result.createdAt),
      createdAt: result.createdAt,
      customerName: null,
      itemsCount: result.itemsCount,
      subtotal: result.subtotal,
      taxAmount: result.taxAmount,
      totalAmount: result.total,
      paymentMethod: result.refundMethod,
      zatcaStatus: result.zatcaStatus,
      displayZatcaStatus: demo
        ? (result.autoSubmitSucceeded ? 'sandbox_validated' : 'sandbox_validation_failed')
        : result.zatcaStatus,
      status: 'posted',
      documentType: 'credit_note',
      invoiceReference: invoice.invoice_number,
      linkedCreditNoteId: null,
      linkedCreditNoteNumber: null,
      creditNoteCount: 0,
      creditStatus: 'none',
      remainingRefundableQuantity: 0,
    })
    updateCachedInvoiceRows(invoice.tenant_id, invoice.branch_id, rows => rows.map(row => row.id === invoice.id ? {
      ...row,
      linkedCreditNoteId: result.creditNoteId,
      linkedCreditNoteNumber: result.creditNoteNumber,
      creditNoteCount: row.creditNoteCount + (result.idempotentReplay ? 0 : 1),
      creditStatus: 'partial',
    } : row))
    setLinkedCreditNotes(prev => [{
      id: result.creditNoteId,
      invoice_number: result.creditNoteNumber,
      total_amount: result.total,
      zatca_status: result.zatcaStatus,
      payment_status: result.refundStatus,
      credit_reason: result.reason,
      created_at: result.createdAt,
    }, ...prev])
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
      const [creditNoteResult, refundResult, refundableResult] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, total_amount, zatca_status, payment_status, credit_reason, created_at')
          .eq('original_invoice_id', invoice.id)
          .eq('zatca_invoice_type', 'credit_note')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('payment_refunds')
          .select('*')
          .or(`original_invoice_id.eq.${invoice.id},credit_note_invoice_id.eq.${result.creditNoteId}`)
          .order('created_at', { ascending: false }),
        (supabase as any)
          .rpc('get_invoice_refundable_items', { p_invoice_id: invoice.id }),
      ])

      if (creditNoteResult.data) {
        setLinkedCreditNotes(creditNoteResult.data as LinkedCreditNote[])
      }
      if (refundResult.data) {
        setRefunds(refundResult.data as PaymentRefund[])
      }
      if (refundableResult.data) {
        setRefundableItems((refundableResult.data as any[]).map((row: any) => ({
          original_invoice_item_id: String(row.original_invoice_item_id),
          name: String(row.name ?? 'Item'),
          unit: row.unit ?? null,
          original_quantity: Number(row.original_quantity ?? 0),
          credited_quantity: Number(row.credited_quantity ?? 0),
          remaining_quantity: Number(row.remaining_quantity ?? 0),
          remaining_total: Number(row.remaining_total ?? 0),
        })))
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
  const latestCreditNote = linkedCreditNotes[0] ?? null
  const totalOriginalQuantity = refundableItems.reduce((sum, item) => sum + Number(item.original_quantity ?? 0), 0)
  const totalCreditedQuantity = refundableItems.reduce((sum, item) => sum + Number(item.credited_quantity ?? 0), 0)
  const totalRemainingQuantity = refundableItems.reduce((sum, item) => sum + Math.max(Number(item.remaining_quantity ?? 0), 0), 0)
  const creditStatus: 'none' | 'partial' | 'full' = isCreditNote || linkedCreditNotes.length === 0
    ? 'none'
    : totalOriginalQuantity > 0 && totalRemainingQuantity <= 0.0005
    ? 'full'
    : 'partial'
  const isStandardDocument = invoice.zatca_invoice_type === 'standard'
    || (isCreditNote && customer?.customer_type === 'business' && !!customer?.vat_number)
  const documentTitleAr = isCreditNote
    ? (isStandardDocument ? 'إشعار دائن ضريبي' : 'إشعار دائن ضريبي مبسط')
    : (isStandardDocument ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة')
  const documentTitleEn = isCreditNote
    ? (isStandardDocument ? 'Tax Credit Note' : 'Simplified Tax Credit Note')
    : (isStandardDocument ? 'Standard Tax Invoice' : 'Simplified Tax Invoice')
  const documentNumberLabel = isCreditNote ? 'Credit Note #' : 'Invoice #'
  const creditLabel = creditStatusLabel(creditStatus)
  const creditLabelClass = creditStatus === 'full'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
    : creditStatus === 'partial'
    ? 'text-amber-700 bg-amber-50 border-amber-100'
    : 'text-gray-600 bg-gray-50 border-gray-100'
  const demoSandbox = isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)
  const sandboxValidated = sandboxValidation?.status === 'sandbox_validated' ||
    sandboxValidation?.status === 'sandbox_validated_with_warnings'
  const canCreateCreditNote = !isCreditNote
    && !isCancelled
    && invoice.status === 'posted'
    && (sandboxValidated || invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    && totalRemainingQuantity > 0.0005
  const creditDisabledReason = isCreditNote
    ? 'Credit notes cannot be credited.'
    : invoice.status !== 'posted'
    ? 'Only posted invoices can be credited.'
    : !(sandboxValidated || invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    ? demoSandbox ? 'Submit this invoice to ZATCA before creating a credit note.' : 'Only reported or cleared invoices can be credited.'
    : isCancelled
    ? 'Cancelled invoices cannot be credited here.'
    : totalOriginalQuantity <= 0
    ? 'Refundable item data is not available.'
    : creditStatus === 'full' || totalRemainingQuantity <= 0.0005
    ? 'All refundable quantities have already been credited.'
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
    subtotal:  Number(i.subtotal),
    taxAmount: Number(i.tax_amount),
    total:     Number(i.total),
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
        discountAmount={Number(invoice.discount_amount)}
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
          {canSubmitCurrentDocument && !demoSandbox && (
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
          <button onClick={() => void handlePrintThermal()} disabled={thermalPrinting}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50">
            {thermalPrinting ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
            {thermalPrinting ? 'Printing...' : 'Print Receipt'}
          </button>
          <button onClick={() => void handlePrintA4()}
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
            ) : linkedCreditNotes.length > 0 ? (
              <div className="space-y-1 text-xs text-gray-600">
                <p>
                  {creditLabel}. <span className="font-semibold text-gray-900">{linkedCreditNotes.length}</span> credit note{linkedCreditNotes.length !== 1 ? 's' : ''} linked to this invoice.
                </p>
                {latestCreditNote && (
                  <p>Latest: <span className="font-semibold text-gray-900">{latestCreditNote.invoice_number}</span> · ZATCA <span className="font-semibold">{ZATCA_STATUS[latestCreditNote.zatca_status]?.label ?? latestCreditNote.zatca_status}</span></p>
                )}
                <p>Credited quantity {fmtQty(totalCreditedQuantity)} · remaining {fmtQty(totalRemainingQuantity)}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                {demoSandbox
                  ? sandboxValidated
                    ? 'Create a credit note or refund for this submitted invoice.'
                    : 'Submit this invoice to ZATCA before creating a credit note.'
                  : 'Create a credit note only after the original invoice has been reported or cleared.'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            {latestCreditNote && !isCreditNote && (
              <button
                type="button"
                onClick={() => navigate(`/invoices/${latestCreditNote.id}`)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Open Latest Credit Note
              </button>
            )}
            {!isCreditNote && (
              <button
                type="button"
                onClick={openCreditModal}
                disabled={!canCreateCreditNote}
                title={creditDisabledReason ?? undefined}
                className="rounded-xl bg-[#0F2419] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
              >
                Create Credit Note / Refund
              </button>
            )}
          </div>
        </div>

        {!isCreditNote && refundableItems.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_90px_110px] gap-2 bg-gray-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Item</span>
                <span className="text-right">Original</span>
                <span className="text-right">Credited</span>
                <span className="text-right">Remaining</span>
                <span className="text-right">Remaining total</span>
              </div>
              <div className="divide-y divide-gray-100">
                {refundableItems.map(item => (
                  <div key={item.original_invoice_item_id} className="grid grid-cols-[minmax(0,1fr)_90px_90px_90px_110px] gap-2 px-3 py-2 text-xs">
                    <span className="truncate font-semibold text-gray-800">{item.name}</span>
                    <span className="text-right tabular-nums text-gray-600">{fmtQty(item.original_quantity)} {item.unit ?? ''}</span>
                    <span className="text-right tabular-nums text-amber-700">{fmtQty(item.credited_quantity)}</span>
                    <span className={`text-right tabular-nums font-semibold ${item.remaining_quantity > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{fmtQty(item.remaining_quantity)}</span>
                    <span className="text-right tabular-nums font-semibold text-gray-900"><Rial amount={item.remaining_total} /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

	        {creditDisabledReason && !isCreditNote && (
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
            {invoice.payment_method === 'other' && !isSplitPayment && (
              <p className="mt-2 text-[11px] text-amber-700">Detailed payment allocation is unavailable for this historical invoice.</p>
            )}
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
              <p className="text-[9px] text-gray-400 mt-1.5">
                {`Scan to verify ${isCreditNote ? 'credit note' : 'invoice'}`}
              </p>
            </div>

            {(branch.show_footer ?? true) && branch.receipt_footer && (
              <div className="flex-1 rounded-xl bg-gray-50 px-4 py-3 text-xs font-medium text-gray-600">
                {branch.receipt_footer}
              </div>
            )}

          </div>
        </div>

        {/* Footer note */}
        <div className="px-8 pb-6 text-center">
          <p className="text-[9px] text-gray-300">
            This is a computer-generated {isCreditNote ? 'credit note' : 'invoice'}.
          </p>
        </div>
      </div>

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
