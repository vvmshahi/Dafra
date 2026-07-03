import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import { supabase } from '@/lib/supabase'
import { printSilent } from '@/lib/electron'
import { buildZatcaQR } from '@/lib/zatca/qr'
import { toSaudiTime } from '@/lib/utils/date'
import type { Branch, Invoice, InvoiceItem, Payment } from '@/types/database'

interface Tenant {
  name: string
  name_ar: string | null
  vat_number: string | null
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

const INVOICE_PRINT_SELECT = `
  id, tenant_id, branch_id, customer_id,
  invoice_number, invoice_reference, original_invoice_id, credit_reason,
  zatca_invoice_type, zatca_qr_code,
  subtotal, tax_amount, total_amount,
  status, payment_status, created_at
`

function isSplitPaymentRows(payments: Payment[]): boolean {
  return payments.length > 1
    && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
    && payments.some(payment => payment.method === 'card' && Number(payment.amount) > 0)
}

function customerDisplayName(customer: Customer | null): string | null {
  if (!customer) return null
  if (customer.customer_type === 'business') {
    return customer.business_name ?? customer.company_name ?? customer.name
  }
  return customer.name
}

function useReceiptPrintStyle() {
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'receipt-route-print-style'
    style.textContent = `
      @media print {
        @page { size: 80mm auto; margin: 0 3mm; }
        html, body {
          margin: 0 !important;
          background: white !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .no-print { display: none !important; }
        #receipt-print-page {
          display: block !important;
          width: 100% !important;
          background: white !important;
          padding: 0 !important;
        }
        #thermal-receipt {
          display: block !important;
          visibility: visible !important;
          position: static !important;
          width: 100% !important;
          max-width: 300px !important;
          margin: 0 auto !important;
          color: #000 !important;
          background: #fff !important;
        }
        #thermal-receipt * {
          visibility: visible !important;
          color: inherit;
        }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('receipt-route-print-style')?.remove() }
  }, [])
}

export default function ReceiptPrintPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const autoPrint = params.get('auto') === '1'
  const printedRef = useRef(false)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [branch, setBranch] = useState<Branch | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useReceiptPrintStyle()

  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false

    async function loadReceipt() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: inv, error: invErr }, { data: itemData }, { data: paymentData }] = await Promise.all([
          supabase.from('invoices').select(INVOICE_PRINT_SELECT).eq('id', invoiceId).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
          supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('paid_at', { ascending: true }).order('created_at', { ascending: true }),
        ])

        if (invErr || !inv) {
          setError('Receipt not found.')
          return
        }
        if (cancelled) return

        const fetches: Promise<any>[] = [
          supabase.from('branches').select('*').eq('id', inv.branch_id).single(),
          supabase.from('tenants').select('name, name_ar, vat_number, cr_number, address').eq('id', inv.tenant_id).single(),
        ]
        if (inv.customer_id) {
          fetches.push(
            supabase.from('customers')
              .select('name, name_ar, vat_number, customer_type, company_name, business_name, business_name_ar, phone')
              .eq('id', inv.customer_id)
              .single(),
          )
        }

        const [branchResult, tenantResult, customerResult] = await Promise.all(fetches)
        if (cancelled) return

        setInvoice(inv as Invoice)
        setItems((itemData ?? []) as InvoiceItem[])
        setPayments((paymentData ?? []) as Payment[])
        setBranch(branchResult.data as Branch)
        setTenant(tenantResult.data as Tenant)
        setCustomer((customerResult?.data ?? null) as Customer | null)
      } catch {
        if (!cancelled) setError('Failed to load receipt.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadReceipt()
    return () => { cancelled = true }
  }, [invoiceId])

  useEffect(() => {
    if (!invoice || !branch || !tenant) return
    let cancelled = false

    async function generateQR() {
      const payload = invoice!.zatca_qr_code ?? buildZatcaQR({
        sellerName: branch!.business_name || branch!.name,
        vatNumber: branch!.vat_number || tenant!.vat_number || '',
        timestamp: invoice!.created_at,
        totalAmount: Number(invoice!.total_amount),
        vatAmount: Number(invoice!.tax_amount),
      })

      try {
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          width: 200,
          margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        if (!cancelled) setQrDataUrl(null)
      }
    }

    generateQR()
    return () => { cancelled = true }
  }, [invoice, branch, tenant])

  useEffect(() => {
    if (!autoPrint || printedRef.current || loading || error || !invoice || !branch || !qrDataUrl) return
    printedRef.current = true
    const timer = window.setTimeout(() => {
      void printSilent()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [autoPrint, loading, error, invoice, branch, qrDataUrl])

  const receipt = useMemo(() => {
    if (!invoice || !branch || !tenant) return null

    const date = new Date(invoice.created_at).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Riyadh',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
    const address = [
      branch.building_number ? `Building ${branch.building_number}` : null,
      branch.street,
      branch.district,
      branch.city,
    ].filter(Boolean).join(', ')
    const thermalItems: ThermalItem[] = items.map(item => ({
      name: item.name_ar?.trim() ? item.name_ar : item.name,
      qty: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.total),
    }))
    const splitPayment = isSplitPaymentRows(payments)
    const payment = payments[0] ?? null
    const cashReceived = !splitPayment && payment?.method === 'cash'
      ? Number(payment.amount_received ?? payment.amount ?? invoice.total_amount)
      : null
    const changeAmount = !splitPayment && payment?.method === 'cash'
      ? Number(payment.change_amount ?? 0)
      : null
    const isCreditNote = invoice.zatca_invoice_type === 'credit_note'
    const isStandardDocument = invoice.zatca_invoice_type === 'standard'
      || (isCreditNote && customer?.customer_type === 'business' && !!customer?.vat_number)

    return {
      date,
      time: toSaudiTime(invoice.created_at),
      brandName: branch.display_name || branch.business_name || branch.name,
      legalName: branch.business_name || branch.name,
      address: address || null,
      items: thermalItems,
      splitPayment,
      payment,
      cashReceived,
      changeAmount,
      customerName: customerDisplayName(customer),
      buyerVatNumber: isStandardDocument ? customer?.vat_number ?? null : null,
      isStandardDocument,
      documentType: isCreditNote ? 'credit_note' as const : 'invoice' as const,
    }
  }, [invoice, branch, tenant, items, payments, customer])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    )
  }

  if (error || !invoice || !branch || !tenant || !receipt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-gray-900">{error ?? 'Receipt not available.'}</p>
          <button
            type="button"
            onClick={() => navigate('/pos')}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft size={14} />
            Back to POS
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="no-print sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">Receipt {invoice.invoice_number}</p>
            <p className="text-xs text-gray-500">Detailed thermal receipt print view</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/pos')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={13} />
              Back to POS
            </button>
            <Link
              to={`/invoices/${invoice.id}`}
              className="hidden rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:inline-flex"
            >
              Invoice details
            </Link>
            <button
              type="button"
              onClick={() => void printSilent()}
              disabled={!qrDataUrl}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F2419] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1a3a28] disabled:cursor-wait disabled:opacity-60"
            >
              {qrDataUrl ? <Printer size={13} /> : <RefreshCw size={13} className="animate-spin" />}
              Print
            </button>
          </div>
        </div>
      </div>

      <main id="receipt-print-page" className="mx-auto flex min-h-[calc(100vh-64px)] max-w-3xl items-start justify-center bg-white px-3 py-5 sm:my-6 sm:min-h-0 sm:rounded-2xl sm:border sm:border-gray-100 sm:shadow-sm">
        <ThermalReceipt
          preview
          businessNameAr={receipt.brandName}
          businessNameEn={receipt.legalName}
          branchName={null}
          address={receipt.address}
          vatNumber={branch.vat_number || tenant.vat_number || ''}
          phone={branch.phone}
          website={branch.website}
          showWebsite={branch.show_website ?? false}
          email={branch.email}
          showEmail={branch.show_email ?? false}
          invoiceNumber={invoice.invoice_number}
          date={receipt.date}
          time={receipt.time}
          items={receipt.items}
          subtotal={Number(invoice.subtotal)}
          taxAmount={Number(invoice.tax_amount)}
          total={Number(invoice.total_amount)}
          paymentMethod={receipt.splitPayment ? 'split' : (receipt.payment?.method ?? 'card')}
          payments={payments.map(payment => ({ method: payment.method, amount: Number(payment.amount) }))}
          cashReceived={receipt.cashReceived}
          change={receipt.changeAmount}
          customerName={receipt.customerName}
          buyerVatNumber={receipt.buyerVatNumber}
          isStandardInvoice={receipt.isStandardDocument}
          documentType={receipt.documentType}
          originalInvoiceNumber={invoice.invoice_reference ?? null}
          creditReason={invoice.credit_reason}
          logoUrl={branch.logo_url}
          showLogo={branch.show_logo ?? true}
          qrDataUrl={qrDataUrl}
          receiptFooter={branch.receipt_footer}
          showFooter={branch.show_footer ?? true}
          showCashChange={branch.show_cash_change ?? true}
        />
      </main>
    </div>
  )
}
