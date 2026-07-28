import { useState, useEffect, useCallback, useRef } from 'react'
import { Boxes, CheckCircle2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import type { InventoryItem, Category, Supplier } from '@/types'
import { useTranslation } from 'react-i18next'

// ── Unit options ──────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['pieces', 'kg', 'grams', 'liters', 'ml', 'boxes', 'bags', 'other'] as const

const createAdjustmentKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `inventory-adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">
      {children}
    </h3>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:       boolean
  item:       InventoryItem | null
  categories: Category[]
  suppliers:  Supplier[]
  onClose:    () => void
  onSaved:    () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function StockItemModal({ open, item, categories, suppliers, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['inventory', 'common'])

  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const [name,       setName]       = useState('')
  const [nameAr,     setNameAr]     = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [unitType,   setUnitType]   = useState('pieces')
  const [currentQty, setCurrentQty] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [adjustmentKey, setAdjustmentKey] = useState('')
  const [minQty,     setMinQty]     = useState('')
  const [unitCost,   setUnitCost]   = useState('')
  const [notes,      setNotes]      = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const costRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open && item) {
      setName(item.name)
      setNameAr(item.name_ar ?? '')
      setCategoryId(item.category_id ?? '')
      setSupplierId(item.supplier_id ?? '')
      setUnitType(item.unit_type)
      setCurrentQty(String(item.current_quantity))
      setAdjustmentReason('')
      setAdjustmentKey(createAdjustmentKey())
      setMinQty(String(item.minimum_quantity))
      setUnitCost(String(item.unit_cost))
      setNotes(item.notes ?? '')
    } else {
      setName(''); setNameAr(''); setCategoryId(''); setSupplierId('')
      setUnitType('pieces'); setCurrentQty('0'); setMinQty('0')
      setUnitCost(''); setNotes(''); setAdjustmentReason('')
      setAdjustmentKey(createAdjustmentKey())
    }
    setError('')
  }, [open, item])

  const requestClose = useCallback(() => {
    if (saving) return
    onClose()
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
  }, [onClose, saving])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    window.setTimeout(() => nameRef.current?.focus(), 0)

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
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    }
  }, [open, requestClose, saving])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!name.trim()) { setError(t('inventory:errors.itemNameRequired')); nameRef.current?.focus(); return }
    const cost = parseFloat(unitCost)
    if (isNaN(cost) || cost < 0) { setError(t('inventory:errors.unitCostInvalid')); costRef.current?.focus(); return }
    const requestedQuantity = Number(currentQty)
    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
      setError(t('inventory:errors.adjustmentQuantityInvalid'))
      quantityRef.current?.focus()
      return
    }
    const quantityBefore = Number(item?.current_quantity ?? 0)
    const adjustmentQuantity = Number((requestedQuantity - quantityBefore).toFixed(3))
    if (adjustmentQuantity !== 0 && !adjustmentReason.trim()) {
      setError(t('inventory:errors.adjustmentReasonRequired'))
      reasonRef.current?.focus()
      return
    }

    setSaving(true)
    setError('')

    try {
      const payload: Record<string, unknown> = {
        name:             name.trim(),
        name_ar:          nameAr.trim() || null,
        category_id:      categoryId || null,
        supplier_id:      supplierId || null,
        unit_type:        unitType,
        minimum_quantity: parseFloat(minQty) || 0,
        unit_cost:        cost,
        notes:            notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      let savedItemId = item?.id ?? null
      if (item) {
        const { error: err } = await q.from('inventory_items').update(payload).eq('id', item.id)
        if (err) { console.error('[StockItemModal] update failed', err); setError(t('inventory:errors.saveFailed')); return }
      } else {
        const { data, error: err } = await q
          .from('inventory_items')
          .insert({
            ...payload,
            tenant_id: profile?.tenant_id!,
            branch_id: profile?.branch_id!,
          })
          .select('id')
          .single()
        if (err) { console.error('[StockItemModal] insert failed', err); setError(t('inventory:errors.saveFailed')); return }
        savedItemId = data?.id ?? null
      }

      if (adjustmentQuantity !== 0) {
        if (!savedItemId) {
          setError(t('inventory:errors.saveFailed'))
          return
        }
        const { error: adjustmentError } = await (supabase as any).rpc('adjust_inventory_item_stock', {
          p_payload: {
            inventory_item_id: savedItemId,
            adjustment_quantity: adjustmentQuantity,
            reason: adjustmentReason.trim(),
            idempotency_key: adjustmentKey,
          },
        })
        if (adjustmentError) {
          console.error('[StockItemModal] audited stock adjustment failed', adjustmentError)
          setError(t('inventory:errors.saveFailed'))
          return
        }
      }

      onSaved()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

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
        aria-labelledby="material-modal-title"
        aria-describedby="material-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,820px)]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">

          {/* Header */}
          <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Boxes size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
              <h2 id="material-modal-title" className="text-base font-bold text-gray-900">
                {t(item ? 'inventory:materialModal.editTitle' : 'inventory:materialModal.addTitle')}
              </h2>
              <p id="material-modal-description" className="mt-0.5 text-xs text-gray-500">
                {t(item ? 'inventory:materialModal.editSubtitle' : 'inventory:materialModal.addSubtitle')}
              </p>
              </div>
            </div>
            <button type="button" onClick={requestClose} disabled={saving} aria-label={t('common:close')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-5">

            {/* ── Item Details ──────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel id="material-identity-heading">{t('inventory:materialModal.identity')}</SectionLabel>

              <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">{t('inventory:item.name')} <span className="text-red-500">*</span></label>
                <input ref={nameRef} className="input" value={name} onChange={e => setName(e.target.value)}
                  placeholder={t('inventory:item.namePlaceholder')} dir="auto" />
              </div>

              <div>
                <label className="label">{t('inventory:item.nameAr')}</label>
                <input className="input" value={nameAr} onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم الصنف بالعربية" dir="rtl" />
              </div>
              </div>

              <SectionLabel id="material-classification-heading">{t('inventory:materialModal.classification')}</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">{t('inventory:item.category')}</label>
                  <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                    <option value="">— {t('inventory:item.uncategorized')} —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.icon ?? ''} {c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('inventory:item.unit')}</label>
                  <select className="input" value={unitType} onChange={e => setUnitType(e.target.value)}>
                    {UNIT_OPTIONS.map(unitValue => (
                      <option key={unitValue} value={unitValue}>{t(`inventory:units.${unitValue}`)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="label">{t('inventory:item.defaultSupplier')}</label>
                <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">— {t('inventory:item.none')} —</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Quantity & Cost ───────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel id="material-quantity-heading">{t('inventory:materialModal.quantityUnit')}</SectionLabel>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">{t('inventory:item.currentQty')}</label>
                  <input ref={quantityRef} className="input" type="number" step="0.001" min="0"
                    value={currentQty} onChange={e => setCurrentQty(e.target.value)}
                    placeholder="0" />
                </div>
                <div>
                  <label className="label">{t('inventory:item.minimumQty')}</label>
                  <input className="input" type="number" step="0.001" min="0"
                    value={minQty} onChange={e => setMinQty(e.target.value)}
                    placeholder="0" />
                </div>
                <div>
                  <label className="label">{t('inventory:item.unitCostSar')}</label>
                  <MoneyInput ref={costRef} className="input"
                    value={unitCost} onValueChange={setUnitCost}
                    placeholder="0.00" />
                </div>
              </div>

              {Number(currentQty) !== Number(item?.current_quantity ?? 0) && (
                <div>
                  <label className="label">
                    {t('inventory:item.adjustmentReason')} <span className="text-red-500">*</span>
                  </label>
                  <input ref={reasonRef}
                    className="input"
                    value={adjustmentReason}
                    onChange={e => setAdjustmentReason(e.target.value)}
                    maxLength={500}
                    placeholder={t('inventory:item.adjustmentReasonPlaceholder')}
                    dir="auto"
                  />
                </div>
              )}

              {parseFloat(unitCost) > 0 && parseFloat(currentQty) > 0 && (
                <div className="bg-emerald-50 rounded-xl px-4 py-3 flex justify-between items-center">
                  <span className="text-sm text-emerald-700 font-medium">{t('inventory:item.totalValue')}</span>
                  <span className="text-sm font-bold text-emerald-700 tabular-nums">
                    <Rial amount={parseFloat(currentQty) * parseFloat(unitCost)} />
                  </span>
                </div>
              )}
            </div>

            {/* ── Notes ─────────────────────────────────────── */}
            <div>
              <SectionLabel id="material-notes-heading">{t('inventory:materialModal.notes')}</SectionLabel>
              <label className="label">{t('inventory:item.notes')}</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder={t('inventory:item.notesPlaceholder')} dir="auto" />
            </div>

            {error && (
              <div role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <p className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs leading-5 text-gray-600">
              <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-primary-700" aria-hidden="true" />
              {name.trim() && Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0
                ? t('inventory:materialModal.ready')
                : t('inventory:materialModal.completeRequired')}
            </p>
            </div>
          </div>

          {/* Footer */}
          <footer className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={requestClose} disabled={saving}>{t('common:cancel')}</Button>
            <Button type="submit" className="w-full bg-[#173f2a] hover:bg-[#22563b] sm:w-auto" loading={saving}
              disabled={saving || !name.trim()} aria-describedby={!name.trim() ? 'material-save-reason' : undefined}>
              {t(item ? 'common:saveChanges' : 'inventory:materialModal.addAction')}
            </Button>
            {!name.trim() && <span id="material-save-reason" className="sr-only">{t('inventory:materialModal.completeRequired')}</span>}
          </footer>
        </form>
      </div>
    </div>
  )
}
