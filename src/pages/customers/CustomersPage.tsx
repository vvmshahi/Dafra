import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Pencil, Eye, Trash2, Users, X, Building2, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { Customer, CustomerType } from '@/types'
import CustomerDrawer from './CustomerDrawer'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomerWithStats extends Customer {
  total_purchases: number
  last_purchase_date: string | null
  purchase_count: number
}

type FilterType = 'all' | CustomerType

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(c: CustomerWithStats) {
  return c.customer_type === 'business' && c.company_name
    ? c.company_name
    : c.name
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-SA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Customer row ──────────────────────────────────────────────────────────────

function CustomerRow({
  customer, onEdit, onDelete, onView,
}: {
  customer: CustomerWithStats
  onEdit: () => void
  onDelete: () => void
  onView: () => void
}) {
  const isBusiness = customer.customer_type === 'business'
  const primary    = displayName(customer)
  const secondary  = isBusiness && customer.company_name ? customer.name : customer.name_ar

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/70 transition-colors border-b border-gray-100 last:border-0">
      {/* Avatar */}
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold ${
          isBusiness
            ? 'bg-gold-500/10 text-gold-700'
            : 'bg-primary-50 text-primary-600'
        }`}
      >
        {isBusiness
          ? <Building2 size={15} />
          : primary.charAt(0).toUpperCase()
        }
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{primary}</p>
        {secondary && (
          <p
            className="text-xs text-gray-400 truncate"
            dir={customer.name_ar && secondary === customer.name_ar ? 'rtl' : 'ltr'}
          >
            {secondary}
          </p>
        )}
      </div>

      {/* Mobile */}
      <div className="w-32 flex-shrink-0 hidden sm:block">
        <p className="text-sm text-gray-600 tabular-nums">{customer.phone ?? '—'}</p>
      </div>

      {/* Type */}
      <div className="w-24 flex-shrink-0 hidden md:block">
        <Badge variant={isBusiness ? 'gold' : 'neutral'}>
          {isBusiness ? 'Business' : 'Individual'}
        </Badge>
      </div>

      {/* VAT */}
      <div className="w-36 flex-shrink-0 hidden lg:block">
        <p className="text-xs text-gray-500 font-mono truncate">
          {customer.vat_number ?? '—'}
        </p>
      </div>

      {/* Total purchases */}
      <div className="w-28 flex-shrink-0 text-right hidden sm:block">
        <p className="text-sm font-semibold text-primary-600">
          <Rial amount={customer.total_purchases} />
        </p>
        {customer.purchase_count > 0 && (
          <p className="text-[10px] text-gray-400">
            {customer.purchase_count} invoice{customer.purchase_count !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Last purchase */}
      <div className="w-28 flex-shrink-0 text-right hidden xl:block">
        <p className="text-xs text-gray-500">{formatDate(customer.last_purchase_date)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onView}
          title="View purchase history"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-primary-50 hover:text-primary-600 transition-colors"
        >
          <Eye size={14} />
        </button>
        <button
          onClick={onEdit}
          title="Edit customer"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          title="Delete customer"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Filter tab ────────────────────────────────────────────────────────────────

function FilterTab({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-xl border transition-all duration-150 ${
        active
          ? 'bg-primary-500 border-primary-500 text-white shadow-sm'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {label}
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
        active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
      }`}>
        {count}
      </span>
    </button>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filtered, onAdd }: { filtered: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
        <Users size={28} className="text-primary-300" />
      </div>
      <p className="text-gray-700 font-semibold">
        {filtered ? 'No customers match your search' : 'No customers yet'}
      </p>
      <p className="text-gray-400 text-sm mt-1 max-w-xs leading-relaxed">
        {filtered
          ? 'Try adjusting your search or filter'
          : 'Customers are added automatically during billing or manually here'}
      </p>
      {!filtered && (
        <Button className="mt-5" onClick={onAdd}>
          <Plus size={15} />
          Add Customer
        </Button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { profile }  = useAuth()
  const navigate     = useNavigate()

  const [customers,   setCustomers]   = useState<CustomerWithStats[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [filterType,  setFilterType]  = useState<FilterType>('all')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<CustomerWithStats | null>(null)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    if (!tid) return

    const [{ data: custs }, { data: invData }] = await Promise.all([
      supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tid)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('invoices')
        .select('customer_id, total_amount, invoice_date')
        .eq('tenant_id', tid)
        .neq('status', 'cancelled')
        .not('customer_id', 'is', null),
    ])

    // Build aggregate map: customer_id → {total, lastDate, count}
    type Agg = { total: number; lastDate: string | null; count: number }
    const aggMap = new Map<string, Agg>()
    for (const inv of (invData ?? []) as { customer_id: string; total_amount: number; invoice_date: string }[]) {
      const prev = aggMap.get(inv.customer_id) ?? { total: 0, lastDate: null, count: 0 }
      aggMap.set(inv.customer_id, {
        total:    prev.total + inv.total_amount,
        lastDate: !prev.lastDate || inv.invoice_date > prev.lastDate
          ? inv.invoice_date
          : prev.lastDate,
        count: prev.count + 1,
      })
    }

    const withStats: CustomerWithStats[] = ((custs ?? []) as unknown as Customer[]).map(c => {
      const agg = aggMap.get(c.id) ?? { total: 0, lastDate: null, count: 0 }
      return {
        ...c,
        total_purchases:    agg.total,
        last_purchase_date: agg.lastDate,
        purchase_count:     agg.count,
      }
    })

    setCustomers(withStats)
    setLoading(false)
  }, [profile?.tenant_id])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (c: CustomerWithStats) => { setEditing(c); setDrawerOpen(true) }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete customer "${name}"? This cannot be undone.`)) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('customers').update({ is_active: false }).eq('id', id)
    setCustomers(prev => prev.filter(c => c.id !== id))
  }

  const counts = {
    all:        customers.length,
    individual: customers.filter(c => c.customer_type === 'individual').length,
    business:   customers.filter(c => c.customer_type === 'business').length,
  }

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !search
      || c.name.toLowerCase().includes(q)
      || (c.name_ar        ?? '').toLowerCase().includes(q)
      || (c.company_name   ?? '').toLowerCase().includes(q)
      || (c.phone          ?? '').includes(search)
      || (c.email          ?? '').toLowerCase().includes(q)
    const matchType = filterType === 'all' || c.customer_type === filterType
    return matchSearch && matchType
  })

  const isFiltered = search.length > 0 || filterType !== 'all'

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-bold text-gray-900">Customers</h1>
          {!loading && (
            <span className="text-xs font-semibold bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full">
              {customers.length}
            </span>
          )}
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus size={14} />
          Add Customer
        </Button>
      </div>

      {/* ── Filter tabs ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <FilterTab label="All"        count={counts.all}        active={filterType === 'all'}        onClick={() => setFilterType('all')} />
        <FilterTab label="Individual" count={counts.individual} active={filterType === 'individual'} onClick={() => setFilterType('individual')} />
        <FilterTab label="Business"   count={counts.business}   active={filterType === 'business'}   onClick={() => setFilterType('business')} />
      </div>

      {/* ── Search ──────────────────────────────────────────── */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, mobile, or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-9 py-2 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-24">
          <LoadingSpinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} onAdd={openAdd} />
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1">Name</div>
            <div className="w-32 flex-shrink-0 hidden sm:block">Mobile</div>
            <div className="w-24 flex-shrink-0 hidden md:block">Type</div>
            <div className="w-36 flex-shrink-0 hidden lg:block">VAT Number</div>
            <div className="w-28 flex-shrink-0 text-right hidden sm:block">Total Spent</div>
            <div className="w-28 flex-shrink-0 text-right hidden xl:block">Last Purchase</div>
            <div className="w-24 flex-shrink-0" />
          </div>
          {filtered.map(c => (
            <CustomerRow
              key={c.id}
              customer={c}
              onEdit={() => openEdit(c)}
              onView={() => navigate(`/customers/${c.id}`)}
              onDelete={() => handleDelete(c.id, displayName(c))}
            />
          ))}
        </div>
      )}

      {/* ── Summary bar (when there are customers) ──────────── */}
      {!loading && customers.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-card text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <User size={14} className="text-primary-400" />
            <span><strong className="text-gray-900">{counts.individual}</strong> individual{counts.individual !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <Building2 size={14} className="text-gold-500" />
            <span><strong className="text-gray-900">{counts.business}</strong> business{counts.business !== 1 ? 'es' : ''}</span>
          </div>
          <div className="ml-auto text-gray-500">
            Total revenue from listed customers:{' '}
            <strong className="text-primary-600">
              <Rial amount={customers.reduce((s, c) => s + c.total_purchases, 0)} />
            </strong>
          </div>
        </div>
      )}

      {/* ── Drawer ──────────────────────────────────────────── */}
      <CustomerDrawer
        open={drawerOpen}
        customer={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  )
}
