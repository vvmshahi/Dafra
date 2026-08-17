import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw, Loader2, AlertCircle, FileText, ReceiptText } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { Rial } from '@/components/ui/RiyalSymbol'
import { selectStoredInvoiceQr } from '@/lib/zatca/qrSelector'
import { selectStoredOutputStateQr, type QrDisplayStatus } from '@/lib/zatca/qrDisplay.mjs'
import { saudiDateStr } from '@/lib/utils/date'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import A4Document from '@/components/print/A4Document'
import A4PreviewFit, { type A4PreviewZoom } from '@/components/print/A4PreviewFit'
import type { Invoice, InvoiceItem, Payment, Branch, PaymentRefund, PaymentMethod, ZatcaStatus } from '@/types/database'
import { isElectron, printA4Invoice, printReceipt } from '@/lib/electron'
import { printCurrentDocument, printCurrentPageDocument, waitForPrintableAssets } from '@/lib/print/browserPrint'
import { submitInvoiceToZatca, type ZatcaOutputState } from '@/lib/zatca/submission'
import { readIssuedDocumentOutputState, renderIssuedDocumentQr, resolveIssuedDocumentReadiness } from '@/lib/invoices/issuedDocumentReadiness'
import CreateCreditNoteModal, { type CreditNoteCreatedResult } from './CreateCreditNoteModal'
import AtomicCreditNoteReceiptView from './AtomicCreditNoteReceiptView'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import { getSandboxValidationStatus, type SandboxValidationResponse } from '@/lib/zatca/api'
import { updateCachedInvoiceRows, upsertInvoiceListRow } from '@/lib/invoices/invoiceListCache'
import { documentFromStoredInvoice } from '@/lib/invoices/documentViewAdapters'
import { canRenderFiscalDocument } from '@/lib/invoices/documentPresentationReadiness'
import type { CustomerCreditPaymentSummary } from '@/lib/invoices/customerCreditPayment'
import { loadCustomerCreditPaymentSummary } from '@/lib/invoices/customerCreditReadModel'
import { useAuth } from '@/hooks/useAuth'
import { INVOICE_SAFE_SELECT } from '@/lib/invoices/invoiceReadContract'
import {
  documentDate,
  documentLabel,
  documentNames,
  resolveCreditNoteDocumentLanguage,
  resolveInvoiceDocumentLanguage,
} from '@/localization/documents'

type PreviewMode = 'a4' | 'thermal'

export function resolveDefaultInvoicePreviewMode(
  printMode: 'thermal' | 'pdf' | 'both',
  afterSaleAction?: 'receipt' | 'a4' | 'both',
): PreviewMode {
  if (printMode === 'thermal') return 'thermal'
  if (printMode === 'pdf') return 'a4'
  return afterSaleAction === 'receipt' ? 'thermal' : 'a4'
}

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
  cr_number: string | null
  address: string | null
  address_ar: string | null
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
  document_language: 'en' | 'ar' | 'both' | null
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

function isSplitPaymentRows(payments: Payment[]): boolean {
  return payments.length > 1
    && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
    && payments.some(payment => payment.method === 'card' && Number(payment.amount) > 0)
}

// ── Print style injector ──────────────────────────────────────────────────────

