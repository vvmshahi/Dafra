import { useState, useEffect, useCallback } from 'react'
import { Plus, Eye, ShoppingCart, Paperclip, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { Purchase, PurchaseItem, Supplier, InventoryItem } from '@/types'
import PurchaseDrawer from './PurchaseDrawer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupplierSnap { name: string }

interface PurchaseRow extends Purchase {
  suppliers:      SupplierSnap | null
  purchase_items: { id: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAY_BADGE: Record<string, 'success' | 'info' | 'neutral'> = {
  cash: 'success', card: 'info', bank_transfer: 'neutral',
}
const PAY_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank',
}
const MODE_LABEL: Record<string, string> = {
  simple_bill: 'Bill only',
  detailed_receiving: 'Receiving',
}
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  partial: 'Partial',
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Purchase detail modal ─────────────────────────────────────────────────────

function PurchaseDetailModal({
  purchase, items, loading, onClose,
}: {
  purchase: PurchaseRow
  items:    PurchaseItem[]
  loading:  boolean
  onClose:  () => void
}) {
  const supplierName = purchase.suppliers?.name ?? '—'
  const pay          = purchase.payment_method
  const mode         = purchase.purchase_mode ?? 'detailed_receiving'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h3 className="text-base font-bold text-gray-900">Purchase Details</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(purchase.purchase_date).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
                {supplierName !== '—' && ` · ${supplierName}`}
              </p>
            </div>
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Meta */}
            <div className="flex gap-3 text-sm">
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Supplier</p>
                <p className="font-medium text-gray-800 mt-0.5">{supplierName}</p>
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Type</p>
                <p className="font-medium text-gray-800 mt-0.5">{MODE_LABEL[mode] ?? mode}</p>
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Payment</p>
                <p className="font-medium text-gray-800 mt-0.5">
                  {PAY_LABEL[pay] ?? pay}
                  {purchase.payment_status ? ` · ${PAYMENT_STATUS_LABEL[purchase.payment_status] ?? purchase.payment_status}` : ''}
                </p>
              </div>
            </div>

            {purchase.bill_number && (
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Bill Number</p>
                <p className="font-medium text-gray-800 mt-0.5">{purchase.bill_number}</p>
              </div>
            )}

            {/* Bill image */}
            {purchase.bill_url && (
              <a href={purchase.bill_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-sm text-amber-700 hover:bg-amber-100 transition-colors">
                <Paperclip size={14} />
                <span className="font-medium">View attached bill / invoice</span>
              </a>
            )}

            {/* Line items */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Items</p>
              {loading ? (
                <div className="flex justify-center py-6"><LoadingSpinner /></div>
              ) : items.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No items recorded</p>
              ) : (
                <div className="space-y-1.5">
                  {/* Header */}
                  <div className="flex gap-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2">
                    <div className="flex-1">Item</div>
                    <div className="w-16 text-right">Qty</div>
                    <div className="w-24 text-right">Unit Cost</div>
                    <div className="w-24 text-right">Total</div>
                  </div>
                  {items.map(item => (
                    <div key={item.id}
                      className="flex gap-2 px-2 py-2 rounded-lg bg-gray-50 text-sm">
                      <div className="flex-1 font-medium text-gray-800 truncate">{item.name}</div>
                      <div className="w-16 text-right tabular-nums text-gray-600">
                        {Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      </div>
                      <div className="w-24 text-right tabular-nums text-gray-600">
                        <Rial amount={item.unit_cost} />
                      </div>
                      <div className="w-24 text-right tabular-nums font-semibold text-gray-800">
                        <Rial amount={item.total} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums"><Rial amount={purchase.subtotal} /></span>
              </div>
              {purchase.vat_amount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>VAT (15%)</span>
                  <span className="tabular-nums"><Rial amount={purchase.vat_amount} /></span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                <span>Total Paid</span>
                <span className="tabular-nums text-emerald-600"><Rial amount={purchase.total_amount} /></span>
              </div>
            </div>

            {purchase.notes && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-gray-600">{purchase.notes}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100">
            <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function PurchaseHistoryTab() {
  const { profile } = useAuth()

  const [purchases,       setPurchases]       = useState<PurchaseRow[]>([])
  const [suppliers,       setSuppliers]       = useState<Supplier[]>([])
  const [inventoryItems,  setInventoryItems]  = useState<InventoryItem[]>([])
  const [loading,         setLoading]         = useState(true)
  const [drawerOpen,      setDrawerOpen]      = useState(false)

  // Detail modal
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRow | null>(null)
  const [viewingItems,    setViewingItems]    = useState<PurchaseItem[]>([])
  const [loadingItems,    setLoadingItems]    = useState(false)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setLoading(false); return }

    const [{ data: purData }, { data: supData }, { data: invData }] = await Promise.all([
      supabase
        .from('purchases')
        .select('*, suppliers(name), purchase_items(id)')
        .eq('branch_id', bid)
        .order('purchase_date', { ascending: false })
        .order('created_at',    { ascending: false }),
      supabase
        .from('suppliers')
        .select('*')
        .eq('tenant_id', tid)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('inventory_items')
        .select('*')
        .eq('branch_id', bid)
        .order('name'),
    ])

    setPurchases((purData ?? []) as unknown as PurchaseRow[])
    setSuppliers((supData ?? []) as unknown as Supplier[])
    setInventoryItems((invData ?? []) as unknown as InventoryItem[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  const viewDetails = async (purchase: PurchaseRow) => {
    setViewingPurchase(purchase)
    setViewingItems([])
    setLoadingItems(true)
    const q = supabase as unknown as { from: (t: string) => any }
    const { data } = await q.from('purchase_items')
      .select('*')
      .eq('purchase_id', purchase.id)
      .order('created_at')
    setViewingItems((data ?? []) as unknown as PurchaseItem[])
    setLoadingItems(false)
  }

  // Summary stats
  const totalSpent     = purchases.reduce((s, p) => s + p.total_amount, 0)
  const totalVat       = purchases.reduce((s, p) => s + p.vat_amount,   0)

  return (
    <div className="space-y-4">

      {/* ── Header row ──────────────────────────────────────── */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex gap-3 flex-1 flex-wrap min-w-0">
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-primary-500 border border-primary-600 text-white shadow-card">
            <p className="text-xs font-medium text-white/70">Total Purchased</p>
            <p className="text-lg font-bold mt-0.5"><Rial amount={totalSpent} /></p>
            <p className="text-[10px] text-white/60 mt-0.5">{purchases.length} purchase{purchases.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
            <p className="text-xs font-medium text-gray-400">VAT Paid</p>
            <p className="text-lg font-bold text-amber-600 mt-0.5"><Rial amount={totalVat} /></p>
            <p className="text-[10px] text-gray-400 mt-0.5">on all purchases</p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
            <p className="text-xs font-medium text-gray-400">Suppliers Used</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">
              {new Set(purchases.map(p => p.supplier_id).filter(Boolean)).size}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">unique vendors</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setDrawerOpen(true)} className="flex-shrink-0 self-start">
          <Plus size={14} />
          Add Purchase
        </Button>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : purchases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <ShoppingCart size={22} className="text-emerald-300" />
          </div>
          <p className="text-gray-700 font-semibold">No purchases recorded yet</p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            Record your first purchase to track inventory and supplier spending
          </p>
          <Button className="mt-5" onClick={() => setDrawerOpen(true)}>
            <Plus size={15} />
            Add Purchase
          </Button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-24 flex-shrink-0">Date</div>
            <div className="flex-1">Supplier</div>
            <div className="w-16 text-center hidden sm:block">Items</div>
            <div className="w-20 hidden lg:block">Method</div>
            <div className="w-24 hidden md:block text-right">VAT</div>
            <div className="w-32 text-right">Total</div>
            <div className="w-20 flex-shrink-0 text-center">Bill</div>
            <div className="w-8 flex-shrink-0" />
          </div>

          {purchases.map(p => (
            <div key={p.id}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/70 transition-colors">

              {/* Date */}
              <div className="w-24 flex-shrink-0">
                <p className="text-sm font-medium text-gray-900">
                  {new Date(p.purchase_date).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short',
                  })}
                </p>
                <p className="text-[10px] text-gray-400">
                  {new Date(p.purchase_date).getFullYear()}
                </p>
              </div>

              {/* Supplier */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {p.suppliers?.name ?? <span className="text-gray-400 font-normal">No supplier</span>}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {MODE_LABEL[p.purchase_mode ?? 'detailed_receiving'] ?? 'Purchase'}
                  {p.bill_number ? ` · Bill ${p.bill_number}` : ''}
                  {p.notes ? ` · ${p.notes}` : ''}
                </p>
              </div>

              {/* Item count */}
              <div className="w-16 text-center hidden sm:block">
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {(p.purchase_mode ?? 'detailed_receiving') === 'simple_bill'
                    ? 'Bill'
                    : `${p.purchase_items.length} item${p.purchase_items.length !== 1 ? 's' : ''}`}
                </span>
              </div>

              {/* Payment method */}
              <div className="w-20 hidden lg:block">
                <Badge variant={PAY_BADGE[p.payment_method] ?? 'neutral'}>
                  {PAY_LABEL[p.payment_method] ?? p.payment_method}
                </Badge>
              </div>

              {/* VAT */}
              <div className="w-24 hidden md:block text-right">
                <p className="text-xs tabular-nums text-amber-600 font-medium">
                  {p.vat_amount > 0 ? <Rial amount={p.vat_amount} /> : '—'}
                </p>
              </div>

              {/* Total */}
              <div className="w-32 text-right">
                <p className="text-sm font-bold text-gray-900 tabular-nums">
                  <Rial amount={p.total_amount} />
                </p>
              </div>

              {/* Bill indicator */}
              <div className="w-20 flex-shrink-0 flex justify-center">
                {p.bill_url ? (
                  <a href={p.bill_url} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg transition-colors">
                    <Paperclip size={10} />
                    Bill
                  </a>
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </div>

              {/* View details */}
              <div className="w-8 flex-shrink-0">
                <button
                  onClick={() => viewDetails(p)}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  title="View details"
                >
                  <Eye size={14} />
                </button>
              </div>
            </div>
          ))}

          {/* Footer total */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="w-24 flex-shrink-0 text-xs font-semibold text-gray-500">
              {purchases.length} purchases
            </div>
            <div className="flex-1" />
            <div className="w-16 hidden sm:block" />
            <div className="w-20 hidden lg:block" />
            <div className="w-24 hidden md:block text-right">
              <p className="text-xs font-bold text-amber-600 tabular-nums"><Rial amount={totalVat} /></p>
            </div>
            <div className="w-32 text-right">
              <p className="text-sm font-bold text-primary-600 tabular-nums"><Rial amount={totalSpent} /></p>
              <p className="text-[10px] text-gray-400">total spent</p>
            </div>
            <div className="w-20" />
            <div className="w-8" />
          </div>
        </div>
      )}

      <PurchaseDrawer
        open={drawerOpen}
        suppliers={suppliers}
        inventoryItems={inventoryItems}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />

      {viewingPurchase && (
        <PurchaseDetailModal
          purchase={viewingPurchase}
          items={viewingItems}
          loading={loadingItems}
          onClose={() => { setViewingPurchase(null); setViewingItems([]) }}
        />
      )}
    </div>
  )
}
