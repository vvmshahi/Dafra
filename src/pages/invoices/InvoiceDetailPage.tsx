import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Download, RefreshCw, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { buildZatcaQR } from '@/lib/zatca/qr'
import type { Invoice, InvoiceItem, Payment, Branch } from '@/types/database'

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

// ── Print style injector ──────────────────────────────────────────────────────

function usePrintStyle() {
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'invoice-print-style'
    style.textContent = `
      @media print {
        @page { size: A4; margin: 10mm; }
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
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  usePrintStyle()

  const [invoice,  setInvoice]  = useState<Invoice | null>(null)
  const [items,    setItems]    = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [branch,   setBranch]   = useState<Branch | null>(null)
  const [tenant,   setTenant]   = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [resubmitting, setResubmitting] = useState(false)

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
          supabase.from('invoices').select('*').eq('id', id).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order'),
          supabase.from('payments').select('*').eq('invoice_id', id),
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
              .select('name, name_ar, vat_number, customer_type, company_name')
              .eq('id', inv.customer_id)
              .single()
          )
        }

        const results = await Promise.all(fetches)
        if (cancelled) return

        const branchData = results[0].data as Branch
        const tenantData = results[1].data as Tenant
        const custData   = results[2]?.data as Customer | null ?? null

        setInvoice(inv as Invoice)
        setItems((itemData ?? []) as InvoiceItem[])
        setPayments((pmtData ?? []) as Payment[])
        setBranch(branchData)
        setTenant(tenantData)
        setCustomer(custData)
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
      const sellerName = branch!.business_name_ar || branch!.business_name || branch!.name_ar || branch!.name
      const vatNumber  = branch!.vat_number || tenant!.vat_number || ''
      const timestamp  = invoice!.created_at

      const payload = buildZatcaQR({
        sellerName,
        vatNumber,
        timestamp,
        totalAmount: Number(invoice!.total_amount),
        vatAmount:   Number(invoice!.tax_amount),
      })

      try {
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          width: 200,
          margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        })
        if (cancelled) return
        setQrDataUrl(url)

        // Persist QR payload to DB if not yet stored
        if (!invoice!.zatca_qr_code) {
          const q = supabase as unknown as { from: (t: string) => any }
          q.from('invoices').update({ zatca_qr_code: payload }).eq('id', invoice!.id)
        }
      } catch {}
    }

    generateQR()
    return () => { cancelled = true }
  }, [invoice, branch, tenant])

  // ── Actions ────────────────────────────────────────────────────────────────

  function handlePrint() {
    window.print()
  }

  async function handleResend() {
    if (!invoice) return
    setResubmitting(true)
    try {
      // Placeholder: update status to pending for retry
      await supabase.from('invoices')
        .update({ zatca_status: 'pending' })
        .eq('id', invoice.id)
      setInvoice(prev => prev ? { ...prev, zatca_status: 'pending' } : prev)
    } finally {
      setResubmitting(false)
    }
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

  const { date: invDate, time: invTime } = fmtDateTime(invoice.created_at)
  const zatcaMeta = ZATCA_STATUS[invoice.zatca_status] ?? ZATCA_STATUS.pending
  const payment   = payments[0] ?? null
  const payLabel  = payment ? (PAY_LABEL[payment.method] ?? payment.method) : null
  const isCancelled = invoice.status === 'cancelled'

  const sellerNameAr = branch.business_name_ar || branch.name_ar || branch.name
  const sellerNameEn = branch.business_name    || branch.name
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

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* ── Action bar (screen only) ─────────────────────── */}
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={16} />
          Back to Invoices
        </button>

        <div className="flex items-center gap-2">
          {invoice.zatca_status === 'failed' && (
            <button onClick={handleResend} disabled={resubmitting}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={resubmitting ? 'animate-spin' : ''} />
              Resend to ZATCA
            </button>
          )}
          <button
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <Download size={13} />
            Download PDF
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2419] rounded-xl hover:bg-[#1a3a28] transition-colors">
            <Printer size={13} />
            Print Invoice
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

      {/* ══════════════════════════════════════════════════ */}
      {/* PRINTABLE INVOICE AREA                            */}
      {/* ══════════════════════════════════════════════════ */}
      <div id="invoice-printable" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

        {/* ── Invoice header ─────────────────────────────── */}
        <div className="px-8 pt-8 pb-6 border-b border-gray-100">
          <div className="flex items-start justify-between gap-6">

            {/* Seller info (left) */}
            <div className="flex items-start gap-4 flex-1">
              {branch.logo_url ? (
                <img src={branch.logo_url} alt="logo" className="w-14 h-14 object-contain rounded-xl flex-shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[#0F2419] flex items-center justify-center flex-shrink-0">
                  <span className="text-gold-400 font-black text-2xl leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
                </div>
              )}
              <div>
                <p className="text-xl font-bold text-gray-900" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  {sellerNameAr}
                </p>
                <p className="text-sm text-gray-500 font-medium">{sellerNameEn}</p>
                {addressParts && <p className="text-xs text-gray-400 mt-1 max-w-xs">{addressParts}</p>}
                <div className="flex flex-wrap gap-3 mt-2">
                  <span className="text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-700">VAT:</span> {vatNumber}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    <span className="font-semibold text-gray-700">CR:</span> {crNumber}
                  </span>
                </div>
              </div>
            </div>

            {/* Invoice info + QR (right) */}
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-[#0F2419]" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>
                فاتورة ضريبية مبسطة
              </p>
              <p className="text-xs text-gray-400 mb-3">Simplified Tax Invoice</p>

              <div className="space-y-1">
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs font-semibold text-gray-800 font-mono">{invoice.invoice_number}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Invoice #</span>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-gray-700">{invDate}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Date</span>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-gray-700">{invTime}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Time</span>
                </div>
              </div>

              <p className="text-[9px] text-gray-300 mt-2 font-mono break-all max-w-[200px] text-right">
                {invoice.zatca_uuid}
              </p>
            </div>
          </div>
        </div>

        {/* ── Customer section ────────────────────────────── */}
        <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Bill To</p>
              {customer ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
                  {customer.name_ar && (
                    <p className="text-xs text-gray-400" dir="rtl">{customer.name_ar}</p>
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
            <div className="text-right">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Supply Date</p>
              <p className="text-xs text-gray-600">{invoice.supply_date ? fmtDateTime(invoice.supply_date).date : invDate}</p>
            </div>
          </div>
        </div>

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
                  <td className="py-3 text-right text-xs text-gray-700 tabular-nums">SAR {fmt(Number(item.unit_price))}</td>
                  <td className="py-3 text-right text-xs text-gray-500">
                    {item.tax_rate > 0 ? `${(Number(item.tax_rate) * 100).toFixed(0)}%` : 'Exempt'}
                  </td>
                  <td className="py-3 text-right text-sm font-semibold text-gray-900 tabular-nums">
                    SAR {fmt(Number(item.total))}
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
                <span className="tabular-nums font-medium">SAR {fmt(Number(invoice.subtotal))}</span>
              </div>
              {Number(invoice.discount_amount) > 0 && (
                <div className="flex justify-between text-xs text-red-500">
                  <span>Discount</span>
                  <span className="tabular-nums">− SAR {fmt(Number(invoice.discount_amount))}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-600">
                <span>Taxable Amount</span>
                <span className="tabular-nums">SAR {fmt(Number(invoice.taxable_amount))}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
                <span className="font-semibold">VAT (15%)</span>
                <span className="tabular-nums font-semibold">SAR {fmt(Number(invoice.tax_amount))}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1.5 border-t border-gray-200">
                <span>Total</span>
                <span className="tabular-nums text-[#0F2419]">SAR {fmt(Number(invoice.total_amount))}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Payment info ─────────────────────────────────── */}
        {payment && (
          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/40">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Payment</p>
            <div className="flex flex-wrap gap-6 text-xs text-gray-700">
              <span><span className="font-semibold">Method:</span> {payLabel}</span>
              <span><span className="font-semibold">Amount:</span> SAR {fmt(Number(payment.amount))}</span>
              <span><span className="font-semibold">Date:</span> {fmtDateTime(payment.paid_at).date}</span>
              {payment.reference && <span><span className="font-semibold">Ref:</span> {payment.reference}</span>}
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
              <p className="text-[9px] text-gray-400 mt-1.5">ZATCA QR Code</p>
            </div>

            {/* ZATCA info */}
            <div className="flex-1 space-y-3">
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
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Invoice UUID</p>
                  <p className="font-mono text-[10px] break-all">{invoice.zatca_uuid}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Invoice Type</p>
                  <p>{invoice.zatca_invoice_type === 'simplified' ? 'Simplified Tax Invoice' : 'Standard Tax Invoice'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Phase</p>
                  <p>Phase 1 — QR Only</p>
                </div>
                {invoice.zatca_submitted_at && (
                  <div>
                    <p className="text-[9px] font-semibold text-gray-300 uppercase tracking-widest">Submitted</p>
                    <p>{fmtDateTime(invoice.zatca_submitted_at).date}</p>
                  </div>
                )}
              </div>
            </div>

            {/* VAT breakdown (right) */}
            <div className="flex-shrink-0 text-right">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">VAT Summary</p>
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex gap-6 justify-end">
                  <span className="text-gray-400">Taxable</span>
                  <span className="tabular-nums">SAR {fmt(Number(invoice.taxable_amount))}</span>
                </div>
                <div className="flex gap-6 justify-end">
                  <span className="text-gray-400">Tax Rate</span>
                  <span>15%</span>
                </div>
                <div className="flex gap-6 justify-end font-semibold text-amber-700">
                  <span>VAT</span>
                  <span className="tabular-nums">SAR {fmt(Number(invoice.tax_amount))}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="px-8 pb-6 text-center">
          <p className="text-[9px] text-gray-300">
            This is a computer-generated invoice. · Powered by دفرة (Dafra) ERP
          </p>
        </div>
      </div>
    </div>
  )
}
