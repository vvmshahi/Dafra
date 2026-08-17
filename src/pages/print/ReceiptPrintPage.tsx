import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import { supabase } from '@/lib/supabase'
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from '@/lib/electron'
import { INVOICE_SAFE_SELECT } from '@/lib/invoices/invoiceReadContract'
import { getSandboxValidationStatus, type SandboxValidationResponse } from '@/lib/zatca/api'
import { selectStoredInvoiceQr } from '@/lib/zatca/qrSelector'
import { selectStoredOutputStateQr, type QrDisplayStatus } from '@/lib/zatca/qrDisplay.mjs'
import { isPermanentDemoSandboxBranch, type ZatcaOutputState } from '@/lib/zatca/submission'
import { readIssuedDocumentOutputState, renderIssuedDocumentQr, resolveIssuedDocumentReadiness } from '@/lib/invoices/issuedDocumentReadiness'
import { RECEIPT_FRAME_FAILED, RECEIPT_FRAME_READY } from '@/lib/receiptPrint'
import { printCurrentDocument, waitForPrintableAssets } from '@/lib/print/browserPrint'
import { executeAndroidPrint } from '@/lib/print/androidPrintExecution'
import { toSaudiTime } from '@/lib/utils/date'
import type { Branch, Invoice, InvoiceItem, Payment } from '@/types/database'
import { documentDate, resolveCreditNoteDocumentLanguage, resolveInvoiceDocumentLanguage } from '@/localization/documents'
import { documentFromStoredInvoice } from '@/lib/invoices/documentViewAdapters'
import { canRenderFiscalDocument } from '@/lib/invoices/documentPresentationReadiness'
import type { CustomerCreditPaymentSummary } from '@/lib/invoices/customerCreditPayment'
import { loadCustomerCreditPaymentSummary } from '@/lib/invoices/customerCreditReadModel'

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
  cr_number: string | null
  address: string | null
  address_ar: string | null
}

function isSplitPaymentRows(payments: Payment[]): boolean {
  return payments.length > 1
    && payments.some(payment => payment.method === 'cash' && Number(payment.amount) > 0)
    && payments.some(payment => (payment.method === 'card' || payment.method === 'bank_transfer') && Number(payment.amount) > 0)
}

function customerDisplayName(customer: Customer | null): string | null {
  if (!customer) return null
  if (customer.customer_type === 'business') {
    return customer.business_name ?? customer.company_name ?? customer.name
  }
  return customer.name
}

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function receiptProfileFromParams(params: URLSearchParams): PrinterSettings {
  const paperWidth = numberParam(params.get('paperWidthMm') ?? params.get('paperWidth'), DEFAULT_PRINTER_SETTINGS.receiptPaperWidthMm, 40, 120)
  const printableWidth = Math.min(
    numberParam(params.get('printableWidthMm'), paperWidth === 58 ? 48 : DEFAULT_PRINTER_SETTINGS.receiptPrintableWidthMm, 30, Math.max(30, paperWidth - 1)),
    paperWidth - 1,
  )

  return {
    ...DEFAULT_PRINTER_SETTINGS,
    receiptPaperPreset: paperWidth === 58 ? '58mm' : paperWidth === 80 ? '80mm' : 'custom',
    receiptPaperWidthMm: paperWidth,
    receiptPrintableWidthMm: printableWidth,
    receiptMarginLeftMm: numberParam(params.get('marginLeftMm'), DEFAULT_PRINTER_SETTINGS.receiptMarginLeftMm, 0, 10),
    receiptMarginRightMm: numberParam(params.get('marginRightMm'), DEFAULT_PRINTER_SETTINGS.receiptMarginRightMm, 0, 10),
    receiptMarginTopMm: numberParam(params.get('marginTopMm'), DEFAULT_PRINTER_SETTINGS.receiptMarginTopMm, 0, 10),
    receiptMarginBottomMm: numberParam(params.get('marginBottomMm'), DEFAULT_PRINTER_SETTINGS.receiptMarginBottomMm, 0, 10),
    receiptHorizontalOffsetMm: numberParam(params.get('horizontalOffsetMm'), 0, -10, 10),
    receiptVerticalOffsetMm: numberParam(params.get('verticalOffsetMm'), 0, -10, 10),
    receiptScalePercent: Math.round(numberParam(params.get('scalePercent'), 100, 70, 110)),
    receiptFontSize: params.get('fontSize') === 'small' || params.get('fontSize') === 'large' ? params.get('fontSize') as PrinterSettings['receiptFontSize'] : 'normal',
    receiptDensity: params.get('density') === 'compact' || params.get('density') === 'spacious' ? params.get('density') as PrinterSettings['receiptDensity'] : 'normal',
  }
}

