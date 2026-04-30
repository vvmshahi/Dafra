import { useState } from 'react'
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, Receipt, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'

/* ── Mock products ──────────────────────────────────────────── */
const MOCK_PRODUCTS = [
  { id: '1', name: 'Arabic Coffee',      nameAr: 'قهوة عربية',    price: 15.00,  category: 'Beverages' },
  { id: '2', name: 'Dates Box 500g',     nameAr: 'تمر ٥٠٠ جرام', price: 45.00,  category: 'Food' },
  { id: '3', name: 'Oud Perfume 50ml',   nameAr: 'عطر عود ٥٠مل', price: 320.00, category: 'Perfumes' },
  { id: '4', name: 'Gahwa Mix',          nameAr: 'خلطة قهوة',     price: 28.50,  category: 'Beverages' },
  { id: '5', name: 'Saudi Ghee 1kg',     nameAr: 'سمن بلدي كيلو', price: 95.00,  category: 'Food' },
  { id: '6', name: 'Rose Water 500ml',   nameAr: 'ماء ورد ٥٠٠مل', price: 22.00, category: 'Pantry' },
  { id: '7', name: 'Saffron 1g',         nameAr: 'زعفران ١ جرام', price: 55.00,  category: 'Spices' },
  { id: '8', name: 'Camel Milk 1L',      nameAr: 'حليب إبل ١ لتر', price: 38.00, category: 'Beverages' },
]

const VAT = 0.15
const CATEGORIES = ['All', ...Array.from(new Set(MOCK_PRODUCTS.map(p => p.category)))]

interface CartItem {
  id: string
  name: string
  price: number
  qty: number
}

/* ── Product card ───────────────────────────────────────────── */
function ProductCard({ product, onAdd }: { product: typeof MOCK_PRODUCTS[0]; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="bg-white border border-gray-100 rounded-2xl p-4 text-left hover:border-primary-300 hover:shadow-md transition-all group"
    >
      <div className="w-full aspect-square bg-gray-50 rounded-xl mb-3 flex items-center justify-center group-hover:bg-primary-50 transition-colors">
        <span className="text-3xl">🛒</span>
      </div>
      <p className="text-xs font-semibold text-gray-800 leading-snug truncate">{product.name}</p>
      <p className="text-[10px] text-gray-400 truncate" style={{ fontFamily: 'Cairo, sans-serif' }}>{product.nameAr}</p>
      <p className="text-sm font-bold text-primary-600 mt-1.5">SAR {product.price.toFixed(2)}</p>
    </button>
  )
}

/* ── Page ───────────────────────────────────────────────────── */
export default function POSPage() {
  const { profile } = useAuth()
  const [search, setSearch]       = useState('')
  const [category, setCategory]   = useState('All')
  const [cart, setCart]           = useState<CartItem[]>([])
  const [note, setNote]           = useState('')

  const filtered = MOCK_PRODUCTS.filter(p => {
    const matchCat    = category === 'All' || p.category === category
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
                     || p.nameAr.includes(search)
    return matchCat && matchSearch
  })

  const addToCart = (product: typeof MOCK_PRODUCTS[0]) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id)
      if (existing) return prev.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }]
    })
  }

  const adjustQty = (id: string, delta: number) => {
    setCart(prev => prev
      .map(c => c.id === id ? { ...c, qty: c.qty + delta } : c)
      .filter(c => c.qty > 0)
    )
  }

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0)
  const vat      = subtotal * VAT
  const total    = subtotal + vat

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Left: products ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* POS header */}
        <div className="bg-[#0F2419] text-white px-5 py-3.5 flex items-center gap-4 flex-shrink-0 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gold-500 flex items-center justify-center">
              <span className="text-[#0F2419] font-black text-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
            </div>
            <span className="font-bold text-sm">دفرة POS</span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <span className="text-white/60 text-xs">{profile?.full_name ?? 'Cashier'}</span>
          <div className="ml-auto">
            <span className="text-xs bg-white/10 border border-white/10 text-white/70 px-3 py-1 rounded-full">
              Branch: Main
            </span>
          </div>
        </div>

        {/* Search + categories */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products…"
              className="input pl-8 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  category === cat
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Search size={32} className="mb-2 opacity-40" />
              <p className="text-sm">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(p => (
                <ProductCard key={p.id} product={p} onAdd={() => addToCart(p)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: cart ─────────────────────────────────────── */}
      <div className="w-80 bg-white border-l border-gray-100 flex flex-col flex-shrink-0 shadow-lg">

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">Current Order</h2>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-300">
              <Receipt size={28} className="mb-2" />
              <p className="text-xs">Cart is empty</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                  <p className="text-[11px] text-gray-400">SAR {item.price.toFixed(2)} each</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => adjustQty(item.id, -1)}
                    className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors"
                  >
                    {item.qty === 1 ? <Trash2 size={10} className="text-red-400" /> : <Minus size={10} className="text-gray-500" />}
                  </button>
                  <span className="text-xs font-bold text-gray-900 w-5 text-center">{item.qty}</span>
                  <button
                    onClick={() => adjustQty(item.id, 1)}
                    className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-primary-50 hover:border-primary-200 transition-colors"
                  >
                    <Plus size={10} className="text-gray-500" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Note */}
        <div className="px-4 pb-2">
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Order note (optional)"
            className="input text-xs py-2"
          />
        </div>

        {/* Totals */}
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Subtotal</span>
            <span className="tabular-nums">SAR {subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>VAT (15%)</span>
            <span className="tabular-nums">SAR {vat.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
            <span>Total</span>
            <span className="tabular-nums">SAR {total.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment buttons */}
        <div className="px-4 pb-5 space-y-2.5">
          <Button
            className="w-full gap-2"
            disabled={cart.length === 0}
          >
            <CreditCard size={15} />
            Card — SAR {total.toFixed(2)}
          </Button>
          <Button
            variant="secondary"
            className="w-full gap-2"
            disabled={cart.length === 0}
          >
            <Banknote size={15} />
            Cash — SAR {total.toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  )
}
