import { useState, useEffect, useRef, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  Receipt, X, ChevronDown, User, Check, Loader2,
  ShoppingBag, AlertCircle, Zap, Printer, PackageOpen, ArrowLeft, Lock,
  ChevronLeft, ChevronRight, ChevronUp, RotateCcw,
  ScanLine, Landmark,
} from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { resolveEffectiveVatTreatment } from '@/lib/pricing/vat'
import { updateCachedInvoiceRows, upsertInvoiceListRow } from '@/lib/invoices/invoiceListCache'
import { saudiDateStr, toSaudiTime } from '@/lib/utils/date'
import {
  finalizeInvoiceForZatca,
  getZatcaFinalizationCapabilities,
  getInvoiceZatcaOutputState,
  requireZatcaFinalizationCapability,
  resolvePosCheckoutDocument,
  retryStoredSimplifiedArtifact,
  submitInvoiceForBranch,
  type ZatcaCheckoutMode,
} from '@/lib/zatca/submission'
import {
  atomicCheckoutFingerprint,
  checkoutSimplifiedAtomically,
  clearPendingAtomicCheckout,
  persistPendingAtomicCheckout,
  readPendingAtomicCheckout,
  type AtomicCheckoutResult,
} from '@/lib/zatca/atomicCheckout'
import {
  renderStoredQrDataUrl,
  selectStoredOutputStateQr,
  type QrDisplayStatus,
} from '@/lib/zatca/qrDisplay.mjs'
import { toast } from 'sonner'
import { resolveBranchDisplayName } from '@/lib/utils/localizedDisplayName.mjs'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import A4Document from '@/components/print/A4Document'
import type { Branch, BranchPosMode, PaymentMethod, VatTreatment } from '@/types/database'
import { usePosSession } from '@/hooks/usePosSession'
import type { ClosedSessionSummary, PosSession } from '@/hooks/usePosSession'
import { useSubscription } from '@/hooks/useSubscription'
import { getPrinterSettings, getPrinters, isElectron, printA4Invoice, printReceipt } from '@/lib/electron'
import { printAtomicReceiptSnapshot } from '@/lib/atomicReceiptPrint'
import { openReceiptPreview, printReceiptInHiddenFrame } from '@/lib/receiptPrint'
import { openPrintPopup, PRINT_POPUP_BLOCKED } from '@/lib/print/browserPrint'
import { supportConfig } from '@/config/support'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import { useLocale } from '@/localization/useLocale'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import { documentFromPosReceipt } from '@/lib/invoices/documentViewAdapters'
import type { CustomerCreditPaymentSummary } from '@/lib/invoices/customerCreditPayment'
import { resolveInvoicePresentationSettings } from '@/lib/invoices/presentationSettings'
import {
  normalizeDocumentLanguage,
  type DocumentLanguage,
} from '@/localization/documents'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { normalizeBarcode } from '@/lib/barcodes/barcode'
import type { ScannerCapture } from '@/lib/barcodes/scanner'
import {
  applyScannerCartMutation,
  createScannerIndex,
  resolveScannerCode,
  type ScannerIndexEntry,
} from '@/lib/pos/unifiedScanner'
import {
  customerDisplayName,
  normalizeSaudiMobile,
  searchCustomers,
  type PosCustomerRecord,
} from '@/lib/pos/customerSearch'
import { PosCustomerQuickCreateModal } from './PosCustomerQuickCreateModal'
import {
  clearPersistentReceivableOperation,
  CUSTOMER_CREDIT_POLICY_CHANGED_EVENT,
  getPersistentReceivableOperation,
  isCustomerCreditPolicyStorageChange,
  loadCustomerCreditCheckoutEligibility,
  type CustomerCreditCheckoutEligibility,
} from '@/lib/customers/receivables'

// ── Types ─────────────────────────────────────────────────────────────────────

type PosPaymentChoice = 'cash' | 'card' | 'split' | 'credit'
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
  unitAr: string | null
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
  sellingUnits: PosSellingUnit[]
}

interface PosSellingUnit {
  id: string
  name: string
  nameAr: string | null
  code: string
  conversionToBase: number
  quantityScale: number
  pricingMethod: 'calculated' | 'custom'
  resolvedPrice: number
  isBase: boolean
  version: number
}

interface PosCategory {
  id: string
  name: string
  nameAr: string | null
  color: string | null
  icon: string | null
}

interface CartItem {
  cartLineId: string
  productId: string
  productUnitId: string | null
  productUnitVersion: number | null
  pricingMethod: 'calculated' | 'custom' | 'legacy'
  conversionToBase: number
  quantityScale: number
  unitName: string
  unitNameAr: string | null
  unitCode: string | null
  baseUnitName: string
  baseUnitNameAr: string | null
  name: string
  nameAr: string | null
  price: number
  vatTreatment: VatTreatment
  unit: string
  quantity: number
  catColor: string | null
}

