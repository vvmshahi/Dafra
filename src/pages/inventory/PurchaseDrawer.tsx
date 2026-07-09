import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Plus, Trash2, ImagePlus, Banknote, CreditCard, Building } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { Supplier, InventoryItem, Purchase, PurchaseItem } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  key:                         string
  inventory_item_id:           string
  name:                        string
  supplier_item_name:          string
  quantity:                    string
  unit_cost:                   string
  remember_match:              boolean
  match_source:                'manual' | 'mapping' | 'none'
  suggestion_lookup_key?:      string
  suggested_inventory_item_id?: string | null
  suggestion_label?:           string | null
}

type PurchaseMode = 'simple_bill' | 'detailed_receiving'
type TaxInputMode = 'included' | 'excluded'
type PaymentStatus = 'paid' | 'unpaid' | 'partial'

// ── Helpers ───────────────────────────────────────────────────────────────────

function newLine(): LineItem {
  return {
    key:                Math.random().toString(36).slice(2),
    inventory_item_id:  '',
    name:               '',
    supplier_item_name: '',
    quantity:           '',
    unit_cost:          '',
    remember_match:     false,
    match_source:       'none',
  }
}

function lineTotal(l: LineItem): number {
  return (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0)
}

function roundMoney(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100)
}

function normalizeSupplierNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function safeFileName(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
  return cleaned || 'bill'
}

