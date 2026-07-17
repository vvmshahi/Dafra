import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { displayName as dn } from '@/lib/utils/display'
import { buildZatcaQR } from '@/lib/zatca/qr'
import { saudiDateStr, toSaudiTime } from '@/lib/utils/date'
import { formatSaudiSessionDateTime } from '@/lib/registerSessions'
import { isPermanentDemoSandboxBranch, submitInvoiceForBranch } from '@/lib/zatca/submission'
import { toast } from 'sonner'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import type { Branch, BranchPosMode, PaymentMethod, VatTreatment } from '@/types/database'
import { usePosSession } from '@/hooks/usePosSession'
import type { ClosedSessionSummary, PosSession } from '@/hooks/usePosSession'
import { useSubscription } from '@/hooks/useSubscription'
import { MeemLogo } from '@/components/MeemLogo'
import { getPrinterSettings, isElectron, printA4Invoice, printReceipt } from '@/lib/electron'
import { openReceiptPreview, printReceiptInHiddenFrame } from '@/lib/receiptPrint'
import { supportConfig } from '@/config/support'
import { resolveBusinessType } from '@/lib/utils/businessType'

const ACCOUNT_SUSPENDED_BILLING_MESSAGE =
  'Account suspended. New billing and register opening are disabled. Existing records remain available. Please contact the business owner or Kubri support.'

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
  catColor: string | null
}

interface PosCategory {
  id: string
  name: string
  color: string | null
  icon: string | null
}

interface PosCustomer {
  id: string
  name: string
  phone: string | null
  customer_type: string
  vat_number: string | null
  business_name: string | null
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
  invoiceNumber: string
  invoiceId: string
  total: number
  taxAmount: number
  subtotal: number
  paymentMethod: PaymentMethod
  change: number
  cashReceived: number
  customerName: string
  customerPhone: string | null
  isStandardInvoice: boolean
  buyerVatNumber: string | null
  cashierName: string
  items: ThermalItem[]
  createdAt: string
  businessNameAr: string
  businessNameEn: string
  branchName: string
  branchAddress: string | null
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
  if (treatment === 'exempt') return 'exempt'
  if (treatment === 'inherit') return branchMode
  return treatment
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

function printFailureMessage(errorType?: string | null, message?: string | null) {
  if (message) return message
  if (errorType === 'NO_PRINTER_CONFIGURED') return 'Choose a receipt printer to enable direct printing.'
  if (errorType === 'PRINTER_NOT_FOUND') return 'Selected printer was not found on this device.'
  if (errorType) return errorType
  return 'Receipt print failed.'
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

function createCheckoutIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function safeCheckoutErrorMessage(err: unknown): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message ?? '')
    : ''

  if (/account is suspended|new billing is disabled|suspended/i.test(message)) {
    return ACCOUNT_SUSPENDED_BILLING_MESSAGE
  }
  if (/amount paid is less|underpaid/i.test(message)) {
    return 'Amount received is less than invoice total.'
  }
  if (/split payment.*not enabled/i.test(message)) {
    return 'Split Payment is not enabled for this branch.'
  }
  if (/split payment.*equal|split payment.*balanced/i.test(message)) {
    return 'Split Payment amounts must equal the invoice total.'
  }
  if (/split payment.*greater than zero|requires both cash and card/i.test(message)) {
    return 'Split Payment needs both cash and card amounts.'
  }
  if (/insufficient stock/i.test(message)) {
    return 'Insufficient stock for one or more items.'
  }
  if (/not available/i.test(message)) {
    return 'One or more items are no longer available.'
  }
  if (/forbidden|unauthorized|not found|inactive/i.test(message)) {
    return 'Checkout is not allowed for this branch.'
  }
  return 'Checkout failed. Please review the cart and try again.'
}

