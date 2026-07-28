import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Switch } from '@/components/ui/Switch'
import type { FixedExpense, ExpenseCategory } from '@/types'
import FixedExpenseModal from './FixedExpenseModal'
import { Rial } from '@/components/ui/RiyalSymbol'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategorySnap { name: string; color: string | null; icon: string | null }

export interface FixedExpenseRow extends FixedExpense {
  expense_categories: CategorySnap | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAY_BADGE: Record<string, 'success' | 'info' | 'neutral'> = {
  cash: 'success', card: 'info', bank_transfer: 'neutral', other: 'neutral',
}

// ── Fixed expense row ─────────────────────────────────────────────────────────

function FixedRow({
  item, onEdit, onDelete, onToggle, toggling,
}: {
  item: FixedExpenseRow
  onEdit: () => void
  onDelete: () => void
  onToggle: (v: boolean) => void
  toggling: boolean
}) {
  const { t } = useTranslation('expenses')
  const catColor = item.expense_categories?.color ?? '#6b7280'
  const catIcon  = item.expense_categories?.icon  ?? '💰'
  const catName  = item.expense_categories?.name
  const pay      = item.payment_method as string

  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors ${
      item.is_active ? 'hover:bg-gray-50/70' : 'bg-gray-50/50 opacity-60'
    }`}>
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
        style={{ backgroundColor: catColor + '18' }}
      >
        {catIcon}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${item.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
          {item.name}
        </p>
      </div>

      {/* Category */}
      <div className="w-28 flex-shrink-0 hidden md:block">
        {catName ? (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: catColor + '22', color: catColor }}
          >
            {catName}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>

      {/* Payment method */}
      <div className="w-20 flex-shrink-0 hidden sm:block">
        <Badge variant={PAY_BADGE[pay] as any}>{t(`payment.${pay}`, { defaultValue: t('payment.unknown') })}</Badge>
      </div>

      {/* Monthly amount */}
      <div className="w-32 flex-shrink-0 text-right">
        <p className="text-sm font-bold text-gray-900 tabular-nums">
          <Rial amount={item.monthly_amount} />
          <span className="text-[10px] font-normal text-gray-400 ms-1">{t('perMonth')}</span>
        </p>
      </div>

      {/* Active toggle */}
      <div className="flex-shrink-0">
        <Switch
          checked={item.is_active}
          onChange={onToggle}
          disabled={toggling}
          size="sm"
          ariaLabel={t(item.is_active ? 'actions.deactivate' : 'actions.activate')}
          title={t(item.is_active ? 'actions.deactivate' : 'actions.activate')}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onEdit} title={t('actions.edit')} aria-label={t('actions.edit')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} title={t('actions.delete')} aria-label={t('actions.delete')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function FixedExpensesTab() {
  const { profile } = useAuth()
  const { t } = useTranslation('expenses')

  const [items,      setItems]      = useState<FixedExpenseRow[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading,    setLoading]    = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing,    setEditing]    = useState<FixedExpenseRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FixedExpenseRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(() => new Set())
  const [toggleTarget, setToggleTarget] = useState<{ id: string; value: boolean } | null>(null)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setLoading(false); return }

    const [{ data: fixedData }, { data: cats }] = await Promise.all([
      supabase
        .from('fixed_expenses')
        .select('*, expense_categories(name,color,icon)')
        .eq('branch_id', bid)
        .order('is_active', { ascending: false })
        .order('name',      { ascending: true }),
      supabase
        .from('expense_categories')
        .select('*')
        .or(`tenant_id.is.null,tenant_id.eq.${tid}`)
        .order('sort_order')
        .order('name'),
    ])

    setItems((fixedData ?? []) as unknown as FixedExpenseRow[])
    setCategories((cats ?? []) as unknown as ExpenseCategory[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (item: FixedExpenseRow) => { setEditing(item); setModalOpen(true) }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    const id = deleteTarget.id
    setDeleting(true)
    const q = supabase as unknown as { from: (t: string) => any }
    const result = await q.from('fixed_expenses').delete().eq('id', id).select('id').maybeSingle()
    if (result.error || (result.status !== undefined && (result.status < 200 || result.status >= 300)) || result.data?.id !== id) {
      toast.error(t('errors.deleteFailed'))
      setDeleting(false)
      return
    }
    setItems(prev => prev.filter(i => i.id !== id))
    setDeleteTarget(null)
    setDeleting(false)
    toast.success(t('success.fixedDeleted'))
  }

  const handleToggle = async (id: string, val: boolean) => {
    if (togglingIds.has(id)) return
    setTogglingIds(previous => new Set(previous).add(id))
    const q = supabase as unknown as { from: (t: string) => any }
    const result = await q.from('fixed_expenses').update({ is_active: val }).eq('id', id).select('id,is_active').maybeSingle()
    if (result.error || result.data?.id !== id || result.data?.is_active !== val) {
      toast.error(t('errors.statusFailed'))
      setTogglingIds(previous => { const next = new Set(previous); next.delete(id); return next })
      return
    }
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_active: val } : i))
    setToggleTarget(null)
    setTogglingIds(previous => { const next = new Set(previous); next.delete(id); return next })
    toast.success(t(val ? 'success.activated' : 'success.deactivated'))
  }

  const activeItems   = items.filter(i => i.is_active)
  const monthlyTotal  = activeItems.reduce((s, i) => s + i.monthly_amount, 0)
  const yearlyTotal   = monthlyTotal * 12
  const fmt = (n: number) => n.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

  return (
    <div className="space-y-4">

      {/* ── Header row ──────────────────────────────────────── */}
      <div className="flex items-start gap-4 flex-wrap">
        {/* Summary cards */}
        <div className="flex gap-3 flex-1 flex-wrap min-w-0">
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-primary-500 border border-primary-800 text-white shadow-card">
            <p className="text-xs font-medium text-white/70">{t('monthlyFixedCost')}</p>
            <p className="text-lg font-bold mt-0.5"><Rial amount={monthlyTotal} /></p>
            <p className="text-[10px] text-white/60 mt-0.5">
              {t('activeCount', { count: activeItems.length })}
            </p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-primary-800/70 shadow-card">
            <p className="text-xs font-medium text-gray-400">{t('annualEstimate')}</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5"><Rial amount={yearlyTotal} /></p>
            <p className="text-[10px] text-gray-400 mt-0.5">{t('annualHint')}</p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-primary-800/70 shadow-card">
            <p className="text-xs font-medium text-gray-400">{t('totalEntries')}</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">{items.length}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {t('inactiveCount', { count: items.length - activeItems.length })}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd} className="flex-shrink-0 self-start">
          <Plus size={14} />
          {t('addFixed')}
        </Button>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
            <RefreshCw size={22} className="text-primary-300" />
          </div>
          <p className="text-gray-700 font-semibold">{t('noFixed')}</p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            {t('noFixedHint')}
          </p>
          <Button className="mt-5" onClick={openAdd}>
            <Plus size={15} />
            {t('addFixed')}
          </Button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1">{t('fields.name')}</div>
            <div className="w-28 flex-shrink-0 hidden md:block">{t('fields.category')}</div>
            <div className="w-20 flex-shrink-0 hidden sm:block">{t('fields.paymentMethod')}</div>
            <div className="w-32 flex-shrink-0 text-end">{t('fields.monthlyAmount')}</div>
            <div className="w-14 flex-shrink-0 text-center">{t('status.active')}</div>
            <div className="w-16 flex-shrink-0" />
          </div>

          {items.map(item => (
            <FixedRow
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleteTarget(item)}
              onToggle={value => setToggleTarget({ id: item.id, value })}
              toggling={togglingIds.has(item.id)}
            />
          ))}

          {/* Footer total */}
          {activeItems.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <div className="w-9" />
              <div className="flex-1 text-xs font-semibold text-gray-500">
                {t('activeCount', { count: activeItems.length })}
              </div>
              <div className="w-28 hidden md:block" />
              <div className="w-20 hidden sm:block" />
              <div className="w-32 text-right">
                <p className="text-sm font-bold text-primary-600 tabular-nums">
                  <Rial amount={monthlyTotal} />
                </p>
                <p className="text-[10px] text-gray-400">{t('perMonth')}</p>
              </div>
              <div className="w-14" />
              <div className="w-16" />
            </div>
          )}
        </div>
      )}

      <FixedExpenseModal
        open={modalOpen}
        item={editing}
        categories={categories}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        kind="delete"
        name={deleteTarget?.name}
        busy={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
      <ConfirmDialog
        open={toggleTarget !== null}
        kind={toggleTarget?.value ? 'activateFixedExpense' : 'deactivateFixedExpense'}
        busy={toggleTarget ? togglingIds.has(toggleTarget.id) : false}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => { if (toggleTarget) void handleToggle(toggleTarget.id, toggleTarget.value) }}
      />
    </div>
  )
}
