import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Pencil, Eye, Archive, Users, X, Building2, User, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { ContentState } from '@/components/ui/ContentState'
import type { Customer, CustomerType } from '@/types'
import CustomerModal from './CustomerModal'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { archiveEntity, type ArchiveEntityClient } from '@/lib/archiveEntity'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomerWithStats extends Customer {
  total_purchases: number
  last_purchase_date: string | null
  purchase_count: number
}

type FilterType = 'all' | CustomerType

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(c: CustomerWithStats) {
  if (c.customer_type === 'business') {
    return c.business_name ?? c.company_name ?? c.name
  }
  return c.name
}

// ── Customer row ──────────────────────────────────────────────────────────────

function CustomerRow({
  customer, onEdit, onArchive, onView, archiving,
}: {
  customer: CustomerWithStats
  onEdit: () => void
  onArchive: () => void
  onView: () => void
  archiving: boolean
}) {
  const { t } = useTranslation('customers')
  const isBusiness = customer.customer_type === 'business'
  const primary    = displayName(customer)
  const secondary  = isBusiness && (customer.business_name ?? customer.company_name) ? customer.name : customer.name_ar

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
        <p className="text-sm font-medium text-gray-900 truncate" dir="auto">{primary}</p>
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
        <p className="text-sm text-gray-600 tabular-nums" dir="ltr">{customer.phone ?? '—'}</p>
      </div>

      {/* Type */}
      <div className="w-24 flex-shrink-0 hidden md:block">
        <Badge variant={isBusiness ? 'gold' : 'neutral'}>
          {t(isBusiness ? 'business' : 'individual')}
        </Badge>
      </div>

      {/* VAT */}
      <div className="w-36 flex-shrink-0 hidden lg:block">
        <p className="text-xs text-gray-500 font-mono truncate" dir="ltr">
          {customer.vat_number ?? '—'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onView}
          title={t('actions.view')}
          aria-label={t('actions.view')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-primary-50 hover:text-primary-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Eye size={14} />
        </button>
        <button
          onClick={onEdit}
          title={t('actions.edit')}
          aria-label={t('actions.edit')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onArchive}
          title={t('actions.archive')}
          aria-label={archiving ? t('actions.archiving') : t('actions.archive')}
          disabled={archiving}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-600 hover:bg-amber-50 hover:text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-wait disabled:opacity-50"
        >
          {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
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
  const { t } = useTranslation('customers')
  return (
    <ContentState
      kind="empty"
      icon={Users}
      title={t(filtered ? 'noMatches' : 'noCustomers')}
      description={t(filtered ? 'filterHint' : 'emptyHint')}
      action={!filtered ? (
        <Button onClick={onAdd}>
          <Plus size={15} />
          {t('add')}
        </Button>
      ) : undefined}
      className="py-24"
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { profile }  = useAuth()
  const navigate     = useNavigate()
  const { t } = useTranslation(['customers', 'customerIntelligence', 'common'])

  const [customers,   setCustomers]   = useState<CustomerWithStats[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [filterType,  setFilterType]  = useState<FilterType>('all')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<CustomerWithStats | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<CustomerWithStats | null>(null)
  const [archivingIds, setArchivingIds] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    const bid = profile?.branch_id
    if (!bid) { setLoading(false); return }

    const { data: custs } = await supabase
      .from('customers')
      .select('*')
      .eq('branch_id', bid)
      .eq('is_active', true)
      .order('name', { ascending: true })

    // Financial metrics are intentionally not calculated from browser-loaded
    // invoice rows. The dedicated report and detail RPCs own those totals.
    const withStats: CustomerWithStats[] = ((custs ?? []) as unknown as Customer[]).map(c => ({
      ...c,
      total_purchases: 0,
      last_purchase_date: null,
      purchase_count: 0,
    }))

    setCustomers(withStats)
    setLoading(false)
  }, [profile?.branch_id])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (c: CustomerWithStats) => { setEditing(c); setDrawerOpen(true) }

  const handleArchive = async () => {
    const target = archiveTarget
    if (!target || archivingIds.has(target.id)) return
    setArchivingIds(prev => new Set(prev).add(target.id))
    try {
      await archiveEntity(supabase as unknown as ArchiveEntityClient, 'customers', target.id)
      setCustomers(prev => prev.filter(customer => customer.id !== target.id))
      setArchiveTarget(null)
      toast.success(t('success.archived'))
    } catch {
      toast.error(t('errors.archiveFailed'))
    } finally {
      setArchivingIds(prev => {
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
    }
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
      || (c.business_name  ?? '').toLowerCase().includes(q)
      || (c.business_name_ar ?? '').toLowerCase().includes(q)
      || (c.phone          ?? '').includes(search)
      || (c.email          ?? '').toLowerCase().includes(q)
      || (c.vat_number     ?? '').includes(search)
      || (c.cr_number      ?? '').includes(search)
    const matchType = filterType === 'all' || c.customer_type === filterType
    return matchSearch && matchType
  })

  const isFiltered = search.length > 0 || filterType !== 'all'

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader
        title={t('title')}
        meta={!loading ? (
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600">
            {customers.length}
          </span>
        ) : undefined}
        actions={(
          <>
            <Button size="sm" onClick={openAdd}>
              <Plus size={14} />
              {t('add')}
            </Button>
          </>
        )}
      />

      {/* ── Filter tabs ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <FilterTab label={t('all')} count={counts.all} active={filterType === 'all'} onClick={() => setFilterType('all')} />
        <FilterTab label={t('individual')} count={counts.individual} active={filterType === 'individual'} onClick={() => setFilterType('individual')} />
        <FilterTab label={t('business')} count={counts.business} active={filterType === 'business'} onClick={() => setFilterType('business')} />
      </div>

      {/* ── Search ──────────────────────────────────────────── */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder={t('search')}
          aria-label={t('search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input ps-9 pe-9 py-2 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label={t('common:clearSearch')}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <ContentState kind="loading" className="py-24" />
      ) : filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} onAdd={openAdd} />
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1">{t('fields.name')}</div>
            <div className="w-32 flex-shrink-0 hidden sm:block">{t('fields.mobile')}</div>
            <div className="w-24 flex-shrink-0 hidden md:block">{t('fields.type')}</div>
            <div className="w-36 flex-shrink-0 hidden lg:block">{t('fields.vatNumber')}</div>
            <div className="w-24 flex-shrink-0" />
          </div>
          {filtered.map(c => (
            <CustomerRow
              key={c.id}
              customer={c}
              onEdit={() => openEdit(c)}
              onView={() => navigate(`/customers/${c.id}`)}
              onArchive={() => setArchiveTarget(c)}
              archiving={archivingIds.has(c.id)}
            />
          ))}
        </div>
      )}

      {/* ── Summary bar (when there are customers) ──────────── */}
      {!loading && customers.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-3 bg-white rounded-2xl border border-gray-100 shadow-card text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <User size={14} className="text-primary-400" />
            <span>{t('individualCount', { count: counts.individual })}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <Building2 size={14} className="text-gold-500" />
            <span>{t('businessCount', { count: counts.business })}</span>
          </div>
        </div>
      )}

      <CustomerModal
        open={drawerOpen}
        customer={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
      <ConfirmDialog
        open={archiveTarget !== null}
        kind="customerArchive"
        name={archiveTarget ? displayName(archiveTarget) : undefined}
        busy={archiveTarget ? archivingIds.has(archiveTarget.id) : false}
        confirmVariant="gold"
        cancelLabel={t('actions.cancel')}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
      />
    </div>
  )
}
