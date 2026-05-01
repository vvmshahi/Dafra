import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  Receipt, X, ChevronDown, User, Check, Loader2,
  ShoppingBag, AlertCircle, Zap, Printer, PackageOpen,
} from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import { buildZatcaQR } from '@/lib/zatca/qr'
import ThermalReceipt, { printThermal } from '@/components/print/ThermalReceipt'
import type { ThermalItem } from '@/components/print/ThermalReceipt'
import type { Branch, VatTreatment } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PosProduct {
  id: string
  name: string
  nameAr: string | null
  price: number
  unit: string
  vatTreatment: VatTreatment
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
  paymentMethod: 'cash' | 'card'
  change: number
  cashReceived: number
  customerName: string
  customerPhone: string | null
  cashierName: string
  items: ThermalItem[]
  createdAt: string
  businessNameAr: string
  businessNameEn: string
  branchName: string
  branchAddress: string | null
  vatNumber: string
  phone: string | null
  receiptFooter: string | null
}

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

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const cartKey = (bid: string) => `pos_cart_${bid}`

// ── Quick Expense modal ───────────────────────────────────────────────────────

function QuickExpenseModal({
  branchId, tenantId, userId, onClose,
}: { branchId: string; tenantId: string; userId: string | null; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [desc,   setDesc]   = useState('')
  const [vendor, setVendor] = useState('')
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [saving, setSaving] = useState(false)

  async function save() {
    const amt = parseFloat(amount)
    if (!amt || !desc.trim()) return
    setSaving(true)
    try {
      const q = supabase as unknown as { from: (t: string) => any }
      await q.from('expenses').insert({
        tenant_id:      tenantId,
        branch_id:      branchId,
        added_by:       userId,
        expense_date:   new Date().toISOString().slice(0, 10),
        description:    desc.trim(),
        vendor_name:    vendor.trim() || null,
        amount:         amt,
        vat_treatment:  'no_vat',
        vat_amount:     0,
        total_paid:     amt,
        payment_method: method,
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
          <h3 className="font-semibold text-gray-900 text-sm">Quick Expense</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="label">Amount (SAR)</label>
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
          <div>
            <label className="label">Payment Method</label>
            <div className="flex gap-2">
              {(['cash', 'card'] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    method === m
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {m === 'cash' ? '💵 Cash' : '💳 Card'}
                </button>
              ))}
            </div>
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

function ReceiptView({ receipt, onNewSale }: { receipt: ReceiptData; onNewSale: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

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

  const invDate = new Date(receipt.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const invTime = new Date(receipt.createdAt).toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* Hidden thermal receipt — rendered for print only */}
      <ThermalReceipt
        businessNameAr={receipt.businessNameAr}
        businessNameEn={receipt.businessNameEn}
        branchName={receipt.branchName}
        address={receipt.branchAddress}
        vatNumber={receipt.vatNumber}
        phone={receipt.phone}
        invoiceNumber={receipt.invoiceNumber}
        date={invDate}
        time={invTime}
        cashierName={receipt.cashierName}
        items={receipt.items}
        subtotal={receipt.subtotal}
        taxAmount={receipt.taxAmount}
        total={receipt.total}
        paymentMethod={receipt.paymentMethod}
        cashReceived={receipt.cashReceived}
        change={receipt.change}
        customerName={receipt.customerName}
        qrDataUrl={qrDataUrl}
        receiptFooter={receipt.receiptFooter}
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
              <span className="font-medium text-gray-800 capitalize">{receipt.paymentMethod}</span>
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

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => printThermal()}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <Printer size={14} />
                Print Receipt
              </button>
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
  return (
    <button onClick={onAdd}
      className="bg-white border border-gray-100 rounded-2xl p-3 text-left hover:border-primary-300 hover:shadow-md transition-all relative">
      {cartQty > 0 && (
        <span className="absolute top-2 right-2 w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center z-10">
          {cartQty}
        </span>
      )}
      <div className="w-full aspect-square rounded-xl mb-2.5 flex items-center justify-center"
        style={{ backgroundColor: `${color}18` }}>
        <ShoppingBag size={22} style={{ color }} />
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

// ── POSPage ───────────────────────────────────────────────────────────────────

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

export default function POSPage() {
  const { profile, user } = useAuth()
  const navigate  = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)

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
  const [payMethod,    setPayMethod]    = useState<'cash' | 'card'>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [receipt,      setReceipt]      = useState<ReceiptData | null>(null)
  const [showExpense,  setShowExpense]  = useState(false)

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
            .select('id, name, name_ar, price, unit, vat_treatment, category_id, categories(id, name, color, icon)')
            .eq('tenant_id', tid)
            .eq('is_active', true)
            .eq('is_available', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('customers')
            .select('id, name, phone')
            .eq('tenant_id', tid)
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(200),
        ])
        if (cancelled) return

        setBranch(branchData as Branch)

        const prods: PosProduct[] = (prodData ?? []).map((p: any) => ({
          id:           p.id,
          name:         p.name,
          nameAr:       p.name_ar,
          price:        Number(p.price),
          unit:         p.unit ?? 'pcs',
          vatTreatment: (p.vat_treatment ?? 'inherit') as VatTreatment,
          catId:        p.category_id,
          catName:      (p.categories as any)?.name ?? null,
          catColor:     (p.categories as any)?.color ?? null,
        }))
        setProducts(prods)

        const catMap = new Map<string, PosCategory>()
        for (const p of prodData ?? []) {
          const c = (p as any).categories
          if (c?.id) catMap.set(c.id, { id: c.id, name: c.name, color: c.color, icon: c.icon })
        }
        setCategories(Array.from(catMap.values()))

        setCustomers((custData ?? []).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })))

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
      const q = search.trim().toLowerCase()
      const visible = products.filter(p => {
        const matchCat = !activeCat || p.catId === activeCat
        if (!q) return matchCat
        return matchCat && (p.name.toLowerCase().includes(q) || (p.nameAr ?? '').includes(search.trim()))
      })
      if (visible.length === 1) addToCart(visible[0])
    }
    window.addEventListener('keydown', onEnter)
    return () => window.removeEventListener('keydown', onEnter)
  })

  // ── Derived ──────────────────────────────────────────────────────────────

  const searchQ = search.trim().toLowerCase()
  const filtered = products.filter(p => {
    const matchCat = !activeCat || p.catId === activeCat
    if (!searchQ) return matchCat
    return matchCat && (p.name.toLowerCase().includes(searchQ) || (p.nameAr ?? '').includes(search.trim()))
  })

  const vatMode = branch?.vat_mode ?? 'exclusive'
  const totals  = computeTotals(cart, vatMode)
  const cashAmt = parseFloat(cashReceived) || 0
  const change  = payMethod === 'cash' ? Math.max(0, cashAmt - totals.total) : 0

  const filteredCusts = custSearch.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(custSearch.toLowerCase()) ||
        (c.phone ?? '').includes(custSearch)
      )
    : customers
  const selectedCust = customers.find(c => c.id === customerId)

  // ── Cart ops ─────────────────────────────────────────────────────────────

  function addToCart(product: PosProduct) {
    setCart(prev => {
      const existing = prev.find(c => c.productId === product.id)
      if (existing) return prev.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, {
        productId:    product.id,
        name:         product.name,
        nameAr:       product.nameAr,
        price:        product.price,
        vatTreatment: product.vatTreatment,
        unit:         product.unit,
        quantity:     1,
        catColor:     product.catColor,
      }]
    })
  }

  function adjustQty(productId: string, delta: number) {
    setCart(prev => prev
      .map(c => c.productId === productId ? { ...c, quantity: c.quantity + delta } : c)
      .filter(c => c.quantity > 0)
    )
  }

  // ── Charge ───────────────────────────────────────────────────────────────

  async function charge() {
    const tid = profile?.tenant_id
    if (!tid || !branch || cart.length === 0 || submitting) return
    setSubmitting(true)
    try {
      const q = supabase as unknown as { from: (t: string) => any }

      const { data: counter } = await supabase.rpc('get_next_invoice_counter', { p_branch_id: branch.id })
      const prefix        = branch.invoice_prefix ?? 'INV'
      const invoiceNumber = `${prefix}-${String(counter ?? 1).padStart(4, '0')}`
      const today         = new Date().toISOString().slice(0, 10)

      const { data: inv, error: invErr } = await q.from('invoices').insert({
        tenant_id:          tid,
        branch_id:          branch.id,
        customer_id:        customerId ?? null,
        created_by:         profile?.id ?? null,
        invoice_number:     invoiceNumber,
        zatca_invoice_type: 'simplified',
        zatca_type_code:    '388',
        zatca_status:       'pending',
        subtotal:           totals.subtotal,
        discount_amount:    0,
        taxable_amount:     totals.subtotal,
        tax_amount:         totals.taxAmount,
        total_amount:       totals.total,
        currency_code:      'SAR',
        invoice_date:       today,
        status:             'posted',
        payment_status:     'paid',
        notes:              note || null,
      }).select('id').single()

      if (invErr) throw invErr

      const itemsPayload = cart.map((item, idx) => {
        const line = item.price * item.quantity
        const mode = resolveMode(item.vatTreatment, vatMode)
        let net = line, tax = 0
        if (mode === 'exclusive')  { net = line;       tax = line * 0.15 }
        if (mode === 'inclusive')  { net = line / 1.15; tax = line - net  }
        return {
          invoice_id:       inv.id,
          tenant_id:        tid,
          product_id:       item.productId,
          name:             item.name,
          name_ar:          item.nameAr,
          unit:             item.unit,
          quantity:         item.quantity,
          unit_price:       item.price,
          discount_percent: 0,
          discount_amount:  0,
          subtotal:         net,
          tax_rate:         mode === 'exempt' ? 0 : 0.15,
          tax_category:     mode === 'exempt' ? 'O' : 'S',
          tax_amount:       tax,
          total:            net + tax,
          sort_order:       idx,
        }
      })
      await q.from('invoice_items').insert(itemsPayload)

      await q.from('payments').insert({
        tenant_id:   tid,
        invoice_id:  inv.id,
        recorded_by: profile?.id ?? null,
        amount:      totals.total,
        method:      payMethod,
        paid_at:     new Date().toISOString(),
      })

      const createdAt    = new Date().toISOString()
      const branchAddr   = [
        branch.building_number ? `Building ${branch.building_number}` : null,
        branch.street, branch.district, branch.city,
      ].filter(Boolean).join(', ')

      setReceipt({
        invoiceNumber,
        invoiceId:      inv.id,
        total:          totals.total,
        taxAmount:      totals.taxAmount,
        subtotal:       totals.subtotal,
        paymentMethod:  payMethod,
        change,
        cashReceived:   cashAmt,
        customerName:   selectedCust?.name ?? 'Walk-in Customer',
        customerPhone:  selectedCust?.phone ?? null,
        cashierName:    profile?.full_name ?? user?.email?.split('@')[0] ?? 'Cashier',
        items:          cart.map(i => ({
          name:      i.nameAr?.trim() ? i.nameAr : i.name,
          qty:       i.quantity,
          unitPrice: i.price,
          lineTotal: i.price * i.quantity,
        })),
        createdAt,
        businessNameAr: branch.business_name_ar || branch.name_ar || branch.name,
        businessNameEn: branch.business_name    || branch.name,
        branchName:     branch.name,
        branchAddress:  branchAddr || null,
        vatNumber:      branch.vat_number ?? '',
        phone:          branch.phone,
        receiptFooter:  branch.receipt_footer,
      })

      setCart([])
      setCustomerId(null)
      setNote('')
      setCashReceived('')
    } catch (err) {
      console.error(err)
      alert('Payment failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
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

  const canCharge = cart.length > 0 && !submitting &&
    !(payMethod === 'cash' && cashReceived !== '' && cashAmt < totals.total - 0.001)

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Modals */}
      {receipt && <ReceiptView receipt={receipt} onNewSale={() => setReceipt(null)} />}
      {showExpense && branch && (
        <QuickExpenseModal
          branchId={branch.id}
          tenantId={profile.tenant_id ?? ''}
          userId={profile.id ?? null}
          onClose={() => setShowExpense(false)}
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
            <div className="w-8 h-8 rounded-xl bg-gold-500 flex items-center justify-center">
              <span className="text-[#0F2419] font-black text-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
            </div>
            <span className="font-bold text-sm">دفرة POS</span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <span className="text-white/60 text-xs">{profile?.full_name ?? 'Cashier'}</span>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-white/50 text-xs">{branch?.name ?? ''}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] bg-white/10 border border-white/10 text-white/50 px-2 py-1 rounded-lg">
              {vatMode === 'inclusive' ? 'VAT Incl.' : 'VAT Excl.'}
            </span>
            <button
              onClick={() => setShowExpense(true)}
              className="text-xs bg-amber-500/20 border border-amber-400/20 text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors flex items-center gap-1.5"
            >
              <Zap size={12} />
              Expense
            </button>
          </div>
        </div>

        {/* Search + category tabs */}
        <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
          <div className="relative w-52 flex-shrink-0">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search… (/)"
              className="input pl-8 py-1.5 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1">
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
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            products.length === 0 ? (
              /* No products exist at all — full empty state */
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
              /* Products exist but search has no matches */
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
              {selectedCust?.name ?? 'Walk-in Customer'}
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
                      <p className="truncate">{c.name}</p>
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
              <button key={m} onClick={() => setPayMethod(m)}
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
        </div>

        {/* Charge button */}
        <div className="px-4 pb-5 flex-shrink-0">
          <button
            onClick={charge}
            disabled={!canCharge}
            className="w-full py-3.5 rounded-2xl font-bold text-sm text-white transition-all flex items-center justify-center gap-2
              bg-gradient-to-r from-[#1a3a28] to-primary-600
              hover:opacity-90 active:scale-[0.98]
              disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed disabled:scale-100"
          >
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
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