function usePrintStyle() {
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'invoice-print-style'
    style.textContent = `
      @media print {
        @page { size: A4; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { visibility: hidden !important; }
        #invoice-printable-a4, #invoice-printable-a4 * { visibility: visible !important; }
        #invoice-printable-a4 {
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 210mm !important;
          min-width: 210mm !important;
          min-height: 297mm !important;
          background: white !important;
          z-index: 99999 !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        #invoice-printable-a4 table tr,
        #invoice-printable-a4 img { break-inside: avoid; page-break-inside: avoid; }
        .no-print { display: none !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('invoice-print-style')?.remove() }
  }, [])
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { t } = useTranslation(['invoices', 'creditNotes', 'refunds', 'printing', 'payments', 'documents', 'validation', 'common', 'pos'])
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()
  const location   = useLocation()
  const { profile } = useAuth()
  const autoPrint  = new URLSearchParams(location.search).get('print') === '1'
  const autoPrintRef = useRef(false)
  usePrintStyle()

  const [invoice,  setInvoice]  = useState<Invoice | null>(null)
  const [items,    setItems]    = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [customerCredit, setCustomerCredit] = useState<CustomerCreditPaymentSummary | null>(null)
  const [refunds,  setRefunds]  = useState<PaymentRefund[]>([])
  const [branch,   setBranch]   = useState<Branch | null>(null)
  const [tenant,   setTenant]   = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [linkedCreditNotes, setLinkedCreditNotes] = useState<LinkedCreditNote[]>([])
  const [refundableItems, setRefundableItems] = useState<RefundableItemSummary[]>([])
  const [originalInvoiceLink, setOriginalInvoiceLink] = useState<OriginalInvoiceLink | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [qrDataUrl,    setQrDataUrl]    = useState<string | null>(null)
  const [qrStatus,     setQrStatus]     = useState<QrDisplayStatus>('loading')
  const [qrRetryVersion, setQrRetryVersion] = useState(0)
  const [resubmitting, setResubmitting] = useState(false)
  const [thermalPrinting, setThermalPrinting] = useState(false)
  const [a4Printing, setA4Printing] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('a4')
  const [a4PreviewZoom, setA4PreviewZoom] = useState<A4PreviewZoom>('fit')
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [creditNoteResult, setCreditNoteResult] = useState<CreditNoteCreatedResult | null>(null)
  const [sandboxValidation, setSandboxValidation] = useState<SandboxValidationResponse | null>(null)
  const [outputState, setOutputState] = useState<ZatcaOutputState | null>(null)
  const previewTabRefs = useRef<Record<PreviewMode, HTMLButtonElement | null>>({ a4: null, thermal: null })
  const creditNoteTriggerRef = useRef<HTMLButtonElement>(null)

  const nonFiscalDemo = invoice?.is_demo === true
  const sandboxDocument = Boolean(invoice && !nonFiscalDemo && isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id))
  const outputStateMatchesInvoice = Boolean(invoice && outputState?.invoiceId === invoice.id)
  const selectedQrPayload = sandboxDocument
    ? selectStoredInvoiceQr(null, 'sandbox', {
      sandboxGenerated: sandboxValidation?.invoiceId === invoice?.id
        && Boolean(sandboxValidation?.qrCode),
      sandboxQrCode: sandboxValidation?.qrCode,
    })
    : selectStoredOutputStateQr(outputStateMatchesInvoice ? outputState : null)
  const sandboxValidated = sandboxValidation?.invoiceId === invoice?.id
    && (sandboxValidation?.status === 'sandbox_validated'
      || sandboxValidation?.status === 'sandbox_validated_with_warnings')
  const shareReady = nonFiscalDemo || Boolean(selectedQrPayload && qrDataUrl)
    && (sandboxDocument
      ? sandboxValidated
      : outputStateMatchesInvoice && outputState?.canPrint === true)
  const documentViewModel = useMemo(() => {
    if (!invoice || !branch) return null
    return documentFromStoredInvoice({
      invoice,
      branch,
      tenant,
      items,
      payments,
      customerCredit,
      authoritativeDocumentKind: outputStateMatchesInvoice ? outputState?.documentKind : null,
    })
  }, [invoice, branch, tenant, items, payments, customerCredit, outputStateMatchesInvoice, outputState?.documentKind])
  const fiscalDocumentRenderable = documentViewModel ? canRenderFiscalDocument(documentViewModel) : false
  const documentReadiness = resolveIssuedDocumentReadiness({
    modelReady: Boolean(invoice && branch && tenant && fiscalDocumentRenderable), nonFiscalDemo,
    outputCanPrint: sandboxDocument ? sandboxValidated : outputStateMatchesInvoice && outputState?.canPrint === true,
    qrPayload: selectedQrPayload, qrStatus, qrDataUrl,
  })
  const printReady = documentReadiness.printable

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
          supabase.from('invoices').select(INVOICE_SAFE_SELECT).eq('id', id).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order'),
          supabase.from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: true }).order('created_at', { ascending: true }),
        ])

        if (invErr || !inv) { setError(t('invoices:notFound')); setLoading(false); return }
        if (cancelled) return

        // Round 2: branch + tenant + customer in parallel
        const fetches: Promise<any>[] = [
          supabase.from('branches').select('*').eq('id', inv.branch_id).single(),
          supabase.from('tenants').select('name, name_ar, vat_number, cr_number, address').eq('id', inv.tenant_id).single(),
        ]
        // Customer master data may still support non-fiscal actions on an
        // invoice detail screen. Credit-note document reprints never read it:
        // their buyer block is exclusively the original issue-time snapshot.
        if (inv.customer_id && inv.zatca_invoice_type !== 'credit_note') {
          fetches.push(
            supabase.from('customers')
              .select('name, name_ar, vat_number, cr_number, address, address_ar, customer_type, company_name, business_name, business_name_ar, phone')
              .eq('id', inv.customer_id)
              .single()
          )
        }

        const [results, customerCreditSummary] = await Promise.all([
          Promise.all(fetches),
          inv.zatca_invoice_type === 'credit_note'
            ? Promise.resolve(null)
            : loadCustomerCreditPaymentSummary({ invoiceId: inv.id, totalAmount: inv.total_amount, paymentStatus: inv.payment_status }),
        ])
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
              .select('id, invoice_number, total_amount, zatca_status, document_language')
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
        setCustomerCredit(customerCreditSummary)
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
        if (!cancelled) setError(t('validation:loadingFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, loadAttempt])

  useEffect(() => {
    if (!invoice || !isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)) return
    let cancelled = false
    setQrStatus('loading')
    getSandboxValidationStatus(invoice.id)
      .then(result => { if (!cancelled) setSandboxValidation(result) })
      .catch(() => {
        if (!cancelled) {
          setSandboxValidation(null)
          setQrStatus('failed')
        }
      })
    return () => { cancelled = true }
  }, [invoice])

  useEffect(() => {
    if (!invoice || isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)) {
      setOutputState(null)
      return
    }
    let cancelled = false
    setOutputState(null)
    setQrStatus('loading')
    readIssuedDocumentOutputState({ invoiceId: invoice.id, branchId: invoice.branch_id, refresh: qrRetryVersion > 0 })
      .then(state => { if (!cancelled) setOutputState(state) })
      .catch(() => {
        if (!cancelled) {
          setOutputState(null)
          setQrStatus('failed')
        }
      })
    return () => { cancelled = true }
  }, [invoice?.id, invoice?.branch_id, invoice?.zatca_status, qrRetryVersion])

  // Generate QR code after data loads
  useEffect(() => {
    if (!invoice || !branch || !tenant) return
    let cancelled = false

    async function generateQR() {
      const sandboxDocument = isPermanentDemoSandboxBranch(invoice!.tenant_id, invoice!.branch_id)
      if (!sandboxDocument && !outputStateMatchesInvoice) return
      if (sandboxDocument && sandboxValidation?.invoiceId !== invoice!.id) return

      setQrStatus('loading')
      const result = await renderIssuedDocumentQr(
        invoice!.id,
        selectedQrPayload,
        payload => QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          width: 200,
          margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        }),
      )
      if (cancelled) return
      setQrDataUrl(result.dataUrl)
      setQrStatus(result.status)
    }

    generateQR()
    return () => { cancelled = true }
  }, [invoice, branch, tenant, sandboxValidation?.invoiceId, selectedQrPayload, outputStateMatchesInvoice, qrRetryVersion])

  // Auto-print when ?print=1 is in the URL
  useEffect(() => {
    if (!autoPrint || autoPrintRef.current || loading || !invoice || !branch || !printReady) return
    autoPrintRef.current = true
    const t = setTimeout(() => {
      void waitForPrintableAssets(document.getElementById('invoice-printable-a4') ?? document.body)
        .then(() => printCurrentDocument())
    }, 0)
    return () => clearTimeout(t)
  }, [autoPrint, loading, invoice, branch, printReady])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handlePrintA4() {
    if (a4Printing) return
    if (!invoice || !printReady) {
      toast.error(t('printing:qrUnavailable'))
      return
    }
    setA4Printing(true)
    try {
      if (!isElectron()) {
        await printCurrentPageDocument('kubri-print-root', 'invoice')
        return
      }
      const result = await printA4Invoice()
      if (!result.success) throw new Error(result.message ?? 'A4 print failed')
    } catch (error) {
      console.error('A4 invoice print failed:', error)
      toast.error(t('printing:a4Failed'))
    } finally {
      setA4Printing(false)
    }
  }

  async function handlePrintThermal() {
    if (thermalPrinting) return
    if (!invoice || !printReady) {
      toast.error(t('printing:qrUnavailable'))
      return
    }

    setThermalPrinting(true)
    try {
      if (!isElectron()) {
        await printCurrentPageDocument('kubri-print-root', 'receipt')
        return
      }

      const result = await printReceipt({ invoiceId: invoice.id })
      if (result.success) {
        toast.success(t('printing:receiptSent'), { duration: 1800 })
      } else {
        console.error('Thermal receipt print failed:', result)
        toast.error(t('printing:receiptFailed'))
      }
    } catch (error) {
      console.error('Thermal receipt print failed:', error)
      toast.error(t('printing:receiptFailed'))
    } finally {
      setThermalPrinting(false)
    }
  }

  function handleWhatsApp() {
    if (!customer?.phone || !shareReady) return
    const digits = customer.phone.replace(/\D/g, '')
    const wa = digits.startsWith('966') ? digits : digits.startsWith('0') ? '966' + digits.slice(1) : digits
    const date = documentDate(invoice!.created_at, documentLanguage)
    const m = (n: number) => `SAR ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const lines = items.map(i => {
      const sellingUnit = documentNames(
        documentLanguage,
        i.selling_unit_name ?? null,
        i.selling_unit_name_ar ?? null,
      ).join(' / ')
      return `${documentNames(documentLanguage, i.name, i.name_ar).join(' / ')} × ${Number(i.quantity)}${sellingUnit ? ` ${sellingUnit}` : ''}  ${m(Number(i.total))}`
    }).join('\n')
    const bizName = documentNames(documentLanguage, brandNameEn, brandNameAr).join(' / ')
    const msg = `${documentLabel(documentLanguage, isCreditNote ? 'taxCreditNote' : isDebitNote ? 'taxDebitNote' : 'taxInvoice')} — ${bizName}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, isCreditNote ? 'creditNoteNumber' : isDebitNote ? 'debitNoteNumber' : 'invoiceNumber')}: ${invoice!.invoice_number}
${(isCreditNote || isDebitNote) && invoice!.invoice_reference ? `${documentLabel(documentLanguage, 'originalInvoice')}: ${invoice!.invoice_reference}\n` : ''}${documentLabel(documentLanguage, 'date')}: ${date}
━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, 'amountBeforeVat')}: ${m(Number(invoice!.subtotal))}
${documentLabel(documentLanguage, 'vatAmount')}: ${m(Number(invoice!.tax_amount))}
${documentLabel(documentLanguage, isCreditNote ? 'creditTotal' : 'totalIncludingVat')}: ${m(Number(invoice!.total_amount))}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, 'thankYou')} 🌿`
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleResend() {
    if (!invoice) return
    setResubmitting(true)
    try {
      setInvoice(prev => prev ? { ...prev, zatca_status: 'pending' } : prev)
      await submitInvoiceToZatca(invoice.id, invoice.branch_id, {
        source: 'manual_retry',
        documentKind: isStandardDocument ? 'standard' : 'simplified',
      })
      const { data: refreshed } = await supabase.from('invoices').select(INVOICE_SAFE_SELECT).eq('id', invoice.id).single()
      if (refreshed) setInvoice(refreshed as Invoice)
    } catch {
      const { data: refreshed } = await supabase.from('invoices').select(INVOICE_SAFE_SELECT).eq('id', invoice.id).single()
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

    setCreditNoteResult(result)
    if (result.atomicReceipt) {
      return
    }

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

  useEffect(() => {
    if (!documentViewModel) return
    setPreviewMode(resolveDefaultInvoicePreviewMode(
      documentViewModel.presentation.printMode,
      documentViewModel.presentation.afterSaleAction,
    ))
  }, [invoice?.id, documentViewModel])

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
        <p className="text-sm">{error ?? t('invoices:notFound')}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setLoadAttempt(attempt => attempt + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-600"
          >
            <RefreshCw size={13} />
            {t('common:retry')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/invoices')}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            {t('invoices:back')}
          </button>
        </div>
      </div>
    )
  }

  if (!fiscalDocumentRenderable) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
        <AlertCircle size={32} />
        <p className="max-w-md text-center text-sm">{t('invoices:documentIdentityUnavailable')}</p>
        <button
          type="button"
          onClick={() => navigate('/invoices')}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          {t('invoices:back')}
        </button>
      </div>
    )
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const isCreditNote = invoice.zatca_invoice_type === 'credit_note'
  const isDebitNote = invoice.zatca_invoice_type === 'debit_note'
  const documentLanguage = isCreditNote
    ? resolveCreditNoteDocumentLanguage(invoice.document_language, originalInvoiceLink?.document_language, branch.invoice_language)
    : resolveInvoiceDocumentLanguage(invoice.document_language, branch.invoice_language)
  const payment   = payments[0] ?? null
  const customerCreditStatusLabel = customerCredit
    ? t(`documents:${customerCredit.paymentStatus === 'paid' ? 'paid' : customerCredit.paymentStatus === 'partial' ? 'partiallyPaid' : 'unpaid'}`)
    : null
  const isSplitPayment = isSplitPaymentRows(payments)
  const isCancelled = invoice.status === 'cancelled'
  const totalOriginalQuantity = refundableItems.reduce((sum, item) => sum + Number(item.original_quantity ?? 0), 0)
  const totalRemainingQuantity = refundableItems.reduce((sum, item) => sum + Math.max(Number(item.remaining_quantity ?? 0), 0), 0)
  const creditedAmount = linkedCreditNotes.reduce((sum, note) => sum + Number(note.total_amount ?? 0), 0)
  const remainingRefundableAmount = refundableItems.length > 0
    ? refundableItems.reduce((sum, item) => sum + Math.max(Number(item.remaining_total ?? 0), 0), 0)
    : null
  const creditStatus: 'none' | 'partial' | 'full' = isCreditNote || linkedCreditNotes.length === 0
    ? 'none'
    : totalOriginalQuantity > 0 && totalRemainingQuantity <= 0.0005
    ? 'full'
    : 'partial'
  const isStandardDocument = documentViewModel.identity.invoiceType === 'standard'
  const documentTitleKey = isCreditNote
    ? (isStandardDocument ? 'taxCreditNote' : 'simplifiedTaxCreditNote')
    : isDebitNote
    ? (isStandardDocument ? 'taxDebitNote' : 'simplifiedTaxDebitNote')
    : (isStandardDocument ? 'standardTaxInvoice' : 'simplifiedTaxInvoice')
  const documentTitle = documentLabel(documentViewModel.identity.language, documentTitleKey)
  const creditLabel = creditStatus === 'full' ? t('invoices:fullyCredited') : t('invoices:partiallyCredited')
  const creditLabelClass = creditStatus === 'full'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
    : creditStatus === 'partial'
    ? 'text-amber-700 bg-amber-50 border-amber-100'
    : 'text-gray-600 bg-gray-50 border-gray-100'
  const demoSandbox = sandboxDocument
  const canIssueCreditNote = profile?.role === 'owner' || profile?.role === 'branch'
  const canCreateCreditNote = !isCreditNote
    && canIssueCreditNote
    && !isCancelled
    && invoice.status === 'posted'
    && (sandboxValidated || invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    && totalRemainingQuantity > 0.0005
  const creditDisabledReason = isCreditNote
    ? t('invoices:creditNotesCannotBeCredited')
    : invoice.status !== 'posted'
    ? t('invoices:postedOnly')
    : !(sandboxValidated || invoice.zatca_status === 'reported' || invoice.zatca_status === 'cleared')
    ? demoSandbox ? t('invoices:submitBeforeCredit') : t('invoices:reportedOnly')
    : isCancelled
    ? t('invoices:cancelledCannotCredit')
    : totalOriginalQuantity <= 0
    ? t('invoices:refundableUnavailable')
    : creditStatus === 'full' || totalRemainingQuantity <= 0.0005
    ? t('invoices:fullyCreditedReason')
    : null
  const canSubmitCurrentDocument = outputStateMatchesInvoice
    && outputState?.documentKind === 'simplified'
    && outputState.artifactStage === 'simplified_final'
    ? outputState.retryAvailable
    : invoice.zatca_status === 'failed'
      || (isCreditNote && invoice.zatca_status === 'pending')

  const displayZatcaStatus = demoSandbox ? sandboxValidation?.status ?? 'sandbox_not_validated' : invoice.zatca_status
  const zatcaStatusKey = displayZatcaStatus === 'sandbox_validated'
    ? 'submitted'
    : displayZatcaStatus === 'sandbox_validated_with_warnings'
    ? 'submittedWarnings'
    : displayZatcaStatus === 'sandbox_validation_rejected'
    ? 'rejected'
    : displayZatcaStatus === 'sandbox_not_validated'
    ? 'notSubmitted'
    : displayZatcaStatus === 'sandbox_validation_failed'
    ? 'failed'
    : displayZatcaStatus
  const zatcaStatusLabel = t(`invoices:${zatcaStatusKey}`, {
    defaultValue: displayZatcaStatus.replaceAll('_', ' '),
  })

  function selectPreview(mode: PreviewMode, focus = false) {
    setPreviewMode(mode)
    if (focus) previewTabRefs.current[mode]?.focus()
  }

  function handlePreviewTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const modes: PreviewMode[] = documentViewModel.identity.direction === 'rtl'
      ? ['thermal', 'a4']
      : ['a4', 'thermal']
    const current = modes.indexOf(previewMode)
    selectPreview(modes[(current + direction + modes.length) % modes.length], true)
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-3 overflow-x-clip pb-6">
      <div id="kubri-print-root" className="fixed left-[-10000px] top-0 w-[210mm]" aria-hidden="true">
        <A4Document model={documentViewModel} options={{ preview: autoPrint, pdfMode: true, id: 'invoice-printable-a4', qrImageUrl: qrDataUrl, nonFiscalDemo }} />
        <ThermalReceipt model={documentViewModel} options={{ id: 'invoice-printable-thermal', qrImageUrl: qrDataUrl, nonFiscalDemo }} />
      </div>

      {!nonFiscalDemo && documentReadiness.phase === 'qr_failed' && (
        <div className="no-print flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          <span>{t('printing:qrUnavailable')}</span>
          <button type="button" onClick={() => setQrRetryVersion(value => value + 1)} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-amber-900 shadow-sm">{t('common:retry')}</button>
        </div>
      )}

      <header className="no-print overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-labelledby="invoice-detail-title">
        <div className="h-1 bg-gold-500" aria-hidden="true" />
        <div className="px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <button type="button" onClick={() => navigate('/invoices')}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-xs font-semibold text-gray-500 outline-none transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-[#0F2419]">
                <ArrowLeft size={14} aria-hidden="true" />
                {t('invoices:back')}
              </button>
              <h1 id="invoice-detail-title" className="mt-0.5 text-lg font-bold leading-tight text-gray-950 sm:text-xl">
                <span dir="auto">{documentTitle}</span>
                <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
                <span className="font-mono text-base font-semibold text-gray-600 sm:text-lg" dir="ltr">{invoice.invoice_number}</span>
              </h1>
              <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t('invoices:documentStatus')}>
                {nonFiscalDemo && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{t('pos:demo.badge')}</span>}
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">{t('invoices:zatcaStatus')}: {zatcaStatusLabel}</span>
                {!isCreditNote && creditStatus !== 'none' && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${creditLabelClass}`}>{creditLabel}</span>}
              </div>
              {customerCredit?.isCustomerCredit && (
                <div className="mt-3 grid max-w-2xl gap-x-5 gap-y-1.5 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2.5 text-xs sm:grid-cols-2" aria-label={t('documents:customerCredit')}>
                  <div><span className="text-gray-500">{t('documents:paymentMethod')}</span><span className="ms-2 font-semibold text-rose-800">{t('documents:customerCredit')}</span></div>
                  <div><span className="text-gray-500">{t('documents:paymentStatus')}</span><span className="ms-2 font-semibold text-gray-900">{customerCreditStatusLabel}</span></div>
                  {customerCredit.initialPaymentMethod && <div><span className="text-gray-500">{t('documents:initialPaymentMethod')}</span><span className="ms-2 font-semibold text-gray-900">{customerCredit.initialPaymentMethod === 'cash' ? t('payments:cash') : customerCredit.initialPaymentMethod === 'card' ? t('payments:card') : customerCredit.initialPaymentMethod === 'bank_transfer' ? t('payments:bankTransfer') : customerCredit.initialPaymentMethod === 'split' ? t('payments:split') : t('payments:other')}</span></div>}
                  <div><span className="text-gray-500">{t('documents:amountPaid')}</span><bdi className="ms-2 font-semibold text-gray-900" dir="ltr"><Rial amount={customerCredit.amountPaid} /></bdi></div>
                  <div><span className="text-gray-500">{t('documents:balanceDue')}</span><bdi className="ms-2 font-semibold text-rose-800" dir="ltr"><Rial amount={customerCredit.balanceDue} /></bdi></div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="inline-flex items-center gap-2" aria-label={t('printing:printActions')}>
                <button type="button" onClick={() => void handlePrintA4()} disabled={a4Printing || !printReady}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-xs font-semibold text-white outline-none transition-colors hover:bg-[#1a3a28] focus-visible:ring-2 focus-visible:ring-[#B5943E] focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                  {a4Printing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Printer size={14} aria-hidden="true" />}
                  {a4Printing ? t('printing:printing') : t('printing:printInvoice')}
                </button>
              <button type="button" onClick={() => void handlePrintThermal()} disabled={thermalPrinting || !printReady}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-[#0F2419] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                {thermalPrinting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Printer size={14} aria-hidden="true" />}
                {thermalPrinting ? t('printing:printing') : t('printing:printReceipt')}
              </button>
              </div>
              {canSubmitCurrentDocument && !demoSandbox && (
                <button type="button" onClick={handleResend} disabled={resubmitting}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 outline-none transition-colors hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">
                  <RefreshCw size={13} className={resubmitting ? 'animate-spin' : ''} aria-hidden="true" />
                  {isCreditNote && invoice.zatca_status === 'pending' ? t('invoices:submitCreditNote') : t('invoices:resendZatca')}
                </button>
              )}
              {customer?.phone && (
                <button type="button" onClick={handleWhatsApp} disabled={!shareReady}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-semibold text-white outline-none transition-colors hover:bg-[#22c55e] focus-visible:ring-2 focus-visible:ring-[#128C7E] disabled:opacity-50">
                  <WhatsAppIcon size={13} />
                  {t('payments:whatsapp')}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {isCancelled && (
        <div className="no-print flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
          <AlertCircle size={16} aria-hidden="true" />
          {t('invoices:cancelled')}
        </div>
      )}

      <section className="no-print min-w-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="document-preview-title">
        <div className="mb-3 flex flex-col gap-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
            <h2 id="document-preview-title" className="text-sm font-bold text-gray-950">{t('invoices:documentPreview')}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t('invoices:documentPreviewHint')}</p>
            </div>
            {!isCreditNote && canIssueCreditNote && canCreateCreditNote && (
              <button ref={creditNoteTriggerRef} type="button" onClick={openCreditModal}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[#0F2419] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F2419] outline-none transition-colors hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-[#0F2419] active:scale-[0.98]">
                <FileText size={13} aria-hidden="true" />
                {creditStatus === 'partial' ? t('creditNotes:createAnother') : t('creditNotes:create')}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="tablist" aria-label={t('invoices:previewMode')} className="grid w-full grid-cols-2 rounded-xl bg-gray-100 p-1 sm:w-auto sm:min-w-64">
            <button ref={node => { previewTabRefs.current.a4 = node }} id="invoice-preview-tab-a4" type="button" role="tab"
              aria-selected={previewMode === 'a4'} aria-controls="invoice-preview-panel-a4" tabIndex={previewMode === 'a4' ? 0 : -1}
              onClick={() => selectPreview('a4')} onKeyDown={handlePreviewTabKeyDown}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0F2419] ${previewMode === 'a4' ? 'bg-[#0F2419] text-white shadow-sm' : 'text-gray-600 hover:bg-white'}`}>
              <FileText size={14} aria-hidden="true" />{t('printing:invoicePreviewTab')}
            </button>
            <button ref={node => { previewTabRefs.current.thermal = node }} id="invoice-preview-tab-thermal" type="button" role="tab"
              aria-selected={previewMode === 'thermal'} aria-controls="invoice-preview-panel-thermal" tabIndex={previewMode === 'thermal' ? 0 : -1}
              onClick={() => selectPreview('thermal')} onKeyDown={handlePreviewTabKeyDown}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0F2419] ${previewMode === 'thermal' ? 'bg-[#0F2419] text-white shadow-sm' : 'text-gray-600 hover:bg-white'}`}>
              <ReceiptText size={14} aria-hidden="true" />{t('printing:receiptPreviewTab')}
            </button>
            </div>

            {previewMode === 'a4' && (
              <div className="grid grid-cols-4 rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label={t('printing:previewZoom')}>
                {([
                  ['fit', t('printing:zoomFit')],
                  [0.75, '75%'],
                  [1, '100%'],
                  [1.25, '125%'],
                ] as const).map(([value, label]) => (
                  <button key={String(value)} type="button" onClick={() => setA4PreviewZoom(value)}
                    aria-pressed={a4PreviewZoom === value}
                    aria-label={value === 'fit' ? t('printing:zoomFit') : t('printing:zoomPercent', { percent: Math.round(value * 100) })}
                    className={`min-h-9 rounded-md px-2 py-1 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0F2419] ${a4PreviewZoom === value ? 'bg-[#0F2419] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isCreditNote ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
              <span>{t('creditNotes:creditsOriginal', { number: invoice.invoice_reference ?? originalInvoiceLink?.invoice_number ?? '—' })}</span>
              {invoice.credit_reason && <span><strong className="text-gray-800">{t('refunds:reason')}:</strong> {invoice.credit_reason}</span>}
              <span dir="ltr"><Rial amount={Number(invoice.total_amount)} /></span>
              {refunds.length > 0 && <span>{t('creditNotes:refundAllocationTitle')}: {refunds.map(refund => `${refund.method === 'card' ? t('creditNotes:bankTransferRefund') : refund.method} · ${refund.status}`).join(', ')}</span>}
              {originalInvoiceLink && <button type="button" onClick={() => navigate(`/invoices/${originalInvoiceLink.id}`)} className="font-semibold text-[#0F2419] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2419]">{t('creditNotes:openOriginal')}</button>}
            </div>
          ) : (
            (linkedCreditNotes.length > 0 || remainingRefundableAmount !== null || (creditDisabledReason && canIssueCreditNote)) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                {linkedCreditNotes.length > 0 && <span>{t('creditNotes:creditedAmount')}: <bdi className="font-semibold text-gray-800" dir="ltr"><Rial amount={creditedAmount} /></bdi></span>}
                {remainingRefundableAmount !== null && <span>{t('creditNotes:remainingRefundableTotal')}: <bdi className="font-semibold text-gray-800" dir="ltr"><Rial amount={remainingRefundableAmount} /></bdi></span>}
                {creditDisabledReason && canIssueCreditNote && !canCreateCreditNote && <span>{creditDisabledReason}</span>}
              </div>
            )
          )}
        </div>

        {previewMode === 'a4' ? (
          <div id="invoice-preview-panel-a4" role="tabpanel" aria-labelledby="invoice-preview-tab-a4" tabIndex={0} className="min-w-0 outline-none">
            <A4PreviewFit bounded zoom={a4PreviewZoom}>
              <A4Document model={documentViewModel} options={{ preview: true, id: 'invoice-preview-a4', qrImageUrl: qrDataUrl, pageNumbers: true, nonFiscalDemo }} />
            </A4PreviewFit>
          </div>
        ) : (
          <div id="invoice-preview-panel-thermal" role="tabpanel" aria-labelledby="invoice-preview-tab-thermal" tabIndex={0}
            className="h-[clamp(30rem,calc(100dvh-14.5rem),58rem)] min-h-[30rem] min-w-0 overflow-auto rounded-xl bg-gray-100 px-3 py-5 outline-none sm:px-6">
            <div className="mx-auto w-max max-w-full">
              <ThermalReceipt model={documentViewModel} options={{ preview: true, id: 'invoice-preview-thermal', qrImageUrl: qrDataUrl, nonFiscalDemo }} />
            </div>
          </div>
        )}

        {!isCreditNote && linkedCreditNotes.length > 0 && (
          <details className="mt-2 rounded-lg border border-gray-100 bg-gray-50/70">
            <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold text-[#0F2419] outline-none focus-visible:ring-2 focus-visible:ring-[#0F2419]">
              {t('creditNotes:viewCreditNotes')} · {linkedCreditNotes.length}
            </summary>
            <div className="divide-y divide-gray-100 border-t border-gray-100 bg-white">
              {linkedCreditNotes.map(note => (
                <button key={note.id} type="button" onClick={() => navigate(`/invoices/${note.id}`)}
                  className="grid min-h-11 w-full gap-1 px-3 py-2 text-start text-xs outline-none hover:bg-gray-50 focus-visible:bg-emerald-50 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                  <span className="font-semibold text-gray-900" dir="ltr">{note.invoice_number}</span>
                  <span className="text-gray-500">{t(`invoices:${note.zatca_status}`, { defaultValue: note.zatca_status })}</span>
                  <span className="font-semibold text-gray-900" dir="ltr"><Rial amount={Number(note.total_amount)} /></span>
                </button>
              ))}
            </div>
          </details>
        )}
      </section>

      <CreateCreditNoteModal
        key={invoice.id}
        open={creditModalOpen}
        invoice={{
          id: invoice.id,
          branch_id: invoice.branch_id,
          invoice_number: invoice.invoice_number,
          total_amount: Number(invoice.total_amount),
          invoice_date: invoice.invoice_date ?? invoice.created_at,
          customer_name: customer?.name ?? null,
          zatca_document_kind: outputState?.documentKind === 'standard'
            || invoice.zatca_invoice_type === 'standard'
            ? 'standard'
            : 'simplified',
        }}
        defaultRefundMethod={(isSplitPayment ? 'other' : (payment?.method ?? invoice.payment_method ?? 'cash')) as PaymentMethod}
        onClose={() => {
          setCreditModalOpen(false)
          window.requestAnimationFrame(() => creditNoteTriggerRef.current?.focus())
        }}
        onCreated={handleCreditNoteCreated}
      />
      {creditNoteResult && (
        <AtomicCreditNoteReceiptView
          result={creditNoteResult}
          onOpenPrinterSettings={() => navigate('/device-printer')}
          onClose={() => {
            setCreditNoteResult(null)
            setLoadAttempt(attempt => attempt + 1)
          }}
        />
      )}
    </div>
  )
}
