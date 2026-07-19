import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Pencil, Trash2, X, Receipt, Filter, Paperclip, FileWarning } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { saudiNow } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { Expense, ExpenseCategory, ExpenseVatClaimStatus } from '@/types'
import ExpenseDrawer from './ExpenseDrawer'
import { Rial } from '@/components/ui/RiyalSymbol'
import { effectiveExpenseVatClaimStatus } from '@/lib/utils/expenseVat'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategorySnap { name: string; color: string | null; icon: string | null }
interface AddedBySnap  { full_name: string | null }

export interface ExpenseRow extends Expense {
  expense_categories: CategorySnap | null
  user_profiles:      AddedBySnap  | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VAT_BADGE: Record<ExpenseVatClaimStatus, 'neutral' | 'info' | 'warning'> = {
  no_vat:        'neutral',
  not_claimable: 'neutral',
  claimable:     'info',
  needs_review:  'warning',
}

const PAY_BADGE: Record<string, 'success' | 'info' | 'neutral'> = {
  cash: 'success', card: 'info', bank_transfer: 'neutral', other: 'neutral',
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoToday() {
  return saudiNow().toISOString().split('T')[0]
}
function isoFirstOfMonth() {
  const d = saudiNow(); d.setUTCDate(1)
  return d.toISOString().split('T')[0]
}
function isoFirstOfWeek() {
  const d = saudiNow(); d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().split('T')[0]
}

type Preset = 'today' | 'week' | 'month' | 'custom'

// ── Summary card ──────────────────────────────────────────────────────────────

function SumCard({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: string; accent?: boolean
}) {
  const { t, i18n } = useTranslation('expenses')
  return (
    <div className={`flex-1 min-w-0 rounded-xl px-4 py-3 border ${
      accent
        ? 'bg-primary-500 border-primary-600 text-white'
        : 'bg-white border-gray-100 shadow-card'
    }`}>
      <p className={`text-xs font-medium ${accent ? 'text-white/70' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${accent ? 'text-white/60' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

// ── Expense row ───────────────────────────────────────────────────────────────

function ExpenseRow({ expense, onEdit, onDelete }: {
  expense: ExpenseRow
  onEdit: () => void
  onDelete: () => void
}) {
  const catColor  = expense.expense_categories?.color ?? '#6b7280'
  const catIcon   = expense.expense_categories?.icon  ?? '💰'
  const catName   = expense.expense_categories?.name
  const vat       = effectiveExpenseVatClaimStatus(
    expense.vat_claim_status,
    expense.vat_treatment,
    expense.vat_amount,
  )
  const claimableVat = vat === 'claimable' ? Number(expense.vat_amount ?? 0) : 0
  const pay       = expense.payment_method as string
  const vatDetailsIncomplete = vat === 'claimable' && (
    !expense.vendor_name
    || !expense.category_id
    || !expense.tax_invoice_number
    || Number(expense.vat_amount ?? 0) <= 0
  )

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/70 transition-colors border-b border-gray-100 last:border-0">
      {/* Category icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
        style={{ backgroundColor: catColor + '18' }}
      >
        {catIcon}
      </div>

      {/* Description + vendor */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate" dir="auto">{expense.description}</p>
        {expense.vendor_name && (
          <p className="text-xs text-gray-400 truncate" dir="auto">{expense.vendor_name}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px]">
          {expense.receipt_url ? (
            <span className="inline-flex items-center gap-1 text-emerald-600"><Paperclip size={10} /> {t('documentAttached')}</span>
          ) : vat === 'claimable' ? (
            <span className="inline-flex items-center gap-1 text-amber-600"><FileWarning size={10} /> {t('noDocument')}</span>
          ) : null}
          {vatDetailsIncomplete && (
            <span className="text-amber-600">{t('incompleteVat')}</span>
          )}
        </div>
      </div>

      {/* Date */}
      <div className="w-24 flex-shrink-0 hidden sm:block">
        <p className="text-xs text-gray-500">
          {new Date(expense.expense_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', {
            day: '2-digit', month: 'short',
          })}
        </p>
      </div>

      {/* Category badge */}
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

      {/* VAT badge */}
      <div className="w-24 flex-shrink-0 hidden lg:block">
        <Badge variant={VAT_BADGE[vat]}>{t(`vat.${vat}`)}</Badge>
      </div>

      {/* Payment method */}
      <div className="w-20 flex-shrink-0 hidden md:block">
        <Badge variant={PAY_BADGE[pay] as any}>{t(`payment.${pay}`, { defaultValue: t('payment.unknown') })}</Badge>
      </div>

      {/* Amount */}
      <div className="w-28 flex-shrink-0 text-right">
        <p className="text-sm font-bold text-gray-900 tabular-nums">
          {expense.total_paid.toLocaleString('en-US', {
            minimumFractionDigits: 2, maximumFractionDigits: 2,
          })}
        </p>
        {claimableVat > 0 && (
          <p className="text-[10px] text-gray-400">
            {t('fields.vat')} {claimableVat.toLocaleString('en-US', {
              minimumFractionDigits: 2, maximumFractionDigits: 2,
            })}
          </p>
        )}
        {vat === 'needs_review' && Number(expense.vat_amount ?? 0) > 0 && (
          <p className="text-[10px] text-amber-600">
            Review {Number(expense.vat_amount).toLocaleString('en-US', {
              minimumFractionDigits: 2, maximumFractionDigits: 2,
            })}
          </p>
        )}
      </div>

      {/* Added by */}
      <div className="w-20 flex-shrink-0 hidden xl:block text-right">
        <p className="text-xs text-gray-400 truncate">
          {expense.user_profiles?.full_name?.split(' ')[0] ?? '—'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onEdit}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filtered, onAdd }: { filtered: boolean; onAdd: () => void }) {
  const { t } = useTranslation('expenses')
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
        <Receipt size={24} className="text-primary-300" />
      </div>
      <p className="text-gray-700 font-semibold">
        {t(filtered ? 'noMatches' : 'noExpenses')}
      </p>
      <p className="text-gray-400 text-sm mt-1 max-w-xs">
        {filtered
          ? t('filterHint')
          : t('emptyHint')}
      </p>
      {!filtered && (
        <Button className="mt-5" onClick={onAdd}>
          <Plus size={15} />
          {t('add')}
        </Button>
      )}
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function DailyExpensesTab() {
  const { profile } = useAuth()
  const { t } = useTranslation('expenses')

  const [expenses,    setExpenses]    = useState<ExpenseRow[]>([])
  const [categories,  setCategories]  = useState<ExpenseCategory[]>([])
  const [loading,     setLoading]     = useState(true)
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<ExpenseRow | null>(null)

  // Filters
  const [preset,      setPreset]      = useState<Preset>('today')
  const [dateFrom,    setDateFrom]    = useState(isoToday)
  const [dateTo,      setDateTo]      = useState(isoToday)
  const [filterCat,   setFilterCat]   = useState('')
  const [filterPay,   setFilterPay]   = useState('')
  const [search,      setSearch]      = useState('')

  const setPresetDates = (p: Preset) => {
    setPreset(p)
    const today = isoToday()
    if (p === 'today') { setDateFrom(today); setDateTo(today) }
    if (p === 'week')  { setDateFrom(isoFirstOfWeek()); setDateTo(today) }
    if (p === 'month') { setDateFrom(isoFirstOfMonth()); setDateTo(today) }
  }

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setLoading(false); return }

    const [{ data: exps }, { data: cats }] = await Promise.all([
      supabase
        .from('expenses')
        .select([
          'id,tenant_id,branch_id,category_id,added_by',
          'expense_date,description,vendor_name',
          'amount,vat_treatment,vat_claim_status,expense_before_vat,vat_amount,total_paid',
          'session_id',
          'tax_invoice_number,supplier_vat_number,supplier_id,supplier_cr_number,supplier_contact,invoice_time',
          'payment_method,receipt_url,notes,created_at,updated_at',
          'expense_categories(name,color,icon)',
          'user_profiles!added_by(full_name)',
        ].join(','))
        .eq('branch_id', bid)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .order('expense_date', { ascending: false })
        .order('created_at',   { ascending: false }),
      supabase
        .from('expense_categories')
        .select('*')
        .or(`tenant_id.is.null,tenant_id.eq.${tid}`)
        .order('sort_order')
        .order('name'),
    ])

    setExpenses((exps ?? []) as unknown as ExpenseRow[])
    setCategories((cats ?? []) as unknown as ExpenseCategory[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (e: ExpenseRow) => { setEditing(e); setDrawerOpen(true) }

  const handleDelete = async (id: string, desc: string) => {
    if (!confirm(t('deleteConfirm', { name: desc }))) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  // Client-side filter by category, payment method, and search
  const filtered = expenses.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !search
      || e.description.toLowerCase().includes(q)
      || (e.vendor_name ?? '').toLowerCase().includes(q)
    const matchCat = !filterCat || e.category_id === filterCat
    const matchPay = !filterPay || e.payment_method === filterPay
    return matchSearch && matchCat && matchPay
  })

  // Stats from filtered set
  const totalPaid = filtered.reduce((s, e) => s + e.total_paid, 0)
  const cashTotal = filtered.filter(e => e.payment_method === 'cash').reduce((s, e) => s + e.total_paid, 0)
  const cardTotal = filtered.filter(e => e.payment_method === 'card').reduce((s, e) => s + e.total_paid, 0)
  const vatTotal  = filtered.reduce((s, e) => {
    const vatStatus = effectiveExpenseVatClaimStatus(e.vat_claim_status, e.vat_treatment, e.vat_amount)
    return s + (vatStatus === 'claimable' ? Number(e.vat_amount ?? 0) : 0)
  }, 0)
  const isFiltered = !!search || !!filterCat || !!filterPay

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-4">

      {/* ── Toolbar: Add + summary cards ──────────────────── */}
      <div className="flex items-start gap-4 flex-wrap">
        {/* Summary cards */}
        <div className="flex gap-3 flex-1 flex-wrap min-w-0">
          <SumCard label={t('fields.total')} value={<Rial amount={totalPaid} />} sub={String(filtered.length)} accent />
          <SumCard label={t('payment.cash')} value={<Rial amount={cashTotal} />} />
          <SumCard label={t('payment.card')} value={<Rial amount={cardTotal} />} />
          {vatTotal > 0 && <SumCard label={t('vat.claimable')} value={<Rial amount={vatTotal} />} />}
        </div>
        <Button size="sm" onClick={openAdd} className="flex-shrink-0 self-start">
          <Plus size={14} />
          {t('add')}
        </Button>
      </div>

      {/* ── Date preset tabs + custom ──────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-0.5">
          {([
            ['today', t('filters.today')],
            ['week', t('filters.week')],
            ['month', t('filters.month')],
            ['custom',t('filters.custom')],
          ] as [Preset, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPresetDates(p)}
              className={`text-xs font-medium px-3 py-1.5 rounded-[10px] transition-colors ${
                preset === p
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="input py-1.5 text-sm w-36"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="input py-1.5 text-sm w-36"
            />
          </div>
        )}
      </div>

      {/* ── Search + dropdowns ────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('filters.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-8 py-2 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Category filter */}
        <div className="relative flex-shrink-0">
          <Filter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="input pl-7 py-2 text-sm w-40 appearance-none"
          >
            <option value="">{t('filters.allCategories')}</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
        </div>

        {/* Payment method filter */}
        <select
          value={filterPay}
          onChange={e => setFilterPay(e.target.value)}
          className="input py-2 text-sm w-36 appearance-none flex-shrink-0"
        >
          <option value="">—</option>
          <option value="">—</option>
          <option value="cash">{t('payment.cash')}</option>
          <option value="card">{t('payment.card')}</option>
          <option value="bank_transfer">{t('payment.bank_transfer')}</option>
          <option value="other">{t('payment.other')}</option>
        </select>
      </div>

      {/* ── Content ───────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filtered={isFiltered || expenses.length > 0} onAdd={openAdd} />
      ) : (
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1">{t('fields.description')}</div>
            <div className="w-24 flex-shrink-0 hidden sm:block">{t('fields.date')}</div>
            <div className="w-28 flex-shrink-0 hidden md:block">{t('fields.category')}</div>
            <div className="w-24 flex-shrink-0 hidden lg:block">{t('fields.vat')}</div>
            <div className="w-20 flex-shrink-0 hidden md:block">{t('fields.paymentMethod')}</div>
            <div className="w-28 flex-shrink-0 text-end">{t('fields.amountSar')}</div>
            <div className="w-20 flex-shrink-0 hidden xl:block text-end">{t('fields.addedBy')}</div>
            <div className="w-16 flex-shrink-0" />
          </div>

          {filtered.map(e => (
            <ExpenseRow
              key={e.id}
              expense={e}
              onEdit={() => openEdit(e)}
              onDelete={() => handleDelete(e.id, e.description)}
            />
          ))}

          {/* Totals footer */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1 text-xs font-semibold text-gray-500">
              {filtered.length} expense{filtered.length !== 1 ? 's' : ''}
            </div>
            <div className="w-24 hidden sm:block" />
            <div className="w-28 hidden md:block" />
            <div className="w-24 hidden lg:block" />
            <div className="w-20 hidden md:block" />
            <div className="w-28 text-right">
              <p className="text-sm font-bold text-primary-600 tabular-nums">
                <Rial amount={totalPaid} />
              </p>
              {vatTotal > 0 && (
                <p className="text-[10px] text-gray-400">claimable VAT {fmt(vatTotal)}</p>
              )}
            </div>
            <div className="w-20 hidden xl:block" />
            <div className="w-16 flex-shrink-0" />
          </div>
        </div>
      )}

      {/* ── Drawer ────────────────────────────────────────── */}
      <ExpenseDrawer
        open={drawerOpen}
        expense={editing}
        categories={categories}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  )
}
