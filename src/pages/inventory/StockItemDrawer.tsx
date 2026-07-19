import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import type { InventoryItem, Category, Supplier } from '@/types'
import { useTranslation } from 'react-i18next'

// ── Unit options ──────────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['pieces', 'kg', 'grams', 'liters', 'ml', 'boxes', 'bags', 'other'] as const

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest pt-1">
      {children}
    </p>
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

export default function StockItemDrawer({ open, item, categories, suppliers, onClose, onSaved }: Props) {
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
  const [minQty,     setMinQty]     = useState('')
  const [unitCost,   setUnitCost]   = useState('')
  const [notes,      setNotes]      = useState('')

  useEffect(() => {
    if (open && item) {
      setName(item.name)
      setNameAr(item.name_ar ?? '')
      setCategoryId(item.category_id ?? '')
      setSupplierId(item.supplier_id ?? '')
      setUnitType(item.unit_type)
      setCurrentQty(String(item.current_quantity))
      setMinQty(String(item.minimum_quantity))
      setUnitCost(String(item.unit_cost))
      setNotes(item.notes ?? '')
    } else {
      setName(''); setNameAr(''); setCategoryId(''); setSupplierId('')
      setUnitType('pieces'); setCurrentQty('0'); setMinQty('0')
      setUnitCost(''); setNotes('')
    }
    setError('')
  }, [open, item])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError(t('inventory:errors.itemNameRequired')); return }
    const cost = parseFloat(unitCost)
    if (isNaN(cost) || cost < 0) { setError(t('inventory:errors.unitCostInvalid')); return }

    setSaving(true)
    setError('')

    try {
      const payload: Record<string, unknown> = {
        tenant_id:        profile?.tenant_id!,
        branch_id:        profile?.branch_id!,
        name:             name.trim(),
        name_ar:          nameAr.trim() || null,
        category_id:      categoryId || null,
        supplier_id:      supplierId || null,
        unit_type:        unitType,
        current_quantity: parseFloat(currentQty) || 0,
        minimum_quantity: parseFloat(minQty) || 0,
        unit_cost:        cost,
        notes:            notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (item) {
        const { error: err } = await q.from('inventory_items').update(payload).eq('id', item.id)
        if (err) { console.error('[StockItemDrawer] update failed', err); setError(t('inventory:errors.saveFailed')); return }
      } else {
        const { error: err } = await q.from('inventory_items').insert(payload)
        if (err) { console.error('[StockItemDrawer] insert failed', err); setError(t('inventory:errors.saveFailed')); return }
      }

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

      <div className="fixed inset-y-0 right-0 w-full max-w-[500px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {t(item ? 'inventory:editItem' : 'inventory:addItem')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('inventory:item.record')}</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Item Details ──────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>{t('inventory:item.details')}</SectionLabel>

              <div>
                <label className="label">{t('inventory:item.name')} <span className="text-red-500">*</span></label>
                <input className="input" value={name} onChange={e => setName(e.target.value)}
                  placeholder={t('inventory:item.namePlaceholder')} dir="auto" />
              </div>

              <div>
                <label className="label">{t('inventory:item.nameAr')}</label>
                <input className="input" value={nameAr} onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم الصنف بالعربية" dir="rtl" />
              </div>

              <div className="grid grid-cols-2 gap-3">
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

              <div>
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
              <SectionLabel>{t('inventory:item.quantityCost')}</SectionLabel>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">{t('inventory:item.currentQty')}</label>
                  <input className="input" type="number" step="0.001" min="0"
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
                  <MoneyInput className="input"
                    value={unitCost} onValueChange={setUnitCost}
                    placeholder="0.00" />
                </div>
              </div>

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
              <label className="label">{t('inventory:item.notes')}</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder={t('inventory:item.notesPlaceholder')} dir="auto" />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>{t('common:cancel')}</Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {t(item ? 'common:saveChanges' : 'inventory:addItem')}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