const BROWSER_RECEIPT_PROFILE: PrinterSettings = {
  ...DEFAULT_PRINTER_SETTINGS,
  receiptPaperPreset: '80mm',
  receiptPaperWidthMm: 80,
  receiptPrintableWidthMm: 72,
  receiptMarginLeftMm: 4,
  receiptMarginRightMm: 4,
  receiptMarginTopMm: 2,
  receiptMarginBottomMm: 2,
  receiptHorizontalOffsetMm: 0,
  receiptVerticalOffsetMm: 0,
  receiptScalePercent: 100,
  receiptFontSize: 'normal',
  receiptDensity: 'normal',
}

function useReceiptPrintStyle(profile: PrinterSettings, isElectronPrint: boolean) {
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'receipt-route-print-style'
    const fontSize = profile.receiptFontSize === 'small' ? 10 : profile.receiptFontSize === 'large' ? 12 : 11
    const lineHeight = profile.receiptDensity === 'compact' ? 1.25 : profile.receiptDensity === 'spacious' ? 1.55 : 1.4
    const receiptScale = profile.receiptScalePercent / 100
    const receiptTransform = isElectronPrint
      ? 'translate(var(--receipt-offset-x), var(--receipt-offset-y)) scale(var(--receipt-scale))'
      : 'none'
    style.textContent = `
      #receipt-print-page {
        --receipt-paper-width: ${profile.receiptPaperWidthMm}mm;
        --receipt-content-width: ${profile.receiptPrintableWidthMm}mm;
        --receipt-margin-left: ${profile.receiptMarginLeftMm}mm;
        --receipt-margin-right: ${profile.receiptMarginRightMm}mm;
        --receipt-margin-top: ${profile.receiptMarginTopMm}mm;
        --receipt-margin-bottom: ${profile.receiptMarginBottomMm}mm;
        --receipt-offset-x: ${profile.receiptHorizontalOffsetMm}mm;
        --receipt-offset-y: ${profile.receiptVerticalOffsetMm}mm;
        --receipt-scale: ${receiptScale};
        --receipt-font-size: ${fontSize}px;
        --receipt-line-height: ${lineHeight};
      }
      #thermal-receipt {
        max-width: var(--receipt-content-width) !important;
        font-size: var(--receipt-font-size) !important;
        line-height: var(--receipt-line-height) !important;
      }
      @media print {
        @page { size: ${profile.receiptPaperWidthMm}mm auto; margin: 0; }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .no-print { display: none !important; }
        #receipt-print-page {
          display: block !important;
          width: ${profile.receiptPaperWidthMm}mm !important;
          background: white !important;
          padding: ${profile.receiptMarginTopMm}mm ${profile.receiptMarginRightMm}mm ${profile.receiptMarginBottomMm}mm ${profile.receiptMarginLeftMm}mm !important;
          box-sizing: border-box !important;
        }
        #thermal-receipt {
          display: block !important;
          visibility: visible !important;
          position: static !important;
          width: var(--receipt-content-width) !important;
          max-width: var(--receipt-content-width) !important;
          margin: 0 auto !important;
          color: #000 !important;
          background: #fff !important;
          transform: ${receiptTransform};
          transform-origin: top center;
        }
        #thermal-receipt * {
          visibility: visible !important;
          color: inherit;
        }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('receipt-route-print-style')?.remove() }
  }, [profile, isElectronPrint])
}

export default function ReceiptPrintPage() {
  const { t } = useTranslation(['receipts', 'printing'])
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const autoPrint = params.get('auto') === '1'
  const embeddedPrint = params.get('embedded') === '1'
  const electronPrint = params.get('electronPrint') === '1'
  const printJobId = params.get('printJobId')
  const receiptProfile = useMemo(
    () => electronPrint ? receiptProfileFromParams(params) : BROWSER_RECEIPT_PROFILE,
    [electronPrint, params],
  )
  const printedRef = useRef(false)
  const electronReadyRef = useRef(false)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [customerCredit, setCustomerCredit] = useState<CustomerCreditPaymentSummary | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<QrDisplayStatus>('loading')
  const [qrRetryVersion, setQrRetryVersion] = useState(0)
  const [sandboxValidation, setSandboxValidation] = useState<SandboxValidationResponse | null>(null)
  const [outputState, setOutputState] = useState<ZatcaOutputState | null>(null)
  const [originalDocumentLanguage, setOriginalDocumentLanguage] = useState<string | null>(null)
  const nonFiscalDemo = invoice?.is_demo === true
  const sandboxValidated = sandboxValidation?.invoiceId === invoice?.id
    && (sandboxValidation?.status === 'sandbox_validated'
      || sandboxValidation?.status === 'sandbox_validated_with_warnings')
  const outputStateMatchesInvoice = Boolean(invoice && outputState?.invoiceId === invoice.id)
  const sandboxDocument = Boolean(invoice && !nonFiscalDemo && isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id))
  const selectedQrPayload = sandboxDocument
    ? selectStoredInvoiceQr(null, 'sandbox', {
      sandboxGenerated: sandboxValidated && Boolean(sandboxValidation?.qrCode),
      sandboxQrCode: sandboxValidation?.qrCode,
    })
    : selectStoredOutputStateQr(outputStateMatchesInvoice ? outputState : null)
  const documentViewModel = useMemo(() => {
    if (!invoice || !branch || !tenant) return null
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
  const documentReadiness = resolveIssuedDocumentReadiness({ modelReady: Boolean(invoice && branch && tenant && fiscalDocumentRenderable), nonFiscalDemo, outputCanPrint: sandboxDocument ? sandboxValidated : outputStateMatchesInvoice && outputState?.canPrint === true, qrPayload: selectedQrPayload, qrStatus, qrDataUrl })
  const printReady = documentReadiness.printable

  useReceiptPrintStyle(receiptProfile, electronPrint)

  useEffect(() => {
    if (!invoice || nonFiscalDemo || !isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)) {
      setSandboxValidation(null)
      return
    }
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
  }, [invoice?.id, invoice?.tenant_id, invoice?.branch_id, nonFiscalDemo])

  useEffect(() => {
    if (!invoice || nonFiscalDemo || isPermanentDemoSandboxBranch(invoice.tenant_id, invoice.branch_id)) {
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
  }, [invoice?.id, invoice?.branch_id, invoice?.zatca_status, nonFiscalDemo, qrRetryVersion])

  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false

    async function loadReceipt() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: inv, error: invErr }, { data: itemData }, { data: paymentData }] = await Promise.all([
          supabase.from('invoices').select(INVOICE_SAFE_SELECT).eq('id', invoiceId).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
          supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('paid_at', { ascending: true }).order('created_at', { ascending: true }),
        ])

        if (invErr || !inv) {
          setError(t('receipts:notFound'))
          return
        }
        if (cancelled) return

        const fetches: Promise<any>[] = [
          supabase.from('branches').select('*').eq('id', inv.branch_id).single(),
          supabase.from('tenants').select('name, name_ar, vat_number, cr_number, address').eq('id', inv.tenant_id).single(),
        ]
        // Receipt rendering must not rehydrate buyer identity from the mutable
        // customer master. The document adapter consumes identity_snapshot.
        const customerFetch = Promise.resolve({ data: null })
        const [branchResult, tenantResult, customerResult, originalResult, customerCreditSummary] = await Promise.all([
          fetches[0],
          fetches[1],
          customerFetch,
          inv.original_invoice_id
            ? supabase.from('invoices').select('document_language').eq('id', inv.original_invoice_id).maybeSingle()
            : Promise.resolve({ data: null }),
          inv.zatca_invoice_type === 'credit_note'
            ? Promise.resolve(null)
            : loadCustomerCreditPaymentSummary({ invoiceId: inv.id, totalAmount: inv.total_amount, paymentStatus: inv.payment_status }),
        ])
        if (cancelled) return

        setInvoice(inv as Invoice)
        setItems((itemData ?? []) as InvoiceItem[])
        setPayments((paymentData ?? []) as Payment[])
        setCustomerCredit(customerCreditSummary)
        setBranch(branchResult.data as Branch)
        setTenant(tenantResult.data as Tenant)
        setCustomer((customerResult?.data ?? null) as Customer | null)
        setOriginalDocumentLanguage((originalResult?.data as { document_language?: string | null } | null)?.document_language ?? null)
      } catch {
        if (!cancelled) setError(t('receipts:loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadReceipt()
    return () => { cancelled = true }
  }, [invoiceId, t])

  useEffect(() => {
    if (!invoice || !branch || !tenant) return
    let cancelled = false

    async function generateQR() {
      if (invoice!.is_demo === true) {
        setQrDataUrl(null)
        setQrStatus('missing')
        return
      }
      const environment = isPermanentDemoSandboxBranch(invoice!.tenant_id, invoice!.branch_id) ? 'sandbox' : 'production'
      if (environment === 'production' && !outputStateMatchesInvoice) return
      if (environment === 'sandbox' && sandboxValidation?.invoiceId !== invoice!.id) return

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

  useEffect(() => {
    if (!autoPrint || embeddedPrint || electronPrint || printedRef.current || loading || error || !invoice || !branch || !printReady) return
    printedRef.current = true
    const timer = window.setTimeout(() => {
      const root = document.getElementById('receipt-print-page')
      if (!root || !documentViewModel) return
      void executeAndroidPrint({
        documentType: documentViewModel.identity.kind === 'credit_note' ? 'credit_note' : documentViewModel.identity.invoiceType === 'standard' ? 'invoice' : 'simplified_invoice',
        printFormat: 'thermal_receipt',
        source: documentViewModel.identity.kind === 'credit_note' ? 'credit_note_reprint' : 'invoice_reprint',
        documentId: invoice.id,
        documentNumber: invoice.invoice_number,
        root,
        itemCount: items.length,
        templateId: documentViewModel.template.resolvedId,
        renderer: async validate => {
          await waitForPrintableAssets(root)
          validate()
          await printCurrentDocument()
          return 'sent_to_printer'
        },
      }).then(result => {
        if (!result.success) toast.error(result.failure?.merchantMessage ?? t('printing:receiptFailed'))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoPrint, embeddedPrint, electronPrint, loading, error, invoice, branch, printReady, documentViewModel, items.length, t])

  useEffect(() => {
    if (!embeddedPrint || loading || !invoiceId) return
    if (error) {
      window.parent.postMessage({
        type: RECEIPT_FRAME_FAILED,
        invoiceId,
        error,
      }, window.location.origin)
      return
    }
    if (invoice && branch && tenant && printReady) {
      window.parent.postMessage({
        type: RECEIPT_FRAME_READY,
        invoiceId,
      }, window.location.origin)
      return
    }
    if (qrStatus === 'missing' || qrStatus === 'failed') {
      window.parent.postMessage({
        type: RECEIPT_FRAME_FAILED,
        invoiceId,
        error: t('printing:qrUnavailable'),
      }, window.location.origin)
    }
  }, [
    embeddedPrint,
    loading,
    error,
    invoiceId,
    invoice,
    branch,
    tenant,
    printReady,
    qrStatus,
    t,
  ])

  const receipt = useMemo(() => {
    if (!invoice || !branch || !tenant) return null

    const documentLanguage = invoice.zatca_invoice_type === 'credit_note'
      ? resolveCreditNoteDocumentLanguage(invoice.document_language, originalDocumentLanguage, branch.invoice_language)
      : resolveInvoiceDocumentLanguage(invoice.document_language, branch.invoice_language)
    const date = documentDate(invoice.created_at, documentLanguage)
    const address = [
      branch.building_number ? `Building ${branch.building_number}` : null,
      branch.street,
      branch.district,
      branch.city,
    ].filter(Boolean).join(', ')
    const addressAr = [
      branch.building_number ? `مبنى ${branch.building_number}` : null,
      branch.street_ar,
      branch.district_ar,
      branch.city_ar,
    ].filter(Boolean).join('، ')
    const thermalItems: ThermalItem[] = items.map(item => ({
      name: item.name,
      nameAr: item.name_ar,
      qty: Number(item.quantity),
      unitName: item.selling_unit_name ?? null,
      unitNameAr: item.selling_unit_name_ar ?? null,
      unitCode: item.selling_unit_code ?? null,
      baseQuantity: item.base_quantity == null ? null : Number(item.base_quantity),
      baseUnitName: item.base_unit_name ?? null,
      baseUnitNameAr: item.base_unit_name_ar ?? null,
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.total),
      subtotal: Number(item.subtotal),
      taxAmount: Number(item.tax_amount),
      total: Number(item.total),
    }))
    const isCreditNote = invoice.zatca_invoice_type === 'credit_note'
    const displayPayments = payments.map(payment => ({
      ...payment,
      method: isCreditNote && payment.method === 'card' ? 'bank_transfer' as const : payment.method,
    }))
    const splitPayment = isSplitPaymentRows(displayPayments)
    const payment = displayPayments[0] ?? null
    const cashReceived = !splitPayment && payment?.method === 'cash'
      ? Number(payment.amount_received ?? payment.amount ?? invoice.total_amount)
      : null
    const changeAmount = !splitPayment && payment?.method === 'cash'
      ? Number(payment.change_amount ?? 0)
      : null
    const isStandardDocument = invoice.zatca_invoice_type === 'standard'
      || (isCreditNote && customer?.customer_type === 'business' && !!customer?.vat_number)

    return {
      date,
      time: toSaudiTime(invoice.created_at),
      brandNameEn: branch.display_name || branch.business_name || branch.name,
      brandNameAr: branch.business_name_ar || branch.name_ar || branch.display_name || branch.business_name || branch.name,
      branchNameEn: branch.name,
      branchNameAr: branch.name_ar,
      address: address || null,
      addressAr: addressAr || null,
      items: thermalItems,
      splitPayment,
      payment,
      payments: displayPayments,
      cashReceived,
      changeAmount,
      customerName: customerDisplayName(customer),
      customerNameAr: customer?.customer_type === 'business'
        ? customer.business_name_ar ?? customer.name_ar
        : customer?.name_ar ?? null,
      buyerVatNumber: isStandardDocument ? customer?.vat_number ?? null : null,
      isStandardDocument,
      documentType: isCreditNote ? 'credit_note' as const : 'invoice' as const,
      documentLanguage,
    }
  }, [invoice, branch, tenant, items, payments, customer, originalDocumentLanguage])

  useEffect(() => {
    if (!electronPrint || electronReadyRef.current || loading || error || !invoice || !branch || !tenant || !receipt || !printReady) return
    electronReadyRef.current = true
    window.electronAPI?.receiptReady?.({
      invoiceId: invoice.id,
      jobId: printJobId,
    })
  }, [electronPrint, loading, error, invoice, branch, tenant, receipt, printReady, printJobId])

  useEffect(() => {
    if (!electronPrint || electronReadyRef.current || !error || !invoiceId) return
    electronReadyRef.current = true
    window.electronAPI?.receiptFailed?.({
      invoiceId,
      jobId: printJobId,
      error,
    })
  }, [electronPrint, error, invoiceId, printJobId])

  async function handlePrint() {
    if (!printReady || !invoice || !documentViewModel) {
      toast.error(t('printing:qrUnavailable'))
      return
    }
    const root = document.getElementById('receipt-print-page')
    if (!root) {
      toast.error(t('printing:receiptFailed'))
      return
    }
    const result = await executeAndroidPrint({
      documentType: documentViewModel.identity.kind === 'credit_note' ? 'credit_note' : documentViewModel.identity.invoiceType === 'standard' ? 'invoice' : 'simplified_invoice',
      printFormat: 'thermal_receipt',
      source: documentViewModel.identity.kind === 'credit_note' ? 'credit_note_reprint' : 'invoice_reprint',
      documentId: invoice.id,
      documentNumber: invoice.invoice_number,
      root,
      itemCount: items.length,
      templateId: documentViewModel.template.resolvedId,
      renderer: async validate => {
        await waitForPrintableAssets(root)
        validate()
        await printCurrentDocument()
        return 'sent_to_printer'
      },
    })
    if (!result.success) toast.error(result.failure?.merchantMessage ?? t('printing:receiptFailed'))
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-400">
        <Loader2 size={28} className="animate-spin" />
      </div>
    )
  }

  if (error || !invoice || !branch || !tenant || !receipt || !documentViewModel || !fiscalDocumentRenderable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-gray-900">{error ?? t('receipts:unavailable')}</p>
          <button
            type="button"
            onClick={() => navigate('/pos')}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0F2419] px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft size={14} />
            {t('receipts:backToPos')}
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
            <p className="text-sm font-bold text-gray-900">{t('receipts:title', { number: invoice.invoice_number })}</p>
            <p className="text-xs text-gray-500">{t('receipts:subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/pos')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={13} />
              {t('receipts:backToPos')}
            </button>
            <Link
              to={`/invoices/${invoice.id}`}
              className="hidden rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:inline-flex"
            >
              {t('receipts:invoiceDetails')}
            </Link>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={!printReady}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F2419] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1a3a28] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Printer size={13} />
              {t('printing:print')}
            </button>
          </div>
        </div>
      </div>

      {!nonFiscalDemo && qrStatus !== 'loading' && qrStatus !== 'ready' && (
        <div className="no-print mx-auto mt-4 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          <div className="flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          {t('printing:qrUnavailable')}
          </div>
          <button type="button" onClick={() => setQrRetryVersion(value => value + 1)} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-amber-900 shadow-sm">{t('common:retry')}</button>
        </div>
      )}

      <main id="receipt-print-page" className="mx-auto flex min-h-[calc(100vh-64px)] max-w-3xl items-start justify-center bg-white px-3 py-5 sm:my-6 sm:min-h-0 sm:rounded-2xl sm:border sm:border-gray-100 sm:shadow-sm">
        <ThermalReceipt model={documentViewModel} options={{ preview: true, qrImageUrl: qrDataUrl, nonFiscalDemo }} />
      </main>
    </div>
  )
}
