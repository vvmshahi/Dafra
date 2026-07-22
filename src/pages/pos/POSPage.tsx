import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  Receipt, X, ChevronDown, User, Check, Loader2,
  ShoppingBag, AlertCircle, Zap, Printer, PackageOpen, ArrowLeft, Lock,
  ChevronLeft, ChevronRight, ChevronUp,
} from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { resolveEffectiveVatTreatment } from '@/lib/pricing/vat'
import { updateCachedInvoiceRows, upsertInvoiceListRow } from '@/lib/invoices/invoiceListCache'
import { buildZatcaQR } from '@/lib/zatca/qr'
import { saudiDateStr, toSaudiTime } from '@/lib/utils/date'
import { isPermanentDemoSandboxBranch, submitInvoiceForBranch } from '@/lib/zatca/submission'
import { toast } from 'sonner'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import A4Document from '@/components/print/A4Document'
import type { Branch, BranchPosMode, Invoice, InvoiceItem, Payment, PaymentMethod, VatTreatment } from '@/types/database'
import { documentFromStoredInvoice } from '@/lib/invoices/documentViewAdapters'
import type { DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { usePosSession } from '@/hooks/usePosSession'
import type { ClosedSessionSummary, PosSession } from '@/hooks/usePosSession'
import { useSubscription } from '@/hooks/useSubscription'
import { getPrinterSettings, getPrinters, isElectron, printA4Invoice, printReceipt } from '@/lib/electron'
import { openReceiptPreview, printReceiptInHiddenFrame } from '@/lib/receiptPrint'
import { supportConfig } from '@/config/support'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useLocale } from '@/localization/useLocale'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import {
  documentDate,
  documentDirection,
  documentFontFamily,
  documentLabel,
  documentLabelLines,
  documentNames,
  documentPaymentLabel,
  normalizeDocumentLanguage,
  type DocumentLanguage,
} from '@/localization/documents'

// ── Types ─────────────────────────────────────────────────────────────────────

type PosPaymentChoice = 'cash' | 'card' | 'split'
type PosMode = BranchPosMode

interface ReceiptPayment {
  method: PaymentMethod
  amount: number
  amountReceived: number | null
  changeAmount: number | null
}

interface PosProduct {
  id: string
  name: string
  nameAr: string | null
  sku: string | null
  barcode: string | null
  price: number
  unit: string
  vatTreatment: VatTreatment
  stockQuantity: number | null
  trackStock: boolean
  imageUrl: string | null
  isService: boolean
  isActive: boolean
  isAvailable: boolean
  catId: string | null
  catName: string | null
  catNameAr: string | null
  catColor: string | null
}

interface PosCategory {
  id: string
  name: string
  nameAr: string | null
  color: string | null
  icon: string | null
}

interface PosCustomer {
  id: string
  name: string
  name_ar: string | null
  phone: string | null
  customer_type: string
  vat_number: string | null
  business_name: string | null
  business_name_ar: string | null
}

interface CartItem {
  productId: string
  name: string
  nameAr: string | null
  price: number
  vatTreatment: VatTreatment
  unit: string
  quantity: number
  catColor: string | null
}

interface ReceiptData {
  document: DocumentViewModel
  invoiceNumber: string
  invoiceId: string
  total: number
  taxAmount: number
  subtotal: number
  paymentMethod: PaymentMethod
  change: number
  cashReceived: number
  customerName: string
  customerNameAr: string | null
  customerPhone: string | null
  isStandardInvoice: boolean
  buyerVatNumber: string | null
  cashierName: string
  items: Array<{ name: string; nameAr?: string | null; qty: number; unitPrice: number; lineTotal: number; subtotal?: number; taxAmount?: number; total?: number }>
  createdAt: string
  businessNameAr: string
  businessNameEn: string
  branchName: string
  branchNameAr: string | null
  branchAddress: string | null
  branchAddressAr: string | null
  documentLanguage: DocumentLanguage
  vatNumber: string
  phone: string | null
  website: string | null
  email: string | null
  showWebsite: boolean
  showEmail: boolean
  receiptFooter: string | null
  showFooter: boolean
  showCashChange: boolean
  logoUrl: string | null
  showLogo: boolean
  payments: ReceiptPayment[]
  displayPaymentMethod: string
  complianceSellerName: string | null
}

function branchPosMode(value: string | null | undefined): PosMode {
  return value === 'quick' ? 'quick' : 'touch'
}

interface PosCheckoutItemResult {
  product_id: string | null
  name: string
  name_ar: string | null
  unit: string | null
  quantity: number | string
  unit_price: number | string
  line_amount: number | string
  subtotal: number | string
  tax_amount: number | string
  total: number | string
}

interface PosCheckoutResult {
  invoice_id: string
  invoice_number: string
  document_language?: 'en' | 'ar' | 'both' | null
  created_at: string
  subtotal: number | string
  tax_amount: number | string
  total: number | string
  payment_method: PaymentMethod
  payment_status: string
  amount_received?: number | string | null
  change_amount?: number | string | null
  display_payment_method?: string | null
  payments?: {
    method: PaymentMethod
    amount: number | string
    amount_received?: number | string | null
    change_amount?: number | string | null
  }[]
  zatca_invoice_type: 'simplified' | 'standard'
  items: PosCheckoutItemResult[]
  idempotent_replay?: boolean
}

const DEVICE_PRINTER_PATH = '/device-printer'

// ── VAT helpers ───────────────────────────────────────────────────────────────

function resolveMode(
  treatment: VatTreatment,
  branchMode: 'exclusive' | 'inclusive',
): 'exclusive' | 'inclusive' | 'exempt' {
  return resolveEffectiveVatTreatment(treatment, branchMode)
}

function computeTotals(cart: CartItem[], vatMode: 'exclusive' | 'inclusive') {
  let subtotal = 0
  let taxAmount = 0
  for (const item of cart) {
    const line = item.price * item.quantity
    const mode = resolveMode(item.vatTreatment, vatMode)
    if (mode === 'exclusive') {
      subtotal += line
      taxAmount += line * 0.15
    } else if (mode === 'inclusive') {
      const net = line / 1.15
      subtotal += net
      taxAmount += line - net
    } else {
      subtotal += line
    }
  }
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

function printFailureKey(errorType?: string | null) {
  if (errorType === 'NO_PRINTER_CONFIGURED') return 'printer.notConfigured'
  if (errorType === 'PRINTER_NOT_FOUND') return 'printer.notFound'
  return 'printer.receiptFailed'
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0)
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function amountInput(value: number): string {
  return Math.max(0, round2(value)).toFixed(2)
}

function formatSessionDateTimeLocalized(utcString: string, locale: string): string {
  return new Date(utcString).toLocaleString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function createCheckoutIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function safeCheckoutErrorKey(err: unknown): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message ?? '')
    : ''

  if (/account is suspended|new billing is disabled|suspended/i.test(message)) {
    return 'pos:accountSuspendedFull'
  }
  if (/amount paid is less|underpaid/i.test(message)) {
    return 'validation:amountReceivedTooLow'
  }
  if (/split payment.*not enabled/i.test(message)) {
    return 'validation:splitPaymentDisabled'
  }
  if (/split payment.*equal|split payment.*balanced/i.test(message)) {
    return 'validation:splitPaymentUnbalanced'
  }
  if (/split payment.*greater than zero|requires both cash and card/i.test(message)) {
    return 'validation:splitPaymentComponents'
  }
  if (/insufficient stock/i.test(message)) {
    return 'validation:insufficientStock'
  }
  if (/not available/i.test(message)) {
    return 'validation:unavailableItem'
  }
  if (/forbidden|unauthorized|not found|inactive/i.test(message)) {
    return 'validation:checkoutForbidden'
  }
  return 'validation:checkoutFailed'
}

function registerSessionErrorKey(err: unknown): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message ?? '')
    : ''

  if (/account is suspended|new register sessions cannot be opened|suspended/i.test(message)) {
    return 'suspended'
  }
  if (/already open/i.test(message)) {
    return 'alreadyOpen'
  }
  if (/forbidden|unauthorized|not found|inactive/i.test(message)) {
    return 'forbidden'
  }
  return 'unableToOpen'
}

function localizedName(name: string | null | undefined, nameAr: string | null | undefined, isArabic: boolean) {
  return isArabic && nameAr?.trim() ? nameAr : (name ?? '')
}

function localizedPaymentMethod(method: string | null | undefined, t: (key: string) => string): string {
  if (method === 'split') return t('payments:splitPayment')
  if (method === 'cash') return t('payments:cash')
  if (method === 'card') return t('payments:cardPos')
  if (method === 'bank_transfer') return t('payments:bankTransfer')
  return t('payments:other')
}

function paymentMethodLabel(method: string | null | undefined): string {
  if (method === 'split') return 'Split Payment'
  if (method === 'cash') return 'Cash'
  if (method === 'card') return 'Card / POS'
  if (method === 'bank_transfer') return 'Bank Transfer'
  return 'Other'
}

function isSplitPaymentRows(payments: ReceiptPayment[]): boolean {
  return payments.length > 1
    && payments.some(payment => payment.method === 'cash' && payment.amount > 0)
    && payments.some(payment => payment.method === 'card' && payment.amount > 0)
}

function paymentRowsTotal(payments: ReceiptPayment[]): number {
  return round2(payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0))
}

function invoiceAccountingSign(invoice: { zatca_invoice_type?: string | null }): number {
  return invoice.zatca_invoice_type === 'credit_note' ? -1 : 1
}

function productSearchRank(product: PosProduct, query: string): number {
  const sku = (product.sku ?? '').toLowerCase()
  const barcode = (product.barcode ?? '').toLowerCase()
  const name = product.name.toLowerCase()
  const nameAr = (product.nameAr ?? '').toLowerCase()

  if (sku === query || barcode === query) return 0
  if (sku.startsWith(query) || barcode.startsWith(query)) return 1
  if (name.includes(query) || nameAr.includes(query)) return 2
  if (sku.includes(query) || barcode.includes(query)) return 3
  return 99
}

function productMatchesSearch(product: PosProduct, query: string): boolean {
  return productSearchRank(product, query) < 99
}

const cartKey = (bid: string) => `pos_cart_${bid}`

// ── Quick Expense modal ───────────────────────────────────────────────────────