function calculatePurchaseTotals(amountRaw: string, taxMode: TaxInputMode) {
  const amount = Math.max(0, parseFloat(amountRaw) || 0)

  if (taxMode === 'included') {
    const vat = roundMoney(amount * 15 / 115)
    return { subtotal: roundMoney(amount - vat), vat, total: roundMoney(amount) }
  }

  if (taxMode === 'excluded') {
    const vat = roundMoney(amount * 0.15)
    return { subtotal: roundMoney(amount), vat, total: roundMoney(amount + vat) }
  }
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

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'paid',    label: 'Paid' },
  { value: 'unpaid',  label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:           boolean
  suppliers:      Supplier[]
  inventoryItems: InventoryItem[]
  tenantId:       string
  branchId:       string
  editingPurchase?: Purchase | null
  editingItems?:    PurchaseItem[]
  onClose:        () => void
  onSaved:        () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseDrawer({
  open,
  suppliers,
  inventoryItems,
  tenantId,
  branchId,
  editingPurchase = null,
  editingItems = [],
  onClose,
  onSaved,
}: Props) {
  const { profile } = useAuth()
  const fileRef     = useRef<HTMLInputElement>(null)
  const isEditing   = Boolean(editingPurchase)

  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [billFile,    setBillFile]    = useState<File | null>(null)
  const [billPreview, setBillPreview] = useState<string | null>(null)
  const [billChanged, setBillChanged] = useState(false)

  const [mode,          setMode]          = useState<PurchaseMode>('simple_bill')
  const [date,          setDate]          = useState('')
  const [supplierId,    setSupplierId]    = useState('')
  const [billNumber,    setBillNumber]    = useState('')
  const [payMethod,     setPayMethod]     = useState<'cash' | 'card' | 'bank_transfer'>('cash')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid')
  const [taxMode,       setTaxMode]       = useState<TaxInputMode>('included')
  const [simpleAmount,  setSimpleAmount]  = useState('')
  const [lines,         setLines]         = useState<LineItem[]>([newLine()])
  const [notes,         setNotes]         = useState('')
  const resolvedTenantId = tenantId || profile?.tenant_id || ''
  const resolvedBranchId = branchId || profile?.branch_id || ''
  const branchSuppliers = useMemo(
    () => suppliers.filter(supplier => supplier.branch_id === resolvedBranchId),
    [suppliers, resolvedBranchId],
  )

  useEffect(() => {
    if (open) {
      const purchaseMode = editingPurchase?.purchase_mode ?? 'simple_bill'
      const nextTaxMode = editingPurchase?.tax_input_mode === 'excluded' ? 'excluded' : 'included'

      setMode(purchaseMode)
      setDate(editingPurchase?.purchase_date ?? new Date().toISOString().split('T')[0])
      setSupplierId(editingPurchase ? (editingPurchase.supplier_id ?? '') : '')
      setBillNumber(editingPurchase?.bill_number ?? '')
      setPayMethod((editingPurchase?.payment_method as 'cash' | 'card' | 'bank_transfer') ?? 'cash')
      setPaymentStatus((editingPurchase?.payment_status as PaymentStatus) ?? 'paid')
      setTaxMode(nextTaxMode)
      setSimpleAmount(
        editingPurchase
          ? String(nextTaxMode === 'excluded' ? editingPurchase.subtotal : editingPurchase.total_amount)
          : ''
      )
      setLines(
        editingPurchase && purchaseMode === 'detailed_receiving'
          ? (editingItems.length > 0 ? editingItems.map(item => ({
              key: item.id,
              inventory_item_id: item.inventory_item_id ?? '',
              name: item.name,
              supplier_item_name: item.supplier_item_name ?? item.name,
              quantity: String(item.quantity),
              unit_cost: String(item.unit_cost),
              remember_match: false,
              match_source: item.inventory_item_id
                ? (item.match_source === 'mapping' ? 'mapping' : 'manual')
                : 'none',
            })) : [newLine()])
          : [newLine()]
      )
      setBillFile(null)
      setBillChanged(false)
      setBillPreview(editingPurchase?.bill_path ? 'attached' : editingPurchase?.bill_url ?? null)
      setNotes(editingPurchase?.notes ?? '')
      setError('')
    }
  }, [open, editingPurchase, editingItems])

  useEffect(() => {
    if (!open || !supplierId) return
    if (!branchSuppliers.some(supplier => supplier.id === supplierId)) {
      setSupplierId('')
    }
  }, [open, supplierId, branchSuppliers])

  const handleSupplierChange = (value: string) => {
    setSupplierId(value)
  }

  const updateLine = (key: string, patch: Partial<LineItem>) =>
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))

  const selectItem = (key: string, itemId: string) => {
    if (!itemId) {
      setLines(prev => prev.map(l => l.key === key ? {
        ...l,
        inventory_item_id: '',
        name: l.supplier_item_name,
        remember_match: false,
        match_source: 'none',
      } : l))
      return
    }
    const item = inventoryItems.find(i => i.id === itemId)
    setLines(prev => prev.map(l => l.key === key ? {
      ...l,
      inventory_item_id: itemId,
      name:              item?.name ?? l.name,
      unit_cost:         l.unit_cost || (item ? String(item.unit_cost) : ''),
      match_source:      'manual',
    } : l))
  }

  const updateSupplierItemName = (key: string, value: string) => {
    setLines(prev => prev.map(l => l.key === key ? {
      ...l,
      supplier_item_name: value,
      name: l.inventory_item_id ? l.name : value,
      match_source: l.inventory_item_id ? 'manual' : 'none',
      suggestion_lookup_key: undefined,
      suggested_inventory_item_id: null,
      suggestion_label: null,
    } : l))
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
    setBillChanged(true)
  }

  useEffect(() => {
    if (!open || mode !== 'detailed_receiving' || !supplierId) return

    const pending = lines.filter(line => {
      const normalized = normalizeSupplierNameKey(line.supplier_item_name)
      const lookupKey = `${supplierId}:${normalized}`
      return normalized.length >= 2 &&
        !line.inventory_item_id &&
        line.suggestion_lookup_key !== lookupKey
    })

    if (pending.length === 0) return

    const timer = window.setTimeout(() => {
      pending.forEach(async line => {
        const normalized = normalizeSupplierNameKey(line.supplier_item_name)
        const lookupKey = `${supplierId}:${normalized}`

        const { data, error: suggestionErr } = await (supabase as any).rpc('suggest_supplier_item_mapping', {
          p_supplier_id: supplierId,
          p_supplier_item_name: line.supplier_item_name,
          p_branch_id: resolvedBranchId || null,
        })

        if (suggestionErr) {
          setLines(prev => prev.map(current => current.key === line.key ? {
            ...current,
            suggestion_lookup_key: lookupKey,
          } : current))
          return
        }

        const matchedId = data?.matched_inventory_item_id as string | undefined
        const matchedItem = matchedId ? inventoryItems.find(item => item.id === matchedId) : null

        setLines(prev => prev.map(current => {
          if (current.key !== line.key) return current
          if (current.inventory_item_id || normalizeSupplierNameKey(current.supplier_item_name) !== normalized) {
            return current
          }

          if (!matchedId || !matchedItem) {
            return {
              ...current,
              suggestion_lookup_key: lookupKey,
              suggested_inventory_item_id: null,
              suggestion_label: null,
            }
          }

          return {
            ...current,
            inventory_item_id: matchedId,
            name: matchedItem.name,
            unit_cost: current.unit_cost || String(matchedItem.unit_cost),
            remember_match: false,
            match_source: 'mapping',
            suggestion_lookup_key: lookupKey,
            suggested_inventory_item_id: matchedId,
            suggestion_label: matchedItem.name,
          }
        }))
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [open, mode, supplierId, lines, inventoryItems, resolvedBranchId])

  // Totals
  const rawLineAmount = roundMoney(lines.reduce((s, l) => s + lineTotal(l), 0))
  const simpleTotals = calculatePurchaseTotals(simpleAmount, taxMode)
  const detailedTotals = calculatePurchaseTotals(String(rawLineAmount), taxMode)

  const lineSupplierName = (line: LineItem) =>
    (line.supplier_item_name || line.name).trim()

  const uploadBill = async (tenantId: string, branchId: string, purchaseKey: string) => {
    if (!billFile) return null

    const originalName = safeFileName(billFile.name)
    const fallbackExt = billFile.type === 'application/pdf' ? 'pdf' : 'jpg'
    const ext = originalName.includes('.') ? originalName.split('.').pop()! : fallbackExt
    const baseName = originalName.replace(/\.[^.]+$/, '') || 'bill'
    const path = `${tenantId}/${branchId}/purchases/${purchaseKey}/${Date.now()}-${baseName}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('purchases-bills')
      .upload(path, billFile, { upsert: false })

    if (upErr) throw new Error('Bill upload failed: ' + upErr.message)
    return path
  }

  const setPurchaseAttachment = async (purchaseId: string, billPath: string | null) => {
    if (!billChanged) return

    const { error: attachmentErr } = await (supabase as any).rpc('set_purchase_bill_attachment', {
      p_purchase_id: purchaseId,
      p_bill_path: billPath,
      p_clear: billPath === null,
    })

    if (attachmentErr) throw new Error(attachmentErr.message)
  }

  const rememberSelectedMatches = async (sourceLines: LineItem[]) => {
    if (!supplierId) return

    const matches = sourceLines.filter(line =>
      line.remember_match &&
      line.inventory_item_id &&
      lineSupplierName(line)
    )

    const results = await Promise.all(matches.map(line =>
      (supabase as any).rpc('upsert_supplier_item_mapping', {
        p_payload: {
          supplier_id: supplierId,
          supplier_item_name: lineSupplierName(line),
          matched_inventory_item_id: line.inventory_item_id,
          branch_id: resolvedBranchId || null,
        },
      })
    ))

    const failed = results.find(result => result.error)
    if (failed?.error) throw new Error(failed.error.message)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validLines = lines.filter(
      l => lineSupplierName(l) && (parseFloat(l.quantity) || 0) > 0
    )
    const selectedSupplier = supplierId
      ? branchSuppliers.find(supplier => supplier.id === supplierId) ?? null
      : null
    if (!date) {
      setError('Purchase date is required')
      return
    }
    if (mode === 'simple_bill' && !supplierId) {
      setError('Supplier is required for simple bill entry')
      return
    }
    if (supplierId && !selectedSupplier) {
      setError('Select a valid supplier for this branch.')
      return
    }
    if (mode === 'simple_bill' && simpleTotals.total <= 0) {
      setError('Enter a bill amount greater than zero')
      return
    }
    if (mode === 'detailed_receiving' && validLines.length === 0) {
      setError('Add at least one item with a name and quantity')
      return
    }

    setSaving(true)
    setError('')

    try {
      const tid = resolvedTenantId
      const bid = resolvedBranchId
      if (!tid || !bid) {
        setError('Branch profile is required before saving purchases')
        return
      }
      if (selectedSupplier && selectedSupplier.tenant_id !== tid) {
        setError('This supplier is not valid for this business.')
        return
      }
      if (selectedSupplier && selectedSupplier.branch_id !== bid) {
        setError('This supplier belongs to another branch. Select a supplier for this branch.')
        return
      }

      const purchaseTotals = mode === 'simple_bill' ? simpleTotals : detailedTotals

      const purchasePayload = {
        tenant_id:      tid,
        branch_id:      bid,
        supplier_id:    supplierId || null,
        added_by:       profile?.id ?? null,
        purchase_date:  date,
        purchase_mode:  mode,
        status:         mode === 'detailed_receiving' ? 'draft' : 'posted',
        receiving_status: mode === 'detailed_receiving' ? 'pending_confirmation' : 'not_applicable',
        bill_number:    billNumber.trim() || null,
        tax_input_mode: taxMode,
        payment_status: paymentStatus,
        subtotal:       purchaseTotals.subtotal,
        vat_amount:     purchaseTotals.vat,
        total_amount:   purchaseTotals.total,
        payment_method: payMethod,
        bill_url:       null,
        bill_path:      null as string | null,
        notes:          notes.trim() || null,
      }

      const billPath = await uploadBill(tid, bid, editingPurchase?.id ?? crypto.randomUUID())
      purchasePayload.bill_path = billPath

      const q = supabase as unknown as { from: (t: string) => any }

      if (isEditing && editingPurchase) {
        const payload: Record<string, unknown> = {
          purchase_id:     editingPurchase.id,
          supplier_id:     supplierId || null,
          purchase_date:   date,
          bill_number:     billNumber.trim() || null,
          tax_input_mode:  taxMode,
          payment_status:  paymentStatus,
          payment_method:  payMethod,
          notes:           notes.trim() || null,
        }

        if (mode === 'simple_bill') {
          payload.amount = Number(simpleAmount)
        } else {
          payload.items = validLines.map(l => ({
            inventory_item_id: l.inventory_item_id || null,
            name:              lineSupplierName(l),
            supplier_item_name: lineSupplierName(l),
            match_source:      l.inventory_item_id ? l.match_source : 'none',
            quantity:          parseFloat(l.quantity),
            unit_cost:         parseFloat(l.unit_cost) || 0,
          }))
        }

        const { error: editErr } = await (supabase as any).rpc('update_purchase_entry', {
          p_payload: payload,
        })

        if (editErr) { setError(editErr.message); return }

        await setPurchaseAttachment(editingPurchase.id, billPath)
        await rememberSelectedMatches(validLines).catch(err => console.warn('Remembering supplier item mapping failed', err))

        onSaved()
        onClose()
        return
      }

      // Insert purchase header. Receive Stock is saved pending confirmation;
      // Phase 4C stock changes happen only through confirm_purchase_receiving.
      const { data: purData, error: purErr } = await q.from('purchases')
        .insert(purchasePayload)
        .select('id')
        .single()

      if (purErr) {
        const mappedUiError = /Purchase supplier does not belong/i.test(purErr.message)
          ? 'Selected supplier does not match this branch. Refresh the page and select a supplier from this branch.'
          : purErr.message
        setError(mappedUiError)
        return
      }

      const purchaseId = purData.id

      if (mode === 'simple_bill') {
        if (billPath) await setPurchaseAttachment(purchaseId, billPath)
        onSaved()
        onClose()
        return
      }

      // Insert line items as receiving detail only. Linked stock is increased
      // later by confirm_purchase_receiving after human confirmation.
      const { error: itemsErr } = await q.from('purchase_items').insert(
        validLines.map(l => ({
          purchase_id:       purchaseId,
          inventory_item_id: l.inventory_item_id || null,
          name:              lineSupplierName(l),
          supplier_item_name: lineSupplierName(l),
          line_type:         l.inventory_item_id ? 'stock' : 'non_stock',
          receiving_status:  'pending',
          received_quantity: 0,
          match_source:      l.inventory_item_id ? l.match_source : 'none',
          quantity:          parseFloat(l.quantity),
          unit_cost:         parseFloat(l.unit_cost) || 0,
          total:             lineTotal(l),
        }))
      )

      if (itemsErr) {
        setError(itemsErr.message)
        return
      }

      if (billPath) await setPurchaseAttachment(purchaseId, billPath)
      await rememberSelectedMatches(validLines).catch(err => console.warn('Remembering supplier item mapping failed', err))

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const selectedSupplier = supplierId
    ? branchSuppliers.find(supplier => supplier.id === supplierId)
    : null
  const simpleBillCanSubmit = mode !== 'simple_bill' ||
    Boolean(date && supplierId && selectedSupplier && selectedSupplier.branch_id === resolvedBranchId && simpleTotals.total > 0)

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-full max-w-[620px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">{isEditing ? 'Edit Purchase' : 'Add Purchase'}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {mode === 'simple_bill' ? 'Record a supplier bill' : 'Record stock from supplier'}
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Mode selector ─────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'simple_bill', label: 'Simple Bill', desc: 'No stock update' },
                { value: 'detailed_receiving', label: 'Receive Stock', desc: 'Confirm before stock updates' },
              ] as { value: PurchaseMode; label: string; desc: string }[]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isEditing}
                  onClick={() => { if (!isEditing) setMode(opt.value) }}
                  className={`text-left rounded-xl border px-4 py-3 transition-all ${
                    mode === opt.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  } ${isEditing ? 'cursor-default' : ''}`}
                >
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="block text-xs opacity-70 mt-0.5">{opt.desc}</span>
                </button>
              ))}
            </div>

            {/* ── Header info ───────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Purchase Details</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Date <span className="text-red-500">*</span></label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Supplier {mode === 'simple_bill' && <span className="text-red-500">*</span>}</label>
                  <select className="input" value={supplierId} onChange={e => handleSupplierChange(e.target.value)}>
                    <option value="">— No Supplier —</option>
                    {branchSuppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {branchSuppliers.length === 0 && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-amber-600">
                      No suppliers found for this branch. Add a supplier first.
                    </p>
                  )}
                  {supplierId && !selectedSupplier && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-red-600">
                      Select a valid supplier for this branch.
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="label">Bill / Invoice Number</label>
                  <input
                    className="input"
                    value={billNumber}
                    onChange={e => setBillNumber(e.target.value)}
                    placeholder="Optional supplier bill number"
                  />
                </div>
              </div>
            </div>

            {/* ── Payment method ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Payment</SectionLabel>
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
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPaymentStatus(opt.value)}
                    className={`py-2 rounded-xl border text-sm font-medium transition-all ${
                      paymentStatus === opt.value
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'simple_bill' && (
              <div className="space-y-4">
                <SectionLabel>Bill Amount</SectionLabel>
                <div>
                  <label className="label">
                    {taxMode === 'excluded' ? 'Subtotal Before VAT' : 'Total Amount'}
                    <span className="text-red-500"> *</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={simpleAmount}
                    onChange={e => setSimpleAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'included', label: 'VAT Included' },
                    { value: 'excluded', label: 'VAT Excluded' },
                  ] as { value: TaxInputMode; label: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTaxMode(opt.value)}
                      className={`py-2 rounded-xl border text-xs font-semibold transition-all ${
                        taxMode === opt.value
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {simpleTotals.total > 0 && (
                  <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium"><Rial amount={simpleTotals.subtotal} /></span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>VAT</span>
                      <span className="tabular-nums font-medium"><Rial amount={simpleTotals.vat} /></span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-2">
                      <span>Total</span>
                      <span className="tabular-nums text-emerald-600"><Rial amount={simpleTotals.total} /></span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === 'detailed_receiving' && (
              <>
                {/* ── Line items ────────────────────────────────── */}
                <div className="space-y-3">
                  <SectionLabel>Items Purchased</SectionLabel>
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Lines are saved for review. Linked stock increases only after Confirm Receiving.
                  </div>

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

                        {line.match_source === 'mapping' && line.suggestion_label && (
                          <div className="pl-7">
                            <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                              Suggested: {line.suggestion_label}
                            </span>
                          </div>
                        )}

                        <div className="flex gap-2 pl-7">
                          <div className="flex-1">
                            <input
                              className="input text-sm"
                              value={line.supplier_item_name}
                              onChange={e => updateSupplierItemName(line.key, e.target.value)}
                              placeholder="Supplier item name *"
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
                              <Rial amount={lineTotal(line)} />
                            </span>
                          </div>
                        </div>

                        {supplierId && line.inventory_item_id && lineSupplierName(line) && (
                          <label className="ml-7 flex items-center gap-2 text-xs text-gray-500">
                            <input
                              type="checkbox"
                              checked={line.remember_match}
                              onChange={e => updateLine(line.key, { remember_match: e.target.checked })}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            Remember this match for this supplier
                          </label>
                        )}
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

                {/* ── VAT mode ──────────────────────────────────── */}
                <div className="space-y-2">
                  <SectionLabel>VAT</SectionLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'included', label: 'VAT Included' },
                      { value: 'excluded', label: 'VAT Excluded' },
                    ] as { value: TaxInputMode; label: string }[]).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTaxMode(opt.value)}
                        className={`py-2 rounded-xl border text-xs font-semibold transition-all ${
                          taxMode === opt.value
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Totals ────────────────────────────────────── */}
                {rawLineAmount > 0 && (
                  <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium"><Rial amount={detailedTotals.subtotal} /></span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>VAT (15%)</span>
                      <span className="tabular-nums font-medium"><Rial amount={detailedTotals.vat} /></span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-2">
                      <span>Total</span>
                      <span className="tabular-nums text-emerald-600"><Rial amount={detailedTotals.total} /></span>
                    </div>
                  </div>
                )}
              </>
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
                  {(billFile?.type.startsWith('image/') || billPreview.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) ? (
                    <img src={billPreview} alt="Bill"
                      className="w-full h-36 object-cover rounded-xl border border-gray-200" />
                  ) : (
                    <div className="w-full h-16 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-sm text-gray-500">Bill attached</p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      Change
                    </button>
                    <button type="button" onClick={() => { setBillFile(null); setBillPreview(null); setBillChanged(true) }}
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
            <Button type="submit" className="flex-1" loading={saving} disabled={saving || !simpleBillCanSubmit}>
              {isEditing ? 'Save Changes' : mode === 'simple_bill' ? 'Record Bill' : 'Save for Confirmation'}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