interface ReceiptData {
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
  hasSelectedCustomer: boolean
  customerAddress: string | null
  customerAddressAr: string | null
  buyerIdentifierType: string | null
  buyerIdentifierValue: string | null
  customerPhone: string | null
  isStandardInvoice: boolean
  buyerVatNumber: string | null
  cashierName: string
  items: ThermalItem[]
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
  customerCredit: CustomerCreditPaymentSummary | null
  zatcaQrCode: string
  canPrint: boolean
  finalizationStatus: string
  artifactStage: string
  documentKind: 'simplified' | 'standard' | null
  finalizationError: string | null
  sandboxGenerated: boolean
  reportingDisplayState: string
  atomicSnapshot: boolean
  isDemo: boolean
  sandboxDemo: boolean
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
  tax_rate?: number | string | null
  tax_category?: string | null
  total: number | string
  product_unit_id?: string | null
  product_unit_version?: number | string | null
  selling_unit_name?: string | null
  selling_unit_name_ar?: string | null
  selling_unit_code?: string | null
  package_quantity?: number | string | null
  package_quantity_scale?: number | string | null
  conversion_to_base?: number | string | null
  base_quantity?: number | string | null
  base_unit_name?: string | null
  base_unit_name_ar?: string | null
  base_unit_code?: string | null
  pricing_method?: string | null
  base_unit_price?: number | string | null
  package_unit_price?: number | string | null
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
  outstanding_amount?: number | string | null
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

function parseExplicitMoneyInput(value: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
  if (/fingerprint|idempotency key was reused/i.test(message)) {
    return 'pos:packages.fingerprintMismatch'
  }
  if (/changed; reload|stale.*version/i.test(message)) {
    return 'pos:packages.changed'
  }
  if (/unit is inactive|package.*inactive/i.test(message)) {
    return 'pos:packages.inactive'
  }
  if (/not enabled for selling|selling.*disabled/i.test(message)) {
    return 'pos:packages.sellingDisabled'
  }
  if (/unsupported decimal precision|exact valid base quantity|package quantity/i.test(message)) {
    return 'pos:packages.invalidQuantity'
  }
  if (/BRANCH_SIMPLIFIED_ONLY/.test(message)) {
    return 'validation:branchSimplifiedOnly'
  }
  if (/BRANCH_STANDARD_ONLY/.test(message)) {
    return 'validation:branchStandardOnly'
  }
  if (/INVOICE_CAPABILITY_NOT_CONFIGURED/.test(message)) {
    return 'validation:invoiceCapabilityNotConfigured'
  }
  if (/ZATCA_CONNECTION_REQUIRED/.test(message)) {
    return 'validation:zatcaConnectionRequired'
  }
  if (/ATOMIC_NOT_READY|ATOMIC_CHECKOUT_REQUIRED/.test(message)) {
    return 'validation:atomicNotReady'
  }
  if (/BRANCH_CREDIT_DISABLED|AR_CREDIT_BRANCH_DISABLED|CREDIT_NOT_ALLOWED_FOR_BRANCH/.test(message)) {
    return 'payments:creditBranchDisabled'
  }
  if (/BUSINESS_CUSTOMER_REQUIRED|CREDIT_NOT_ALLOWED_FOR_BUSINESS/.test(message)) {
    return 'payments:businessCustomerRequired'
  }
  if (/CUSTOMER_INACTIVE/.test(message)) {
    return 'payments:customerInactive'
  }
  if (/BRANCH_INACTIVE/.test(message)) {
    return 'payments:branchInactive'
  }
  if (/CREDIT_UNAUTHORIZED/.test(message)) {
    return 'payments:creditUnauthorized'
  }
  if (/CREDIT_ACCOUNT_SETUP_FAILED/.test(message)) {
    return 'payments:creditUnavailable'
  }
  if (/STANDARD_CUSTOMER_DETAILS_REQUIRED/.test(message)) {
    return 'validation:standardCustomerDetailsRequired'
  }
  if (/SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE/.test(message)) {
    return 'validation:sandboxStandardUnavailable'
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
  if (method === 'credit' || method === 'partial_credit') return t('payments:customerCredit')
  return t('payments:other')
}

function paymentMethodLabel(method: string | null | undefined): string {
  if (method === 'split') return 'Split Payment'
  if (method === 'cash') return 'Cash'
  if (method === 'card') return 'Card / POS'
  if (method === 'bank_transfer') return 'Bank Transfer'
  return 'Other'
}

function creditEligibilityMessageKey(reasonCode: string): string {
  switch (reasonCode) {
    case 'BUSINESS_CUSTOMER_REQUIRED': return 'businessCustomerRequired'
    case 'CUSTOMER_NOT_FOUND': return 'creditCustomerRequired'
    case 'CREDIT_UNAUTHORIZED': return 'creditUnauthorized'
    case 'BRANCH_INACTIVE': return 'branchInactive'
    case 'BRANCH_CREDIT_DISABLED': return 'creditBranchDisabled'
    case 'CUSTOMER_INACTIVE': return 'customerInactive'
    case 'AR_CREDIT_ELIGIBLE': return 'creditEligible'
    default: return 'creditUnavailable'
  }
}

function creditEligibilitySettingsPath(reasonCode: string, customerId: string, branchId: string) {
  switch (reasonCode) {
    case 'BRANCH_CREDIT_DISABLED':
    case 'AR_CREDIT_BRANCH_DISABLED':
    case 'CREDIT_NOT_ALLOWED_FOR_BRANCH':
      return `/branch-settings?section=credit`
    default:
      return branchId ? `/branch-settings?section=credit` : '/branch-settings'
  }
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

type ReceiptActionId = 'print_receipt' | 'print_invoice' | 'new_sale'

function ReceiptView({ receipt, branch, onNewSale, onOpenPrinterSettings, onRetryFinalization, afterSaleAction }: {
  receipt: ReceiptData
  branch: Branch | null
  onNewSale: () => void
  onOpenPrinterSettings: () => void
  onRetryFinalization: () => Promise<void>
  afterSaleAction: 'receipt' | 'a4' | 'both'
}) {
  const { t } = useTranslation(['pos', 'payments', 'printing', 'common'])
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<QrDisplayStatus>('loading')
  const [printingReceipt, setPrintingReceipt] = useState(false)
  const [printErrorKey, setPrintErrorKey] = useState<string | null>(null)
  const [retryingFinalization, setRetryingFinalization] = useState(false)
  const automaticSnapshotPrintRef = useRef(false)
  const documentViewModel = useMemo(() => documentFromPosReceipt({ ...receipt, zatcaQrCode: receipt.zatcaQrCode, presentationSettings: branch?.presentation_settings, branchDefaults: branch ?? undefined, items: receipt.items.map(item => ({ name: item.name, nameAr: item.nameAr, qty: item.qty, unitPrice: item.unitPrice, lineTotal: item.lineTotal, subtotal: item.subtotal, taxAmount: item.taxAmount, taxRate: item.taxRate, taxCategory: item.taxCategory, unitName: item.unitName, unitNameAr: item.unitNameAr, unitCode: item.unitCode, baseQuantity: item.baseQuantity, baseUnitName: item.baseUnitName, baseUnitNameAr: item.baseUnitNameAr })), payments: receipt.payments.map(payment => ({ method: payment.method, amount: payment.amount, amountReceived: payment.amountReceived, changeAmount: payment.changeAmount })) }), [receipt, branch])
  const printReady = receipt.isDemo
    ? receipt.canPrint
    : receipt.canPrint && qrStatus === 'ready' && Boolean(qrDataUrl)
  const showReceiptAction = afterSaleAction !== 'a4'
  const showInvoiceAction = afterSaleAction === 'a4' || afterSaleAction === 'both'
  const actionIdCandidates: ReceiptActionId[] = [
    ...(showReceiptAction ? ['print_receipt' as const] : []),
    ...(showInvoiceAction ? ['print_invoice' as const] : []),
    'new_sale',
  ]
  const uniqueActionIds = [...new Set(actionIdCandidates)]
  const hasReceiptAction = uniqueActionIds.includes('print_receipt')
  const hasInvoiceAction = uniqueActionIds.includes('print_invoice')
  const receiptPrintButton = showReceiptAction ? (
    <button
      type="button"
      onClick={() => void openReceiptPrintPage()}
      disabled={printingReceipt || !printReady}
      className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {printingReceipt ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
      {printingReceipt ? t('payments:printing') : t('payments:printReceipt')}
    </button>
  ) : null
  const invoicePrintButton = showInvoiceAction ? (
    <button
      type="button"
      onClick={printPosA4}
      disabled={!printReady}
      className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Printer size={14} />
      {t('payments:printInvoice')}
    </button>
  ) : null
  const newSaleButton = (
    <button type="button" onClick={onNewSale}
      className="flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 py-2.5 text-sm font-semibold text-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#B5943E] focus-visible:ring-offset-2">
      {t('payments:newSale')}
    </button>
  )

  useEffect(() => {
    async function genQR() {
      setQrStatus('loading')
      const result = await renderStoredQrDataUrl(
        receipt.zatcaQrCode,
        payload => QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M', width: 160, margin: 1,
          color: { dark: '#0F2419', light: '#FFFFFF' },
        }),
      )
      setQrDataUrl(result.dataUrl)
      setQrStatus(result.status)
    }
    void genQR()
  }, [receipt.zatcaQrCode])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      console.info('[zatca-timing]', {
        event: 'receipt_rendered',
        invoiceId: receipt.invoiceId,
        reportingDisplayState: receipt.reportingDisplayState,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [receipt.invoiceId, receipt.reportingDisplayState])

  async function printRenderedReceiptSnapshot(): Promise<boolean> {
    const result = await printAtomicReceiptSnapshot({
      invoiceId: receipt.invoiceId,
      receiptElementId: 'thermal-receipt',
      source: 'atomic_checkout_snapshot',
    })
    if (result.success) {
      return true
    }
    console.warn('[ReceiptView] receipt snapshot print failed', result.errorType)
    return false
  }

  useEffect(() => {
    if (!receipt.atomicSnapshot || !printReady || automaticSnapshotPrintRef.current) return
    automaticSnapshotPrintRef.current = true
    void getPrinterSettings().then(settings => {
      if (!settings.autoPrintReceiptAfterSale) return
      void openReceiptPrintPage()
    })
  }, [receipt.atomicSnapshot, receipt.invoiceId, printReady])

  async function printPosA4() {
    if (!printReady) {
      toast.error(t('printing:qrUnavailable'))
      return
    }
    if (!isElectron()) {
      try {
        openPrintPopup(`/invoices/${encodeURIComponent(receipt.invoiceId)}?print=1`)
      } catch (error) {
        console.warn('[ReceiptView] A4 print popup failed', error)
        toast.error(t('printing:popupBlocked'))
      }
      return
    }

    console.info('[zatca-timing]', {
      event: 'print_requested',
      invoiceId: receipt.invoiceId,
      source: receipt.atomicSnapshot ? 'atomic_checkout_a4_snapshot' : 'pos_a4_snapshot',
    })
    const existing = document.getElementById('pos-pdf-print-style')
    existing?.remove()
    const s = document.createElement('style')
    s.id = 'pos-pdf-print-style'
    s.textContent = `
      @media print {
        @page { size: A4; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { visibility: hidden !important; }
        #thermal-receipt { display: none !important; visibility: hidden !important; }
        #pos-pdf-printable {
          display: block !important;
          visibility: visible !important;
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 210mm !important;
          min-width: 210mm !important;
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
    } else {
      console.info('[zatca-timing]', {
        event: 'printer_started',
        invoiceId: receipt.invoiceId,
        source: receipt.atomicSnapshot ? 'atomic_checkout_a4_snapshot' : 'pos_a4_snapshot',
      })
    }
    s.remove()
  }

  async function openReceiptPrintPage() {
    if (printingReceipt) return
    if (!printReady) {
      toast.error(t('printing:qrUnavailable'))
      return
    }
    setPrintErrorKey(null)

    setPrintingReceipt(true)
    try {
      if (receipt.atomicSnapshot || receipt.isDemo || receipt.sandboxDemo) {
        const printed = await printRenderedReceiptSnapshot()
        if (printed) {
          toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
          return
        }
        throw new Error('Rendered receipt snapshot could not be printed')
      }
      if (!isElectron()) {
        await printReceiptInHiddenFrame(receipt.invoiceId)
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
      const message = error instanceof Error && error.message === PRINT_POPUP_BLOCKED
        ? t('printing:popupBlocked')
        : t('pos:printer.receiptFailed')
      setPrintErrorKey('printer.receiptFailed')
      toast.error(message)
    } finally {
      setPrintingReceipt(false)
    }
  }

  return (
    <>
      <A4Document model={documentViewModel} options={{ pdfMode: true, id: 'pos-pdf-printable', qrImageUrl: qrDataUrl, nonFiscalDemo: receipt.isDemo }} />
      {/* Hidden thermal receipt — rendered for print only */}
      <ThermalReceipt model={documentViewModel} options={{ qrImageUrl: qrDataUrl, nonFiscalDemo: receipt.isDemo }} />

      {/* Success overlay */}
      <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#0F2419]/90 p-4 sm:p-6">
        <div className="my-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">

          {/* Banner */}
          <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 px-5 py-6 text-center text-white sm:px-8">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
              <Check size={32} strokeWidth={3} />
            </div>
            <p className="text-xl font-bold sm:text-2xl">{t('payments:paymentReceived')}</p>
            <p className="text-emerald-100 text-sm mt-1"><bdi dir="ltr">{receipt.invoiceNumber}</bdi></p>
          </div>

          {/* Summary */}
          <div className="space-y-3 p-5 sm:p-6">
            <div className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
              <div><p className="text-xs text-gray-500">{t('payments:customer')}</p><p className="mt-1 font-semibold text-gray-800" dir="auto">{receipt.customerName}</p></div>
              <div className="sm:text-end"><p className="text-xs text-gray-500">{t('payments:method')}</p><p className={`mt-1 font-semibold ${receipt.displayPaymentMethod === 'credit' || receipt.displayPaymentMethod === 'partial_credit' ? 'text-primary-800' : 'text-gray-800'}`}>{localizedPaymentMethod(receipt.displayPaymentMethod, t)}</p></div>
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
          <div className="space-y-3 border-t border-gray-100 px-5 pb-6 pt-5 sm:px-7">
            {!receipt.canPrint && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                <p>{receipt.finalizationError
                  ? t('pos:zatca.saleCompletedAttention')
                  : receipt.isStandardInvoice ? t('pos:zatca.finalizingTaxInvoice') : t('pos:zatca.finalizingInvoice')}</p>
                {receipt.finalizationError && <p className="mt-1 font-normal text-amber-700">{receipt.finalizationError}</p>}
                <div className="mt-2 flex justify-center gap-2">
                  <button
                    type="button"
                    disabled={retryingFinalization}
                    onClick={async () => {
                      setRetryingFinalization(true)
                      try { await onRetryFinalization() } finally { setRetryingFinalization(false) }
                    }}
                    className="rounded-lg bg-white px-2.5 py-1.5 font-semibold shadow-sm hover:bg-amber-100 disabled:opacity-50"
                  >
                    {retryingFinalization ? t('common:loading') : t('pos:zatca.retryFinalization')}
                  </button>
                </div>
              </div>
            )}
            {receipt.canPrint && qrStatus !== 'loading' && !printReady && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                <AlertCircle size={14} className="mx-auto mb-1" />
                {t('printing:qrUnavailable')}
              </div>
            )}
            {hasReceiptAction && hasInvoiceAction ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">{receiptPrintButton}{invoicePrintButton}</div>
                {newSaleButton}
              </>
            ) : hasReceiptAction ? (
              <div className="grid gap-2 sm:grid-cols-2">{receiptPrintButton}{newSaleButton}</div>
            ) : hasInvoiceAction ? (
              <div className="grid gap-2 sm:grid-cols-2">{invoicePrintButton}{newSaleButton}</div>
            ) : newSaleButton}
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

function singleUnitCartQuantity(cart: CartItem[], productId: string): number {
  const lines = cart.filter(item => item.productId === productId)
  return lines.length === 1 ? lines[0].quantity : 0
}

function QuickBillingPanel({
  products,
  totalProductCount,
  cart,
  query,
  onAdd,
  stockVisible,
}: {
  products: PosProduct[]
  totalProductCount: number
  cart: CartItem[]
  query: string
  onAdd: (product: PosProduct) => void
  stockVisible: boolean
}) {
  const { t } = useTranslation('pos')
  const { isRtl } = useLocale()
  const desktopGrid = stockVisible
    ? 'lg:grid-cols-[minmax(220px,1.7fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_120px_110px_92px]'
    : 'lg:grid-cols-[minmax(220px,1.7fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_110px_92px]'
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
      <div className={`hidden lg:grid ${desktopGrid} gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase text-gray-400`}>
        <span>{t('product')}</span>
        <span>{t('category')}</span>
        <span>{t('skuBarcode')}</span>
        {stockVisible && <span>{t('availableStock')}</span>}
        <span className="text-end">{t('price')}</span>
        <span className="text-end">{t('add')}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {products.map(product => {
          const codeParts = [product.sku, product.barcode].filter(Boolean)
          const cartLines = cart.filter(item => item.productId === product.id)
          const cartSummary = cartLines.length === 1
            ? t('packages.inCartWithUnit', {
                quantity: formatPackageQuantity(
                  cartLines[0].quantity,
                  cartLines[0].quantityScale,
                ),
                unit: localizedName(
                  cartLines[0].unitName,
                  cartLines[0].unitNameAr,
                  isRtl,
                ),
              })
            : cartLines.length > 1
              ? t('packages.mixedUnitsInCart', { count: cartLines.length })
              : null

          return (
            <div
              key={product.id}
              className={`grid grid-cols-1 ${desktopGrid} gap-3 px-4 py-3 items-center hover:bg-emerald-50/30 transition-colors`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                  <span dir="auto">{localizedName(product.name, product.nameAr, isRtl)}</span>
                </p>
                {cartSummary && (
                  <span className="mt-1 inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                    {cartSummary}
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

              {stockVisible && <div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  product.trackStock
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {product.trackStock ? t('stockCount', { count: formatStockQuantity(product.stockQuantity) }) : t('notTracked')}
                </span>
              </div>}

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

function packageQuantityStep(scale: number): number {
  return Number((10 ** -Math.max(0, Math.min(6, scale))).toFixed(Math.max(0, Math.min(6, scale))))
}

function formatPackageQuantity(value: number, scale = 3): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Math.min(6, scale)),
  })
}

function SellingUnitChooser({
  product,
  onChoose,
  onClose,
}: {
  product: PosProduct
  onChoose: (unit: PosSellingUnit, quantity: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['pos', 'common'])
  const { isRtl } = useLocale()
  const units = useMemo(
    () => [...product.sellingUnits].sort((left, right) => Number(right.isBase) - Number(left.isBase)),
    [product.sellingUnits],
  )
  const [selectedId, setSelectedId] = useState(units[0]?.id ?? '')
  const selected = units.find(unit => unit.id === selectedId) ?? units[0]
  const [quantity, setQuantity] = useState('1')
  const parsedQuantity = Number(quantity)
  const step = packageQuantityStep(selected?.quantityScale ?? 0)
  const validQuantity = Boolean(
    selected
      && Number.isFinite(parsedQuantity)
      && parsedQuantity > 0
      && Number(parsedQuantity.toFixed(selected.quantityScale)) === parsedQuantity,
  )

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    setQuantity('1')
  }, [selectedId])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="selling-unit-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="max-h-[85vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="selling-unit-title" className="text-base font-bold text-gray-900">
              {t('pos:packages.chooseSellingUnit')}
            </h2>
            <p className="mt-0.5 truncate text-xs text-gray-500" dir="auto">
              {localizedName(product.name, product.nameAr, isRtl)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {units.map(unit => {
              const active = unit.id === selected?.id
              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => setSelectedId(unit.id)}
                  aria-pressed={active}
                  className={`min-w-0 rounded-2xl border p-3 text-start transition-colors ${
                    active
                      ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500'
                      : 'border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-gray-900" dir="auto">
                        {localizedName(unit.name, unit.nameAr, isRtl)}
                      </span>
                      {!unit.isBase && (
                        <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                          {t('pos:packages.contains', {
                            quantity: formatPackageQuantity(unit.conversionToBase, 6),
                            unit: localizedName(product.unit, product.unitAr, isRtl),
                          })}
                        </span>
                      )}
                    </span>
                    <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                      active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300'
                    }`}>
                      {active && <Check size={12} />}
                    </span>
                  </span>
                  <span className="mt-2 block text-base font-extrabold tabular-nums text-emerald-700" dir="ltr">
                    <Rial amount={unit.resolvedPrice} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t border-gray-100 bg-gray-50/70 p-4">
          <label htmlFor="selling-unit-quantity" className="mb-1.5 block text-xs font-semibold text-gray-700">
            {t('pos:packages.packageQuantity')}
          </label>
          <div className="flex min-w-0 gap-2">
            <input
              id="selling-unit-quantity"
              type="number"
              inputMode="decimal"
              min={step}
              step={step}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && validQuantity && selected) {
                  onChoose(selected, parsedQuantity)
                }
              }}
              autoFocus
              className="input min-w-0 flex-1 text-base tabular-nums"
              dir="ltr"
              aria-invalid={!validQuantity}
            />
            <button
              type="button"
              disabled={!validQuantity || !selected}
              onClick={() => { if (selected) onChoose(selected, parsedQuantity) }}
              className="min-w-[132px] rounded-xl bg-[#1B6B3A] px-4 text-sm font-bold text-white hover:bg-[#155830] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t('pos:packages.addSelected')}
            </button>
          </div>
          {!validQuantity && (
            <p className="mt-1.5 text-xs text-red-600">{t('pos:packages.invalidQuantity')}</p>
          )}
        </div>
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
              className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-white/20"
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

  const sessionKpis = [
    {
      label: t('register:netSessionSales'),
      amount: totalSessionSales,
      icon: Receipt,
      cardClass: 'bg-gradient-to-br from-[#1B6B3A] to-[#0F2419]',
    },
    {
      label: t('register:netCashSales'),
      amount: cashSales - cashRefunds,
      icon: Banknote,
      cardClass: 'bg-gradient-to-br from-[#0e6f53] to-[#0F4A28]',
    },
    {
      label: t('register:netCardSales'),
      amount: cardSales,
      icon: CreditCard,
      cardClass: 'bg-gradient-to-br from-[#4a5568] to-[#1f2937]',
    },
    {
      label: t('register:refundsCreditNotes'),
      amount: creditRefunds,
      icon: RotateCcw,
      cardClass: 'bg-gradient-to-br from-[#b45309] to-[#92400e]',
    },
  ]

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
            <section aria-label={t('register:sessionSummary')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sessionKpis.map(({ label, amount, icon: Icon, cardClass }) => (
                <div key={label} className={`min-w-0 rounded-xl border border-white/10 px-3 py-2.5 shadow-card-md ${cardClass}`}>
                  <div className="flex items-start gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/15" aria-hidden="true">
                      <Icon size={14} strokeWidth={2} className="text-white" />
                    </span>
                    <p className="min-w-0 text-[10px] font-semibold leading-4 text-white/70">{label}</p>
                  </div>
                  <p className="mt-1.5 text-base font-black tracking-tight text-white tabular-nums" dir="ltr">
                    <Rial amount={amount} />
                  </p>
                </div>
              ))}
            </section>

            <section aria-labelledby="expected-cash-heading" className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1B6B3A] to-[#0F2419] p-4 text-white shadow-card-md ring-1 ring-[#1B6B3A]/15 sm:p-5">
              <p id="expected-cash-heading" className="text-xs font-bold uppercase tracking-wide text-[#F3DE9A]">{t('register:expectedCashDrawer')}</p>
              <div className="mt-3 space-y-2 text-sm text-emerald-50/80">
                <div className="flex justify-between gap-4"><span>{t('register:openingCash')}</span><span className="font-medium text-white tabular-nums" dir="ltr"><Rial amount={openingCash} /></span></div>
                <div className="flex justify-between gap-4"><span><span className="text-emerald-100/60" aria-hidden="true">+</span> {t('register:netCashSales')}</span><span className="font-medium text-white tabular-nums" dir="ltr"><Rial amount={cashSales} /></span></div>
                <div className="flex justify-between gap-4"><span><span className="text-emerald-100/60" aria-hidden="true">−</span> {t('register:posCashExpenses')}</span><span className="font-medium text-white tabular-nums" dir="ltr"><Rial amount={cashExpenses} /></span></div>
                <div className="flex justify-between gap-4"><span><span className="text-emerald-100/60" aria-hidden="true">−</span> {t('register:cashRefunds')}</span><span className="font-medium text-white tabular-nums" dir="ltr"><Rial amount={cashRefunds} /></span></div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-4 border-t border-white/15 pt-3">
                <span className="text-sm font-semibold text-[#FFF6D8]">{t('register:expectedCashDrawer')}</span>
                <span className="text-2xl font-black tracking-tight text-white tabular-nums" dir="ltr"><Rial amount={expectedCash} /></span>
              </div>
            </section>

            <section aria-labelledby="cash-count-heading" className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 id="cash-count-heading" className="text-sm font-bold text-gray-900">{t('register:countDrawer')}</h4>
                <button
                  type="button"
                  onClick={() => setCashActual(expectedCash.toFixed(2))}
                  className="rounded-xl border border-[#1B6B3A]/25 bg-[#F3F8F4] px-3 py-2 text-xs font-semibold text-[#155830] hover:bg-[#E8F3EB] focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/40"
                >
                  {t('register:cashMatches', { amount: `SAR ${fmt(expectedCash)}` })}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor="actual-closing-cash" className="label">{t('register:actualCashCounted')}</label>
                  <div className="relative">
                    <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" dir="ltr">SAR</span>
                    <MoneyInput id="actual-closing-cash" value={cashActual} onValueChange={setCashActual} className="input h-11 ps-10 focus:border-[#1B6B3A] focus:ring-[#1B6B3A]/20" placeholder="0.00" autoFocus />
                  </div>
                </div>
                <div aria-live="polite" className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold sm:min-w-48 ${differenceState.className}`}>
                  {differenceState.label}
                </div>
              </div>
            </section>

            <details className="group rounded-xl border border-gray-100 bg-gray-50/70">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#1B6B3A]">
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
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0F2419] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#173F2F] disabled:bg-red-500 disabled:text-white disabled:opacity-50">
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
  const checkoutInFlightRef = useRef(false)
  const cartRef = useRef<CartItem[]>([])
  const sub       = useSubscription()

  // Session management
  const {
    session,
    loading: sessionLoading,
    error: sessionLoadError,
    openSession,
    closeSession,
    fetchActiveSession,
  } = usePosSession(
    profile?.branch_id,
    profile?.tenant_id,
    profile?.id,
  )
  const [showOpenSession,  setShowOpenSession]  = useState(false)
  const [showCloseSession, setShowCloseSession] = useState(false)
  const [sessionSummary,   setSessionSummary]   = useState<ClosedSessionSummary | null>(null)

  const [branch,     setBranch]     = useState<Branch | null>(null)
  const [products,   setProducts]   = useState<PosProduct[]>([])
  const [categories, setCategories] = useState<PosCategory[]>([])
  const [customers,  setCustomers]  = useState<PosCustomerRecord[]>([])
  const [loading,    setLoading]    = useState(true)

  const [search,       setSearch]       = useState('')
  const [activeCat,    setActiveCat]    = useState<string | null>(null)
  const [cart,         setCart]         = useState<CartItem[]>([])
  const [customerId,   setCustomerId]   = useState<string | null>(null)
  const [custSearch,   setCustSearch]   = useState('')
  const [custOpen,     setCustOpen]     = useState(false)
  const [customerActiveIndex, setCustomerActiveIndex] = useState(0)
  const [showQuickCustomer, setShowQuickCustomer] = useState(false)
  const [customerStatus, setCustomerStatus] = useState('')
  const [note,         setNote]         = useState('')
  const [payMethod,    setPayMethod]    = useState<PosPaymentChoice>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [splitCash,    setSplitCash]    = useState('')
  const [splitCard,    setSplitCard]    = useState('')
  const [splitOpen,    setSplitOpen]    = useState(false)
  const [splitLastEdited, setSplitLastEdited] = useState<'cash' | 'card'>('cash')
  const [creditInitialPayment, setCreditInitialPayment] = useState('')
  const [creditInitialMethod, setCreditInitialMethod] = useState<'cash' | 'card'>('cash')
  const [creditEligibility, setCreditEligibility] = useState<CustomerCreditCheckoutEligibility | null>(null)
  const [creditEligibilityLoading, setCreditEligibilityLoading] = useState(false)
  const [creditPolicyRevision, setCreditPolicyRevision] = useState(0)
  const [submitting,   setSubmitting]   = useState(false)
  const [receipt,      setReceipt]      = useState<ReceiptData | null>(null)
  const [unitChooserProduct, setUnitChooserProduct] = useState<PosProduct | null>(null)
  const [scannerEnabled, setScannerEnabled] = useState(true)
  const [scannerStatus, setScannerStatus] = useState<'idle' | 'looking' | 'accepted' | 'unknown' | 'conflict' | 'error'>('idle')
  const [scannerMessage, setScannerMessage] = useState('')
  const [showExpense,  setShowExpense]  = useState(false)
  const [printerStatus, setPrinterStatus] = useState<'connected' | 'unconfigured' | 'error'>('unconfigured')
  const [scrollState,  setScrollState]  = useState({
    categoryAtStart: true,
    categoryAtEnd: true,
    productsAtStart: true,
    productsAtEnd: true,
  })
  const checkoutKeyRef = useRef<string | null>(null)
  const creditOperationRef = useRef<string | null>(null)
  const autoPrintedReceiptIdRef = useRef<string | null>(null)
  const resolvedBarcodeCacheRef = useRef(new Map<string, ScannerIndexEntry<PosProduct, PosSellingUnit>>())
  const businessType = resolveBusinessType(tenant?.business_type)
  const stockVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  const savedBranchPosMode = branchPosMode(branch?.pos_mode)
  const activePosMode: PosMode = businessType === 'trading' ? savedBranchPosMode : 'touch'
  const resolvedInvoiceSettings = useMemo(
    () => resolveInvoicePresentationSettings({ savedSettings: branch?.presentation_settings, branch: branch ?? {} }),
    [branch],
  )

  const playScannerTone = (accepted: boolean) => {
    try {
      const AudioContextClass = window.AudioContext
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = accepted ? 880 : 220
      gain.gain.setValueAtTime(0.035, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.08)
      oscillator.onended = () => void context.close()
    } catch {
      // Visual feedback remains available when browser audio is unavailable.
    }
  }

  const loadedBarcodeIndex = useMemo(() => {
    const entries: Array<{
      code: string | null
      product: PosProduct
      unit: PosSellingUnit
      source: 'barcode' | 'sku'
    }> = []
    for (const product of products) {
      const baseUnit = product.sellingUnits.find(unit => unit.isBase)
      if (!baseUnit) continue
      entries.push({ code: product.barcode, product, unit: baseUnit, source: 'barcode' })
      if (normalizeBarcode(product.sku ?? '').toLocaleLowerCase('en-US')
        !== normalizeBarcode(product.barcode ?? '').toLocaleLowerCase('en-US')) {
        entries.push({ code: product.sku, product, unit: baseUnit, source: 'sku' })
      }
    }
    return createScannerIndex(entries)
  }, [products])

  const announceScan = (status: typeof scannerStatus, message: string, accepted = false) => {
    setScannerStatus(status)
    setScannerMessage(message)
    playScannerTone(accepted)
  }

  const addScannedUnit = (product: PosProduct, unit: PosSellingUnit) => {
    const mutation = mutateCart(product, 1, unit, true)
    if (mutation.status === 'out_of_stock') {
      announceScan('unknown', t('pos:scanner.outOfStock'))
      return
    }
    announceScan(
      'accepted',
      mutation.status === 'incremented'
        ? t('pos:scanner.quantityUpdated', { product: localizedName(product.name, product.nameAr, isRtl), quantity: mutation.quantity })
        : t(unit.isBase ? 'pos:scanner.productAdded' : 'pos:scanner.packageAdded', {
            product: localizedName(product.name, product.nameAr, isRtl),
            unit: localizedName(unit.name, unit.nameAr, isRtl),
          }),
      true,
    )
  }

  const resolveScannedBarcode = async (capture: ScannerCapture) => {
    const branchId = profile?.branch_id
    const code = normalizeBarcode(capture.code)
    if (!branchId || code.length < 3 || submitting || checkoutInFlightRef.current) return
    setScannerStatus('looking')
    setScannerMessage(t('pos:scanner.processing'))
    const indexed = resolveScannerCode(loadedBarcodeIndex, code)
    if (indexed.status === 'conflict') {
      announceScan('conflict', t('pos:scanner.conflict'))
      console.warn('[POS scanner] ambiguous loaded barcode', { codeLength: code.length, matches: indexed.entries.length })
      return
    }
    if (indexed.status === 'found') {
      addScannedUnit(indexed.entry.product, indexed.entry.unit)
      return
    }
    const cacheKey = code.toLocaleLowerCase('en-US')
    const cached = resolvedBarcodeCacheRef.current.get(cacheKey)
    if (cached) {
      addScannedUnit(cached.product, cached.unit)
      return
    }
    const { data, error } = await (supabase as any).rpc('resolve_product_unit_barcode', {
      p_branch_id: branchId,
      p_barcode: code,
    })
    if (error) {
      announceScan('error', t('pos:scanner.networkError'))
      console.warn('[POS scanner] barcode resolution failed', { codeLength: code.length })
      return
    }
    const row = data?.[0]
    if (!row) {
      announceScan('unknown', t('pos:scanner.unknown'))
      return
    }
    if (row.resolution_status !== 'active') {
      announceScan('unknown', t('pos:scanner.inactive'))
      return
    }
    const product = products.find(candidate => candidate.id === row.product_id)
    if (!product) {
      announceScan('error', t('pos:scanner.refreshRequired'))
      return
    }
    const unit: PosSellingUnit = {
      id: String(row.product_unit_id),
      name: String(row.unit_name),
      nameAr: row.unit_name_ar ?? null,
      code: String(row.unit_code),
      conversionToBase: Number(row.conversion_to_base),
      quantityScale: Number(row.quantity_scale),
      pricingMethod: row.pricing_method === 'custom' ? 'custom' : 'calculated',
      resolvedPrice: Number(row.selling_price),
      isBase: product.sellingUnits.some(candidate => candidate.id === row.product_unit_id && candidate.isBase),
      version: Number(row.product_unit_version),
    }
    resolvedBarcodeCacheRef.current.set(cacheKey, { product, unit, source: 'unit' })
    addScannedUnit(product, unit)
  }

  useBarcodeScanner({
    enabled: scannerEnabled,
    blocked: Boolean(
      receipt || showOpenSession || showCloseSession || unitChooserProduct
      || custOpen || showQuickCustomer || splitOpen || showExpense || submitting
    ),
    onScan: resolveScannedBarcode,
  })

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
        const [
          { data: branchData },
          { data: prodData },
          { data: custData },
          { data: unitData, error: unitError },
        ] = await Promise.all([
          supabase.from('branches').select('*').eq('id', bid).single(),
          supabase
            .from('products')
            .select('id, name, name_ar, sku, barcode, price, unit, unit_ar, vat_treatment, category_id, stock_quantity, track_stock, image_url, is_service, is_active, is_available, categories(id, name, name_ar, color, icon)')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .eq('is_available', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('customers')
            .select('id, name, name_ar, phone, customer_type, vat_number, cr_number, address, address_ar, business_name, business_name_ar')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(200),
          (supabase as any).rpc('get_branch_selling_product_units', { p_branch_id: bid }),
        ])
        if (cancelled) return

        setBranch(branchData as Branch)

        const unitsByProduct = new Map<string, PosSellingUnit[]>()
        if (!unitError) {
          for (const row of unitData ?? []) {
            const unit: PosSellingUnit = {
              id: String(row.id),
              name: String(row.name),
              nameAr: row.name_ar ?? null,
              code: String(row.unit_code ?? 'PCE'),
              conversionToBase: Number(row.conversion_to_base),
              quantityScale: Number(row.quantity_scale ?? 0),
              pricingMethod: row.pricing_method === 'custom' ? 'custom' : 'calculated',
              resolvedPrice: Number(row.resolved_selling_price),
              isBase: row.is_base === true,
              version: Number(row.version),
            }
            const existing = unitsByProduct.get(String(row.product_id)) ?? []
            existing.push(unit)
            unitsByProduct.set(String(row.product_id), existing)
          }
        }

        const prods: PosProduct[] = (prodData ?? []).map((p: any) => ({
          id:            p.id,
          name:          p.name,
          nameAr:        p.name_ar,
          sku:           p.sku ?? null,
          barcode:       p.barcode ?? null,
          price:         Number(p.price),
          unit:          p.unit ?? 'pcs',
          unitAr:        p.unit_ar ?? null,
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
          sellingUnits:  unitsByProduct.get(p.id) ?? [],
        }))
        setProducts(prods)
        if (unitError) {
          console.warn('[POSPage] selling-unit load failed', { code: unitError.code ?? 'unknown' })
          toast.error(t('pos:packages.loadFailed'))
        }

        const catMap = new Map<string, PosCategory>()
        for (const p of prodData ?? []) {
          const c = (p as any).categories
          if (c?.id) catMap.set(c.id, { id: c.id, name: c.name, nameAr: c.name_ar ?? null, color: c.color, icon: c.icon })
        }
        setCategories(Array.from(catMap.values()))

        setCustomers((custData ?? []).map((c: any) => ({
          id:            c.id,
          name:          c.name,
          name_ar:       c.name_ar ?? null,
          phone:         c.phone,
          customer_type: c.customer_type ?? 'individual',
          vat_number:    c.vat_number ?? null,
          business_name: c.business_name ?? null,
          business_name_ar: c.business_name_ar ?? null,
          cr_number: c.cr_number ?? null,
          address: c.address ?? null,
          address_ar: c.address_ar ?? null,
        })))

        try {
          const saved = localStorage.getItem(cartKey(bid))
          if (saved) {
            const rawItems = JSON.parse(saved) as Partial<CartItem>[]
            const restored = rawItems.flatMap(raw => {
              const product = prods.find(candidate => candidate.id === raw.productId)
              if (!product || !Number.isFinite(Number(raw.quantity)) || Number(raw.quantity) <= 0) return []
              const requestedUnit = raw.productUnitId
                ? product.sellingUnits.find(unit => unit.id === raw.productUnitId)
                : product.sellingUnits.find(unit => unit.isBase)
              if (raw.productUnitId && !requestedUnit) return []
              if (requestedUnit) {
                return [{
                  cartLineId: `${product.id}:${requestedUnit.id}:${requestedUnit.version}:${requestedUnit.pricingMethod}:${requestedUnit.resolvedPrice.toFixed(2)}:${product.vatTreatment}`,
                  productId: product.id,
                  productUnitId: requestedUnit.id,
                  productUnitVersion: requestedUnit.version,
                  pricingMethod: requestedUnit.pricingMethod,
                  conversionToBase: requestedUnit.conversionToBase,
                  quantityScale: requestedUnit.quantityScale,
                  unitName: requestedUnit.name,
                  unitNameAr: requestedUnit.nameAr,
                  unitCode: requestedUnit.code,
                  baseUnitName: product.unit,
                  baseUnitNameAr: product.unitAr,
                  name: product.name,
                  nameAr: product.nameAr,
                  price: requestedUnit.resolvedPrice,
                  vatTreatment: product.vatTreatment,
                  unit: requestedUnit.name,
                  quantity: Number(raw.quantity),
                  catColor: product.catColor,
                }]
              }
              return [{
                cartLineId: `${product.id}:legacy:0:legacy:${product.price.toFixed(2)}:${product.vatTreatment}`,
                productId: product.id,
                productUnitId: null,
                productUnitVersion: null,
                pricingMethod: 'legacy' as const,
                conversionToBase: 1,
                quantityScale: 3,
                unitName: product.unit,
                unitNameAr: null,
                unitCode: null,
                baseUnitName: product.unit,
                baseUnitNameAr: product.unitAr,
                name: product.name,
                nameAr: product.nameAr,
                price: product.price,
                vatTreatment: product.vatTreatment,
                unit: product.unit,
                quantity: Number(raw.quantity),
                catColor: product.catColor,
              }]
            })
            cartRef.current = restored
            setCart(restored)
          }
        } catch {}
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => {
    const userId = user?.id
    const tenantId = profile?.tenant_id
    const branchId = profile?.branch_id
    if (!userId || !tenantId || !branchId) return

    let cancelled = false
    void getZatcaFinalizationCapabilities(branchId)
      .then(capability => {
        if (cancelled || capability.acknowledged) return
        console.warn('[POSPage] ZATCA capability acknowledgement unavailable', {
          branchId,
          status: capability.acknowledgementStatus,
          reason: capability.acknowledgementReason,
        })
      })
      .catch(error => {
        if (cancelled) return
        console.warn('[POSPage] ZATCA capability handshake failed', {
          branchId,
          reason: error instanceof Error ? error.message : 'unknown_error',
        })
      })

    return () => { cancelled = true }
  }, [user?.id, profile?.tenant_id, profile?.branch_id])

  // ── Persist cart ─────────────────────────────────────────────────────────

  useEffect(() => {
    const bid = profile?.branch_id
    if (!bid) return
    cartRef.current = cart
    localStorage.setItem(cartKey(bid), JSON.stringify(cart))
  }, [cart, profile?.branch_id])

  useEffect(() => {
    if (!session || submitting || receipt || showOpenSession || showCloseSession || unitChooserProduct || custOpen || showQuickCustomer || splitOpen || showExpense) return
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [session, submitting, receipt, showOpenSession, showCloseSession, unitChooserProduct, custOpen, showQuickCustomer, splitOpen, showExpense])

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

  function handleCommandBarKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const code = normalizeBarcode(search)
    if (code.length < 3) return
    const loadedResolution = resolveScannerCode(loadedBarcodeIndex, code)
    const visibleResults = activePosMode === 'quick' ? quickFiltered : filtered
    if (loadedResolution.status === 'unknown' && visibleResults.length > 0) return
    event.preventDefault()
    void resolveScannedBarcode({ code, characterCount: code.length, durationMs: 0, terminator: 'enter' })
    setSearch('')
  }

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
  const creditInitialAmount = parseExplicitMoneyInput(creditInitialPayment)
  const creditInitialNumeric = creditInitialAmount ?? 0
  const creditInitialWithinInvoice = creditInitialAmount !== null
    && creditInitialAmount >= 0
    && creditInitialAmount <= totals.total + 0.001
  const creditHasOutstanding = creditInitialAmount !== null
    && totals.total - creditInitialAmount > 0.001
  const creditInitialValid = creditInitialWithinInvoice && creditHasOutstanding
  const creditOutstandingAmount = creditInitialAmount === null
    ? totals.total
    : Math.max(0, round2(totals.total - creditInitialAmount))

  const filteredCusts = useMemo(() => searchCustomers(customers, custSearch), [customers, custSearch])
  const selectedCust = customers.find(c => c.id === customerId)
  const selectedCustomerIsBusiness = selectedCust?.customer_type === 'business'
  const exactCustomerMobile = normalizeSaudiMobile(custSearch)

  useEffect(() => {
    const refreshForPolicyChange = (event: Event) => {
      const changedCustomerId = (event as CustomEvent<{ customerId?: string | null }>).detail?.customerId
      if (!changedCustomerId || changedCustomerId === customerId) setCreditPolicyRevision(value => value + 1)
    }
    const refreshForStorageChange = (event: StorageEvent) => {
      if (isCustomerCreditPolicyStorageChange(event)) setCreditPolicyRevision(value => value + 1)
    }
    window.addEventListener(CUSTOMER_CREDIT_POLICY_CHANGED_EVENT, refreshForPolicyChange)
    window.addEventListener('storage', refreshForStorageChange)
    return () => {
      window.removeEventListener(CUSTOMER_CREDIT_POLICY_CHANGED_EVENT, refreshForPolicyChange)
      window.removeEventListener('storage', refreshForStorageChange)
    }
  }, [customerId])

  useEffect(() => {
    if (!branch || !customerId || !selectedCustomerIsBusiness) {
      setCreditEligibility(null)
      setCreditEligibilityLoading(false)
      return
    }
    let cancelled = false
    const proposedCreditAmount = creditInitialAmount !== null && creditInitialWithinInvoice
      ? creditOutstandingAmount
      : totals.total
    setCreditEligibilityLoading(true)
    void loadCustomerCreditCheckoutEligibility({
      branchId: branch.id,
      customerId,
      proposedCreditAmount,
    }).then(result => {
      if (!cancelled) setCreditEligibility(result)
    }).catch(error => {
      console.warn('[POSPage] credit eligibility preflight failed', error)
      if (!cancelled) setCreditEligibility(null)
    }).finally(() => {
      if (!cancelled) setCreditEligibilityLoading(false)
    })
    return () => { cancelled = true }
  }, [branch?.id, customerId, selectedCustomerIsBusiness, creditInitialAmount, creditInitialWithinInvoice, creditOutstandingAmount, totals.total, creditPolicyRevision])

  useEffect(() => {
    if (!selectedCustomerIsBusiness && payMethod === 'credit') {
      setPayMethod('cash')
      setCreditInitialPayment('')
    }
  }, [selectedCustomerIsBusiness, payMethod])

  useEffect(() => {
    if (payMethod === 'credit' && creditEligibility && !creditEligibility.allowed) {
      setPayMethod('cash')
      setCreditInitialPayment('')
    }
  }, [creditEligibility, payMethod])

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

  function addQuantityToCart(product: PosProduct, quantity: number, unit?: PosSellingUnit) {
    if (!Number.isFinite(quantity) || quantity <= 0) return
    mutateCart(product, quantity, unit, false)
  }

  function mutateCart(product: PosProduct, quantity: number, unit: PosSellingUnit | undefined, enforceScanStock: boolean) {
    const selectedUnit = unit ?? product.sellingUnits.find(candidate => candidate.isBase)
    const unitId = selectedUnit?.id ?? null
    const unitVersion = selectedUnit?.version ?? null
    const pricingMethod = selectedUnit?.pricingMethod ?? 'legacy'
    const price = selectedUnit?.resolvedPrice ?? product.price
    const cartLineId = `${product.id}:${unitId ?? 'legacy'}:${unitVersion ?? 0}:${pricingMethod}:${price.toFixed(2)}:${product.vatTreatment}`
    const line: CartItem = {
      cartLineId,
        productId:    product.id,
        productUnitId: unitId,
        productUnitVersion: unitVersion,
        pricingMethod,
        conversionToBase: selectedUnit?.conversionToBase ?? 1,
        quantityScale: selectedUnit?.quantityScale ?? 3,
        unitName: selectedUnit?.name ?? product.unit,
        unitNameAr: selectedUnit?.nameAr ?? null,
        unitCode: selectedUnit?.code ?? null,
        baseUnitName: product.unit,
        baseUnitNameAr: product.unitAr,
        name:         product.name,
        nameAr:       product.nameAr,
        price,
        vatTreatment: product.vatTreatment,
        unit:         selectedUnit?.name ?? product.unit,
        quantity: 1,
        catColor:     product.catColor,
    }
    const mutation = applyScannerCartMutation({
      cart: cartRef.current,
      line,
      quantity,
      stockQuantity: product.stockQuantity,
      enforceStock: enforceScanStock && stockVisible && product.trackStock && !product.isService,
    })
    if (mutation.status !== 'out_of_stock') {
      cartRef.current = mutation.cart
      setCart(mutation.cart)
    }
    return mutation
  }

  function addToCart(product: PosProduct) {
    const alternates = product.sellingUnits.filter(unit => !unit.isBase)
    if (alternates.length > 0) {
      setUnitChooserProduct(product)
      return
    }
    addQuantityToCart(product, 1, product.sellingUnits.find(unit => unit.isBase))
  }

  function adjustQty(cartLineId: string, delta: number) {
    const next = cartRef.current
      .map(item => item.cartLineId === cartLineId ? { ...item, quantity: item.quantity + delta } : item)
      .filter(item => item.quantity > 0)
    cartRef.current = next
    setCart(next)
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
    if (!tid || !branch || cart.length === 0 || submitting || checkoutInFlightRef.current) return
    if (isAccountSuspended) {
      toast.error(t('pos:accountSuspendedFull'))
      return
    }
    checkoutInFlightRef.current = true
    setSubmitting(true)

    try {
      const persistedAtomicCheckout = readPendingAtomicCheckout(branch.id)
      const persistedInvoiceCheckout = persistedAtomicCheckout?.documentType === 'invoice'
        ? persistedAtomicCheckout
        : null
      const idempotencyKey = persistedInvoiceCheckout?.idempotencyKey
        ?? checkoutKeyRef.current
        ?? createCheckoutIdempotencyKey()
      checkoutKeyRef.current = idempotencyKey

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
      if (payMethod === 'credit') {
        if (!customerId) {
          toast.error(t('payments:creditCustomerRequired'))
          return
        }
        if (!creditInitialValid) {
          toast.error(t('payments:creditInitialInvalid'))
          return
        }
        const freshEligibility = await loadCustomerCreditCheckoutEligibility({
          branchId: branch.id,
          customerId,
          proposedCreditAmount: creditOutstandingAmount,
        })
        setCreditEligibility(freshEligibility)
        if (!freshEligibility.allowed) {
          toast.error(t(`payments:${creditEligibilityMessageKey(freshEligibility.reasonCode)}`))
          return
        }
      }

      const splitUsesBothMethods = payMethod === 'split' && splitCashAmount > 0 && splitCardAmount > 0
      const effectivePaymentMethod: PaymentMethod = payMethod === 'split'
        ? splitCashAmount > 0 && splitCardAmount <= 0 ? 'cash' : splitCardAmount > 0 && splitCashAmount <= 0 ? 'card' : 'other'
        : payMethod === 'credit' ? 'other' : payMethod
      const cashTenderProvided = (effectivePaymentMethod === 'cash' && payMethod === 'split') || (payMethod === 'cash' && cashReceived.trim() !== '')
      const splitPayments = splitUsesBothMethods
        ? [
            { method: 'cash', amount: round2(splitCashAmount) },
            { method: 'card', amount: round2(splitCardAmount) },
          ]
        : null
      let payload: Record<string, unknown> = {
        branch_id: branch.id,
        customer_id: customerId,
        session_id: session?.id ?? null,
        payment_method: effectivePaymentMethod,
        amount_paid: cashTenderProvided ? (payMethod === 'split' ? splitCashAmount : cashAmt) : null,
        ...(splitPayments ? { payments: splitPayments } : {}),
        note: note || null,
        idempotency_key: idempotencyKey,
        items: cart.map(item => item.productUnitId
          ? {
              product_id: item.productId,
              product_unit_id: item.productUnitId,
              package_quantity: item.quantity,
              expected_product_unit_version: item.productUnitVersion,
            }
          : {
              product_id: item.productId,
              quantity: item.quantity,
            }),
      }

      const documentDecision = await resolvePosCheckoutDocument(branch.id, customerId)
      if (documentDecision?.status === 'blocked') {
        throw new Error(documentDecision.code ?? 'CHECKOUT_DOCUMENT_BLOCKED')
      }
      const nonFiscalDemo = documentDecision.checkoutPath === 'demo'
        && documentDecision.isDemo
        && documentDecision.nonFiscal
      const sandboxDemo = documentDecision.checkoutPath === 'sandbox'
        && documentDecision.isDemo === false
        && documentDecision.nonFiscal === false
      const standardRequested = documentDecision
        ? documentDecision.documentType === 'standard'
        : selectedCust?.customer_type === 'business'
          && /^3[0-9]{13}3$/.test(selectedCust.vat_number ?? '')
      const atomicRequested = !nonFiscalDemo
        && !sandboxDemo
        && payMethod !== 'credit'
        && documentDecision?.documentType === 'simplified'
        && documentDecision.checkoutPath === 'atomic'
      let productionCheckoutMode: ZatcaCheckoutMode = 'legacy'
      let atomicCheckoutResult: AtomicCheckoutResult | null = null
      let atomicFingerprint: string | null = null
      let checkout: PosCheckoutResult | null = null
      if (atomicRequested) {
        if (persistedInvoiceCheckout) payload = persistedInvoiceCheckout.checkout
        atomicFingerprint = await atomicCheckoutFingerprint(payload)
        if (persistedInvoiceCheckout
            && persistedInvoiceCheckout.cartFingerprint !== atomicFingerprint) {
          throw new Error('Persisted checkout fingerprint does not match its request payload')
        }
        persistPendingAtomicCheckout(branch.id, {
          idempotencyKey,
          cartFingerprint: atomicFingerprint,
          documentType: 'invoice',
          checkout: payload,
        })
        const atomicAttempt = await checkoutSimplifiedAtomically({
          branchId: branch.id,
          checkout: payload,
          cartFingerprint: atomicFingerprint,
        })
        if (atomicAttempt.status === 'committed') {
          atomicCheckoutResult = atomicAttempt
          const atomicReceipt = atomicCheckoutResult.receipt
          const atomicPayments = Array.isArray(atomicReceipt.payments) ? atomicReceipt.payments : []
          const firstAtomicPayment = atomicPayments[0]
          checkout = {
            invoice_id: atomicReceipt.invoice_id,
            invoice_number: atomicReceipt.invoice_number,
            created_at: atomicReceipt.created_at,
            subtotal: atomicReceipt.subtotal,
            tax_amount: atomicReceipt.tax_amount,
            total: atomicReceipt.total,
            payment_method: atomicReceipt.payment_method as PaymentMethod,
            display_payment_method: atomicPayments.length > 1 ? 'split' : atomicReceipt.payment_method,
            payment_status: atomicReceipt.payment_status,
            amount_received: firstAtomicPayment?.amount_received ?? atomicReceipt.total,
            change_amount: firstAtomicPayment?.change_amount ?? 0,
            payments: atomicPayments.map(payment => ({
              method: payment.method as PaymentMethod,
              amount: payment.amount,
              amount_received: payment.amount_received,
              change_amount: payment.change_amount,
            })),
            zatca_invoice_type: 'simplified',
            items: atomicReceipt.items,
            document_language: atomicReceipt.document_language ?? undefined,
            idempotent_replay: atomicCheckoutResult.idempotentReplay,
          } as PosCheckoutResult
        }
      }
      if (!checkout) {
        if (!nonFiscalDemo && !sandboxDemo) {
          // The authenticated server classifier has already selected the
          // document kind. Standard and non-eligible Simplified transactions
          // retain the approved legacy path without changing fiscal type.
          productionCheckoutMode = 'legacy'
        }
        const creditOperationId = payMethod === 'credit' && customerId
          ? (creditOperationRef.current ?? getPersistentReceivableOperation({
              branchId: branch.id,
              customerId,
              fingerprint: JSON.stringify({
                branch_id: branch.id,
                customer_id: customerId,
                items: payload.items,
                initial_payments: creditInitialNumeric > 0
                  ? [{ method: creditInitialMethod, amount: round2(creditInitialNumeric) }]
                  : [],
              }),
            }))
          : null
        if (creditOperationId) creditOperationRef.current = creditOperationId
        const creditPayload = payMethod === 'credit'
          ? {
              ...payload,
              operation_id: creditOperationId,
              settlement_mode: creditInitialNumeric > 0 ? 'partial' : 'credit',
              initial_payments: creditInitialNumeric > 0
                ? [{ method: creditInitialMethod, amount: round2(creditInitialNumeric) }]
                : [],
            }
          : null
        const { data, error } = await (supabase as any).rpc(
          payMethod === 'credit' ? 'post_customer_credit_checkout_v1' : 'pos_checkout',
          { p_payload: payMethod === 'credit' ? creditPayload : payload },
        )
        if (error) throw error
        checkout = data as PosCheckoutResult
      }
      if (!checkout) throw new Error('Checkout did not return an invoice')
      const serverTotal = num(checkout.total)
      const serverTax = num(checkout.tax_amount)
      const serverSubtotal = num(checkout.subtotal)
      const createdAt = checkout.created_at
      // Credit is a business posting mode, not a database tender enum. Keep
      // the persisted tender compatible while preserving the visible mode.
      const receiptPaymentMethod: PaymentMethod = payMethod === 'credit'
        ? 'other'
        : checkout.payment_method ?? (payMethod === 'split' ? 'other' : payMethod)
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
      const displayPaymentMethod = payMethod === 'credit'
        ? (checkout.display_payment_method ?? 'credit')
        : checkout.display_payment_method ?? (isSplitPaymentRows(receiptPayments) ? 'split' : receiptPaymentMethod)
      const serverAmountReceived = num(checkout.amount_received ?? serverTotal)
      const serverChangeAmount = num(checkout.change_amount ?? Math.max(0, serverAmountReceived - serverTotal))
      const receiptCashReceived = displayPaymentMethod !== 'split' && receiptPaymentMethod === 'cash'
        ? serverAmountReceived
        : serverTotal
      const receiptChange = displayPaymentMethod !== 'split' && receiptPaymentMethod === 'cash' ? serverChangeAmount : 0
      const creditInitialPayment = payMethod === 'credit' ? num(checkout.amount_received ?? 0) : 0
      const creditBalanceDue = payMethod === 'credit' && checkout.outstanding_amount != null
        ? Math.max(0, num(checkout.outstanding_amount))
        : payMethod === 'credit' ? Math.max(0, serverTotal - creditInitialPayment) : 0
      const creditAmountPaid = payMethod === 'credit' ? Math.max(0, serverTotal - creditBalanceDue) : 0
      const creditInitialMethods = payMethod === 'credit'
        ? [...new Set((checkout.payments ?? []).map(payment => payment.method).filter(Boolean))]
        : []
      const customerCredit: CustomerCreditPaymentSummary | null = payMethod === 'credit'
        ? {
            isCustomerCredit: true,
            paymentStatus: creditBalanceDue <= 0.005 || checkout.payment_status === 'paid'
              ? 'paid'
              : creditInitialPayment > 0.005 || checkout.payment_status === 'partial'
              ? 'partial'
              : 'unpaid',
            initialPayment: creditInitialPayment,
            initialPaymentMethod: creditInitialMethods.length > 1 ? 'split' : creditInitialMethods[0] ?? null,
            amountPaid: creditAmountPaid,
            balanceDue: creditBalanceDue,
          }
        : null
      const isB2BInvoice = checkout.zatca_invoice_type === 'standard'
      let preOutputSubmission: Awaited<ReturnType<typeof submitInvoiceForBranch>> | null = null
      let finalQrCode: string | null = null
      let canPrintCustomerCopy = false
      let finalizationStatus = 'not_started'
      let artifactStage = 'none'
      let documentKind: 'simplified' | 'standard' | null = isB2BInvoice ? 'standard' : 'simplified'
      let finalizationError: string | null = null

      try {
        if (atomicCheckoutResult) {
          finalizationStatus = atomicCheckoutResult.finalizationStatus
          artifactStage = atomicCheckoutResult.artifactStage
          documentKind = atomicCheckoutResult.documentKind
          finalQrCode = atomicCheckoutResult.receipt.qr_code
          canPrintCustomerCopy = atomicCheckoutResult.receipt.can_print === true
        } else if (nonFiscalDemo) {
          finalQrCode = null
          canPrintCustomerCopy = true
          finalizationStatus = 'demo_non_fiscal'
          artifactStage = 'none'
          documentKind = null
        } else if (sandboxDemo) {
          preOutputSubmission = await submitInvoiceForBranch({
            invoiceId: checkout.invoice_id,
            tenantId: branch.tenant_id,
            branchId: branch.id,
            options: {
              source: 'auto_checkout',
              retryDelayMs: 1500,
              contractMode: 'legacy',
              documentKind: 'simplified',
            },
          })
          if (preOutputSubmission.mode !== 'sandbox_validation') {
            throw new Error('SANDBOX_SUBMISSION_ROUTE_UNAVAILABLE')
          }
          const sandboxResult = preOutputSubmission.result
          const validated = sandboxResult.status === 'sandbox_validated'
            || sandboxResult.status === 'sandbox_validated_with_warnings'
          finalizationStatus = sandboxResult.status ?? 'sandbox_validation_failed'
          artifactStage = validated ? 'sandbox_compliance_validated' : 'sandbox_compliance_pending'
          documentKind = 'simplified'
          finalQrCode = sandboxResult.qrCode ?? null
          canPrintCustomerCopy = validated && Boolean(finalQrCode)
          if (!canPrintCustomerCopy) {
            finalizationError = sandboxResult.message ?? 'Sandbox compliance validation did not produce a printable QR.'
          }
        } else if (productionCheckoutMode === 'legacy') {
          preOutputSubmission = await submitInvoiceForBranch({
            invoiceId: checkout.invoice_id,
            tenantId: branch.tenant_id,
            branchId: branch.id,
            options: {
              source: 'auto_checkout',
              retryDelayMs: 1500,
              contractMode: productionCheckoutMode,
              documentKind: isB2BInvoice ? 'standard' : 'simplified',
            },
          })
          if (preOutputSubmission.mode === 'production_submission') {
            const legacy = preOutputSubmission.result
            finalizationStatus = legacy.finalizationStatus
            artifactStage = legacy.artifactStage
            documentKind = legacy.documentKind ?? documentKind
            finalQrCode = selectStoredOutputStateQr(legacy)
            canPrintCustomerCopy = Boolean(finalQrCode)
            if (!canPrintCustomerCopy) {
              finalizationError = legacy.retryable
                ? 'Legacy ZATCA submission is pending and can be retried.'
                : 'Legacy ZATCA submission did not produce a printable artifact.'
            }
          }
        } else {
          const finalization = await finalizeInvoiceForZatca({
            invoiceId: checkout.invoice_id,
            branchId: branch.id,
            options: { source: 'auto_checkout' },
          })
          finalizationStatus = finalization.finalizationStatus
          artifactStage = finalization.artifactStage
          documentKind = finalization.documentKind
          if (!finalization.ok) throw new Error(finalization.error ?? 'Invoice finalization failed')

          if (isB2BInvoice) {
            preOutputSubmission = await submitInvoiceForBranch({
              invoiceId: checkout.invoice_id,
              tenantId: branch.tenant_id,
              branchId: branch.id,
              options: {
                source: 'auto_checkout',
                retryDelayMs: 1500,
                contractMode: productionCheckoutMode,
                documentKind: 'standard',
              },
            })
            const output = await getInvoiceZatcaOutputState({ invoiceId: checkout.invoice_id, branchId: branch.id })
            finalizationStatus = output.finalizationStatus
            artifactStage = output.artifactStage
            documentKind = output.documentKind
            finalQrCode = selectStoredOutputStateQr(output)
            canPrintCustomerCopy = Boolean(finalQrCode)
            if (!canPrintCustomerCopy) {
              finalizationError = output.error ?? 'Standard invoice is awaiting a validated cleared artifact.'
            }
          } else {
            finalQrCode = selectStoredOutputStateQr({
              ...finalization,
              contractMode: 'v2',
              legacyCompatible: false,
            })
            canPrintCustomerCopy = Boolean(finalQrCode)
          }
        }
      } catch (finalizationFailure) {
        finalizationError = finalizationFailure instanceof Error
          ? finalizationFailure.message
          : 'Invoice finalization requires attention.'
        canPrintCustomerCopy = false
        finalQrCode = null
      }

      const branchAddr = [
        branch.building_number ? `Building ${branch.building_number}` : null,
        branch.street, branch.district, branch.city,
      ].filter(Boolean).join(', ')
      const branchAddrAr = [
        branch.building_number ? `مبنى ${branch.building_number}` : null,
        branch.street_ar, branch.district_ar, branch.city_ar,
      ].filter(Boolean).join('، ')
      const atomicReceipt = atomicCheckoutResult?.receipt ?? null
      const atomicSeller = atomicReceipt?.seller ?? null
      const atomicCustomer = atomicReceipt?.customer ?? null

      setReceipt({
        invoiceNumber:  checkout.invoice_number,
        invoiceId:      checkout.invoice_id,
        total:          serverTotal,
        taxAmount:      serverTax,
        subtotal:       serverSubtotal,
        paymentMethod:  receiptPaymentMethod,
        change:         receiptChange,
        cashReceived:   receiptCashReceived,
        customerName:      typeof atomicCustomer?.business_name === 'string' && atomicCustomer.business_name
          ? atomicCustomer.business_name
          : typeof atomicCustomer?.name === 'string' && atomicCustomer.name
          ? atomicCustomer.name
          : selectedCust?.customer_type === 'business' && selectedCust?.business_name
          ? selectedCust.business_name
          : (selectedCust?.name ?? 'Walk-in Customer'),
        customerNameAr:    typeof atomicCustomer?.business_name_ar === 'string'
          ? atomicCustomer.business_name_ar
          : typeof atomicCustomer?.name_ar === 'string'
          ? atomicCustomer.name_ar
          : selectedCust?.customer_type === 'business'
          ? (selectedCust?.business_name_ar ?? selectedCust?.name_ar)
          : (selectedCust?.name_ar ?? null),
        hasSelectedCustomer: atomicCustomer != null || selectedCust != null,
        customerAddress: typeof atomicCustomer?.address === 'string' ? atomicCustomer.address : (selectedCust?.address ?? null),
        customerAddressAr: typeof atomicCustomer?.address_ar === 'string' ? atomicCustomer.address_ar : (selectedCust?.address_ar ?? null),
        buyerIdentifierType: atomicCustomer?.cr_number || selectedCust?.cr_number ? 'CR' : null,
        buyerIdentifierValue: typeof atomicCustomer?.cr_number === 'string' ? atomicCustomer.cr_number : (selectedCust?.cr_number ?? null),
        customerPhone: typeof atomicCustomer?.phone === 'string' ? atomicCustomer.phone : (selectedCust?.phone ?? null),
        isStandardInvoice: isB2BInvoice,
        buyerVatNumber:    isB2BInvoice ? (selectedCust?.vat_number ?? null) : null,
        cashierName:    profile?.full_name ?? user?.email?.split('@')[0] ?? 'Cashier',
        items:          (checkout.items ?? []).map(i => ({
          name:      i.name,
          nameAr:    i.name_ar,
          qty:       num(i.quantity),
          unitName: i.selling_unit_name ?? null,
          unitNameAr: i.selling_unit_name_ar ?? null,
          unitCode: i.selling_unit_code ?? null,
          baseQuantity: i.base_quantity == null ? null : num(i.base_quantity),
          baseUnitName: i.base_unit_name ?? null,
          baseUnitNameAr: i.base_unit_name_ar ?? null,
          unitPrice: num(i.unit_price),
          lineTotal: num(i.total),
          subtotal:  num(i.subtotal),
          taxAmount: num(i.tax_amount),
          taxRate: i.tax_rate == null ? undefined : num(i.tax_rate),
          taxCategory: i.tax_category ?? null,
          total:     num(i.total),
        })),
        createdAt,
        businessNameAr:  (typeof atomicSeller?.business_name_ar === 'string' ? atomicSeller.business_name_ar : null)
          || (typeof atomicSeller?.branch_name_ar === 'string' ? atomicSeller.branch_name_ar : null)
          || branch.business_name_ar || branch.name_ar || branch.display_name || branch.business_name || branch.name,
        businessNameEn:  (typeof atomicSeller?.display_name === 'string' ? atomicSeller.display_name : null)
          || (typeof atomicSeller?.business_name === 'string' ? atomicSeller.business_name : null)
          || branch.display_name || branch.business_name || branch.name,
        branchName:      typeof atomicSeller?.branch_name === 'string' ? atomicSeller.branch_name : branch.name,
        branchNameAr:    typeof atomicSeller?.branch_name_ar === 'string' ? atomicSeller.branch_name_ar : branch.name_ar,
        branchAddress:   branchAddr || null,
        branchAddressAr: branchAddrAr || null,
        documentLanguage: normalizeDocumentLanguage(checkout.document_language ?? branch.invoice_language),
        vatNumber:       typeof atomicSeller?.vat_number === 'string' ? atomicSeller.vat_number : (branch.vat_number ?? ''),
        phone:           typeof atomicSeller?.phone === 'string' ? atomicSeller.phone : branch.phone,
        website:         typeof atomicSeller?.website === 'string' ? atomicSeller.website : (branch.website ?? null),
        email:           typeof atomicSeller?.email === 'string' ? atomicSeller.email : (branch.email ?? null),
        showWebsite:     typeof atomicSeller?.show_website === 'boolean' ? atomicSeller.show_website : (branch.show_website ?? false),
        showEmail:       typeof atomicSeller?.show_email === 'boolean' ? atomicSeller.show_email : (branch.show_email ?? false),
        receiptFooter:   typeof atomicSeller?.receipt_footer === 'string' ? atomicSeller.receipt_footer : branch.receipt_footer,
        showFooter:      typeof atomicSeller?.show_footer === 'boolean' ? atomicSeller.show_footer : (branch.show_footer ?? true),
        showCashChange:  typeof atomicSeller?.show_cash_change === 'boolean' ? atomicSeller.show_cash_change : (branch.show_cash_change ?? true),
        logoUrl:         typeof atomicSeller?.logo_url === 'string' ? atomicSeller.logo_url : (branch.logo_url ?? null),
        showLogo:        typeof atomicSeller?.show_logo === 'boolean' ? atomicSeller.show_logo : (branch.show_logo ?? true),
        payments:        receiptPayments,
        displayPaymentMethod,
        customerCredit,
        zatcaQrCode:    finalQrCode ?? '',
        canPrint:       canPrintCustomerCopy,
        finalizationStatus,
        artifactStage,
        documentKind,
        finalizationError,
        sandboxGenerated: sandboxDemo,
        reportingDisplayState: atomicCheckoutResult?.reportingDisplayState
          ?? (nonFiscalDemo ? 'demo_non_fiscal' : sandboxDemo ? finalizationStatus : isB2BInvoice ? 'clearance_pending' : 'reporting_pending'),
        atomicSnapshot: Boolean(atomicCheckoutResult),
        isDemo: nonFiscalDemo,
        sandboxDemo,
      })
      upsertInvoiceListRow(branch.tenant_id, {
        isDemo: nonFiscalDemo,
        isSandboxDemo: sandboxDemo,
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
        displayZatcaStatus: sandboxDemo ? 'sandbox_not_validated' : nonFiscalDemo ? 'not_submitted' : 'pending',
        status: 'posted',
        documentType: checkout.zatca_invoice_type,
        invoiceReference: null,
        linkedCreditNoteId: null,
        linkedCreditNoteNumber: null,
        creditNoteCount: 0,
        creditStatus: 'none',
        remainingRefundableQuantity: (checkout.items ?? []).reduce((sum, item) => sum + num(item.quantity), 0),
      })
      if (canPrintCustomerCopy && !isB2BInvoice && !atomicCheckoutResult) {
        void maybeAutoPrintReceiptAfterSale(checkout.invoice_id)
      }
      cartRef.current = []
      setCart([])
      setCustomerId(null)
      setNote('')
      setCashReceived('')
      setCreditInitialPayment('')
      setCreditInitialMethod('cash')
      if (payMethod === 'credit' && customerId) {
        clearPersistentReceivableOperation(branch.id, customerId, 'credit-checkout')
      }
      creditOperationRef.current = null
      setSplitCash('')
      setSplitCard('')
      setSplitOpen(false)
      if (atomicFingerprint) {
        clearPendingAtomicCheckout(branch.id, idempotencyKey, atomicFingerprint)
      }
      checkoutKeyRef.current = null

      if (finalizationError) {
        toast.warning(t('pos:zatca.saleCompletedAttention'), {
          duration: Infinity,
          action: { label: t('pos:zatca.viewInvoice'), onClick: () => navigate(`/invoices/${checkout.invoice_id}`) },
        })
      }

      if (preOutputSubmission) {
        if (preOutputSubmission.mode === 'sandbox_validation') {
          const sandboxResult = preOutputSubmission.result
          const validated = sandboxResult.status === 'sandbox_validated'
            || sandboxResult.status === 'sandbox_validated_with_warnings'
          updateCachedInvoiceRows(branch.tenant_id, branch.id, cachedRows => cachedRows.map(row => row.id === checkout.invoice_id
            ? { ...row, displayZatcaStatus: sandboxResult.status }
            : row))
          if (sandboxResult.status === 'sandbox_validated_with_warnings') {
            toast.warning(t('pos:zatca.warning'), { duration: 5000 })
          } else if (validated) {
            toast.success(t('pos:zatca.success'), { duration: 2500 })
          } else {
            toast.error(t('pos:zatca.failed'), { duration: Infinity, action: { label: t('pos:zatca.viewInvoice'), onClick: () => navigate(`/invoices/${checkout.invoice_id}`) } })
          }
        } else {
          const result = preOutputSubmission.result
          updateCachedInvoiceRows(branch.tenant_id, branch.id, cachedRows => cachedRows.map(row => row.id === checkout.invoice_id
            ? { ...row, zatcaStatus: result.invoiceStatus, displayZatcaStatus: result.invoiceStatus }
            : row))
          if (result.ok) {
            setReceipt(prev => prev ? { ...prev, canPrint: true } : prev)
            if (isB2BInvoice) void maybeAutoPrintReceiptAfterSale(checkout.invoice_id)
            toast.success(t('pos:zatca.success'), { duration: 2500 })
          } else if (result.invoiceStatus === 'failed') {
            toast.error(t('pos:zatca.failed'), { duration: Infinity, action: { label: t('pos:zatca.viewInvoice'), onClick: () => navigate(`/invoices/${checkout.invoice_id}`) } })
          }
        }
      }
    } catch (err) {
      const safeKey = safeCheckoutErrorKey(err)
      console.warn('[POSPage charge] checkout failed', err)
      const reloadPackage = [
        'pos:packages.changed',
        'pos:packages.inactive',
        'pos:packages.sellingDisabled',
      ].includes(safeKey)
      toast.error(t(safeKey), reloadPackage
        ? {
            action: {
              label: t('pos:packages.reload'),
              onClick: () => window.location.reload(),
            },
          }
        : undefined)
    } finally {
      checkoutInFlightRef.current = false
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

  if (sessionLoadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0F2419]">
        <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-900">{t('register:loadFailed')}</h2>
          <p className="mb-6 text-sm text-gray-500">{t('register:loadFailedPrompt')}</p>
          <button
            type="button"
            onClick={() => void fetchActiveSession()}
            className="w-full rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 py-3 font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t('common:retry')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/branch')}
            className="mt-3 w-full text-sm text-gray-400 transition-colors hover:text-gray-600"
          >
            <DirectionalIcon icon={ArrowLeft} size={13} className="me-1 inline-block" />
            {t('pos:backToDashboard')}
          </button>
        </div>
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

  async function retryReceiptFinalization() {
    if (!receipt || !branch) return
    try {
      if (receipt.sandboxDemo) {
        const routed = await submitInvoiceForBranch({
          invoiceId: receipt.invoiceId,
          tenantId: branch.tenant_id,
          branchId: branch.id,
          options: {
            source: 'manual_retry',
            retryDelayMs: 1500,
            contractMode: 'legacy',
            documentKind: 'simplified',
          },
        })
        if (routed.mode !== 'sandbox_validation') {
          throw new Error('SANDBOX_SUBMISSION_ROUTE_UNAVAILABLE')
        }
        const sandboxResult = routed.result
        const validated = sandboxResult.status === 'sandbox_validated'
          || sandboxResult.status === 'sandbox_validated_with_warnings'
        const qrCode = sandboxResult.qrCode ?? ''
        setReceipt(current => current ? {
          ...current,
          zatcaQrCode: qrCode,
          canPrint: validated && Boolean(qrCode),
          finalizationStatus: sandboxResult.status ?? 'sandbox_validation_failed',
          artifactStage: validated ? 'sandbox_compliance_validated' : 'sandbox_compliance_pending',
          documentKind: 'simplified',
          finalizationError: validated && qrCode
            ? null
            : (sandboxResult.message ?? 'Sandbox compliance validation did not produce a printable QR.'),
          reportingDisplayState: sandboxResult.status ?? 'sandbox_validation_failed',
        } : current)
        if (validated && qrCode) toast.success(t('pos:zatca.success'))
        else toast.warning(t('pos:zatca.saleCompletedAttention'))
        return
      }
      const currentOutput = await getInvoiceZatcaOutputState({
        invoiceId: receipt.invoiceId,
        branchId: branch.id,
      })
      if (
        currentOutput.contractMode === 'v2'
        && currentOutput.documentKind === 'simplified'
        && currentOutput.artifactStage === 'simplified_final'
      ) {
        await retryStoredSimplifiedArtifact({
          invoiceId: receipt.invoiceId,
          branchId: branch.id,
          source: 'manual_retry',
        })
      } else {
        const capability = await requireZatcaFinalizationCapability(
          branch.id,
          receipt.isStandardInvoice ? 'standard' : 'simplified',
        )
        if (capability.checkoutMode === 'legacy') {
          const routed = await submitInvoiceForBranch({
            invoiceId: receipt.invoiceId,
            tenantId: branch.tenant_id,
            branchId: branch.id,
            options: {
              source: 'manual_retry',
              retryDelayMs: 1500,
              contractMode: 'legacy',
              documentKind: receipt.isStandardInvoice ? 'standard' : 'simplified',
            },
          })
          if (routed.mode !== 'production_submission' || !routed.result.ok) {
            throw new Error('Legacy ZATCA submission is still pending.')
          }
        } else {
          const finalized = await finalizeInvoiceForZatca({
            invoiceId: receipt.invoiceId,
            branchId: branch.id,
            options: { source: 'manual_retry' },
          })
          if (!finalized.ok) throw new Error(finalized.error ?? 'Invoice finalization is still pending.')
          if (finalized.documentKind === 'standard') {
            await submitInvoiceForBranch({
              invoiceId: receipt.invoiceId,
              tenantId: branch.tenant_id,
              branchId: branch.id,
              options: {
                source: 'manual_retry',
                retryDelayMs: 1500,
                contractMode: 'v2',
                documentKind: 'standard',
              },
            })
          }
        }
      }
      const output = await getInvoiceZatcaOutputState({ invoiceId: receipt.invoiceId, branchId: branch.id })
      const storedQrCode = selectStoredOutputStateQr(output)
      setReceipt(current => current ? {
        ...current,
        zatcaQrCode: storedQrCode ?? '',
        canPrint: Boolean(storedQrCode),
        finalizationStatus: output.finalizationStatus,
        artifactStage: output.artifactStage,
        documentKind: output.documentKind,
        finalizationError: storedQrCode ? null : (output.error ?? 'The finalized QR code is unavailable.'),
      } : current)
      if (storedQrCode) toast.success(t('pos:zatca.success'))
      else toast.warning(t('pos:zatca.saleCompletedAttention'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invoice finalization requires attention.'
      setReceipt(current => current ? { ...current, canPrint: false, finalizationError: message } : current)
      toast.warning(t('pos:zatca.saleCompletedAttention'))
    }
  }

  const canCharge = !isAccountSuspended && cart.length > 0 && !submitting &&
    (payMethod === 'split'
      ? splitReady
      : payMethod === 'credit'
        ? Boolean(customerId) && creditEligibility?.allowed === true && creditInitialValid
      : !(payMethod === 'cash' && cashReceived !== '' && cashAmt < totals.total - 0.001))

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" dir="ltr">

      {/* Modals */}
      {receipt && (
        <ReceiptView
          receipt={receipt}
          branch={branch}
          onNewSale={() => setReceipt(null)}
          onOpenPrinterSettings={() => navigate(DEVICE_PRINTER_PATH)}
          onRetryFinalization={retryReceiptFinalization}
          afterSaleAction={resolvedInvoiceSettings.afterSaleAction}
        />
      )}
      {unitChooserProduct && (
        <SellingUnitChooser
          product={unitChooserProduct}
          onClose={() => setUnitChooserProduct(null)}
          onChoose={(unit, quantity) => {
            addQuantityToCart(unitChooserProduct, quantity, unit)
            setUnitChooserProduct(null)
          }}
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
      {showQuickCustomer && profile.tenant_id && profile.branch_id && (
        <PosCustomerQuickCreateModal
          customers={customers}
          initialQuery={custSearch}
          tenantId={profile.tenant_id}
          branchId={profile.branch_id}
          onClose={() => setShowQuickCustomer(false)}
          onSelectExisting={customer => {
            setCustomerId(customer.id)
            setCustomerStatus(t('pos:customerQuick.existingSelected'))
            setShowQuickCustomer(false)
            setCustSearch('')
          }}
          onCreated={customer => {
            setCustomers(current => [...current, customer])
            setCustomerId(customer.id)
            setCustomerStatus(t('pos:customerQuick.addedSelected'))
            setShowQuickCustomer(false)
            setCustSearch('')
          }}
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
            <h1 className="truncate text-sm font-semibold text-white" title={resolveBranchDisplayName(branch, isRtl, t('pos:activeBranch'))} dir="auto">
              {resolveBranchDisplayName(branch, isRtl, t('pos:activeBranch'))}
            </h1>
            <p className="mt-0.5 text-[10px] text-white/55">{activePosMode === 'quick' ? t('pos:quickBilling') : t('pos:touchPos')}</p>
            {tenant?.is_demo && (
              <div className="mx-auto mt-1 w-fit rounded-full border border-amber-300/50 bg-amber-300/15 px-2 py-0.5 text-[9px] font-black text-amber-100">
                {t('pos:demo.badge')}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setScannerEnabled(value => !value)}
              aria-pressed={scannerEnabled}
              title={t(scannerEnabled ? 'pos:scanner.disable' : 'pos:scanner.enable')}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                scannerEnabled
                  ? 'border-sky-400/30 bg-sky-500/20 text-sky-200'
                  : 'border-white/15 bg-white/10 text-white/50'
              }`}
            >
              <ScanLine size={15} />
              <span className={`absolute end-1 top-1 h-1.5 w-1.5 rounded-full ${
                scannerStatus === 'accepted' ? 'bg-emerald-400'
                  : scannerStatus === 'unknown' || scannerStatus === 'error' ? 'bg-red-400'
                    : scannerStatus === 'looking' ? 'bg-amber-300' : 'bg-white/40'
              }`} />
            </button>
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
          <span className="ms-auto hidden text-[10px] font-medium text-emerald-700 sm:inline">
            {t(scannerEnabled ? 'pos:scanner.ready' : 'pos:scanner.unavailable')}
          </span>
        </div>

        {/* Search + category tabs */}
        <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex flex-col gap-2.5 flex-shrink-0 sm:flex-row sm:items-center">
          {activePosMode === 'quick' ? (
            <div className="contents">
              <div className="relative min-w-0 flex-1 sm:min-w-[280px] sm:max-w-xl">
                <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={handleCommandBarKeyDown}
                  placeholder={t('pos:searchProducts')}
                  aria-label={t('pos:searchProducts')}
                  aria-describedby="pos-scanner-status"
                  autoComplete="off"
                  className="input ps-8 pe-14 py-2 text-sm"
                />
                <ScanLine size={14} aria-hidden="true" className="absolute end-3 top-1/2 -translate-y-1/2 text-sky-500" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label={t('pos:clearProductSearch')} className="absolute end-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
                <span id="pos-scanner-status" className="sr-only" aria-live="polite" aria-atomic="true">{scannerMessage || t(scannerEnabled ? 'pos:scanner.ready' : 'pos:scanner.unavailable')}</span>
              </div>
              <div className="flex w-full min-w-0 items-center gap-1.5 overflow-x-auto sm:flex-1">
                <button type="button" onClick={() => setActiveCat(null)} className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium ${!activeCat ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{t('pos:allProducts')}</button>
                {categories.map(category => (
                  <button key={category.id} type="button" onClick={() => setActiveCat(activeCat === category.id ? null : category.id)} className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium ${activeCat === category.id ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600'}`} dir="auto">{localizedName(category.name, category.nameAr, isRtl)}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="relative w-full flex-shrink-0 sm:w-72 lg:w-96">
                <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={handleCommandBarKeyDown}
                  placeholder={t('pos:searchProducts')}
                  aria-label={t('pos:searchProducts')}
                  aria-describedby="pos-scanner-status"
                  autoComplete="off"
                  className="input ps-8 pe-14 py-2 text-sm"
                />
                <ScanLine size={14} aria-hidden="true" className="absolute end-3 top-1/2 -translate-y-1/2 text-sky-500" />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label={t('pos:clearProductSearch')}
                    className="absolute end-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={13} />
                  </button>
                )}
                <span id="pos-scanner-status" className="sr-only" aria-live="polite" aria-atomic="true">{scannerMessage || t(scannerEnabled ? 'pos:scanner.ready' : 'pos:scanner.unavailable')}</span>
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
              stockVisible={stockVisible}
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
                        cartQty={singleUnitCartQuantity(cart, p.id)}
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
            <button onClick={() => { cartRef.current = []; setCart([]) }}
              className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors">
              <X size={11} /> {t('pos:clearCart')}
            </button>
          )}
        </div>

        {/* Customer selector */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0 relative z-20">
          <button
            type="button"
            onClick={() => { setCustOpen(o => !o); setCustSearch(''); setCustomerActiveIndex(0) }}
            aria-haspopup="listbox"
            aria-expanded={custOpen}
            aria-controls="pos-customer-listbox"
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
                <input
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="pos-customer-listbox"
                  aria-activedescendant={filteredCusts[customerActiveIndex] ? `pos-customer-${filteredCusts[customerActiveIndex].id}` : undefined}
                  aria-label={t('pos:customerQuick.search')}
                  value={custSearch}
                  onChange={event => { setCustSearch(event.target.value); setCustomerActiveIndex(0) }}
                  onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (filteredCusts.length > 0) setCustomerActiveIndex(index => Math.min(filteredCusts.length - 1, index + 1))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setCustomerActiveIndex(index => Math.max(0, index - 1))
                    } else if (event.key === 'Enter' && filteredCusts[customerActiveIndex]) {
                      event.preventDefault()
                      setCustomerId(filteredCusts[customerActiveIndex].id)
                      setCustOpen(false)
                      setCustomerStatus(t('pos:customerQuick.existingSelected'))
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setCustOpen(false)
                    }
                  }}
                  placeholder={t('pos:customerQuick.search')}
                  className="input text-xs py-1.5"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div id="pos-customer-listbox" role="listbox" aria-label={t('pos:customerQuick.results')} className="max-h-60 overflow-y-auto">
                <button
                  type="button"
                  role="option"
                  aria-selected={!customerId}
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
                    id={`pos-customer-${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={customerId === c.id}
                    onClick={() => { setCustomerId(c.id); setCustOpen(false); setCustomerStatus(t('pos:customerQuick.existingSelected')) }}
                    className={`w-full px-3 py-2.5 text-start text-xs flex items-center gap-2 hover:bg-gray-50 ${
                      customerId === c.id ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-medium" dir="auto">{customerDisplayName(c)}</p>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">
                          {t(c.customer_type === 'business' ? 'customers:businessB2b' : 'customers:individual')}
                        </span>
                      </div>
                      {c.phone && (
                        <p className="mt-0.5 text-gray-500 text-[10px]">
                          <bdi dir="ltr">{c.phone}</bdi>
                          {exactCustomerMobile.length === 10 && normalizeSaudiMobile(c.phone) === exactCustomerMobile && (
                            <span className="ms-1.5 font-semibold text-emerald-700">{t('pos:customerQuick.exactMobile')}</span>
                          )}
                        </p>
                      )}
                      {c.customer_type === 'business' && c.vat_number && (
                        <p className="text-gray-400 text-[10px]"><bdi dir="ltr">{t('customers:fields.vatNumber')}: {c.vat_number}</bdi></p>
                      )}
                    </div>
                    {customerId === c.id && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
                {filteredCusts.length === 0 && custSearch && (
                  <div className="px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">{t('pos:customerQuick.noneFound')}</p>
                    <button type="button" onClick={() => { setCustOpen(false); setShowQuickCustomer(true) }}
                      className="mt-2 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white focus-visible:ring-2 focus-visible:ring-primary-500">
                      {/^05\d{8}$/.test(exactCustomerMobile)
                        ? t('pos:customerQuick.addWithMobile', { mobile: exactCustomerMobile })
                        : t('pos:customerQuick.addNew')}
                    </button>
                  </div>
                )}
                {filteredCusts.length > 0 && (
                  <button type="button" onClick={() => { setCustOpen(false); setShowQuickCustomer(true) }}
                    className="w-full border-t border-gray-100 px-3 py-2.5 text-start text-xs font-semibold text-primary-700 hover:bg-primary-50">
                    <Plus size={12} className="me-1 inline" aria-hidden="true" />{t('pos:customerQuick.addNew')}
                  </button>
                )}
              </div>
            </div>
          )}
          <span className="sr-only" role="status" aria-live="polite">{customerStatus}</span>
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
                <div key={item.cartLineId} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                  <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: `${color}20` }}>
                    <ShoppingBag size={12} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate" dir="auto">{localizedName(item.name, item.nameAr, isRtl)}</p>
                    <p className="text-[10px] font-medium text-gray-500" dir="auto">
                      {localizedName(item.unitName, item.unitNameAr, isRtl)}
                      {item.conversionToBase !== 1 && (
                        <span className="ms-1 text-gray-400">
                          · {t('pos:packages.baseEquivalent', {
                            quantity: formatPackageQuantity(item.quantity * item.conversionToBase),
                            unit: localizedName(item.baseUnitName, item.baseUnitNameAr, isRtl),
                          })}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400 tabular-nums" dir="ltr">
                      {fmt(item.price)} × {formatPackageQuantity(item.quantity, item.quantityScale)} = <span className="text-gray-700 font-semibold"><Rial amount={line} /></span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" dir="ltr">
                    <button onClick={() => adjustQty(item.cartLineId, -1)}
                      aria-label={item.quantity <= 1
                        ? t('pos:removeItem', { name: localizedName(item.name, item.nameAr, isRtl) })
                        : t('pos:decreaseQuantity', { name: localizedName(item.name, item.nameAr, isRtl) })}
                      className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors">
                      {item.quantity <= 1
                        ? <Trash2 size={10} className="text-red-400" />
                        : <Minus size={10} className="text-gray-500" />
                      }
                    </button>
                    <span className="min-w-5 text-center text-xs font-bold tabular-nums text-gray-900">{formatPackageQuantity(item.quantity, item.quantityScale)}</span>
                    <button onClick={() => adjustQty(item.cartLineId, 1)}
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
          <div className={`grid gap-2 ${splitPaymentsEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {(['cash', 'card'] as const).map(m => (
              <button key={m} onClick={() => { setPayMethod(m); setSplitOpen(false) }}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
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
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
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

          {selectedCustomerIsBusiness && (
            creditEligibilityLoading ? (
              <div className="h-10 animate-pulse rounded-xl border border-gray-100 bg-gray-50" aria-label={t('payments:creditChecking')} />
            ) : creditEligibility?.allowed ? (
              <button
                type="button"
                onClick={() => { setPayMethod('credit'); setSplitOpen(false) }}
                title={t('payments:sellOnCreditTooltip')}
                aria-label={t('payments:sellOnCreditTooltip')}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                  payMethod === 'credit'
                    ? 'border-primary-700 bg-primary-700 text-white shadow-sm'
                    : 'border-primary-200 bg-primary-50 text-primary-800 hover:border-primary-300 hover:bg-primary-100'
                }`}
              >
                <span className="flex items-center gap-1.5"><Landmark size={13} /> {t('payments:sellOnCredit')}</span>
              </button>
              ) : creditEligibility ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <span className="min-w-0"><span className="font-semibold text-gray-700">{t('payments:creditUnavailable')}</span> · {t(`payments:${creditEligibilityMessageKey(creditEligibility.reasonCode)}`)}</span>
                {creditEligibility.reasonCode === 'BRANCH_CREDIT_DISABLED' && customerId && (
                  <button type="button" onClick={() => navigate(creditEligibilitySettingsPath(creditEligibility.reasonCode, customerId, branch?.id ?? ''))} className="flex-shrink-0 font-semibold text-primary-700 hover:text-primary-900">
                    {t('payments:creditSettings')}
                  </button>
                )}
              </div>
            ) : null
          )}

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