function registerSessionErrorMessage(err: unknown): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message ?? '')
    : ''

  if (/account is suspended|new register sessions cannot be opened|suspended/i.test(message)) {
    return 'Account is suspended. New register sessions cannot be opened.'
  }
  if (/already open/i.test(message)) {
    return 'Register is already open for this branch.'
  }
  if (/forbidden|unauthorized|not found|inactive/i.test(message)) {
    return 'Register cannot be opened for this branch.'
  }
  return message || 'Register could not be opened. Please try again.'
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
  const [amount, setAmount] = useState('')
  const [desc,   setDesc]   = useState('')
  const [vendor, setVendor] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const amt = parseFloat(amount)
    if (!amt || !desc.trim()) return
    const totalPaid = Number(amt.toFixed(2))
    setSaving(true)
    try {
      const q = supabase as unknown as { from: (t: string) => any }
      await q.from('expenses').insert({
        tenant_id:      tenantId,
        branch_id:      branchId,
        added_by:       userId,
        expense_date:   saudiDateStr(),
        description:    desc.trim(),
        vendor_name:    vendor.trim() || null,
        amount:         totalPaid,
        vat_treatment:  'no_vat',
        vat_claim_status: 'not_claimable',
        expense_before_vat: totalPaid,
        vat_amount:     0,
        total_paid:     totalPaid,
        payment_method: 'cash',
        session_id:     sessionId ?? null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Quick cash expense</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              VAT is not claimed here. Add VAT invoices from Expenses.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="label">Amount paid (SAR)</label>
            <input type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} className="input" placeholder="0.00" autoFocus />
          </div>
          <div>
            <label className="label">Description</label>
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
              className="input" placeholder="What was this expense for?" />
          </div>
          <div>
            <label className="label">Vendor (optional)</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
              className="input" placeholder="Vendor name" />
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
            This is recorded as a cash expense with no input VAT claim.
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !amount || !desc.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Receipt overlay ───────────────────────────────────────────────────────────

function ReceiptView({ receipt, onNewSale, onOpenPrinterSettings, printMode, zatcaStatus }: {
  receipt: ReceiptData
  onNewSale: () => void
  onOpenPrinterSettings: () => void
  printMode: 'thermal' | 'pdf' | 'both'
  zatcaStatus: 'submitted' | 'pending' | 'failed' | 'sandbox_pending' | 'sandbox_validated' | 'sandbox_failed' | null
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    async function genQR() {
      try {
        const payload = buildZatcaQR({
          sellerName:  receipt.businessNameAr || receipt.businessNameEn,
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
    const date = new Date(receipt.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const m = (n: number) => `SAR ${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const lines = receipt.items.map(i => `${i.name} × ${i.qty}  ${m(i.lineTotal)}`).join('\n')
    const msg = `فاتورتك من ${receipt.businessNameAr || receipt.businessNameEn}
━━━━━━━━━━━━━━━
رقم الفاتورة: ${receipt.invoiceNumber}
التاريخ: ${date}
━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━
المجموع: ${m(receipt.subtotal)}
الضريبة: ${m(receipt.taxAmount)}
الإجمالي: ${m(receipt.total)}
━━━━━━━━━━━━━━━
شكراً لزيارتكم 🌿`
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const invDate = new Date(receipt.createdAt).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric',
  })
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
      toast.error(result.message || result.errorType || 'A4 print failed.')
    }
    s.remove()
  }

  async function openReceiptPrintPage() {
    if (printingReceipt) return
    setPrintError(null)

    setPrintingReceipt(true)
    try {
      if (!isElectron()) {
        await printReceiptInHiddenFrame(receipt.invoiceId)
        return
      }

      const settings = await getPrinterSettings()
      if (!settings.receiptPrinterName) {
        const message = 'Choose a receipt printer to enable direct printing.'
        setPrintError(message)
        toast.info(message, {
          action: { label: 'Device Printer', onClick: onOpenPrinterSettings },
        })
        return
      }

      const result = await printReceipt({ invoiceId: receipt.invoiceId })
      if (result.success) {
        toast.success('Receipt sent to printer', { duration: 1800 })
        return
      }

      const message = printFailureMessage(result.errorType, result.message)
      setPrintError(message)
      toast.error(message)
      if (settings.fallbackToPreview) await printReceiptInHiddenFrame(receipt.invoiceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Receipt print failed.'
      setPrintError(message)
      toast.error(message)
    } finally {
      setPrintingReceipt(false)
    }
  }

  return (
    <>
      {/* A4 invoice — hidden, shown only via printPosA4() print style */}
      <div id="pos-pdf-printable" style={{ display: 'none', fontFamily: '"Segoe UI", Arial, sans-serif', fontSize: '12px', color: '#111', lineHeight: '1.5', background: 'white' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '20px', borderBottom: '2px solid #e5e7eb', marginBottom: '20px' }}>
          <div>
            {receipt.showLogo && receipt.logoUrl && (
              <img src={receipt.logoUrl} alt="logo" style={{ maxHeight: '60px', maxWidth: '160px', objectFit: 'contain', display: 'block', marginBottom: '10px' }} />
            )}
            <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'Cairo, "Segoe UI", sans-serif' }}>{receipt.businessNameAr}</div>
            {receipt.businessNameEn !== receipt.businessNameAr && (
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{receipt.businessNameEn}</div>
            )}
            {receipt.branchAddress && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>{receipt.branchAddress}</div>}
            <div style={{ fontSize: '11px', color: '#374151', marginTop: '6px' }}>VAT: {receipt.vatNumber}</div>
            {receipt.showWebsite && receipt.website && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{receipt.website}</div>}
            {receipt.showEmail && receipt.email && <div style={{ fontSize: '11px', color: '#6b7280' }}>{receipt.email}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'Cairo, "Segoe UI", sans-serif', fontSize: '18px', fontWeight: 'bold', color: '#0F2419', direction: 'rtl' }}>فاتورة ضريبية مبسطة</div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '14px' }}>Simplified Tax Invoice</div>
            <div style={{ fontSize: '12px', marginBottom: '3px' }}>Invoice #: <strong>{receipt.invoiceNumber}</strong></div>
            <div style={{ fontSize: '12px', marginBottom: '3px' }}>Date: {invDate}</div>
            <div style={{ fontSize: '12px' }}>Time: {invTime}</div>
          </div>
        </div>
        {/* Customer */}
        <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Bill To</div>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>{receipt.customerName}</div>
        </div>
        {/* Items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 4px', fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase' }}>Item</th>
              <th style={{ textAlign: 'right', padding: '8px 4px', fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', width: '50px' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '8px 4px', fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', width: '100px' }}>Unit Price</th>
              <th style={{ textAlign: 'right', padding: '8px 4px', fontSize: '10px', fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', width: '100px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 4px', fontSize: '13px', color: '#111827' }}>{item.name}</td>
                <td style={{ textAlign: 'right', padding: '10px 4px', fontSize: '12px', color: '#6b7280' }}>{item.qty}</td>
                <td style={{ textAlign: 'right', padding: '10px 4px', fontSize: '12px', color: '#374151' }}><Rial amount={item.unitPrice} /></td>
                <td style={{ textAlign: 'right', padding: '10px 4px', fontSize: '13px', fontWeight: '600', color: '#111827' }}><Rial amount={item.lineTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
          <div style={{ width: '240px', background: '#f9fafb', borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>
              <span>Subtotal</span><span><Rial amount={receipt.subtotal} /></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600', color: '#b45309', background: '#fffbeb', padding: '4px 6px', borderRadius: '4px', marginBottom: '6px' }}>
              <span>VAT (15%)</span><span><Rial amount={receipt.taxAmount} /></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 'bold', color: '#111827', borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '4px' }}>
              <span>Total</span><span><Rial amount={receipt.total} /></span>
            </div>
          </div>
        </div>
        {/* Payment */}
        <div style={{ fontSize: '12px', color: '#374151', marginBottom: '20px', padding: '10px 14px', background: '#f9fafb', borderRadius: '8px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <span><strong>Payment:</strong> {paymentMethodLabel(isSplitPayment ? 'split' : receipt.paymentMethod)}</span>
          {isSplitPayment && cashPayment && (
            <span><strong>Cash:</strong> <Rial amount={cashPayment.amount} /></span>
          )}
          {isSplitPayment && cardPayment && (
            <span><strong>Card:</strong> <Rial amount={cardPayment.amount} /></span>
          )}
          {isSplitPayment && (
            <span><strong>Total paid:</strong> <Rial amount={paymentRowsTotal(receipt.payments)} /></span>
          )}
          {!isSplitPayment && receipt.paymentMethod === 'cash' && receipt.cashReceived > 0 && (
            <span><strong>Received:</strong> <Rial amount={receipt.cashReceived} /></span>
          )}
          {!isSplitPayment && receipt.showCashChange && receipt.paymentMethod === 'cash' && receipt.change > 0.005 && (
            <span><strong>Change:</strong> <Rial amount={receipt.change} /></span>
          )}
        </div>
        {/* QR + footer */}
        <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: '16px', display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
          {qrDataUrl && (
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <img src={qrDataUrl} alt="ZATCA QR" style={{ width: '100px', height: '100px', display: 'block' }} />
              <div style={{ fontSize: '9px', color: '#d1d5db', marginTop: '4px' }}>Scan to verify invoice</div>
            </div>
          )}
          <div style={{ fontSize: '9px', color: '#9ca3af' }}>
            {receipt.showFooter && receipt.receiptFooter ? (
              <div style={{ marginBottom: '4px', color: '#4b5563', fontWeight: 600 }}>{receipt.receiptFooter}</div>
            ) : null}
            <div style={{ color: '#d1d5db' }}>This is a computer-generated invoice.</div>
          </div>
        </div>
      </div>

      {/* Hidden thermal receipt — rendered for print only */}
      <ThermalReceipt
        businessNameAr={receipt.businessNameAr}
        businessNameEn={receipt.businessNameEn}
        logoUrl={receipt.logoUrl}
        showLogo={receipt.showLogo}
        branchName={null}
        address={receipt.branchAddress}
        vatNumber={receipt.vatNumber}
        phone={receipt.phone}
        website={receipt.website}
        showWebsite={receipt.showWebsite}
        email={receipt.email}
        showEmail={receipt.showEmail}
        invoiceNumber={receipt.invoiceNumber}
        date={invDate}
        time={invTime}
        cashierName={receipt.cashierName}
        items={receipt.items}
        subtotal={receipt.subtotal}
        taxAmount={receipt.taxAmount}
        total={receipt.total}
        paymentMethod={isSplitPayment ? 'split' : receipt.paymentMethod}
        payments={receipt.payments}
        cashReceived={receipt.cashReceived}
        change={receipt.change}
        showCashChange={receipt.showCashChange}
        customerName={receipt.customerName}
        buyerVatNumber={receipt.buyerVatNumber}
        isStandardInvoice={receipt.isStandardInvoice}
        qrDataUrl={qrDataUrl}
        receiptFooter={receipt.receiptFooter}
        showFooter={receipt.showFooter}
      />

      {/* Success overlay */}
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0F2419]/90">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

          {/* Banner */}
          <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 px-6 py-8 text-center text-white">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check size={32} strokeWidth={3} />
            </div>
            <p className="text-2xl font-bold">Payment Received!</p>
            <p className="text-emerald-100 text-sm mt-1">{receipt.invoiceNumber}</p>
          </div>

          {/* Summary */}
          <div className="p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium text-gray-800">{receipt.customerName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Method</span>
              <span className="font-medium text-gray-800">{paymentMethodLabel(receipt.paymentMethod)}</span>
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Net Amount</span>
                <span className="tabular-nums"><Rial amount={receipt.subtotal} /></span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>VAT (15%)</span>
                <span className="tabular-nums"><Rial amount={receipt.taxAmount} /></span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-lg pt-1.5 border-t border-gray-100">
                <span>Total</span>
                <span className="tabular-nums text-emerald-600"><Rial amount={receipt.total} /></span>
              </div>
            </div>
            {receipt.paymentMethod === 'cash' && receipt.change > 0.005 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex justify-between">
                <span className="text-sm font-semibold text-amber-700">Change Due</span>
                <span className="text-lg font-bold text-amber-700 tabular-nums"><Rial amount={receipt.change} /></span>
              </div>
            )}

            {/* QR code */}
            <div className="flex justify-center pt-1">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="ZATCA QR" className="w-24 h-24 rounded-xl border border-gray-100 p-1" />
              ) : (
                <div className="w-24 h-24 bg-gray-100 rounded-xl flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-gray-300" />
                </div>
              )}
            </div>
            <p className="text-center text-[10px] text-gray-300">ZATCA QR Code</p>
          </div>

          {/* ZATCA status */}
          {zatcaStatus === 'submitted' && (
            <div className="mx-6 mb-2 flex items-center gap-1.5 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
              <span className="text-emerald-500">✓</span> Submitted to ZATCA
            </div>
          )}
          {zatcaStatus === 'pending' && (
            <div className="mx-6 mb-2 flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
              <span>⚠</span> ZATCA submission pending — retry from Invoices if needed
            </div>
          )}
          {zatcaStatus === 'failed' && (
            <div className="mx-6 mb-2 flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
              <span>⚠</span> ZATCA submission failed — retry from Invoices
            </div>
          )}
          {zatcaStatus === 'sandbox_pending' && (
            <div className="mx-6 mb-2 flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-[10px] text-gray-600">
              <Loader2 size={11} className="animate-spin" /> Submission pending…
            </div>
          )}
          {zatcaStatus === 'sandbox_validated' && (
            <div className="mx-6 mb-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-700">
              <p className="font-bold">ZATCA submission successful</p>
              <p className="mt-0.5">Successfully processed by ZATCA</p>
            </div>
          )}
          {zatcaStatus === 'sandbox_failed' && (
            <div className="mx-6 mb-2 flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[10px] text-red-700">
              <span>⚠</span> ZATCA Sandbox validation failed
            </div>
          )}
          {(zatcaStatus === 'sandbox_pending' || zatcaStatus === 'sandbox_validated' || zatcaStatus === 'sandbox_failed') && (
            <p className="mx-6 mb-3 text-center text-[9px] text-gray-300">
              Demo environment — no production tax submission was made.
            </p>
          )}

          {printError && (
            <div className="mx-6 mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-700">{printError}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void openReceiptPrintPage()}
                  disabled={printingReceipt}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-700 shadow-sm hover:bg-red-100"
                >
                  {printingReceipt ? 'Printing...' : 'Retry'}
                </button>
                <button
                  type="button"
                  onClick={onOpenPrinterSettings}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Choose Printer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!openReceiptPreview(receipt.invoiceId, false)) {
                      toast.error('Could not open print preview. Check popup permissions.')
                    }
                  }}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Open Print Preview
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
                  {printingReceipt ? 'Printing...' : 'Print Receipt'}
                </button>
              )}
              {printMode === 'pdf' || printMode === 'both' ? (
                <button
                  onClick={printPosA4}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Printer size={14} />
                  Print Invoice
                </button>
              ) : null}
              {receipt.customerPhone && (
                <button
                  onClick={shareWhatsApp}
                  className="flex-1 py-2.5 bg-[#25D366] text-white text-sm font-semibold rounded-xl hover:bg-[#22c55e] transition-colors flex items-center justify-center gap-1.5"
                >
                  <WhatsAppIcon size={14} />
                  WhatsApp
                </button>
              )}
            </div>
            <button onClick={onNewSale}
              className="w-full py-3 bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity">
              New Sale
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
  const color = product.catColor ?? '#10b981'
  const imageUrl = product.imageUrl?.trim() || null
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  return (
    <button onClick={onAdd}
      className="bg-white border border-gray-100 rounded-2xl p-3 text-left hover:border-primary-300 hover:shadow-md transition-all relative">
      {cartQty > 0 && (
        <span className="absolute top-2 right-2 w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center z-10">
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
      <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2">{dn(product.name, product.nameAr)}</p>
      <p className="text-sm font-bold text-primary-600 mt-1"><Rial amount={product.price} /></p>
      {product.catName && (
        <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1"
          style={{ backgroundColor: `${color}20`, color }}>
          {product.catName}
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
  cart,
  query,
  onAdd,
}: {
  products: PosProduct[]
  cart: CartItem[]
  query: string
  onAdd: (product: PosProduct) => void
}) {
  if (products.length === 0) {
    const hasQuery = query.trim().length > 0
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
          <PackageOpen size={30} className="text-gray-300" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-gray-700 text-sm">
            {hasQuery ? 'No matching products found.' : 'Search by product name, SKU or barcode to add an item.'}
          </p>
          {hasQuery && query.trim().length < 2 ? (
            <p className="text-xs text-gray-400 max-w-[240px]">
              Type at least 2 characters, or scan an exact SKU or barcode.
            </p>
          ) : hasQuery ? (
            <p className="text-xs text-gray-400 max-w-[240px]">
              Try another product name, SKU or barcode.
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="hidden lg:grid grid-cols-[minmax(220px,1.7fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_120px_110px_92px] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase text-gray-400">
        <span>Product</span>
        <span>Category</span>
        <span>SKU / Barcode</span>
        <span>Available stock</span>
        <span className="text-right">Price</span>
        <span className="text-right">Add</span>
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
                  {dn(product.name, product.nameAr)}
                </p>
                {cartQty > 0 && (
                  <span className="mt-1 inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                    In cart: {cartQty}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                {product.catName ? (
                  <span className="inline-flex max-w-full rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 truncate">
                    {product.catName}
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Uncategorized</span>
                )}
              </div>

              <div className="min-w-0 text-xs text-gray-500">
                {codeParts.length > 0 ? (
                  <div className="space-y-0.5">
                    {product.sku && <p className="truncate">SKU: {product.sku}</p>}
                    {product.barcode && <p className="truncate">Barcode: {product.barcode}</p>}
                  </div>
                ) : (
                  <span className="text-gray-300">No SKU or barcode</span>
                )}
              </div>

              <div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  product.trackStock
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {product.trackStock ? `Stock: ${formatStockQuantity(product.stockQuantity)}` : 'Not tracked'}
                </span>
              </div>

              <div className="text-left lg:text-right">
                <span className="text-sm font-bold tabular-nums text-primary-700">
                  <Rial amount={product.price} />
                </span>
              </div>

              <button
                type="button"
                onClick={() => onAdd(product)}
                className="h-9 rounded-xl bg-[#1B6B3A] text-white text-xs font-bold hover:bg-[#155830] transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus size={13} />
                Add
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
              title="Back to Dashboard"
            >
              <X size={14} />
            </button>
          )}
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ShoppingBag size={22} />
          </div>
          <h3 className="font-bold text-lg">Open Register</h3>
          <p className="text-white/70 text-xs mt-1">Start a new Register Session</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Opening Cash (optional)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">SAR</span>
              <input
                type="number" min="0" step="0.01" value={cash}
                onChange={e => setCash(e.target.value)}
                className="input pl-10" placeholder="0.00" autoFocus
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Enter the cash amount currently in the register</p>
          </div>
        </div>
        <div className="px-5 pb-5 space-y-2">
          <div className="flex gap-2">
            <button onClick={handleSkip} disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              Open with 0
            </button>
            <button onClick={handleOpen} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Open Register'}
            </button>
          </div>
          {onBack && (
            <button onClick={onBack} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">
              ← Back to Dashboard
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
  const [cashActual,    setCashActual]    = useState('')
  const [notes,         setNotes]         = useState('')
  const [saving,        setSaving]        = useState(false)
  const [loadingData,   setLoadingData]   = useState(true)
  const [invoiceCount,  setInvoiceCount]  = useState(0)
  const [grossSessionSales, setGrossSessionSales] = useState(0)
  const [sessionCreditNotes, setSessionCreditNotes] = useState(0)
  const [totalSessionSales, setTotalSessionSales] = useState(0)
  const [cashSales,     setCashSales]     = useState(0)
  const [cardSales,     setCardSales]     = useState(0)
  const [creditRefunds, setCreditRefunds] = useState(0)
  const [totalExpenses, setTotalExpenses] = useState(0)
  const [cashExpenses,  setCashExpenses]  = useState(0)
  const [cashSalesOk,   setCashSalesOk]   = useState(false)
  const [cardSalesOk,   setCardSalesOk]   = useState(false)
  const [expensesOk,    setExpensesOk]    = useState(false)
  const [creditRefundsOk, setCreditRefundsOk] = useState(false)

  const openedAt = formatSaudiSessionDateTime(session.opened_at)
  const durationMs = Date.now() - new Date(session.opened_at).getTime()
  const durationH  = Math.floor(durationMs / 3_600_000)
  const durationM  = Math.floor((durationMs % 3_600_000) / 60_000)
  const duration   = durationH > 0 ? `${durationH}h ${durationM}m` : `${durationM}m`
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
      setGrossSessionSales(invoices
        .filter((invoice: any) => invoiceAccountingSign(invoice) > 0)
        .reduce((s: number, invoice: any) => s + Number(invoice.total_amount ?? 0), 0))
      setSessionCreditNotes(invoices
        .filter((invoice: any) => invoiceAccountingSign(invoice) < 0)
        .reduce((s: number, invoice: any) => s + Math.abs(Number(invoice.total_amount ?? 0)), 0))
      setTotalSessionSales(invoices
        .reduce((s: number, invoice: any) => s + invoiceAccountingSign(invoice) * Number(invoice.total_amount ?? 0), 0))
      setCashSales(pmts
        .filter((p: any) => p.method === 'cash')
        .reduce((s: number, p: any) => s + (signByInvoiceId.get(p.invoice_id) ?? 1) * Number(p.amount ?? 0), 0))
      setCardSales(pmts
        .filter((p: any) => p.method === 'card')
        .reduce((s: number, p: any) => s + (signByInvoiceId.get(p.invoice_id) ?? 1) * Number(p.amount ?? 0), 0))
      setCreditRefunds(pmts
        .filter((p: any) => (signByInvoiceId.get(p.invoice_id) ?? 1) < 0)
        .reduce((s: number, p: any) => s + Math.abs(Number(p.amount ?? 0)), 0))
      setTotalExpenses((expData ?? []).reduce((s: number, e: any) => s + Number(e.total_paid ?? 0), 0))
      setCashExpenses((expData ?? []).filter((e: any) => e.payment_method === 'cash').reduce((s: number, e: any) => s + Number(e.total_paid ?? 0), 0))
      setLoadingData(false)
    }
    fetchData()
  }, [session.id])

  const expectedCash  = openingCash + cashSales - cashExpenses
  const actualCash    = parseFloat(cashActual) || 0
  const difference    = cashActual !== '' ? actualCash - expectedCash : null
  const differenceState = difference === null
    ? { label: 'Enter actual cash', className: 'bg-gray-100 text-gray-500' }
    : Math.abs(difference) < 0.005
    ? { label: 'Balanced', className: 'bg-emerald-100 text-emerald-700' }
    : difference > 0
    ? { label: `Over by SAR ${fmt(difference)}`, className: 'bg-emerald-100 text-emerald-700' }
    : { label: `Short by SAR ${fmt(Math.abs(difference))}`, className: 'bg-red-100 text-red-700' }
  const canClose = cashActual !== ''
    && cashSalesOk
    && cardSalesOk
    && expensesOk
    && creditRefundsOk
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
          cash_sales_confirmed: cashSalesOk,
          card_sales_confirmed: cardSalesOk,
          cash_expenses_confirmed: expensesOk,
          credit_refunds_confirmed: creditRefundsOk,
          total_session_sales_preview: totalSessionSales,
          credit_refunds_preview: creditRefunds,
          expected_cash_preview: expectedCash,
          actual_cash_entered: actualCash,
          cash_difference_preview: difference,
        },
      })
    } catch (err) {
      console.error('[CloseSessionModal]', err)
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
            <h3 className="font-bold text-gray-900">Close Register</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Opened {openedAt} · {duration}</p>
          </div>
          <div className="hidden sm:block text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Expected cash</p>
            <p className="text-sm font-bold text-gray-900 tabular-nums"><Rial amount={expectedCash} /></p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Check session totals</p>
                <p className="text-[10px] text-gray-400">{invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''}</p>
              </div>
              <div className="mb-2 grid grid-cols-1 gap-2 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Gross Sales</p>
                  <p className="mt-1 text-base font-black text-primary-800 tabular-nums">
                    <Rial amount={grossSessionSales} />
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Refunds / Credit Notes</p>
                  <p className="mt-1 text-base font-black text-primary-800 tabular-nums">
                    <Rial amount={sessionCreditNotes} />
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Net Sales</p>
                  <p className="mt-1 text-lg font-black text-primary-900 tabular-nums">
                    <Rial amount={totalSessionSales} />
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600">
                  <span className="min-w-0 flex-1">Net Cash Sales</span>
                  <span className="font-bold text-gray-900 tabular-nums"><Rial amount={cashSales} /></span>
                  <input
                    type="checkbox"
                    checked={cashSalesOk}
                    onChange={e => setCashSalesOk(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600">
                  <span className="min-w-0 flex-1">Net Card Sales</span>
                  <span className="font-bold text-gray-900 tabular-nums"><Rial amount={cardSales} /></span>
                  <input
                    type="checkbox"
                    checked={cardSalesOk}
                    onChange={e => setCardSalesOk(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600">
                  <span className="min-w-0 flex-1">POS cash expenses</span>
                  <span className="font-bold text-gray-900 tabular-nums"><Rial amount={cashExpenses} /></span>
                  <input
                    type="checkbox"
                    checked={expensesOk}
                    onChange={e => setExpensesOk(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600">
                  <span className="min-w-0 flex-1">Refunds / Credit Notes</span>
                  <span className="font-bold text-gray-900 tabular-nums"><Rial amount={creditRefunds} /></span>
                  <input
                    type="checkbox"
                    checked={creditRefundsOk}
                    onChange={e => setCreditRefundsOk(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </label>
              </div>
            </section>

            <section>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Cash count</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-3.5 py-3 space-y-2">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Opening cash</span>
                    <span className="tabular-nums"><Rial amount={openingCash} /></span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Expected in drawer</span>
                    <span className="tabular-nums"><Rial amount={expectedCash} /></span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Total expenses</span>
                    <span className="tabular-nums"><Rial amount={totalExpenses} /></span>
                  </div>
                </div>
                <div className="rounded-xl bg-white border border-gray-100 px-3.5 py-3">
                  <label className="label">Actual cash counted</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">SAR</span>
                    <input
                      type="number" min="0" step="0.01" value={cashActual}
                      onChange={e => setCashActual(e.target.value)}
                      className="input pl-10 h-10" placeholder="0.00" autoFocus
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">Difference</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${differenceState.className}`}>
                      {differenceState.label}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <label className="label">Notes (optional)</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                className="input resize-none min-h-0" rows={2}
                placeholder="Optional closing note"
              />
            </section>
          </div>
        )}

        <div className="px-5 py-3.5 flex gap-2 border-t border-gray-100 flex-shrink-0">
          <button onClick={onCancel} disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleClose} disabled={!canClose}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : 'Close Register'}
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
  const openedAt = formatSaudiSessionDateTime(summary.opened_at)
  const closedAt = formatSaudiSessionDateTime(summary.closed_at)
  const diff      = Number(summary.closing_cash_difference ?? 0)
  const diffColor = diff > 0.005 ? 'text-emerald-600' : diff < -0.005 ? 'text-red-600' : 'text-gray-700'

  const rows: [string, React.ReactNode][] = [
    ['Invoices',              summary.total_invoices],
    ['Net Session Sales',     <Rial amount={Number(summary.total_session_sales)} />],
    ['Cash Sales',            <Rial amount={Number(summary.total_cash_sales)} />],
    ['Card Sales',            <Rial amount={Number(summary.total_card_sales)} />],
    ['Expenses',              <Rial amount={Number(summary.total_expenses)} />],
    ['Opening Cash',          <Rial amount={Number(summary.opening_cash)} />],
    ['Expected Closing Cash', <Rial amount={Number(summary.closing_cash_expected)} />],
    ['Actual Closing Cash',   <Rial amount={Number(summary.closing_cash_actual)} />],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="bg-gradient-to-br from-[#1a3a28] to-primary-600 px-6 py-5 text-white text-center">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Check size={22} strokeWidth={2.5} />
          </div>
          <h3 className="font-bold text-lg">Register Session Closed</h3>
          <p className="text-white/70 text-xs mt-1">{openedAt}{' -> '}{closedAt}</p>
        </div>
        <div className="p-5">
          <div className="space-y-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm text-gray-600 border-b border-gray-50 pb-1.5">
                <span>{label}</span>
                <span className="tabular-nums font-medium">{value}</span>
              </div>
            ))}
            <div className={`flex justify-between text-sm font-bold pt-1 ${diffColor}`}>
              <span>Cash Difference</span>
              <span className="tabular-nums">
                {diff >= 0.005 ? '+' : diff < -0.005 ? '' : ''}
                <Rial amount={Math.abs(diff)} />
                {diff < -0.005 && <span className="ml-0.5 text-xs">(short)</span>}
              </span>
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onNewSession}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            New Register
          </button>
          <button onClick={onDone}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            Dashboard
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
  const cashAmount = parseFloat(cashValue) || 0
  const cardAmount = parseFloat(cardValue) || 0
  const paidTotal = round2(cashAmount + cardAmount)
  const balance = round2(total - paidTotal)
  const isBalanced = Math.abs(balance) <= 0.01
  const hasNegative = cashAmount < 0 || cardAmount < 0
  const canComplete = isBalanced && !hasNegative && cashAmount > 0 && cardAmount > 0 && !submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Split Payment</h3>
            <p className="text-xs text-gray-400 mt-0.5">Total <Rial amount={total} /></p>
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
            <span className="text-xs font-semibold text-gray-700">Cash amount</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">SAR</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cashValue}
                onChange={e => onCashChange(e.target.value)}
                className="input pl-10 tabular-nums"
                autoFocus
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-gray-700">Card amount</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">SAR</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cardValue}
                onChange={e => onCardChange(e.target.value)}
                className="input pl-10 tabular-nums"
              />
            </div>
          </label>

          <div className={`rounded-xl px-3 py-2 text-xs ${
            isBalanced && !hasNegative ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <div className="flex justify-between">
              <span>Total paid</span>
              <span className="font-semibold tabular-nums"><Rial amount={paidTotal} /></span>
            </div>
            <div className="flex justify-between mt-1">
              <span>{balance >= 0 ? 'Remaining' : 'Over by'}</span>
              <span className="font-semibold tabular-nums"><Rial amount={Math.abs(balance)} /></span>
            </div>
          </div>

          {cashAmount <= 0 && cardAmount > 0 && (
            <button type="button" onClick={onUseCard} className="w-full text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-xl py-2">
              Use normal Card payment
            </button>
          )}
          {cardAmount <= 0 && cashAmount > 0 && (
            <button type="button" onClick={onUseCash} className="w-full text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl py-2">
              Use normal Cash payment
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
            Cancel
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={!canComplete}
            className="flex-1 rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'Processing...' : 'Complete Sale'}
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
  const [zatcaResult,  setZatcaResult]  = useState<'submitted' | 'pending' | 'failed' | 'sandbox_pending' | 'sandbox_validated' | 'sandbox_failed' | null>(null)
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

  // ── Load data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      const bid = profile?.branch_id
      if (!tid || !bid) { setLoading(false); return }
      setLoading(true)
      try {
        const [{ data: branchData }, { data: prodData }, { data: custData }] = await Promise.all([
          supabase.from('branches').select('*').eq('id', bid).single(),
          supabase
            .from('products')
            .select('id, name, name_ar, sku, barcode, price, unit, vat_treatment, category_id, stock_quantity, track_stock, image_url, is_service, is_active, is_available, categories(id, name, color, icon)')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .eq('is_available', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('customers')
            .select('id, name, phone, customer_type, vat_number, business_name')
            .eq('branch_id', bid)
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(200),
        ])
        if (cancelled) return

        setBranch(branchData as Branch)

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
          catColor:     (p.categories as any)?.color ?? null,
        }))
        setProducts(prods)

        const catMap = new Map<string, PosCategory>()
        for (const p of prodData ?? []) {
          const c = (p as any).categories
          if (c?.id) catMap.set(c.id, { id: c.id, name: c.name, color: c.color, icon: c.icon })
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
    if (!searchQ) return []

    return products
      .filter(p => {
        const exactCodeMatch = (p.sku ?? '').toLowerCase() === searchQ || (p.barcode ?? '').toLowerCase() === searchQ
        if (searchQ.length < 2) return exactCodeMatch
        return productMatchesSearch(p, searchQ)
      })
      .sort((a, b) => productSearchRank(a, searchQ) - productSearchRank(b, searchQ))
      .slice(0, 20)
  }, [products, searchQ])

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
    && splitCashAmount > 0
    && splitCardAmount > 0
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
      toast.error('Account is suspended. New register sessions cannot be opened.')
      return
    }

    try {
      await openSession(openingCash)
      setShowOpenSession(false)
    } catch (err) {
      toast.error(registerSessionErrorMessage(err))
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
        toast.info('Choose a receipt printer to enable direct printing.', {
          action: { label: 'Device Printer', onClick: () => navigate(DEVICE_PRINTER_PATH) },
        })
        return
      }

      autoPrintedReceiptIdRef.current = invoiceId
      const result = await printReceipt({ invoiceId })
      if (result.success) {
        toast.success('Receipt sent to printer', { duration: 1800 })
        return
      }

      const message = printFailureMessage(result.errorType, result.message)
      toast.error(message)
      if (settings.fallbackToPreview) await printReceiptInHiddenFrame(invoiceId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Receipt print failed.')
    }
  }

  // ── Charge ───────────────────────────────────────────────────────────────

  async function charge() {
    const tid = profile?.tenant_id
    if (!tid || !branch || cart.length === 0 || submitting) return
    if (isAccountSuspended) {
      toast.error(ACCOUNT_SUSPENDED_BILLING_MESSAGE)
      return
    }
    setSubmitting(true)
    setZatcaResult(null)
    const idempotencyKey = checkoutKeyRef.current ?? createCheckoutIdempotencyKey()
    checkoutKeyRef.current = idempotencyKey

    try {
      if (payMethod === 'split') {
        if (!splitPaymentsEnabled) {
          toast.error('Split Payment is not enabled for this branch.')
          return
        }
        if (!splitReady) {
          setSplitOpen(true)
          toast.error('Split Payment must be balanced before checkout.')
          return
        }
      }

      const cashTenderProvided = payMethod === 'cash' && cashReceived.trim() !== ''
      const splitPayments = payMethod === 'split'
        ? [
            { method: 'cash', amount: round2(splitCashAmount) },
            { method: 'card', amount: round2(splitCardAmount) },
          ]
        : null
      const payload = {
        branch_id: branch.id,
        customer_id: customerId,
        session_id: session?.id ?? null,
        payment_method: payMethod === 'split' ? 'other' : payMethod,
        amount_paid: cashTenderProvided ? cashAmt : null,
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

      setReceipt({
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
        customerPhone:     selectedCust?.phone ?? null,
        isStandardInvoice: isB2BInvoice,
        buyerVatNumber:    isB2BInvoice ? (selectedCust?.vat_number ?? null) : null,
        cashierName:    profile?.full_name ?? user?.email?.split('@')[0] ?? 'Cashier',
        items:          (checkout.items ?? []).map(i => ({
          name:      i.name_ar?.trim() ? i.name_ar : i.name,
          qty:       num(i.quantity),
          unitPrice: num(i.unit_price),
          lineTotal: num(i.total),
          subtotal:  num(i.subtotal),
          taxAmount: num(i.tax_amount),
          total:     num(i.total),
        })),
        createdAt,
        businessNameAr:  branch.display_name || branch.business_name || branch.name,
        businessNameEn:  branch.business_name || branch.name,
        branchName:      branch.name,
        branchAddress:   branchAddr || null,
        vatNumber:       branch.vat_number ?? '',
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

      const demoSandboxValidation = isPermanentDemoSandboxBranch(profile?.tenant_id, branch.id)
      if (demoSandboxValidation) setZatcaResult('sandbox_pending')
      submitInvoiceForBranch({
        invoiceId: checkout.invoice_id,
        tenantId: profile?.tenant_id ?? '',
        branchId: branch.id,
        options: { source: 'auto_checkout', retryDelayMs: 1500 },
      })
        .then((routed) => {
          if (routed.mode === 'sandbox_validation') {
            const validated = routed.result.status === 'sandbox_validated' ||
              routed.result.status === 'sandbox_validated_with_warnings'
            setZatcaResult(validated ? 'sandbox_validated' : 'sandbox_failed')
            if (validated) toast.success('ZATCA submission successful', { description: 'Successfully processed by ZATCA', duration: 2500 })
            else toast.error('ZATCA Sandbox validation failed')
            return
          }
          const result = routed.result
          if (result.ok) {
            setZatcaResult('submitted')
            toast.success('Submitted to ZATCA', { duration: 2000 })
          } else if (result.invoiceStatus === 'failed') {
            setZatcaResult('failed')
            toast.error('ZATCA submission failed')
          } else {
            setZatcaResult('pending')
            toast.warning('Invoice created. ZATCA submission is pending retry.', { duration: 3500 })
          }
        })
        .catch((error) => {
          if (demoSandboxValidation) {
            setZatcaResult('sandbox_failed')
            toast.error('ZATCA Sandbox validation failed')
          } else {
            console.warn('[POSPage charge] automatic ZATCA action failed', {
              invoiceId: checkout.invoice_id,
              branchId: branch.id,
              message: error instanceof Error ? error.message : String(error ?? ''),
            })
            setZatcaResult('pending')
            toast.warning('Invoice created. ZATCA submission is pending retry.', { duration: 3500 })
          }
        })
    } catch (err) {
      const safeMessage = safeCheckoutErrorMessage(err)
      console.warn('[POSPage charge] checkout failed:', safeMessage)
      toast.error(safeMessage)
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
          <p className="text-sm">Loading POS…</p>
        </div>
      </div>
    )
  }

  if (!profile?.branch_id) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">No branch assigned. Contact your administrator.</p>
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
              {isAccountSuspended ? 'Account Suspended' : 'Register Closed'}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {isAccountSuspended
                ? 'New billing and register opening are disabled. Existing records remain available.'
                : 'Open a new session to start accepting payments.'}
            </p>
            {!isAccountSuspended && (
              <button
                onClick={() => setShowOpenSession(true)}
                className="w-full py-3 bg-gradient-to-r from-[#1a3a28] to-primary-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity"
              >
                Open Register
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
                  Contact Us
                </a>
                <a
                  href={EMAIL_LINK}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  Email
                </a>
              </div>
            )}
            <button
              onClick={() => navigate('/branch')}
              className="mt-3 w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← Back to Dashboard
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
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Modals */}
      {receipt && (
        <ReceiptView
          receipt={receipt}
          onNewSale={() => { setReceipt(null); setZatcaResult(null) }}
          onOpenPrinterSettings={() => navigate(DEVICE_PRINTER_PATH)}
          printMode={branch?.print_mode ?? 'thermal'}
          zatcaStatus={zatcaResult}
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
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="bg-[#0F2419] text-white px-5 py-3.5 flex items-center gap-3 flex-shrink-0 shadow-lg">
          <button
            onClick={() => navigate('/branch')}
            title="Back to Dashboard (Esc)"
            className="flex items-center gap-1.5 text-white/50 hover:text-white border border-white/15 hover:border-white/30 px-2.5 py-1.5 rounded-lg text-xs transition-colors flex-shrink-0"
          >
            <ArrowLeft size={13} />
            Dashboard
          </button>
          <div className="h-4 w-px bg-white/20 flex-shrink-0" />
          <div className="flex items-center gap-2.5">
            <MeemLogo size="sm" />
          </div>
          <div className="h-4 w-px bg-white/20" />
          <span className="text-white/60 text-xs">{profile?.full_name ?? 'Cashier'}</span>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-white/50 text-xs">{branch?.name ?? ''}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] bg-white/10 border border-white/10 text-white/50 px-2 py-1 rounded-lg">
              {vatMode === 'inclusive' ? 'VAT Incl.' : 'VAT Excl.'}
            </span>
            {isElectron() && (
              <button
                type="button"
                onClick={() => navigate(DEVICE_PRINTER_PATH)}
                title="Device Printer"
                className="text-xs bg-white/10 border border-white/10 text-white/70 px-3 py-1.5 rounded-lg hover:bg-white/15 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <Printer size={12} />
                Printer
              </button>
            )}
            <button
              onClick={() => setShowExpense(true)}
              className="text-xs bg-amber-500/20 border border-amber-400/20 text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors flex items-center gap-1.5"
            >
              <Zap size={12} />
              Expense
            </button>
            <button
              onClick={() => setShowCloseSession(true)}
              className="text-xs bg-red-500/20 border border-red-400/20 text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Close Register
            </button>
          </div>
        </div>

        {/* Session info bar */}
        <div className="bg-emerald-50 border-b border-emerald-100 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
          <span className="text-xs text-emerald-700">
            Register Session open since {toSaudiTime(session.opened_at)}
            {Number(session.opening_cash) > 0 && (
              <> · Opening: <Rial amount={Number(session.opening_cash)} /></>
            )}
          </span>
        </div>

        {/* Search + category tabs */}
        <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
          {activePosMode === 'quick' ? (
            <div className="relative flex-1 max-w-xl min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search product name, SKU or barcode"
                className="input pl-8 py-1.5 text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="relative w-52 flex-shrink-0">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search... (/)"
                  className="input pl-8 py-1.5 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                  title="Scroll categories left"
                  className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div ref={categoryScrollRef} className="flex items-center gap-1.5 overflow-x-auto flex-1">
                <button
                  onClick={() => setActiveCat(null)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    !activeCat ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All
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
                    {cat.icon && <span className="mr-1">{cat.icon}</span>}
                    {cat.name}
                  </button>
                ))}
              </div>
              {showPosScrollButtons && (
                <button
                  type="button"
                  onClick={() => scrollCategories(1)}
                  disabled={scrollState.categoryAtEnd}
                  title="Scroll categories right"
                  className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <ChevronRight size={20} />
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
                        <p className="font-semibold text-gray-700 text-base">No products yet</p>
                        <p className="text-sm text-gray-400 max-w-[220px]">
                          Add your menu items to start selling
                        </p>
                      </div>
                      <button
                        onClick={() => navigate('/products')}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#1B6B3A] text-white text-sm font-semibold rounded-xl hover:bg-[#155830] transition-colors shadow-sm"
                      >
                        <Plus size={15} />
                        Go to Products
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <AlertCircle size={28} className="mb-2 opacity-40" />
                      <p className="text-sm">No products found</p>
                      {search && (
                        <button onClick={() => setSearch('')} className="text-xs text-primary-500 mt-1 underline">
                          Clear search
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
                    title="Scroll products up"
                    className="h-12 w-12 rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <ChevronUp size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollProducts(1)}
                    disabled={scrollState.productsAtEnd}
                    title="Scroll products down"
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
      <div className="w-[340px] bg-white border-l border-gray-100 flex flex-col flex-shrink-0 shadow-xl">

        {/* Cart header */}
        <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Receipt size={15} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900 text-sm">Current Order</h2>
            {cart.length > 0 && (
              <span className="w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {cart.reduce((s, c) => s + c.quantity, 0)}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button onClick={() => setCart([])}
              className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors">
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {/* Customer selector */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0 relative z-20">
          <button
            onClick={() => { setCustOpen(o => !o); setCustSearch('') }}
            className="w-full flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-left hover:border-primary-200 transition-colors"
          >
            <User size={13} className="text-gray-400 flex-shrink-0" />
            <span className={`flex-1 text-xs ${customerId ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
              {selectedCust?.customer_type === 'business' && selectedCust?.business_name
                ? selectedCust.business_name
                : (selectedCust?.name ?? 'Walk-in Customer')}
            </span>
            <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
          </button>
          {custOpen && (
            <div className="absolute left-4 right-4 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input type="text" value={custSearch} onChange={e => setCustSearch(e.target.value)}
                  placeholder="Search customers…" className="input text-xs py-1.5" autoFocus />
              </div>
              <div className="max-h-52 overflow-y-auto">
                <button
                  onClick={() => { setCustomerId(null); setCustOpen(false) }}
                  className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 hover:bg-gray-50 ${!customerId ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'}`}
                >
                  <User size={12} />
                  Walk-in Customer
                  {!customerId && <Check size={12} className="ml-auto" />}
                </button>
                {filteredCusts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setCustomerId(c.id); setCustOpen(false) }}
                    className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 hover:bg-gray-50 ${customerId === c.id ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate">
                        {c.customer_type === 'business' && c.business_name ? c.business_name : c.name}
                      </p>
                      {c.customer_type === 'business' && c.business_name && (
                        <p className="text-gray-400 text-[10px] truncate">{c.name}</p>
                      )}
                      {c.phone && <p className="text-gray-400 text-[10px]">{c.phone}</p>}
                    </div>
                    {customerId === c.id && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
                {filteredCusts.length === 0 && custSearch && (
                  <p className="px-3 py-4 text-center text-xs text-gray-400">No customers found</p>
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
              <p className="text-xs">Tap a product to add</p>
              <p className="text-[10px] mt-1 text-gray-200">Press / to search</p>
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
                    <p className="text-xs font-semibold text-gray-800 truncate">{dn(item.name, item.nameAr)}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums">
                      {fmt(item.price)} × {item.quantity} = <span className="text-gray-700 font-semibold"><Rial amount={line} /></span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => adjustQty(item.productId, -1)}
                      className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors">
                      {item.quantity === 1
                        ? <Trash2 size={10} className="text-red-400" />
                        : <Minus size={10} className="text-gray-500" />
                      }
                    </button>
                    <span className="text-xs font-bold text-gray-900 w-5 text-center tabular-nums">{item.quantity}</span>
                    <button onClick={() => adjustQty(item.productId, 1)}
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
            placeholder="Order note (optional)" className="input text-xs py-1.5" />
        </div>

        {/* Totals */}
        <div className="px-4 py-3 border-t border-gray-100 space-y-1.5 flex-shrink-0">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Net Amount</span>
            <span className="tabular-nums"><Rial amount={totals.subtotal} /></span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>VAT 15% ({vatMode === 'inclusive' ? 'incl.' : 'excl.'})</span>
            <span className="tabular-nums"><Rial amount={totals.taxAmount} /></span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 text-base pt-1.5 border-t border-gray-100">
            <span>Total</span>
            <span className="tabular-nums text-primary-600"><Rial amount={totals.total} /></span>
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
                {m === 'cash' ? 'Cash' : 'Card'}
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
                Split
              </button>
            )}
          </div>

          {payMethod === 'cash' && cart.length > 0 && (
            <div className="space-y-1">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">SAR</span>
                <input
                  type="number" min="0" step="1"
                  value={cashReceived}
                  onChange={e => setCashReceived(e.target.value)}
                  placeholder={fmt(Math.ceil(totals.total))}
                  className="input pl-10 py-1.5 text-sm tabular-nums"
                />
              </div>
              {cashAmt >= totals.total && cashAmt > 0 && (
                <div className="flex justify-between px-1">
                  <span className="text-xs text-gray-500">Change</span>
                  <span className="text-sm font-bold text-emerald-600 tabular-nums"><Rial amount={change} /></span>
                </div>
              )}
              {cashAmt > 0 && cashAmt < totals.total && (
                <p className="text-[10px] text-red-500 px-1 flex items-baseline gap-1">
                  Short by <Rial amount={totals.total - cashAmt} />
                </p>
              )}
            </div>
          )}

          {payMethod === 'split' && cart.length > 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-600">
                <span>Cash</span>
                <span className="font-semibold tabular-nums"><Rial amount={splitCashAmount} /></span>
              </div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>Card</span>
                <span className="font-semibold tabular-nums"><Rial amount={splitCardAmount} /></span>
              </div>
              <button
                type="button"
                onClick={() => setSplitOpen(true)}
                className="text-[11px] font-semibold text-primary-700 hover:text-primary-900"
              >
                Edit Split Payment
              </button>
            </div>
          )}
        </div>

        {isAccountSuspended && (
          <div className="mx-4 mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {ACCOUNT_SUSPENDED_BILLING_MESSAGE}
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
              ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
              : isAccountSuspended
                ? <><AlertCircle size={16} /> Billing disabled</>
              : <>
                  {payMethod === 'cash' ? <Banknote size={16} /> : <CreditCard size={16} />}
                  Charge — <Rial amount={totals.total} />
                </>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
