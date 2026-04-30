import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, ImagePlus, Banknote, CreditCard, Building } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { Supplier, InventoryItem } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  key:               string
  inventory_item_id: string
  name:              string
  quantity:          string
  unit_cost:         string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newLine(): LineItem {
  return { key: Math.random().toString(36).slice(2), inventory_item_id: '', name: '', quantity: '', unit_cost: '' }
}

function lineTotal(l: LineItem): number {
  return (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0)
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest pt-1">
      {children}
    </p>
  )
}

// ── Payment options ───────────────────────────────────────────────────────────

const PAY_OPTIONS = [
  { value: 'cash',          label: 'Cash',          icon: Banknote   },
  { value: 'card',          label: 'Card',          icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building   },
] as const

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:           boolean
  suppliers:      Supplier[]
  inventoryItems: InventoryItem[]
  onClose:        () => void
  onSaved:        () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseDrawer({ open, suppliers, inventoryItems, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const fileRef     = useRef<HTMLInputElement>(null)

  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [billFile,    setBillFile]    = useState<File | null>(null)
  const [billPreview, setBillPreview] = useState<string | null>(null)

  const [date,       setDate]       = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [payMethod,  setPayMethod]  = useState<'cash' | 'card' | 'bank_transfer'>('cash')
  const [hasVat,     setHasVat]     = useState(false)
  const [lines,      setLines]      = useState<LineItem[]>([newLine()])
  const [notes,      setNotes]      = useState('')

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().split('T')[0])
      setSupplierId('')
      setPayMethod('cash')
      setHasVat(false)
      setLines([newLine()])
      setBillFile(null)
      setBillPreview(null)
      setNotes('')
      setError('')
    }
  }, [open])

  const updateLine = (key: string, patch: Partial<LineItem>) =>
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))

  const selectItem = (key: string, itemId: string) => {
    if (!itemId) { updateLine(key, { inventory_item_id: '', name: '', unit_cost: '' }); return }
    const item = inventoryItems.find(i => i.id === itemId)
    updateLine(key, {
      inventory_item_id: itemId,
      name:              item?.name ?? '',
      unit_cost:         item ? String(item.unit_cost) : '',
    })
  }

  const removeLine = (key: string) => {
    if (lines.length === 1) return
    setLines(prev => prev.filter(l => l.key !== key))
  }

  const handleBillChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBillFile(file)
    setBillPreview(URL.createObjectURL(file))
  }

  // Totals
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const vatAmt   = hasVat ? subtotal * 0.15 : 0
  const totalAmt = subtotal + vatAmt
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validLines = lines.filter(
      l => l.name.trim() && (parseFloat(l.quantity) || 0) > 0
    )
    if (validLines.length === 0) {
      setError('Add at least one item with a name and quantity')
      return
    }

    setSaving(true)
    setError('')

    try {
      const tid = profile?.tenant_id!
      const bid = profile?.branch_id!

      // Upload bill
      let billUrl: string | null = null
      if (billFile) {
        const ext  = billFile.name.split('.').pop() ?? 'jpg'
        const path = `${tid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('purchases-bills')
          .upload(path, billFile, { upsert: true })
        if (upErr) { setError('Bill upload failed: ' + upErr.message); return }
        const { data: { signedUrl } } = await supabase.storage
          .from('purchases-bills')
          .createSignedUrl(path, 60 * 60 * 24 * 365)
        billUrl = signedUrl
      }

      const q = supabase as unknown as { from: (t: string) => any }

      // Insert purchase header
      const { data: purData, error: purErr } = await q.from('purchases')
        .insert({
          tenant_id:      tid,
          branch_id:      bid,
          supplier_id:    supplierId || null,
          added_by:       profile?.id ?? null,
          purchase_date:  date,
          subtotal:       parseFloat(subtotal.toFixed(2)),
          vat_amount:     parseFloat(vatAmt.toFixed(2)),
          total_amount:   parseFloat(totalAmt.toFixed(2)),
          payment_method: payMethod,
          bill_url:       billUrl,
          notes:          notes.trim() || null,
        })
        .select('id')
        .single()

      if (purErr) { setError(purErr.message); return }

      const purchaseId = purData.id

      // Insert line items (trigger updates inventory_items.current_quantity)
      const { error: itemsErr } = await q.from('purchase_items').insert(
        validLines.map(l => ({
          purchase_id:       purchaseId,
          inventory_item_id: l.inventory_item_id || null,
          name:              l.name.trim(),
          quantity:          parseFloat(l.quantity),
          unit_cost:         parseFloat(l.unit_cost) || 0,
          total:             lineTotal(l),
        }))
      )

      if (itemsErr) { setError(itemsErr.message); return }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-full max-w-[620px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">Add Purchase</h2>
              <p className="text-xs text-gray-400 mt-0.5">Record stock received from supplier</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Header info ───────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Purchase Details</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Date <span className="text-red-500">*</span></label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Supplier</label>
                  <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">— No Supplier —</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Payment method ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Payment Method</SectionLabel>
              <div className="flex gap-2">
                {PAY_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPayMethod(value)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      payMethod === value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Line items ────────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Items Purchased</SectionLabel>

              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={line.key} className="bg-gray-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400 w-5">{idx + 1}.</span>
                      <select
                        className="input flex-1 text-sm"
                        value={line.inventory_item_id}
                        onChange={e => selectItem(line.key, e.target.value)}
                      >
                        <option value="">— Select stock item (optional) —</option>
                        {inventoryItems.map(i => (
                          <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="flex gap-2 pl-7">
                      <div className="flex-1">
                        <input
                          className="input text-sm"
                          value={line.name}
                          onChange={e => updateLine(line.key, { name: e.target.value })}
                          placeholder="Item name *"
                        />
                      </div>
                      <div className="w-24">
                        <input
                          className="input text-sm"
                          type="number"
                          step="0.001"
                          min="0"
                          value={line.quantity}
                          onChange={e => updateLine(line.key, { quantity: e.target.value })}
                          placeholder="Qty *"
                        />
                      </div>
                      <div className="w-28">
                        <input
                          className="input text-sm"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.unit_cost}
                          onChange={e => updateLine(line.key, { unit_cost: e.target.value })}
                          placeholder="Unit cost"
                        />
                      </div>
                      <div className="w-28 flex items-center justify-end">
                        <span className="text-sm font-semibold text-gray-700 tabular-nums">
                          SAR {fmt(lineTotal(line))}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setLines(prev => [...prev, newLine()])}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-primary-400 hover:text-primary-500 transition-colors"
              >
                <Plus size={15} />
                Add another item
              </button>
            </div>

            {/* ── VAT toggle ────────────────────────────────── */}
            <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-amber-800">Include VAT (15%)</p>
                <p className="text-xs text-amber-600 mt-0.5">Add 15% VAT to the subtotal</p>
              </div>
              <button
                type="button"
                onClick={() => setHasVat(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  hasVat ? 'bg-amber-500' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                  hasVat ? 'translate-x-[22px]' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* ── Totals ────────────────────────────────────── */}
            {subtotal > 0 && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums font-medium">SAR {fmt(subtotal)}</span>
                </div>
                {hasVat && (
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>VAT (15%)</span>
                    <span className="tabular-nums font-medium">SAR {fmt(vatAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span className="tabular-nums text-emerald-600">SAR {fmt(totalAmt)}</span>
                </div>
              </div>
            )}

            {/* ── Bill upload ───────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Bill / Invoice (optional)</SectionLabel>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={handleBillChange}
              />
              {billPreview ? (
                <div className="relative group/img">
                  {billPreview.startsWith('blob:') || billPreview.match(/\.(jpg|jpeg|png|webp)/i) ? (
                    <img src={billPreview} alt="Bill"
                      className="w-full h-36 object-cover rounded-xl border border-gray-200" />
                  ) : (
                    <div className="w-full h-16 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-sm text-gray-500">📄 Bill attached</p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      Change
                    </button>
                    <button type="button" onClick={() => { setBillFile(null); setBillPreview(null) }}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full h-20 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/20 transition-colors group/up">
                  <ImagePlus size={18} className="text-gray-300 group-hover/up:text-primary-400" />
                  <p className="text-xs text-gray-400 group-hover/up:text-primary-500">Attach bill photo or PDF</p>
                </button>
              )}
            </div>

            {/* ── Notes ─────────────────────────────────────── */}
            <div>
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>
              Record Purchase
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
