import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { X, Plus, Trash2, ImagePlus, Banknote, CreditCard, Building, FileText, Check, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import type { Supplier, InventoryItem, Purchase, PurchaseItem } from '@/types'
import { useTranslation } from 'react-i18next'

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
  { value: 'cash',          icon: Banknote   },
  { value: 'card',          icon: CreditCard },
  { value: 'bank_transfer', icon: Building   },
] as const

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:           boolean
  suppliers:      Supplier[]
  inventoryItems: InventoryItem[]
  tenantId:       string
  branchId:       string
  stockEnabled:   boolean
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
  stockEnabled,
  editingPurchase = null,
  editingItems = [],
  onClose,
  onSaved,
}: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['purchases', 'common'])
  const fileRef     = useRef<HTMLInputElement>(null)
  const dialogRef   = useRef<HTMLDivElement>(null)
  const supplierRef = useRef<HTMLSelectElement>(null)
  const modeRef = useRef<HTMLFieldSetElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isEditing   = Boolean(editingPurchase)

  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [billFile,    setBillFile]    = useState<File | null>(null)
  const [billPreview, setBillPreview] = useState<string | null>(null)
  const [billChanged, setBillChanged] = useState(false)

  const [mode,          setMode]          = useState<PurchaseMode | null>(null)
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

  const resetTransientState = useCallback(() => {
    setSaving(false)
    setError('')
    setBillFile(null)
    setBillPreview(null)
    setBillChanged(false)
    setMode(null)
    setDate('')
    setSupplierId('')
    setBillNumber('')
    setPayMethod('cash')
    setPaymentStatus('paid')
    setTaxMode('included')
    setSimpleAmount('')
    setLines([newLine()])
    setNotes('')
  }, [])

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      const purchaseMode = editingPurchase?.purchase_mode ?? null
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
      window.setTimeout(() => {
        if (editingPurchase) supplierRef.current?.focus()
        else modeRef.current?.focus()
      }, 0)
    }
  }, [open, editingPurchase, editingItems])

  const requestClose = useCallback(() => {
    if (saving) return
    resetTransientState()
    onClose()
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
  }, [onClose, resetTransientState, saving])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!nodes.length) return
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes[nodes.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
        event.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose, saving])

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

  const changeMode = (nextMode: PurchaseMode) => {
    if (isEditing || nextMode === mode) return
    setMode(nextMode)
    setError('')
    if (nextMode === 'simple_bill') setLines([newLine()])
    else setSimpleAmount('')
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

  const lineSupplierName = (line: LineItem) =>
    (line.supplier_item_name || line.name).trim()

  // Totals
  const rawLineAmount = roundMoney(lines.reduce((s, l) => s + lineTotal(l), 0))
  const simpleTotals = calculatePurchaseTotals(simpleAmount, taxMode)
  const detailedTotals = calculatePurchaseTotals(String(rawLineAmount), taxMode)
  const activeTotals = mode === 'simple_bill' ? simpleTotals : detailedTotals
  const validLines = lines.filter(
    line => lineSupplierName(line) && (parseFloat(line.quantity) || 0) > 0
  )
  const totalReceivingQuantity = validLines.reduce(
    (sum, line) => sum + (parseFloat(line.quantity) || 0),
    0,
  )

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

    if (!mode) {
      setError(t('purchases:errors.purchaseTypeRequired'))
      modeRef.current?.focus()
      return
    }
    const selectedSupplier = supplierId
      ? branchSuppliers.find(supplier => supplier.id === supplierId) ?? null
      : null
    if (!date) {
      setError(t('purchases:errors.dateRequired'))
      dateRef.current?.focus()
      return
    }
    if (mode === 'simple_bill' && !supplierId) {
      setError(t('purchases:errors.supplierRequired'))
      supplierRef.current?.focus()
      return
    }
    if (supplierId && !selectedSupplier) {
      setError(t('purchases:errors.supplierInvalid'))
      return
    }
    if (mode === 'simple_bill' && simpleTotals.total <= 0) {
      setError(t('purchases:errors.amountPositive'))
      amountRef.current?.focus()
      return
    }
    if (mode === 'detailed_receiving' && validLines.length === 0) {
      setError(t('purchases:errors.itemRequired'))
      return
    }

    setSaving(true)
    setError('')

    try {
      const tid = resolvedTenantId
      const bid = resolvedBranchId
      if (!tid || !bid) {
        setError(t('purchases:errors.branchRequired'))
        return
      }
      if (selectedSupplier && selectedSupplier.tenant_id !== tid) {
        setError(t('purchases:errors.supplierBusinessInvalid'))
        return
      }
      if (selectedSupplier && selectedSupplier.branch_id !== bid) {
        setError(t('purchases:errors.supplierBranchInvalid'))
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

        if (editErr) { console.error('[PurchaseDrawer] update failed', editErr); setError(t('purchases:errors.saveFailed')); return }

        await setPurchaseAttachment(editingPurchase.id, billPath)
        await rememberSelectedMatches(validLines).catch(err => console.warn('Remembering supplier item mapping failed', err))

        toast.success(t(mode === 'simple_bill' ? 'purchases:success.bill' : 'purchases:success.receiving'))
        onSaved()
        resetTransientState()
        onClose()
        window.setTimeout(() => previousFocusRef.current?.focus(), 0)
        return
      }

      // Insert purchase header. Receive Stock is saved pending confirmation;
      // Phase 4C stock changes happen only through confirm_purchase_receiving.
      const { data: purData, error: purErr } = await q.from('purchases')
        .insert(purchasePayload)
        .select('id')
        .single()

      if (purErr) {
        console.error('[PurchaseDrawer] purchase insert failed', purErr)
        setError(/Purchase supplier does not belong/i.test(purErr.message)
          ? t('purchases:errors.supplierBranchInvalid')
          : t('purchases:errors.saveFailed'))
        return
      }

      const purchaseId = purData.id

      if (mode === 'simple_bill') {
        if (billPath) await setPurchaseAttachment(purchaseId, billPath)
        toast.success(t('purchases:success.bill'))
        onSaved()
        resetTransientState()
        onClose()
        window.setTimeout(() => previousFocusRef.current?.focus(), 0)
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
        console.error('[PurchaseDrawer] item insert failed', itemsErr)
        setError(t('purchases:errors.saveFailed'))
        return
      }

      if (billPath) await setPurchaseAttachment(purchaseId, billPath)
      await rememberSelectedMatches(validLines).catch(err => console.warn('Remembering supplier item mapping failed', err))

      toast.success(t('purchases:success.receiving'))
      onSaved()
      resetTransientState()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } catch (err) {
      console.error('[PurchaseDrawer] save failed', err)
      setError(t('purchases:errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const selectedSupplier = supplierId
    ? branchSuppliers.find(supplier => supplier.id === supplierId)
    : null
  const supplierIsValid = !supplierId || Boolean(selectedSupplier?.branch_id === resolvedBranchId)
  const simpleBillCanSubmit = Boolean(
    date && supplierId && supplierIsValid && simpleTotals.total > 0
  )
  const receivingCanSubmit = Boolean(
    date && supplierIsValid && validLines.length > 0
  )
  const formCanSubmit = Boolean(mode && (
    mode === 'simple_bill' ? simpleBillCanSubmit : receivingCanSubmit
  ))
  const dynamicSubtitle = !mode
    ? t('purchases:modal.chooseType')
    : t(mode === 'simple_bill' ? 'purchases:modal.simpleSubtitle' : 'purchases:modal.receivingSubtitle')

  return (
    <div
      className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-modal-title"
        aria-describedby="purchase-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,880px)]"
      >
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <FileText size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 id="purchase-modal-title" className="truncate text-base font-bold text-gray-900">
                  {t(isEditing ? 'purchases:edit' : 'purchases:new')}
                </h2>
                {mode && (
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                    {t(mode === 'simple_bill' ? 'purchases:mode.simple' : 'purchases:mode.receiving')}
                  </span>
                )}
              </div>
              <p id="purchase-modal-description" className="mt-0.5 truncate text-xs text-gray-500">{dynamicSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              aria-label={t('common:close')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <fieldset ref={modeRef} tabIndex={-1} aria-describedby={!mode && error ? 'purchase-form-error' : undefined}>
              <legend className="sr-only">{t('purchases:modal.modeLegend')}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  { value: 'simple_bill', label: t('purchases:mode.simple'), desc: t('purchases:modal.simpleExplanation') },
                  { value: 'detailed_receiving', label: t('purchases:mode.receiving'), desc: t('purchases:modal.receivingExplanation') },
                ] as { value: PurchaseMode; label: string; desc: string }[]).map(opt => {
                  const disabled = isEditing || (!stockEnabled && opt.value === 'detailed_receiving')
                  const checked = mode === opt.value
                  return (
                    <label key={opt.value} className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-primary-500 ${
                      checked ? 'border-primary-600 bg-primary-50' : 'border-gray-200 bg-white'
                    } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                      <input
                        type="radio"
                        name="purchase-mode"
                        value={opt.value}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => changeMode(opt.value)}
                        className="sr-only"
                      />
                      <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                        checked ? 'border-primary-700 bg-primary-700 text-white' : 'border-gray-300'
                      }`}>
                        {checked && <Check size={12} aria-hidden="true" />}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-gray-900">{opt.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-gray-500">{opt.desc}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {mode && (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(280px,1fr)]">
            <div className="min-w-0 space-y-4">
            <section aria-labelledby="purchase-details-heading">
              <SectionHeading id="purchase-details-heading">{t('purchases:sections.details')}</SectionHeading>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="purchase-date">{t('purchases:fields.date')} <span className="text-red-600">*</span></label>
                  <input ref={dateRef} id="purchase-date" className="input" type="date" value={date} onChange={event => setDate(event.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="purchase-supplier">
                    {t('purchases:fields.supplier')} {mode === 'simple_bill' && <span className="text-red-600">*</span>}
                  </label>
                  <select
                    ref={supplierRef}
                    id="purchase-supplier"
                    className="input"
                    value={supplierId}
                    aria-invalid={Boolean(supplierId && !selectedSupplier)}
                    onChange={event => handleSupplierChange(event.target.value)}
                  >
                    <option value="">— {t('purchases:noSupplier')} —</option>
                    {branchSuppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name_ar || supplier.name}</option>
                    ))}
                  </select>
                  {branchSuppliers.length === 0 && (
                    <p role="status" className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                      <AlertTriangle size={12} className="flex-shrink-0 text-amber-600" aria-hidden="true" />
                      <span>{t('purchases:modal.supplierCompactEmpty')}</span>
                      <a href="/suppliers" target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline underline-offset-2">
                        {t('purchases:modal.addSupplier')}
                      </a>
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="purchase-bill-number">{t('purchases:fields.billNumber')}</label>
                  <input
                    id="purchase-bill-number"
                    className="input"
                    value={billNumber}
                    onChange={event => setBillNumber(event.target.value)}
                    placeholder={t('purchases:modal.supplierBillNumber')}
                  />
                </div>
                <div>
                  <span className="label">{t('purchases:sections.attachment')}</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                    className="hidden"
                    onChange={handleBillChange}
                  />
                  <div className="flex h-[38px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-gray-600 hover:text-primary-700">
                      <ImagePlus size={14} className="flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{billFile?.name || (billPreview ? t('purchases:billAttached') : t('purchases:attachBill'))}</span>
                    </button>
                    {billPreview && (
                      <button type="button" aria-label={t('purchases:remove')}
                        onClick={() => { setBillFile(null); setBillPreview(null); setBillChanged(true) }}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600">
                        <X size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {mode === 'detailed_receiving' && (
              <section aria-labelledby="purchase-items-heading">
                <SectionHeading id="purchase-items-heading">{t('purchases:modal.receivingItems')}</SectionHeading>
                <p className="mt-1 text-xs text-gray-500">{t('purchases:receivingReviewHint')}</p>
                <div className="mt-3 space-y-3">
                  {lines.map((line, index) => {
                    const linkedItem = inventoryItems.find(item => item.id === line.inventory_item_id)
                    const received = parseFloat(line.quantity) || 0
                    return (
                      <div key={line.key} className="rounded-xl border border-gray-200 bg-white p-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{index + 1}</span>
                          <select
                            className="input min-w-0 flex-1 text-sm"
                            value={line.inventory_item_id}
                            aria-label={t('purchases:modal.stockItemNumber', { number: index + 1 })}
                            onChange={event => selectItem(line.key, event.target.value)}
                          >
                            <option value="">— {t('purchases:placeholders.selectItem')} —</option>
                            {inventoryItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            disabled={lines.length === 1}
                            aria-label={t('purchases:modal.removeLine', { number: index + 1 })}
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-30"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-12">
                          <div className="sm:col-span-5">
                            <label className="label" htmlFor={`purchase-line-name-${line.key}`}>{t('purchases:placeholders.itemName')}</label>
                            <input id={`purchase-line-name-${line.key}`} className="input" value={line.supplier_item_name}
                              onChange={event => updateSupplierItemName(line.key, event.target.value)} />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="label" htmlFor={`purchase-line-quantity-${line.key}`}>{t('purchases:fields.quantity')}</label>
                            <input id={`purchase-line-quantity-${line.key}`} className="input" type="number" step="0.001" min="0"
                              value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="label" htmlFor={`purchase-line-cost-${line.key}`}>{t('purchases:fields.unitCost')}</label>
                            <MoneyInput id={`purchase-line-cost-${line.key}`} className="input" value={line.unit_cost}
                              onValueChange={value => updateLine(line.key, { unit_cost: value })} />
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 text-xs sm:grid-cols-4">
                          <SummaryItem label={t('purchases:modal.currentStock')} value={linkedItem ? `${linkedItem.current_quantity} ${linkedItem.unit_type}` : '—'} />
                          <SummaryItem label={t('purchases:modal.receiving')} value={`${received} ${linkedItem?.unit_type ?? ''}`} />
                          <SummaryItem label={t('purchases:modal.projectedStock')} value={linkedItem ? `${Number(linkedItem.current_quantity) + received} ${linkedItem.unit_type}` : '—'} />
                          <SummaryItem label={t('purchases:modal.lineTotal')} value={<Rial amount={lineTotal(line)} />} />
                        </div>
                        {line.match_source === 'mapping' && line.suggestion_label && (
                          <p className="mt-2 text-xs font-medium text-emerald-700">{t('purchases:suggested', { name: line.suggestion_label })}</p>
                        )}
                        {supplierId && line.inventory_item_id && lineSupplierName(line) && (
                          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" checked={line.remember_match}
                              onChange={event => updateLine(line.key, { remember_match: event.target.checked })}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                            {t('purchases:rememberMatch')}
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button type="button" onClick={() => setLines(previous => [...previous, newLine()])}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-2.5 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500">
                  <Plus size={15} aria-hidden="true" />{t('purchases:addAnotherItem')}
                </button>
              </section>
            )}

            <section aria-labelledby="purchase-payment-heading">
              <SectionHeading id="purchase-payment-heading">{t('purchases:sections.payment')}</SectionHeading>
              <div className="mt-2">
                <fieldset>
                  <legend className="sr-only">{t('purchases:modal.paymentMethod')}</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {PAY_OPTIONS.map(({ value, icon: Icon }) => (
                      <label key={value} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold focus-within:ring-2 focus-within:ring-primary-500 ${
                        payMethod === value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'
                      }`}>
                        <input className="sr-only" type="radio" name="payment-method" value={value}
                          checked={payMethod === value} onChange={() => setPayMethod(value)} />
                        <Icon size={15} aria-hidden="true" />
                        {t(`purchases:paymentMethod.${value}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>

            <section aria-labelledby="purchase-vat-heading">
              <SectionHeading id="purchase-vat-heading">{t('purchases:modal.amountAndVat')}</SectionHeading>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {mode === 'simple_bill' && (
                  <div>
                    <label className="label" htmlFor="purchase-amount">
                      {t(taxMode === 'excluded' ? 'purchases:fields.subtotalBeforeVat' : 'purchases:fields.totalAmount')} <span className="text-red-600">*</span>
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-semibold text-gray-500">SAR</span>
                      <MoneyInput ref={amountRef} id="purchase-amount" className="input ps-12" value={simpleAmount}
                        onValueChange={setSimpleAmount} placeholder="0.00" />
                    </div>
                  </div>
                )}
                <fieldset className={mode === 'detailed_receiving' ? 'md:col-span-2' : ''}>
                  <legend className="mb-2 text-xs font-semibold text-gray-600">{t('purchases:sections.vat')}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['included', 'excluded'] as TaxInputMode[]).map(value => (
                      <label key={value} className={`cursor-pointer rounded-lg border px-2.5 py-2 focus-within:ring-2 focus-within:ring-amber-500 ${
                        taxMode === value ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white'
                      }`}>
                        <input className="sr-only" type="radio" name="tax-mode" value={value}
                          checked={taxMode === value} onChange={() => setTaxMode(value)} />
                        <span className="flex items-center gap-2 text-xs font-bold text-gray-800">
                          {taxMode === value && <Check size={12} className="text-amber-700" aria-hidden="true" />}
                          {t(`purchases:taxMode.${value}`)}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                          {t(`purchases:modal.vat${value === 'included' ? 'Included' : 'Excluded'}Hint`)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>

            <section aria-label={t('purchases:modal.supportingDetails')}>
                <label className="label" htmlFor="purchase-notes">{t('purchases:fields.notes')}</label>
                <textarea id="purchase-notes" className="input resize-none" rows={2} value={notes}
                  onChange={event => setNotes(event.target.value)} placeholder={t('purchases:placeholders.notes')} dir="auto" />
                <p className="mt-1 text-[11px] text-gray-500">{t('purchases:modal.notesHelper')}</p>
            </section>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start" aria-labelledby="purchase-preview-heading">
              <section className="rounded-xl border border-primary-200 bg-primary-50/70 p-4">
                <h3 id="purchase-preview-heading" className="text-sm font-bold text-[#173f2a]">{t('purchases:modal.financialPreview')}</h3>
                <dl className="mt-3 divide-y divide-primary-100 text-sm" aria-live="polite">
                  <PreviewMetric label={t('purchases:fields.subtotal')} value={<Rial amount={activeTotals.subtotal} />} />
                  <PreviewMetric label={t('purchases:fields.vat')} value={<Rial amount={activeTotals.vat} />} />
                  <PreviewMetric label={t('purchases:modal.paymentMethod')} value={t(`purchases:paymentMethod.${payMethod}`)} />
                  {mode === 'detailed_receiving' && (
                    <>
                      <PreviewMetric label={t('purchases:modal.receivingSummary')} value={t('purchases:modal.lineQuantitySummary', {
                        lines: validLines.length,
                        quantity: totalReceivingQuantity,
                      })} />
                      <PreviewMetric label={t('purchases:modal.totalInventoryCost')} value={<Rial amount={rawLineAmount} />} />
                    </>
                  )}
                </dl>
                <div className="mt-3 border-t-2 border-primary-700 pt-3">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-sm font-bold text-[#173f2a]">{t('purchases:modal.totalBill')}</span>
                    <span className="text-xl font-bold text-primary-800"><Rial amount={activeTotals.total} /></span>
                  </div>
                </div>
                {mode === 'simple_bill' && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-white/70 p-2.5 text-xs leading-5 text-gray-600">
                    <Info size={14} className="mt-0.5 flex-shrink-0 text-primary-700" aria-hidden="true" />
                    {t('purchases:modal.compactNoStockNote')}
                  </p>
                )}
                <p className="mt-3 text-xs leading-5 text-gray-600" aria-live="polite">
                  {formCanSubmit
                    ? t(mode === 'simple_bill' ? 'purchases:modal.billConfirmation' : 'purchases:modal.receivingConfirmation', {
                        amount: activeTotals.total.toFixed(2),
                        vat: activeTotals.vat.toFixed(2),
                        lines: validLines.length,
                      })
                    : t('purchases:modal.completeRequired')}
                </p>
              </section>
            </aside>
            </div>
            )}

            {error && (
              <div id="purchase-form-error" role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-gray-600 sm:max-w-[65%]" aria-live="polite">
              {!mode ? t('purchases:modal.chooseType') : !formCanSubmit ? t('purchases:modal.completeRequired') : ''}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={requestClose} disabled={saving}>
                {t('common:cancel')}
              </Button>
              <Button type="submit" className="w-full bg-[#173f2a] hover:bg-[#22563b] sm:w-auto" loading={saving} disabled={saving || !formCanSubmit}>
                {isEditing
                  ? t('purchases:actions.saveChanges')
                  : t(!mode ? 'purchases:actions.selectType' : mode === 'simple_bill' ? 'purchases:actions.recordBill' : 'purchases:actions.receiveStock')}
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">{children}</h3>
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-gray-500">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-gray-800" dir="auto">{value}</dd>
    </div>
  )
}

function PreviewMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-end font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  )
}