          {payMethod === 'credit' && cart.length > 0 && (
            <div className="rounded-xl border border-primary-100 bg-primary-50/70 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-primary-950">{t('payments:creditCheckout')}</p>
                <span className="text-[10px] font-medium text-primary-800" dir="ltr">{t('payments:creditInvoiceTotal', { amount: totals.total.toFixed(2) })}</span>
              </div>
              <label className="block text-[10px] font-medium text-primary-900" htmlFor="credit-initial-payment">
                {t('payments:creditInitialPayment')}
                <span className="ms-1 font-normal text-primary-700">{t('payments:creditExplicitZero')}</span>
              </label>
              <div className={`grid gap-2 ${creditInitialNumeric > 0 ? 'grid-cols-[1fr_116px]' : 'grid-cols-1'}`}>
                <div className="relative">
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-xs text-primary-700" dir="ltr">SAR</span>
                  <MoneyInput id="credit-initial-payment" value={creditInitialPayment} onValueChange={setCreditInitialPayment} placeholder="0.00" className="input border-primary-200 bg-white ps-10 py-1.5 text-sm tabular-nums" />
                </div>
                {creditInitialNumeric > 0 && <select value={creditInitialMethod} onChange={event => setCreditInitialMethod(event.target.value as 'cash' | 'card')} className="rounded-lg border border-primary-200 bg-white px-2 text-xs font-medium text-slate-700">
                  <option value="cash">{t('payments:cash')}</option><option value="card">{t('payments:card')}</option>
                </select>}
              </div>
              <div className="flex items-center justify-between text-[10px] text-primary-900">
                <span>{t('payments:creditOutstandingLabel')}</span>
                <span className="font-semibold tabular-nums" dir="ltr">SAR {creditOutstandingAmount.toFixed(2)}</span>
              </div>
              {creditInitialPayment !== '' && !creditInitialWithinInvoice && <p className="text-[10px] text-red-600">{t('payments:creditInitialInvalid')}</p>}
              {creditInitialWithinInvoice && !creditHasOutstanding && <p className="text-[10px] text-gray-600">{t('payments:creditFullPaymentUseTender')}</p>}
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
                  {payMethod === 'cash' ? <Banknote size={16} /> : payMethod === 'credit' ? <Landmark size={16} /> : <CreditCard size={16} />}
                  {t('pos:charge')} — <span dir="ltr"><Rial amount={totals.total} /></span>
                </>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