function QuickExpenseModal({
  branchId, tenantId, userId, sessionId, onClose,
}: { branchId: string; tenantId: string; userId: string | null; sessionId?: string | null; onClose: () => void }) {
  const { t } = useTranslation(['pos', 'common'])
  const [amount, setAmount] = useState('')
  const [desc,   setDesc]   = useState('')
  const [vendor, setVendor] = useState('')
  const [reviewVatLater, setReviewVatLater] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    const amt = parseFloat(amount)
    if (!amt || !desc.trim()) return
    const totalPaid = Number(amt.toFixed(2))
    setSaving(true)
    try {
      const q = supabase as unknown as { from: (t: string) => any }
      const { error } = await q.from('expenses').insert({
        tenant_id:      tenantId,
        branch_id:      branchId,
        added_by:       userId,
        expense_date:   saudiDateStr(),
        description:    desc.trim(),
        vendor_name:    vendor.trim() || null,
        amount:         totalPaid,
        vat_treatment:  'no_vat',
        vat_claim_status: reviewVatLater ? 'needs_review' : 'not_claimable',
        expense_before_vat: totalPaid,
        vat_amount:     0,
        total_paid:     totalPaid,
        payment_method: 'cash',
        session_id:     sessionId ?? null,
      })
      if (error) throw error
      toast.success(t('pos:expenseSaved'))
      onClose()
    } catch (error) {
      console.warn('[QuickExpenseModal] expense insert failed', error)
      toast.error(t('pos:expenseFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{t('pos:quickCashExpense')}</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {t('pos:expenseHint')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="label">{t('pos:expenseAmount')}</label>
            <MoneyInput value={amount} onValueChange={setAmount}
              className="input" placeholder="0.00" autoFocus />
          </div>
          <div>
            <label className="label">{t('pos:expenseDescription')}</label>
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
              className="input" placeholder={t('pos:expenseDescriptionPlaceholder')} />
          </div>
          <div>
            <label className="label">{t('pos:vendorOptional')}</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
              className="input" placeholder={t('pos:vendorPlaceholder')} />
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={reviewVatLater}
                onChange={event => setReviewVatLater(event.target.checked)} />
              <span>
                {t('pos:reviewVatLater')}
                {!reviewVatLater && ` ${t('pos:noInputVatClaimed')}`}
              </span>
            </label>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            {t('common:cancel')}
          </button>
          <button onClick={save} disabled={saving || !amount || !desc.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : t('pos:saveExpense')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Receipt overlay ───────────────────────────────────────────────────────────

function ReceiptView({ receipt, onNewSale, onOpenPrinterSettings, printMode }: {
  receipt: ReceiptData
  onNewSale: () => void
  onOpenPrinterSettings: () => void
  printMode: 'thermal' | 'pdf' | 'both'
}) {
  const { t } = useTranslation(['pos', 'payments', 'common'])
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState(false)
  const [printErrorKey, setPrintErrorKey] = useState<string | null>(null)
  const documentLanguage = normalizeDocumentLanguage(receipt.documentLanguage)
  const documentDir = documentDirection(documentLanguage)

  useEffect(() => {
    async function genQR() {
      try {
        if (!receipt.complianceSellerName || !receipt.vatNumber) return
        const payload = buildZatcaQR({
          sellerName:  receipt.complianceSellerName,
          vatNumber:   receipt.vatNumber,
          timestamp:   receipt.createdAt,
          totalAmount: receipt.total,
          vatAmount:   receipt.taxAmount,
        })
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M', width: 160, margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        })
        setQrDataUrl(url)
      } catch {}
    }
    genQR()
  }, [receipt])

  function shareWhatsApp() {
    if (!receipt.customerPhone) return
    const digits = receipt.customerPhone.replace(/\D/g, '')
    const wa = digits.startsWith('966') ? digits : digits.startsWith('0') ? '966' + digits.slice(1) : digits
    const date = documentDate(receipt.createdAt, documentLanguage, { month: '2-digit' })
    const m = (n: number) => `SAR ${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const lines = receipt.items.map(i => `${documentNames(documentLanguage, i.name, i.nameAr).join(' / ')} × ${i.qty}  ${m(i.lineTotal)}`).join('\n')
    const businessName = documentNames(documentLanguage, receipt.businessNameEn, receipt.businessNameAr).join(' / ')
    const msg = `${documentLabel(documentLanguage, 'taxInvoice')} — ${businessName}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, 'invoiceNumber')}: ${receipt.invoiceNumber}
${documentLabel(documentLanguage, 'date')}: ${date}
━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, 'amountBeforeVat')}: ${m(receipt.subtotal)}
${documentLabel(documentLanguage, 'vatAmount')}: ${m(receipt.taxAmount)}
${documentLabel(documentLanguage, 'totalIncludingVat')}: ${m(receipt.total)}
━━━━━━━━━━━━━━━
${documentLabel(documentLanguage, 'thankYou')} 🌿`
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const invDate = documentDate(receipt.createdAt, documentLanguage, { month: '2-digit' })
  const invTime = toSaudiTime(receipt.createdAt)
  const isSplitPayment = receipt.displayPaymentMethod === 'split' || isSplitPaymentRows(receipt.payments)
  const cashPayment = receipt.payments.find(payment => payment.method === 'cash')
  const cardPayment = receipt.payments.find(payment => payment.method === 'card')

  async function printPosA4() {
    const existing = document.getElementById('pos-pdf-print-style')
    existing?.remove()
    const s = document.createElement('style')
    s.id = 'pos-pdf-print-style'
    s.textContent = `
      @media print {
        @page { size: A4; margin: 15mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { visibility: hidden !important; }
        #thermal-receipt { display: none !important; visibility: hidden !important; }
        #pos-pdf-printable {
          display: block !important;
          visibility: visible !important;
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 100% !important;
          background: white !important;
          z-index: 999999 !important;
          padding: 10mm !important;
          box-sizing: border-box !important;
        }
        #pos-pdf-printable * { visibility: visible !important; }
      }
    `
    document.head.appendChild(s)
    const result = await printA4Invoice()
    if (!result.success) {
      console.warn('[ReceiptView] A4 print failed', result.errorType)
      toast.error(t('pos:printer.a4Failed'))
    }
    s.remove()
  }

  async function openReceiptPrintPage() {
    if (printingReceipt) return
    setPrintErrorKey(null)

    setPrintingReceipt(true)
    try {
      if (!isElectron()) {
        if (!openReceiptPreview(receipt.invoiceId, false)) throw new Error('Receipt preview was blocked')
        return
      }

      const settings = await getPrinterSettings()
      if (!settings.receiptPrinterName) {
        const message = t('pos:printer.notConfigured')
        setPrintErrorKey('printer.notConfigured')
        toast.info(message, {
          action: { label: t('pos:printer.devicePrinter'), onClick: onOpenPrinterSettings },
        })
        return
      }

      const result = await printReceipt({ invoiceId: receipt.invoiceId })
      if (result.success) {
        toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
        return
      }

      console.warn('[ReceiptView] receipt print failed', result.errorType)
      const message = t(`pos:${printFailureKey(result.errorType)}`)
      setPrintErrorKey(printFailureKey(result.errorType))
      toast.error(message)
      if (settings.fallbackToPreview) await printReceiptInHiddenFrame(receipt.invoiceId)
    } catch (error) {
      console.warn('[ReceiptView] receipt print failed', error)
      const message = t('pos:printer.receiptFailed')
      setPrintErrorKey('printer.receiptFailed')
      toast.error(message)
    } finally {
      setPrintingReceipt(false)
    }
  }

  return (
    <>
      {/* A4 invoice — hidden, shown only via printPosA4() print style */}
      <A4Document model={receipt.document} options={{ id: 'pos-pdf-printable', pdfMode: true, qrImageUrl: qrDataUrl, pageNumbers: true }} />
      {/* A4 output is rendered only by A4Document above. */}

      {/* Hidden thermal receipt — rendered for print only */}
      <ThermalReceipt
        model={receipt.document}
        options={{ qrImageUrl: qrDataUrl }}
      />

      {/* Success overlay */}
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0F2419]/90">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

          {/* Banner */}
          <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 px-6 py-8 text-center text-white">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check size={32} strokeWidth={3} />
            </div>
            <p className="text-2xl font-bold">{t('payments:paymentReceived')}</p>
            <p className="text-emerald-100 text-sm mt-1"><bdi dir="ltr">{receipt.invoiceNumber}</bdi></p>
          </div>

          {/* Summary */}
          <div className="p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{t('payments:customer')}</span>
              <span className="font-medium text-gray-800" dir="auto">{receipt.customerName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{t('payments:method')}</span>
              <span className="font-medium text-gray-800">{localizedPaymentMethod(receipt.displayPaymentMethod, t)}</span>
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>{t('pos:netAmount')}</span>
                <span className="tabular-nums" dir="ltr"><Rial amount={receipt.subtotal} /></span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>{t('pos:vat')}</span>
                <span className="tabular-nums" dir="ltr"><Rial amount={receipt.taxAmount} /></span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-lg pt-1.5 border-t border-gray-100">
                <span>{t('payments:amountDue')}</span>
                <span className="tabular-nums text-emerald-600" dir="ltr"><Rial amount={receipt.total} /></span>
              </div>
            </div>
            {receipt.paymentMethod === 'cash' && receipt.change > 0.005 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex justify-between">
                <span className="text-sm font-semibold text-amber-700">{t('payments:changeDue')}</span>
                <span className="text-lg font-bold text-amber-700 tabular-nums" dir="ltr"><Rial amount={receipt.change} /></span>
              </div>
            )}

          </div>

          {printErrorKey && (
            <div className="mx-6 mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-700">{t(`pos:${printErrorKey}`)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void openReceiptPrintPage()}
                  disabled={printingReceipt}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-700 shadow-sm hover:bg-red-100"
                >
                  {printingReceipt ? t('payments:printing') : t('common:retry')}
                </button>
                <button
                  type="button"
                  onClick={onOpenPrinterSettings}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  {t('pos:printer.choose')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!openReceiptPreview(receipt.invoiceId, false)) {
                      toast.error(t('pos:printer.previewFailed'))
                    }
                  }}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  {t('pos:printer.openPreview')}
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            <div className="flex gap-2">
              {printMode !== 'pdf' && (
                <button
                  onClick={() => void openReceiptPrintPage()}
                  disabled={printingReceipt}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  {printingReceipt ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                  {printingReceipt ? t('payments:printing') : t('payments:printReceipt')}
                </button>
              )}
              {printMode === 'pdf' || printMode === 'both' ? (
                <button
                  onClick={printPosA4}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Printer size={14} />
                  {t('payments:printInvoice')}
                </button>
              ) : null}
              {receipt.customerPhone && (
                <button
                  onClick={shareWhatsApp}
                  className="flex-1 py-2.5 bg-[#25D366] text-white text-sm font-semibold rounded-xl hover:bg-[#22c55e] transition-colors flex items-center justify-center gap-1.5"
                >
                  <WhatsAppIcon size={14} />
                  {t('payments:whatsapp')}
                </button>
              )}
            </div>
            <button onClick={onNewSale}
              className="w-full py-3 bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity">
              {t('payments:newSale')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product, cartQty, onAdd }: {
  product: PosProduct; cartQty: number; onAdd: () => void
}) {
  const { isRtl } = useLocale()
  const color = product.catColor ?? '#10b981'
  const imageUrl = product.imageUrl?.trim() || null
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  return (
    <button onClick={onAdd}
      className="bg-white border border-gray-100 rounded-2xl p-3 text-start hover:border-primary-300 hover:shadow-md transition-all relative">
      {cartQty > 0 && (
        <span className="absolute top-2 end-2 w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center z-10" dir="ltr">
          {cartQty}
        </span>
      )}
      <div className="w-full aspect-square rounded-xl mb-2.5 flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: `${color}18` }}>
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ShoppingBag size={22} style={{ color }} />
        )}
      </div>
      <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2" dir="auto">{localizedName(product.name, product.nameAr, isRtl)}</p>
      <p className="text-sm font-bold text-primary-600 mt-1" dir="ltr"><Rial amount={product.price} /></p>
      {product.catName && (
        <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1"
          style={{ backgroundColor: `${color}20`, color }}>
          <span dir="auto">{localizedName(product.catName, product.catNameAr, isRtl)}</span>
        </span>
      )}
    </button>
  )
}

function formatStockQuantity(value: number | null | undefined) {
  if (value == null) return '0'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

function QuickBillingPanel({
  products,
  totalProductCount,
  cart,
  query,
  onAdd,
}: {
  products: PosProduct[]
  totalProductCount: number
  cart: CartItem[]
  query: string
  onAdd: (product: PosProduct) => void
}) {
  const { t } = useTranslation('pos')
  const { isRtl } = useLocale()
  if (products.length === 0) {
    const hasQuery = query.trim().length > 0
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
          <PackageOpen size={30} className="text-gray-300" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-gray-700 text-sm">
            {totalProductCount === 0 ? t('noProductsAvailable') : t('noMatchingProducts')}
          </p>
          {totalProductCount === 0 ? null : hasQuery && query.trim().length < 2 ? (
            <p className="text-xs text-gray-400 max-w-[240px]">
              {t('searchMinimum')}
            </p>
          ) : hasQuery ? (
            <p className="text-xs text-gray-400 max-w-[240px]">
              {t('searchTryAnother')}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {!query.trim() && <div className="border-b border-gray-100 px-4 py-3"><p className="text-sm font-bold text-gray-900">{t('browseProducts')}</p><p className="text-[11px] text-gray-500">{t('showingActiveProducts')}</p></div>}
      <div className="hidden lg:grid grid-cols-[minmax(220px,1.7fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_120px_110px_92px] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase text-gray-400">
        <span>{t('product')}</span>
        <span>{t('category')}</span>
        <span>{t('skuBarcode')}</span>
        <span>{t('availableStock')}</span>
        <span className="text-end">{t('price')}</span>
        <span className="text-end">{t('add')}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {products.map(product => {
          const codeParts = [product.sku, product.barcode].filter(Boolean)
          const cartQty = cart.find(item => item.productId === product.id)?.quantity ?? 0

          return (
            <div
              key={product.id}
              className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1.7fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_120px_110px_92px] gap-3 px-4 py-3 items-center hover:bg-emerald-50/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                  <span dir="auto">{localizedName(product.name, product.nameAr, isRtl)}</span>
                </p>
                {cartQty > 0 && (
                  <span className="mt-1 inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                    {t('inCart', { count: cartQty })}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                {product.catName ? (
                  <span className="inline-flex max-w-full rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 truncate">
                    <span dir="auto">{localizedName(product.catName, product.catNameAr, isRtl)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">{t('uncategorized')}</span>
                )}
              </div>

              <div className="min-w-0 text-xs text-gray-500" dir="ltr">
                {codeParts.length > 0 ? (
                  <div className="space-y-0.5">
                    {product.sku && <p className="truncate">{t('sku', { value: product.sku })}</p>}
                    {product.barcode && <p className="truncate">{t('barcode', { value: product.barcode })}</p>}
                  </div>
                ) : (
                  <span className="text-gray-300">{t('noSkuBarcode')}</span>
                )}
              </div>

              <div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  product.trackStock
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {product.trackStock ? t('stockCount', { count: formatStockQuantity(product.stockQuantity) }) : t('notTracked')}
                </span>
              </div>

              <div className="text-start lg:text-end">
                <span className="text-sm font-bold tabular-nums text-primary-700" dir="ltr">
                  <Rial amount={product.price} />
                </span>
              </div>

              <button
                type="button"
                onClick={() => onAdd(product)}
                className="h-9 rounded-xl bg-[#1B6B3A] text-white text-xs font-bold hover:bg-[#155830] transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus size={13} />
                {t('add')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── WhatsApp icon ─────────────────────────────────────────────────────────────

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

// ── Open Session Modal ────────────────────────────────────────────────────────

function OpenSessionModal({
  onOpen, onSkip, onBack,
}: { onOpen: (cash: number) => Promise<void>; onSkip: () => Promise<void>; onBack?: () => void }) {
  const { t } = useTranslation(['register', 'pos'])
  const [cash,   setCash]   = useState('')
  const [saving, setSaving] = useState(false)

  async function handleOpen() {
    setSaving(true)
    try { await onOpen(parseFloat(cash) || 0) } finally { setSaving(false) }
  }

  async function handleSkip() {
    setSaving(true)
    try { await onSkip() } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="relative bg-gradient-to-br from-[#1a3a28] to-primary-600 px-6 py-6 text-white text-center">
          {onBack && (
            <button
              onClick={onBack}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              title={t('pos:backToDashboard')}
            >
              <X size={14} />
            </button>
          )}
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ShoppingBag size={22} />
          </div>
          <h3 className="font-bold text-lg">{t('register:open')}</h3>
          <p className="text-white/70 text-xs mt-1">{t('register:startSession')}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('register:openingCashOptional')}</label>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
              <MoneyInput
                value={cash} onValueChange={setCash}
                className="input ps-10" placeholder="0.00" autoFocus
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{t('register:openingCashHint')}</p>
          </div>
        </div>
        <div className="px-5 pb-5 space-y-2">
          <div className="flex gap-2">
            <button onClick={handleSkip} disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              {t('register:openWithZero')}
            </button>
            <button onClick={handleOpen} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : t('register:open')}
            </button>
          </div>
          {onBack && (
            <button onClick={onBack} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">
              <DirectionalIcon icon={ArrowLeft} size={12} className="inline-block me-1" />{t('pos:backToDashboard')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Close Session Modal ───────────────────────────────────────────────────────

function CloseSessionModal({ session, onClose, onCancel }: {
  session: PosSession
  onClose: (params: { closingCashActual: number; notes: string; closingChecks?: Record<string, unknown> }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation(['register', 'common'])
  const { locale } = useLocale()
  const [cashActual,    setCashActual]    = useState('')
  const [notes,         setNotes]         = useState('')
  const [saving,        setSaving]        = useState(false)
  const [loadingData,   setLoadingData]   = useState(true)
  const [invoiceCount,  setInvoiceCount]  = useState(0)
  const [totalSessionSales, setTotalSessionSales] = useState(0)
  const [cashSales,     setCashSales]     = useState(0)
  const [cashRefunds,   setCashRefunds]   = useState(0)
  const [cardSales,     setCardSales]     = useState(0)
  const [creditRefunds, setCreditRefunds] = useState(0)
  const [cashExpenses,  setCashExpenses]  = useState(0)

  const openedAt = formatSessionDateTimeLocalized(session.opened_at, locale)
  const durationMs = Date.now() - new Date(session.opened_at).getTime()
  const durationH  = Math.floor(durationMs / 3_600_000)
  const durationM  = Math.floor((durationMs % 3_600_000) / 60_000)
  const duration   = durationH > 0
    ? t('register:durationHoursMinutes', { hours: durationH, minutes: durationM })
    : t('register:durationMinutes', { minutes: durationM })
  const openingCash = Number(session.opening_cash)

  useEffect(() => {
    const db = () => supabase as unknown as { from: (t: string) => any }
    async function fetchData() {
      const [{ data: invData }, { data: expData }] = await Promise.all([
        db().from('invoices').select('id, zatca_invoice_type, total_amount').eq('session_id', session.id).neq('status', 'cancelled'),
        db().from('expenses').select('total_paid, payment_method').eq('session_id', session.id),
      ])
      const ids = (invData ?? []).map((i: any) => i.id)
      const signByInvoiceId = new Map(
        (invData ?? []).map((invoice: any) => [invoice.id, invoiceAccountingSign(invoice)]),
      )
      let pmts: any[] = []
      if (ids.length > 0) {
        const { data } = await db().from('payments').select('invoice_id, method, amount').in('invoice_id', ids)
        pmts = data ?? []
      }
      const invoices = invData ?? []
      setInvoiceCount(invoices.length)
      setTotalSessionSales(invoices
        .reduce((s: number, invoice: any) => s + invoiceAccountingSign(invoice) * Number(invoice.total_amount ?? 0), 0))
      setCashSales(pmts
        .filter((p: any) => p.method === 'cash' && (signByInvoiceId.get(p.invoice_id) ?? 1) > 0)
        .reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0))
      setCashRefunds(pmts
        .filter((p: any) => p.method === 'cash' && (signByInvoiceId.get(p.invoice_id) ?? 1) < 0)
        .reduce((s: number, p: any) => s + Math.abs(Number(p.amount ?? 0)), 0))
      setCardSales(pmts
        .filter((p: any) => p.method === 'card')
        .reduce((s: number, p: any) => s + (signByInvoiceId.get(p.invoice_id) ?? 1) * Number(p.amount ?? 0), 0))
      setCreditRefunds(pmts
        .filter((p: any) => (signByInvoiceId.get(p.invoice_id) ?? 1) < 0)
        .reduce((s: number, p: any) => s + Math.abs(Number(p.amount ?? 0)), 0))
      setCashExpenses((expData ?? []).filter((e: any) => e.payment_method === 'cash').reduce((s: number, e: any) => s + Number(e.total_paid ?? 0), 0))
      setLoadingData(false)
    }
    fetchData()
  }, [session.id])

  // Mirrors close_register_session: opening cash + signed cash payments - cash expenses.
  // Positive cash sales and cash refunds are separated here only for reconciliation clarity.
  const expectedCash  = openingCash + cashSales - cashRefunds - cashExpenses
  const actualCash    = parseFloat(cashActual) || 0
  const difference    = cashActual !== '' ? actualCash - expectedCash : null
  const differenceState = difference === null
    ? { label: t('register:enterActualCash'), className: 'bg-gray-100 text-gray-500' }
    : Math.abs(difference) < 0.005
    ? { label: t('register:balanced'), className: 'bg-emerald-100 text-emerald-700' }
    : difference > 0
    ? { label: t('register:cashOverBy', { amount: `SAR ${fmt(difference)}` }), className: 'bg-amber-100 text-amber-800' }
    : { label: t('register:cashShortBy', { amount: `SAR ${fmt(Math.abs(difference))}` }), className: 'bg-red-100 text-red-700' }
  const canClose = cashActual !== ''
    && !loadingData
    && !saving

  async function handleClose() {
    if (cashActual === '') return
    setSaving(true)
    try {
      await onClose({
        closingCashActual: actualCash,
        notes,
        closingChecks: {
          cash_sales_confirmed: false,
          card_sales_confirmed: false,
          cash_expenses_confirmed: false,
          credit_refunds_confirmed: false,
          total_session_sales_preview: totalSessionSales,
          credit_refunds_preview: creditRefunds,
          expected_cash_preview: expectedCash,
          actual_cash_entered: actualCash,
          cash_difference_preview: difference,
        },
      })
    } catch (err) {
      console.error('[CloseSessionModal]', err)
      toast.error(t('register:unableToClose'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-1.5rem)] mx-2 overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">{t('register:close')}</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">{t('register:openedAt', { time: openedAt, duration })}</p>
          </div>
          <button onClick={onCancel} aria-label={t('register:cancelClose')} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"><X size={16} /></button>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : (
          <div className="px-4 py-4 space-y-4 overflow-y-auto sm:px-5">
            <section aria-labelledby="expected-cash-heading" className="rounded-2xl border border-primary-200 bg-primary-50/70 p-4 sm:p-5">
              <p id="expected-cash-heading" className="text-xs font-bold uppercase tracking-wide text-primary-700">{t('register:expectedCashDrawer')}</p>
              <div className="mt-3 space-y-2 text-sm text-gray-600">
                <div className="flex justify-between gap-4"><span>{t('register:openingCash')}</span><span className="tabular-nums" dir="ltr"><Rial amount={openingCash} /></span></div>
                <div className="flex justify-between gap-4"><span><span aria-hidden="true">+</span> {t('register:netCashSales')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cashSales} /></span></div>
                <div className="flex justify-between gap-4"><span><span aria-hidden="true">−</span> {t('register:posCashExpenses')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cashExpenses} /></span></div>
                <div className="flex justify-between gap-4"><span><span aria-hidden="true">−</span> {t('register:cashRefunds')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cashRefunds} /></span></div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-4 border-t border-primary-200 pt-3">
                <span className="text-sm font-semibold text-primary-900">{t('register:expectedCashDrawer')}</span>
                <span className="text-2xl font-black text-primary-900 tabular-nums" dir="ltr"><Rial amount={expectedCash} /></span>
              </div>
            </section>

            <section aria-labelledby="cash-count-heading" className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 id="cash-count-heading" className="text-sm font-bold text-gray-900">{t('register:countDrawer')}</h4>
                <button
                  type="button"
                  onClick={() => setCashActual(expectedCash.toFixed(2))}
                  className="rounded-xl border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {t('register:cashMatches', { amount: `SAR ${fmt(expectedCash)}` })}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor="actual-closing-cash" className="label">{t('register:actualCashCounted')}</label>
                  <div className="relative">
                    <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
                    <MoneyInput id="actual-closing-cash" value={cashActual} onValueChange={setCashActual} className="input h-11 ps-10" placeholder="0.00" autoFocus />
                  </div>
                </div>
                <div aria-live="polite" className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold sm:min-w-48 ${differenceState.className}`}>
                  {differenceState.label}
                </div>
              </div>
            </section>

            <details className="group rounded-xl border border-gray-100 bg-gray-50/70">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500">
                {t('register:sessionSummary')}
                <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-gray-100 px-4 py-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between"><span className="text-gray-500">{t('register:invoiceCount')}</span><span className="font-medium" dir="ltr">{invoiceCount}</span></div>
                <div className="flex justify-between font-bold text-gray-900"><span>{t('register:netSessionSales')}</span><span className="tabular-nums" dir="ltr"><Rial amount={totalSessionSales} /></span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t('register:netCashSales')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cashSales - cashRefunds} /></span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t('register:netCardSales')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cardSales} /></span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t('register:refundsCreditNotes')}</span><span className="tabular-nums" dir="ltr"><Rial amount={creditRefunds} /></span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t('register:posCashExpenses')}</span><span className="tabular-nums" dir="ltr"><Rial amount={cashExpenses} /></span></div>
              </div>
            </details>

            <section>
              <label className="label">{t('register:closingNoteOptional')}</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                className="input resize-none min-h-0" rows={2}
                placeholder={t('register:closingNotePlaceholder')}
              />
            </section>
          </div>
        )}

        <div className="px-5 py-3.5 flex gap-2 border-t border-gray-100 flex-shrink-0">
          <button onClick={onCancel} disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
            {t('common:cancel')}
          </button>
          <button onClick={handleClose} disabled={!canClose}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : t('register:close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Session Summary Modal ─────────────────────────────────────────────────────

function SessionSummaryModal({ summary, onDone, onNewSession }: {
  summary: ClosedSessionSummary
  onDone: () => void
  onNewSession: () => void
}) {
  const { t } = useTranslation(['register', 'pos'])
  const { locale } = useLocale()
  const openedAt = formatSessionDateTimeLocalized(summary.opened_at, locale)
  const closedAt = formatSessionDateTimeLocalized(summary.closed_at, locale)
  const diff      = Number(summary.closing_cash_difference ?? 0)
  const isBalanced = Math.abs(diff) < 0.005
  const differenceLabel = isBalanced
    ? t('register:balanced')
    : diff < 0
    ? t('register:shortAmount', { amount: `SAR ${fmt(Math.abs(diff))}` })
    : t('register:overAmount', { amount: `SAR ${fmt(diff)}` })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="bg-gradient-to-br from-[#1a3a28] to-primary-600 px-6 py-5 text-white text-center">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Check size={22} strokeWidth={2.5} />
          </div>
          <h3 className="font-bold text-lg">{t('register:closed')}</h3>
          <p className="text-white/70 text-xs mt-1" dir="auto">{openedAt} – {closedAt}</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl bg-primary-50 px-4 py-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{t('register:netSessionSales')}</p>
            <p className="mt-1 text-2xl font-black text-primary-900 tabular-nums" dir="ltr"><Rial amount={Number(summary.total_session_sales)} /></p>
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              [t('register:invoiceCount'), summary.total_invoices],
              [t('register:netCashSales'), <Rial amount={Number(summary.total_cash_sales)} />],
              [t('register:netCardSales'), <Rial amount={Number(summary.total_card_sales)} />],
              [t('register:posCashExpenses'), <Rial amount={Number(summary.cash_expenses)} />],
              [t('register:refundsCreditNotes'), <Rial amount={Number(summary.total_refunds)} />],
              [t('register:openingCash'), <Rial amount={Number(summary.opening_cash)} />],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-4 border-b border-gray-50 pb-2 text-gray-600">
                <span>{label}</span><span className="font-medium tabular-nums" dir="ltr">{value}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">{t('register:closingCash')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-gray-500">{t('register:expectedClosingCash')}</p><p className="mt-1 font-bold tabular-nums" dir="ltr"><Rial amount={Number(summary.closing_cash_expected)} /></p></div>
              <div><p className="text-xs text-gray-500">{t('register:actualClosingCash')}</p><p className="mt-1 font-bold tabular-nums" dir="ltr"><Rial amount={Number(summary.closing_cash_actual)} /></p></div>
            </div>
            <div className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-bold ${isBalanced ? 'bg-gray-100 text-gray-700' : diff < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
              <span>{t('register:cashDifference')}</span><span dir="auto">{differenceLabel}</span>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onNewSession}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            {t('register:openNew')}
          </button>
          <button onClick={onDone}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            {t('pos:dashboard')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SplitPaymentModal({
  total,
  cashValue,
  cardValue,
  submitting,
  onCashChange,
  onCardChange,
  onUseCash,
  onUseCard,
  onClose,
  onComplete,
}: {
  total: number
  cashValue: string
  cardValue: string
  submitting: boolean
  onCashChange: (value: string) => void
  onCardChange: (value: string) => void
  onUseCash: () => void
  onUseCard: () => void
  onClose: () => void
  onComplete: () => void
}) {
  const { t } = useTranslation(['payments', 'common'])
  const cashAmount = parseFloat(cashValue) || 0
  const cardAmount = parseFloat(cardValue) || 0
  const paidTotal = round2(cashAmount + cardAmount)
  const balance = round2(total - paidTotal)
  const isBalanced = Math.abs(balance) <= 0.01
  const hasNegative = cashAmount < 0 || cardAmount < 0
  const canComplete = isBalanced && !hasNegative && (cashAmount > 0 || cardAmount > 0) && !submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">{t('payments:splitPayment')}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{t('payments:amountDue')} <span dir="ltr"><Rial amount={total} /></span></p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">{t('payments:cashAmount')}</span>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
              <MoneyInput
                value={cashValue}
                onValueChange={onCashChange}
                className="input ps-10 tabular-nums"
                autoFocus
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">{t('payments:cardAmount')}</span>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
              <MoneyInput
                value={cardValue}
                onValueChange={onCardChange}
                className="input ps-10 tabular-nums"
              />
            </div>
          </label>

          <div className={`rounded-xl px-3 py-2 text-xs ${
            isBalanced && !hasNegative ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <div className="flex justify-between">
              <span>{t('payments:totalPaid')}</span>
              <span className="font-semibold tabular-nums" dir="ltr"><Rial amount={paidTotal} /></span>
            </div>
            <div className="flex justify-between mt-1">
              <span>{balance >= 0 ? t('payments:remaining') : t('payments:overBy')}</span>
              <span className="font-semibold tabular-nums" dir="ltr"><Rial amount={Math.abs(balance)} /></span>
            </div>
          </div>

          {cashAmount <= 0 && cardAmount > 0 && (
            <button type="button" onClick={onUseCard} className="w-full text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-xl py-2">
              {t('payments:useCard')}
            </button>
          )}
          {cardAmount <= 0 && cashAmount > 0 && (
            <button type="button" onClick={onUseCash} className="w-full text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl py-2">
              {t('payments:useCash')}
            </button>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={!canComplete}
            className="flex-1 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? t('payments:processing') : t('payments:completeSale')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── POSPage ───────────────────────────────────────────────────────────────────

const WA_LINK    = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

export default function POSPage() {
  const { t } = useTranslation(['pos', 'payments', 'register', 'validation', 'common'])
  const { isRtl } = useLocale()
  const { profile, user, tenant } = useAuth()
  const navigate  = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const categoryScrollRef = useRef<HTMLDivElement>(null)
  const productScrollRef = useRef<HTMLDivElement>(null)
  const sub       = useSubscription()

  // Session management
  const { session, loading: sessionLoading, openSession, closeSession } = usePosSession(
    profile?.branch_id,
    profile?.tenant_id,
    profile?.id,
  )
  const [showOpenSession,  setShowOpenSession]  = useState(false)
  const [showCloseSession, setShowCloseSession] = useState(false)
  const [sessionSummary,   setSessionSummary]   = useState<ClosedSessionSummary | null>(null)

  const [branch,     setBranch]     = useState<Branch | null>(null)
  const [complianceSellerName, setComplianceSellerName] = useState<string | null>(null)
  const [complianceVatNumber, setComplianceVatNumber] = useState<string | null>(null)
  const [products,   setProducts]   = useState<PosProduct[]>([])
  const [categories, setCategories] = useState<PosCategory[]>([])
  const [customers,  setCustomers]  = useState<PosCustomer[]>([])
  const [loading,    setLoading]    = useState(true)

  const [search,       setSearch]       = useState('')
  const [activeCat,    setActiveCat]    = useState<string | null>(null)
  const [cart,         setCart]         = useState<CartItem[]>([])
  const [customerId,   setCustomerId]   = useState<string | null>(null)
  const [custSearch,   setCustSearch]   = useState('')
  const [custOpen,     setCustOpen]     = useState(false)
  const [note,         setNote]         = useState('')
  const [payMethod,    setPayMethod]    = useState<PosPaymentChoice>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [splitCash,    setSplitCash]    = useState('')
  const [splitCard,    setSplitCard]    = useState('')
  const [splitOpen,    setSplitOpen]    = useState(false)
  const [splitLastEdited, setSplitLastEdited] = useState<'cash' | 'card'>('cash')
  const [submitting,   setSubmitting]   = useState(false)
  const [receipt,      setReceipt]      = useState<ReceiptData | null>(null)
  const [showExpense,  setShowExpense]  = useState(false)
  const [printerStatus, setPrinterStatus] = useState<'connected' | 'unconfigured' | 'error'>('unconfigured')
  const [scrollState,  setScrollState]  = useState({
    categoryAtStart: true,
    categoryAtEnd: true,
    productsAtStart: true,
    productsAtEnd: true,
  })
  const checkoutKeyRef = useRef<string | null>(null)
  const autoPrintedReceiptIdRef = useRef<string | null>(null)
  const businessType = resolveBusinessType(tenant?.business_type)
  const savedBranchPosMode = branchPosMode(branch?.pos_mode)
  const activePosMode: PosMode = businessType === 'trading' ? savedBranchPosMode : 'touch'

  useEffect(() => {
    if (!isElectron()) return
    let cancelled = false
    Promise.all([getPrinterSettings(), getPrinters()])
      .then(([settings, printers]) => {
        if (cancelled) return
        if (!settings.receiptPrinterName) setPrinterStatus('unconfigured')
        else if (printers.some(printer => printer.name === settings.receiptPrinterName)) setPrinterStatus('connected')
        else setPrinterStatus('error')
      })
      .catch(() => { if (!cancelled) setPrinterStatus('error') })
    return () => { cancelled = true }
  }, [])

  // ── Load data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      const bid = profile?.branch_id
      if (!tid || !bid) { setLoading(false); return }
      setLoading(true)
      try {
        const [{ data: branchData }, { data: prodData }, { data: custData }, { data: complianceData }] = await Promise.all([
          supabase.from('branches').select('*').eq('id', bid).single(),
          supabase
            .from('products')
            .select('id, name, name_ar, sku, barcode, price, unit, vat_treatment, category_id, stock_quantity, track_stock, image_url, is_service, is_active, is_available, categories(id, name, name_ar, color, icon)')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .eq('is_available', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('customers')
            .select('id, name, name_ar, phone, customer_type, vat_number, business_name, business_name_ar')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(200),
          (supabase as any).from('branch_compliance_profiles')
            .select('registered_seller_name,vat_number,validation_status')
            .eq('branch_id', bid).eq('tenant_id', tid).eq('validation_status', 'verified').maybeSingle(),
        ])
        if (cancelled) return

        setBranch(branchData as Branch)
        const protectedMode = branchData?.compliance_identity_mode === 'protected'
        setComplianceSellerName(protectedMode
          ? complianceData?.registered_seller_name ?? null
          : branchData?.business_name || branchData?.name || null)
        setComplianceVatNumber(protectedMode
          ? complianceData?.vat_number ?? null
          : branchData?.vat_number ?? null)

        const prods: PosProduct[] = (prodData ?? []).map((p: any) => ({
          id:            p.id,
          name:          p.name,
          nameAr:        p.name_ar,
          sku:           p.sku ?? null,
          barcode:       p.barcode ?? null,
          price:         Number(p.price),
          unit:          p.unit ?? 'pcs',
          vatTreatment:  (p.vat_treatment ?? 'inherit') as VatTreatment,
          stockQuantity: p.stock_quantity == null ? null : Number(p.stock_quantity),
          trackStock:    Boolean(p.track_stock),
          imageUrl:      p.image_url ?? null,
          isService:     Boolean(p.is_service),
          isActive:      p.is_active !== false,
          isAvailable:   p.is_available !== false,
          catId:         p.category_id,
          catName:       (p.categories as any)?.name ?? null,
          catNameAr:     (p.categories as any)?.name_ar ?? null,
          catColor:     (p.categories as any)?.color ?? null,
        }))
        setProducts(prods)

        const catMap = new Map<string, PosCategory>()
        for (const p of prodData ?? []) {
          const c = (p as any).categories
          if (c?.id) catMap.set(c.id, { id: c.id, name: c.name, nameAr: c.name_ar ?? null, color: c.color, icon: c.icon })
        }
        setCategories(Array.from(catMap.values()))

        setCustomers((custData ?? []).map((c: any) => ({
          id:            c.id,
          name:          c.name,
          phone:         c.phone,
          customer_type: c.customer_type ?? 'individual',
          vat_number:    c.vat_number ?? null,
          business_name: c.business_name ?? null,
        })))

        try {
          const saved = localStorage.getItem(cartKey(bid))
          if (saved) setCart(JSON.parse(saved))
        } catch {}
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile?.tenant_id, profile?.branch_id])

  // ── Persist cart ─────────────────────────────────────────────────────────

  useEffect(() => {
    const bid = profile?.branch_id
    if (!bid) return
    localStorage.setItem(cartKey(bid), JSON.stringify(cart))
  }, [cart, profile?.branch_id])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        if (e.target === searchRef.current) {
          setSearch('')
          searchRef.current?.blur()
        } else if (!isInput && cart.length === 0) {
          navigate('/branch')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart, navigate])

  // Enter-to-add: separate effect so it sees latest products/search/cart
  useEffect(() => {
    function onEnter(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.target !== searchRef.current) return
      const visible = activePosMode === 'quick' ? quickFiltered : filtered
      if (visible.length === 1) addToCart(visible[0])
    }
    window.addEventListener('keydown', onEnter)
    return () => window.removeEventListener('keydown', onEnter)
  })

  // ── Derived ──────────────────────────────────────────────────────────────

  const searchText = search.trim()
  const searchQ = searchText.toLowerCase()
  const filtered = useMemo(() => {
    const visible = products.filter(p => {
      const matchCat = !activeCat || p.catId === activeCat
      if (!searchQ) return matchCat
      return matchCat && productMatchesSearch(p, searchQ)
    })

    return searchQ
      ? visible.sort((a, b) => productSearchRank(a, searchQ) - productSearchRank(b, searchQ))
      : visible
  }, [products, activeCat, searchQ])
  const quickFiltered = useMemo(() => {
    const visible = products
      .filter(p => {
        if (activeCat && p.catId !== activeCat) return false
        if (!searchQ) return true
        const exactCodeMatch = (p.sku ?? '').toLowerCase() === searchQ || (p.barcode ?? '').toLowerCase() === searchQ
        if (searchQ.length < 2) return exactCodeMatch
        return productMatchesSearch(p, searchQ)
      })
    return (searchQ ? visible.sort((a, b) => productSearchRank(a, searchQ) - productSearchRank(b, searchQ)) : visible).slice(0, 25)
  }, [products, activeCat, searchQ])

  const vatMode = branch?.vat_mode ?? 'exclusive'
  const totals  = computeTotals(cart, vatMode)
  const cashAmt = parseFloat(cashReceived) || 0
  const change  = payMethod === 'cash' ? Math.max(0, cashAmt - totals.total) : 0
  const splitPaymentsEnabled = branch?.allow_split_payments ?? false
  const showPosScrollButtons = branch?.show_pos_scroll_buttons ?? false
  const splitCashAmount = parseFloat(splitCash) || 0
  const splitCardAmount = parseFloat(splitCard) || 0
  const splitPaidTotal = round2(splitCashAmount + splitCardAmount)
  const splitBalanced = Math.abs(splitPaidTotal - round2(totals.total)) <= 0.01
  const splitReady = splitPaymentsEnabled
    && (splitCashAmount > 0 || splitCardAmount > 0)
    && splitCashAmount <= totals.total + 0.01
    && splitCardAmount <= totals.total + 0.01
    && splitBalanced
  const isAccountSuspended = sub.status === 'suspended'

  const filteredCusts = custSearch.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(custSearch.toLowerCase()) ||
        (c.phone ?? '').includes(custSearch)
      )
    : customers
  const selectedCust = customers.find(c => c.id === customerId)

  function getScrollState(el: HTMLElement | null) {
    if (!el) return { atStart: true, atEnd: true }
    const maxScroll = Math.max(0, el.scrollWidth > el.clientWidth
      ? el.scrollWidth - el.clientWidth
      : el.scrollHeight - el.clientHeight)
    const current = el.scrollWidth > el.clientWidth ? el.scrollLeft : el.scrollTop
    return {
      atStart: current <= 2,
      atEnd: current >= maxScroll - 2,
    }
  }

  function updateScrollState() {
    const category = getScrollState(categoryScrollRef.current)
    const products = getScrollState(productScrollRef.current)
    setScrollState(prev => {
      const next = {
        categoryAtStart: category.atStart,
        categoryAtEnd: category.atEnd,
        productsAtStart: products.atStart,
        productsAtEnd: products.atEnd,
      }
      return prev.categoryAtStart === next.categoryAtStart &&
        prev.categoryAtEnd === next.categoryAtEnd &&
        prev.productsAtStart === next.productsAtStart &&
        prev.productsAtEnd === next.productsAtEnd
        ? prev
        : next
    })
  }

  function scrollCategories(direction: -1 | 1) {
    const el = categoryScrollRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(180, Math.round(el.clientWidth * 0.7)), behavior: 'smooth' })
  }

  function scrollProducts(direction: -1 | 1) {
    const el = productScrollRef.current
    if (!el) return
    el.scrollBy({ top: direction * Math.max(220, Math.round(el.clientHeight * 0.75)), behavior: 'smooth' })
  }

  useEffect(() => {
    if (!showPosScrollButtons || activePosMode !== 'touch') return
    const categoryEl = categoryScrollRef.current
    const productEl = productScrollRef.current
    updateScrollState()
    categoryEl?.addEventListener('scroll', updateScrollState, { passive: true })
    productEl?.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    return () => {
      categoryEl?.removeEventListener('scroll', updateScrollState)
      productEl?.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [showPosScrollButtons, activePosMode, categories.length, filtered.length])

  useEffect(() => {
    if (payMethod !== 'split') return
    if (splitLastEdited === 'cash') {
      setSplitCard(amountInput(totals.total - splitCashAmount))
    } else {
      setSplitCash(amountInput(totals.total - splitCardAmount))
    }
  // Rebalance when the cart total changes while the split dialog is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.total])

  function openSplitPayment() {
    if (!splitPaymentsEnabled) return
    setPayMethod('split')
    setSplitLastEdited('cash')
    setSplitCash('')
    setSplitCard(amountInput(totals.total))
    setSplitOpen(true)
  }

  function updateSplitCash(value: string) {
    const amount = parseFloat(value) || 0
    setSplitLastEdited('cash')
    setSplitCash(value)
    setSplitCard(amountInput(totals.total - amount))
  }

  function updateSplitCard(value: string) {
    const amount = parseFloat(value) || 0
    setSplitLastEdited('card')
    setSplitCard(value)
    setSplitCash(amountInput(totals.total - amount))
  }

  async function handleOpenRegister(openingCash: number) {
    if (isAccountSuspended) {
      toast.error(t('register:suspended'))
      return
    }

    try {
      await openSession(openingCash)
      setShowOpenSession(false)
    } catch (err) {
      console.warn('[POSPage] register open failed', err)
      toast.error(t(`register:${registerSessionErrorKey(err)}`))
    }
  }

  function useNormalCardPayment() {
    setPayMethod('card')
    setSplitOpen(false)
    setSplitCash('')
    setSplitCard('')
  }

  function useNormalCashPayment() {
    setPayMethod('cash')
    setSplitOpen(false)
    setSplitCash('')
    setSplitCard('')
    setCashReceived(amountInput(totals.total))
  }

  // ── Cart ops ─────────────────────────────────────────────────────────────

  function addQuantityToCart(product: PosProduct, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) return
    setCart(prev => {
      const existing = prev.find(c => c.productId === product.id)
      if (existing) return prev.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + quantity } : c)
      return [...prev, {
        productId:    product.id,
        name:         product.name,
        nameAr:       product.nameAr,
        price:        product.price,
        vatTreatment: product.vatTreatment,
        unit:         product.unit,
        quantity,
        catColor:     product.catColor,
      }]
    })
  }

  function addToCart(product: PosProduct) {
    addQuantityToCart(product, 1)
  }

  function adjustQty(productId: string, delta: number) {
    setCart(prev => prev
      .map(c => c.productId === productId ? { ...c, quantity: c.quantity + delta } : c)
      .filter(c => c.quantity > 0)
    )
  }

  async function maybeAutoPrintReceiptAfterSale(invoiceId: string) {
    if (!isElectron()) return
    if (autoPrintedReceiptIdRef.current === invoiceId) return

    try {
      const settings = await getPrinterSettings()
      if (!settings.autoPrintReceiptAfterSale) return

      if (!settings.receiptPrinterName) {
        toast.info(t('pos:printer.notConfigured'), {
          action: { label: t('pos:printer.devicePrinter'), onClick: () => navigate(DEVICE_PRINTER_PATH) },
        })
        return
      }

      autoPrintedReceiptIdRef.current = invoiceId
      const result = await printReceipt({ invoiceId })
      if (result.success) {
        toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
        return
      }

      console.warn('[POSPage] automatic receipt print failed', result.errorType)
      const message = t(`pos:${printFailureKey(result.errorType)}`)
      toast.error(message)
      if (settings.fallbackToPreview) await printReceiptInHiddenFrame(invoiceId)
    } catch (error) {
      console.warn('[POSPage] automatic receipt print failed', error)
      toast.error(t('pos:printer.receiptFailed'))
    }
  }

  // ── Charge ───────────────────────────────────────────────────────────────

  async function charge() {
    const tid = profile?.tenant_id
    if (!tid || !branch || cart.length === 0 || submitting) return
    if (isAccountSuspended) {
      toast.error(t('pos:accountSuspendedFull'))
      return
    }
    setSubmitting(true)
    const idempotencyKey = checkoutKeyRef.current ?? createCheckoutIdempotencyKey()
    checkoutKeyRef.current = idempotencyKey

    try {
      if (payMethod === 'split') {
        if (!splitPaymentsEnabled) {
          toast.error(t('validation:splitPaymentDisabled'))
          return
        }
        if (!splitReady) {
          setSplitOpen(true)
          toast.error(t('validation:splitPaymentUnbalanced'))
          return
        }
      }

      const splitUsesBothMethods = payMethod === 'split' && splitCashAmount > 0 && splitCardAmount > 0
      const effectivePaymentMethod: PaymentMethod = payMethod === 'split'
        ? splitCashAmount > 0 && splitCardAmount <= 0 ? 'cash' : splitCardAmount > 0 && splitCashAmount <= 0 ? 'card' : 'other'
        : payMethod
      const cashTenderProvided = (effectivePaymentMethod === 'cash' && payMethod === 'split') || (payMethod === 'cash' && cashReceived.trim() !== '')
      const splitPayments = splitUsesBothMethods
        ? [
            { method: 'cash', amount: round2(splitCashAmount) },
            { method: 'card', amount: round2(splitCardAmount) },
          ]
        : null
      const payload = {
        branch_id: branch.id,
        customer_id: customerId,
        session_id: session?.id ?? null,
        payment_method: effectivePaymentMethod,
        amount_paid: cashTenderProvided ? (payMethod === 'split' ? splitCashAmount : cashAmt) : null,
        ...(splitPayments ? { payments: splitPayments } : {}),
        note: note || null,
        idempotency_key: idempotencyKey,
        items: cart.map(item => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
      }

      const { data, error } = await (supabase as any).rpc('pos_checkout', { p_payload: payload })
      if (error) throw error

      const checkout = data as PosCheckoutResult
      const serverTotal = num(checkout.total)
      const serverTax = num(checkout.tax_amount)
      const serverSubtotal = num(checkout.subtotal)
      const createdAt = checkout.created_at
      const receiptPaymentMethod: PaymentMethod = checkout.payment_method ?? (payMethod === 'split' ? 'other' : payMethod)
      const receiptPayments: ReceiptPayment[] = Array.isArray(checkout.payments) && checkout.payments.length > 0
        ? checkout.payments.map(payment => ({
            method: payment.method,
            amount: num(payment.amount),
            amountReceived: payment.amount_received == null ? null : num(payment.amount_received),
            changeAmount: payment.change_amount == null ? null : num(payment.change_amount),
          }))
        : [{
            method: receiptPaymentMethod,
            amount: serverTotal,
            amountReceived: receiptPaymentMethod === 'cash'
              ? num(checkout.amount_received ?? serverTotal)
              : serverTotal,
            changeAmount: receiptPaymentMethod === 'cash'
              ? num(checkout.change_amount ?? 0)
              : 0,
          }]
      const displayPaymentMethod = checkout.display_payment_method
        ?? (isSplitPaymentRows(receiptPayments) ? 'split' : receiptPaymentMethod)
      const serverAmountReceived = num(checkout.amount_received ?? serverTotal)
      const serverChangeAmount = num(checkout.change_amount ?? Math.max(0, serverAmountReceived - serverTotal))
      const receiptCashReceived = displayPaymentMethod !== 'split' && receiptPaymentMethod === 'cash'
        ? serverAmountReceived
        : serverTotal
      const receiptChange = displayPaymentMethod !== 'split' && receiptPaymentMethod === 'cash' ? serverChangeAmount : 0
      const isB2BInvoice = checkout.zatca_invoice_type === 'standard'

      const branchAddr = [
        branch.building_number ? `Building ${branch.building_number}` : null,
        branch.street, branch.district, branch.city,
      ].filter(Boolean).join(', ')
      const branchAddrAr = [
        branch.building_number ? `مبنى ${branch.building_number}` : null,
        branch.street_ar, branch.district_ar, branch.city_ar,
      ].filter(Boolean).join('، ')
      const [issuedInvoiceResult, issuedItemsResult, issuedPaymentsResult] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', checkout.invoice_id).single(),
        supabase.from('invoice_items').select('*').eq('invoice_id', checkout.invoice_id).order('sort_order'),
        supabase.from('payments').select('*').eq('invoice_id', checkout.invoice_id).order('paid_at', { ascending: true }),
      ])
      if (issuedInvoiceResult.error || !issuedInvoiceResult.data || issuedItemsResult.error || issuedPaymentsResult.error) throw new Error('Issued receipt snapshot could not be loaded')
      const thermalDocument = documentFromStoredInvoice({
        invoice: issuedInvoiceResult.data as Invoice,
        branch,
        items: (issuedItemsResult.data ?? []) as InvoiceItem[],
        payments: (issuedPaymentsResult.data ?? []) as Payment[],
        customer: selectedCust ? { name: selectedCust.customer_type === 'business' && selectedCust.business_name ? selectedCust.business_name : selectedCust.name, nameAr: selectedCust.customer_type === 'business' ? selectedCust.business_name_ar ?? selectedCust.name_ar : selectedCust.name_ar, vatNumber: selectedCust.vat_number, type: selectedCust.customer_type } : null,
      })

      setReceipt({
        document: thermalDocument,
        invoiceNumber:  checkout.invoice_number,
        invoiceId:      checkout.invoice_id,
        total:          serverTotal,
        taxAmount:      serverTax,
        subtotal:       serverSubtotal,
        paymentMethod:  receiptPaymentMethod,
        change:         receiptChange,
        cashReceived:   receiptCashReceived,
        customerName:      selectedCust?.customer_type === 'business' && selectedCust?.business_name
          ? selectedCust.business_name
          : (selectedCust?.name ?? 'Walk-in Customer'),
        customerNameAr:    selectedCust?.customer_type === 'business'
          ? (selectedCust?.business_name_ar ?? selectedCust?.name_ar)
          : (selectedCust?.name_ar ?? null),
        customerPhone:     selectedCust?.phone ?? null,
        isStandardInvoice: isB2BInvoice,
        buyerVatNumber:    isB2BInvoice ? (selectedCust?.vat_number ?? null) : null,
        cashierName:    profile?.full_name ?? user?.email?.split('@')[0] ?? 'Cashier',
        items:          (checkout.items ?? []).map(i => ({
          name:      i.name,
          nameAr:    i.name_ar,
          qty:       num(i.quantity),
          unitPrice: num(i.unit_price),
          lineTotal: num(i.total),
          subtotal:  num(i.subtotal),
          taxAmount: num(i.tax_amount),
          total:     num(i.total),
        })),
        createdAt,
        businessNameAr:  branch.business_name_ar || branch.name_ar || branch.display_name || branch.business_name || branch.name,
        businessNameEn:  branch.display_name || branch.business_name || branch.name,
        branchName:      branch.name,
        branchNameAr:    branch.name_ar,
        branchAddress:   branchAddr || null,
        branchAddressAr: branchAddrAr || null,
        documentLanguage: normalizeDocumentLanguage(checkout.document_language ?? branch.invoice_language),
        vatNumber:       complianceVatNumber ?? '',
        phone:           branch.phone,
        website:         branch.website ?? null,
        email:           branch.email ?? null,
        showWebsite:     branch.show_website ?? false,
        showEmail:       branch.show_email ?? false,
        receiptFooter:   branch.receipt_footer,
        showFooter:      branch.show_footer ?? true,
        showCashChange:  branch.show_cash_change ?? true,
        logoUrl:         branch.logo_url ?? null,
        showLogo:        branch.show_logo ?? true,
        payments:        receiptPayments,
        displayPaymentMethod,
        complianceSellerName,
      })
      upsertInvoiceListRow(branch.tenant_id, {
        id: checkout.invoice_id,
        branchId: branch.id,
        invoiceNumber: checkout.invoice_number,
        date: saudiDateStr(createdAt),
        createdAt,
        customerName: selectedCust?.customer_type === 'business' && selectedCust?.business_name
          ? selectedCust.business_name
          : (selectedCust?.name ?? null),
        itemsCount: checkout.items?.length ?? cart.length,
        subtotal: serverSubtotal,
        taxAmount: serverTax,
        totalAmount: serverTotal,
        paymentMethod: displayPaymentMethod,
        zatcaStatus: 'pending',
        displayZatcaStatus: isPermanentDemoSandboxBranch(branch.tenant_id, branch.id)
          ? 'sandbox_validation_pending'
          : 'pending',
        status: 'posted',
        documentType: checkout.zatca_invoice_type,
        invoiceReference: null,
        linkedCreditNoteId: null,
        linkedCreditNoteNumber: null,
        creditNoteCount: 0,
        creditStatus: 'none',
        remainingRefundableQuantity: (checkout.items ?? []).reduce((sum, item) => sum + num(item.quantity), 0),
      })
      void maybeAutoPrintReceiptAfterSale(checkout.invoice_id)
      setCart([])
      setCustomerId(null)
      setNote('')
      setCashReceived('')
      setSplitCash('')
      setSplitCard('')
      setSplitOpen(false)
      checkoutKeyRef.current = null

      // The loaded branch row is the authoritative checkout scope. Using it here
      // avoids routing differences while an auth profile is being rehydrated.
      const demoSandboxValidation = isPermanentDemoSandboxBranch(branch.tenant_id, branch.id)
      submitInvoiceForBranch({
        invoiceId: checkout.invoice_id,
        tenantId: branch.tenant_id,
        branchId: branch.id,
        options: { source: 'auto_checkout', retryDelayMs: 1500 },
      })
        .then((routed) => {
          if (routed.mode === 'sandbox_validation') {
            const validated = routed.result.status === 'sandbox_validated' ||
              routed.result.status === 'sandbox_validated_with_warnings'
            updateCachedInvoiceRows(branch.tenant_id, branch.id, cachedRows => cachedRows.map(row => row.id === checkout.invoice_id
              ? { ...row, displayZatcaStatus: routed.result.status }
              : row))
            if (routed.result.status === 'sandbox_validated_with_warnings') {
              toast.warning(t('pos:zatca.warning'), { duration: 5000 })
            } else if (validated) {
              toast.success(t('pos:zatca.success'), { duration: 2500 })
            } else if (routed.result.status === 'sandbox_validation_rejected' || routed.result.status === 'sandbox_validation_failed') {
              toast.error(t('pos:zatca.failed'), { duration: Infinity, action: { label: t('pos:zatca.viewInvoice'), onClick: () => navigate(`/invoices/${checkout.invoice_id}`) } })
            }
            return
          }
          const result = routed.result
          updateCachedInvoiceRows(branch.tenant_id, branch.id, cachedRows => cachedRows.map(row => row.id === checkout.invoice_id
            ? { ...row, zatcaStatus: result.invoiceStatus, displayZatcaStatus: result.invoiceStatus }
            : row))
          if (result.ok) {
            toast.success(t('pos:zatca.success'), { duration: 2500 })
          } else if (result.invoiceStatus === 'failed') {
            toast.error(t('pos:zatca.failed'), { duration: Infinity, action: { label: t('pos:zatca.viewInvoice'), onClick: () => navigate(`/invoices/${checkout.invoice_id}`) } })
          }
        })
        .catch((error) => {
          console.warn('[POSPage charge] automatic ZATCA action remains pending', {
            invoiceId: checkout.invoice_id,
            branchId: branch.id,
            mode: demoSandboxValidation ? 'sandbox_validation' : 'production_submission',
            message: error instanceof Error ? error.message : String(error ?? ''),
          })
        })
    } catch (err) {
      const safeKey = safeCheckoutErrorKey(err)
      console.warn('[POSPage charge] checkout failed', err)
      toast.error(t(safeKey))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading || sessionLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">{t('pos:loading')}</p>
        </div>
      </div>
    )
  }

  if (!profile?.branch_id) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">{t('pos:noBranch')}</p>
      </div>
    )
  }

  // Blocked state — no active session
  if (!session) {
    return (
      <div className="flex h-screen bg-[#0F2419] items-center justify-center">
        {showOpenSession && !isAccountSuspended && (
          <OpenSessionModal
            onOpen={handleOpenRegister}
            onSkip={() => handleOpenRegister(0)}
            onBack={() => navigate('/branch')}
          />
        )}
        {sessionSummary && (
          <SessionSummaryModal
            summary={sessionSummary}
            onDone={() => navigate('/branch')}
            onNewSession={() => { setSessionSummary(null); setShowOpenSession(true) }}
          />
        )}
        {(!showOpenSession || isAccountSuspended) && !sessionSummary && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm mx-4 w-full">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
              isAccountSuspended ? 'bg-red-50' : 'bg-gray-100'
            }`}>
              {isAccountSuspended
                ? <AlertCircle size={28} className="text-red-500" />
                : <Lock size={28} className="text-gray-400" />}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {isAccountSuspended ? t('pos:accountSuspendedTitle') : t('register:closed')}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {isAccountSuspended
                ? t('pos:accountSuspendedBody')
                : t('register:openPrompt')}
            </p>
            {!isAccountSuspended && (
              <button
                onClick={() => setShowOpenSession(true)}
                className="w-full py-3 bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity"
              >
                {t('register:open')}
              </button>
            )}
            {isAccountSuspended && (
              <div className="flex gap-2">
                <a
                  href={WA_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
                >
                  {t('common:contactUs')}
                </a>
                <a
                  href={EMAIL_LINK}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  {t('pos:email')}
                </a>
              </div>
            )}
            <button
              onClick={() => navigate('/branch')}
              className="mt-3 w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <DirectionalIcon icon={ArrowLeft} size={13} className="inline-block me-1" />{t('pos:backToDashboard')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const canCharge = !isAccountSuspended && cart.length > 0 && !submitting &&
    (payMethod === 'split'
      ? splitReady
      : !(payMethod === 'cash' && cashReceived !== '' && cashAmt < totals.total - 0.001))

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" dir="ltr">

      {/* Modals */}
      {receipt && (
        <ReceiptView
          receipt={receipt}
          onNewSale={() => setReceipt(null)}
          onOpenPrinterSettings={() => navigate(DEVICE_PRINTER_PATH)}
          printMode={branch?.print_mode ?? 'thermal'}
        />
      )}
      {showExpense && branch && (
        <QuickExpenseModal
          branchId={branch.id}
          tenantId={profile.tenant_id ?? ''}
          userId={profile.id ?? null}
          sessionId={session.id}
          onClose={() => setShowExpense(false)}
        />
      )}
      {splitOpen && (
        <SplitPaymentModal
          total={totals.total}
          cashValue={splitCash}
          cardValue={splitCard}
          submitting={submitting}
          onCashChange={updateSplitCash}
          onCardChange={updateSplitCard}
          onUseCash={useNormalCashPayment}
          onUseCard={useNormalCardPayment}
          onClose={() => setSplitOpen(false)}
          onComplete={charge}
        />
      )}
      {showCloseSession && (
        <CloseSessionModal
          session={session}
          onClose={async (params) => {
            const summary = await closeSession(params)
            setShowCloseSession(false)
            setSessionSummary(summary)
          }}
          onCancel={() => setShowCloseSession(false)}
        />
      )}
      {custOpen && <div className="fixed inset-0 z-10" onClick={() => setCustOpen(false)} />}

      {/* ── Left: product panel ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0" dir={isRtl ? 'rtl' : 'ltr'}>

        {/* Header */}
        <div className="bg-[#0F2419] text-white px-3 sm:px-5 py-3 flex items-center gap-3 flex-shrink-0 shadow-lg">
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('/branch')}
              title={t('pos:backToDashboardShortcut')}
              aria-label={t('pos:backToDashboard')}
              className="flex items-center gap-1.5 text-white/60 hover:text-white border border-white/15 hover:border-white/30 px-2.5 py-2 rounded-lg text-xs transition-colors active:scale-[0.97]"
            >
              <DirectionalIcon icon={ArrowLeft} size={13} />
              <span className="hidden sm:inline">{t('pos:dashboard')}</span>
            </button>
            <button
              onClick={() => setShowCloseSession(true)}
              aria-label={t('register:close')}
              className="flex items-center gap-1.5 text-xs bg-red-500/20 border border-red-400/30 text-red-200 px-2.5 py-2 rounded-lg hover:bg-red-500/30 transition-colors active:scale-[0.97]"
            >
              <Lock size={12} />
              <span>{t('register:close')}</span>
            </button>
          </div>

          <div className="min-w-0 flex-1 text-center px-1">
            <h1 className="truncate text-sm font-semibold text-white" title={branch?.name ?? t('pos:activeBranch')} dir="auto">
              {branch?.name ?? t('pos:activeBranch')}
            </h1>
            <p className="mt-0.5 text-[10px] text-white/55">{activePosMode === 'quick' ? t('pos:quickBilling') : t('pos:touchPos')}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <AuthenticatedLanguageSwitch inverse className="h-9" />
            {isElectron() && (
              <button
                type="button"
                onClick={() => navigate(DEVICE_PRINTER_PATH)}
                title={printerStatus === 'connected'
                  ? t('pos:printer.connected')
                  : printerStatus === 'error'
                    ? t('pos:printer.unavailable')
                    : t('pos:printer.unconfigured')}
                aria-label={printerStatus === 'connected'
                  ? t('pos:printer.connected')
                  : printerStatus === 'error'
                    ? t('pos:printer.unavailable')
                    : t('pos:printer.unconfigured')}
                className={`relative w-9 h-9 rounded-lg border transition-colors active:scale-[0.97] flex items-center justify-center ${
                  printerStatus === 'connected'
                    ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30'
                    : printerStatus === 'error'
                      ? 'bg-red-500/20 border-red-400/30 text-red-300 hover:bg-red-500/30'
                      : 'bg-white/10 border-white/15 text-white/60 hover:bg-white/15 hover:text-white'
                }`}
              >
                <Printer size={14} />
                <span className={`absolute end-1 top-1 h-1.5 w-1.5 rounded-full ${
                  printerStatus === 'connected' ? 'bg-emerald-400' : printerStatus === 'error' ? 'bg-red-400' : 'bg-white/35'
                }`} />
              </button>
            )}
            <button
              onClick={() => setShowExpense(true)}
              aria-label={t('pos:addExpense')}
              className="h-9 text-xs bg-amber-500/20 border border-amber-400/25 text-amber-200 px-2.5 sm:px-3 rounded-lg hover:bg-amber-500/30 transition-colors active:scale-[0.97] flex items-center gap-1.5"
            >
              <Zap size={12} />
              <span className="hidden sm:inline">{t('pos:expense')}</span>
            </button>
          </div>
        </div>

        {/* Session info bar */}
        <div className="bg-emerald-50 border-b border-emerald-100 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
          <span className="text-xs text-emerald-700">
            {t('register:sessionOpenSince', { time: toSaudiTime(session.opened_at) })}
            {Number(session.opening_cash) > 0 && (
              <> · {t('register:openingAmount', { amount: '' })}<span dir="ltr"><Rial amount={Number(session.opening_cash)} /></span></>
            )}
          </span>
        </div>

        {/* Search + category tabs */}
        <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
          {activePosMode === 'quick' ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="relative min-w-[220px] max-w-xl flex-1">
                <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('pos:searchProducts')} className="input ps-8 pe-8 py-1.5 text-sm" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label={t('pos:clearProductSearch')} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
              </div>
              <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto md:flex">
                <button type="button" onClick={() => setActiveCat(null)} className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium ${!activeCat ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{t('pos:allProducts')}</button>
                {categories.map(category => (
                  <button key={category.id} type="button" onClick={() => setActiveCat(activeCat === category.id ? null : category.id)} className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium ${activeCat === category.id ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600'}`} dir="auto">{localizedName(category.name, category.nameAr, isRtl)}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="relative w-52 flex-shrink-0">
                <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('pos:searchShortcut')}
                  className="input ps-8 pe-8 py-1.5 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label={t('pos:clearProductSearch')}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {showPosScrollButtons && (
                <button
                  type="button"
                  onClick={() => scrollCategories(-1)}
                  disabled={scrollState.categoryAtStart}
                  title={t('pos:scrollCategoriesPrevious')}
                  className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <DirectionalIcon icon={ChevronLeft} size={20} />
                </button>
              )}
              <div ref={categoryScrollRef} className="flex items-center gap-1.5 overflow-x-auto flex-1">
                <button
                  onClick={() => setActiveCat(null)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    !activeCat ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t('pos:allProducts')}
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCat(activeCat === cat.id ? null : cat.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                      activeCat === cat.id ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={activeCat === cat.id ? { backgroundColor: cat.color ?? '#10b981' } : {}}
                  >
                    {cat.icon && <span className="me-1">{cat.icon}</span>}
                    <span dir="auto">{localizedName(cat.name, cat.nameAr, isRtl)}</span>
                  </button>
                ))}
              </div>
              {showPosScrollButtons && (
                <button
                  type="button"
                  onClick={() => scrollCategories(1)}
                  disabled={scrollState.categoryAtEnd}
                  title={t('pos:scrollCategoriesNext')}
                  className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <DirectionalIcon icon={ChevronRight} size={20} />
                </button>
              )}
            </>
          )}
        </div>

        {/* Product grid */}
        <div ref={productScrollRef} className="flex-1 overflow-y-auto p-4">
          {activePosMode === 'quick' ? (
            <QuickBillingPanel
              products={quickFiltered}
              totalProductCount={products.length}
              cart={cart}
              query={searchText}
              onAdd={addToCart}
            />
          ) : (
            <div className={showPosScrollButtons ? 'flex items-start gap-3 min-h-full' : 'min-h-full'}>
              <div className="flex-1 min-w-0">
                {filtered.length === 0 ? (
                  products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5 text-center px-6">
                      <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center">
                        <PackageOpen size={36} className="text-gray-300" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-semibold text-gray-700 text-base">{t('pos:noProductsYet')}</p>
                        <p className="text-sm text-gray-400 max-w-[220px]">
                          {t('pos:addProductsPrompt')}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate('/products')}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#1B6B3A] text-white text-sm font-semibold rounded-xl hover:bg-[#155830] transition-colors shadow-sm"
                      >
                        <Plus size={15} />
                        {t('pos:goToProducts')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <AlertCircle size={28} className="mb-2 opacity-40" />
                      <p className="text-sm">{t('pos:noProductsFound')}</p>
                      {search && (
                        <button onClick={() => setSearch('')} className="text-xs text-primary-500 mt-1 underline">
                          {t('pos:clearSearch')}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                    {filtered.map(p => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        cartQty={cart.find(c => c.productId === p.id)?.quantity ?? 0}
                        onAdd={() => addToCart(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
              {showPosScrollButtons && (
                <div className="sticky top-0 flex-shrink-0 self-start flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => scrollProducts(-1)}
                    disabled={scrollState.productsAtStart}
                    title={t('pos:scrollProductsUp')}
                    className="h-12 w-12 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <ChevronUp size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollProducts(1)}
                    disabled={scrollState.productsAtEnd}
                    title={t('pos:scrollProductsDown')}
                    className="h-12 w-12 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <ChevronUp size={22} className="rotate-180" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: cart panel ───────────────────────────────── */}
      <div className="w-[340px] bg-white border-s border-gray-100 flex flex-col flex-shrink-0 shadow-xl" dir={isRtl ? 'rtl' : 'ltr'}>

        {/* Cart header */}
        <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Receipt size={15} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900 text-sm">{t('pos:currentOrder')}</h2>
            {cart.length > 0 && (
              <span className="w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {cart.reduce((s, c) => s + c.quantity, 0)}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button onClick={() => setCart([])}
              className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors">
              <X size={11} /> {t('pos:clearCart')}
            </button>
          )}
        </div>

        {/* Customer selector */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0 relative z-20">
          <button
            onClick={() => { setCustOpen(o => !o); setCustSearch('') }}
            className="w-full flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-start hover:border-primary-200 transition-colors"
          >
            <User size={13} className="text-gray-400 flex-shrink-0" />
            <span className={`flex-1 text-xs ${customerId ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
              <span dir="auto">{selectedCust?.customer_type === 'business' && selectedCust?.business_name
                ? selectedCust.business_name
                : (selectedCust?.name ?? t('pos:walkInCustomer'))}</span>
            </span>
            <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
          </button>
          {custOpen && (
            <div className="absolute start-4 end-4 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input type="text" value={custSearch} onChange={e => setCustSearch(e.target.value)}
                  placeholder={t('pos:searchCustomers')} className="input text-xs py-1.5" autoFocus />
              </div>
              <div className="max-h-52 overflow-y-auto">
                <button
                  onClick={() => { setCustomerId(null); setCustOpen(false) }}
                  className={`w-full px-3 py-2.5 text-start text-xs flex items-center gap-2 hover:bg-gray-50 ${!customerId ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'}`}
                >
                  <User size={12} />
                  {t('pos:walkInCustomer')}
                  {!customerId && <Check size={12} className="ms-auto" />}
                </button>
                {filteredCusts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setCustomerId(c.id); setCustOpen(false) }}
                    className={`w-full px-3 py-2.5 text-start text-xs flex items-center gap-2 hover:bg-gray-50 ${customerId === c.id ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate" dir="auto">
                        {c.customer_type === 'business' && c.business_name ? c.business_name : c.name}
                      </p>
                      {c.customer_type === 'business' && c.business_name && (
                        <p className="text-gray-400 text-[10px] truncate" dir="auto">{c.name}</p>
                      )}
                      {c.phone && <p className="text-gray-400 text-[10px]"><bdi dir="ltr">{c.phone}</bdi></p>}
                    </div>
                    {customerId === c.id && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
                {filteredCusts.length === 0 && custSearch && (
                  <p className="px-3 py-4 text-center text-xs text-gray-400">{t('pos:noCustomersFound')}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 py-10">
              <ShoppingBag size={32} className="mb-3" />
              <p className="text-xs">{t('pos:emptyCart')}</p>
              <p className="text-[10px] mt-1 text-gray-200">{t('pos:pressToSearch')}</p>
            </div>
          ) : (
            cart.map(item => {
              const line  = item.price * item.quantity
              const color = item.catColor ?? '#6b7280'
              return (
                <div key={item.productId} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                  <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: `${color}20` }}>
                    <ShoppingBag size={12} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate" dir="auto">{localizedName(item.name, item.nameAr, isRtl)}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums" dir="ltr">
                      {fmt(item.price)} × {item.quantity} = <span className="text-gray-700 font-semibold"><Rial amount={line} /></span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" dir="ltr">
                    <button onClick={() => adjustQty(item.productId, -1)}
                      aria-label={item.quantity === 1
                        ? t('pos:removeItem', { name: localizedName(item.name, item.nameAr, isRtl) })
                        : t('pos:decreaseQuantity', { name: localizedName(item.name, item.nameAr, isRtl) })}
                      className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors">
                      {item.quantity === 1
                        ? <Trash2 size={10} className="text-red-400" />
                        : <Minus size={10} className="text-gray-500" />
                      }
                    </button>
                    <span className="text-xs font-bold text-gray-900 w-5 text-center tabular-nums">{item.quantity}</span>
                    <button onClick={() => adjustQty(item.productId, 1)}
                      aria-label={t('pos:increaseQuantity', { name: localizedName(item.name, item.nameAr, isRtl) })}
                      className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-primary-50 hover:border-primary-200 transition-colors">
                      <Plus size={10} className="text-gray-500" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Note */}
        <div className="px-4 pb-2 flex-shrink-0">
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder={t('pos:orderNote')} className="input text-xs py-1.5" />
        </div>

        {/* Totals */}
        <div className="px-4 py-3 border-t border-gray-100 space-y-1.5 flex-shrink-0">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('pos:netAmount')}</span>
            <span className="tabular-nums" dir="ltr"><Rial amount={totals.subtotal} /></span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{vatMode === 'inclusive' ? t('pos:vatInclusive') : t('pos:vatExclusive')}</span>
            <span className="tabular-nums" dir="ltr"><Rial amount={totals.taxAmount} /></span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 text-base pt-1.5 border-t border-gray-100">
            <span>{t('payments:amountDue')}</span>
            <span className="tabular-nums text-primary-600" dir="ltr"><Rial amount={totals.total} /></span>
          </div>
        </div>

        {/* Payment method */}
        <div className="px-4 pb-2 flex-shrink-0 space-y-2">
          <div className="flex gap-2">
            {(['cash', 'card'] as const).map(m => (
              <button key={m} onClick={() => { setPayMethod(m); setSplitOpen(false) }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  payMethod === m
                    ? m === 'cash'
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                      : 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {m === 'cash' ? <Banknote size={13} /> : <CreditCard size={13} />}
                {m === 'cash' ? t('payments:cash') : t('payments:card')}
              </button>
            ))}
            {splitPaymentsEnabled && (
              <button
                type="button"
                onClick={openSplitPayment}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  payMethod === 'split'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                <Banknote size={12} />
                <CreditCard size={12} />
                {t('payments:split')}
              </button>
            )}
          </div>

          {payMethod === 'cash' && cart.length > 0 && (
            <div className="space-y-1">
              <div className="relative">
                <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
                <MoneyInput
                  value={cashReceived}
                  onValueChange={setCashReceived}
                  placeholder={fmt(Math.ceil(totals.total))}
                  className="input ps-10 py-1.5 text-sm tabular-nums"
                />
              </div>
              {cashAmt >= totals.total && cashAmt > 0 && (
                <div className="flex justify-between px-1">
                  <span className="text-xs text-gray-500">{t('payments:change')}</span>
                  <span className="text-sm font-bold text-emerald-600 tabular-nums" dir="ltr"><Rial amount={change} /></span>
                </div>
              )}
              {cashAmt > 0 && cashAmt < totals.total && (
                <p className="text-[10px] text-red-500 px-1 flex items-baseline gap-1">
                  {t('payments:shortBy')} <span dir="ltr"><Rial amount={totals.total - cashAmt} /></span>
                </p>
              )}
            </div>
          )}

          {payMethod === 'split' && cart.length > 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-600">
                <span>{t('payments:cash')}</span>
                <span className="font-semibold tabular-nums" dir="ltr"><Rial amount={splitCashAmount} /></span>
              </div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>{t('payments:card')}</span>
                <span className="font-semibold tabular-nums" dir="ltr"><Rial amount={splitCardAmount} /></span>
              </div>
              <button
                type="button"
                onClick={() => setSplitOpen(true)}
                className="text-[11px] font-semibold text-primary-700 hover:text-primary-900"
              >
                {t('payments:editSplit')}
              </button>
            </div>
          )}
        </div>

        {isAccountSuspended && (
          <div className="mx-4 mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {t('pos:accountSuspendedFull')}
          </div>
        )}

        {/* Charge button */}
        <div className="px-4 pb-5 flex-shrink-0">
          <button
            onClick={payMethod === 'split' ? () => setSplitOpen(true) : charge}
            disabled={!canCharge}
            className="w-full py-3.5 rounded-2xl font-bold text-sm text-white transition-all flex items-center justify-center gap-2
              bg-gradient-to-r from-[#1a3a28] to-primary-600
              hover:opacity-90 active:scale-[0.98]
              disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed disabled:scale-100"
          >
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> {t('payments:processing')}</>
              : isAccountSuspended
                ? <><AlertCircle size={16} /> {t('pos:billingDisabled')}</>
              : <>
                  {payMethod === 'cash' ? <Banknote size={16} /> : <CreditCard size={16} />}
                  {t('pos:charge')} — <span dir="ltr"><Rial amount={totals.total} /></span>
                </>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
