import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Pencil, Eye, Archive, Users, X, Building2, User, Loader2, MapPin, CalendarDays } from 'lucide-react'
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
import { loadCustomerReport } from '@/lib/customers/customerIntelligence'
import { saudiDateStr, formatSaudiDate } from '@/lib/utils/date'

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
  const secondary  = isBusiness && (customer.business_name ?? customer.company_name)
    ? (customer.name !== primary ? customer.name : customer.name_ar)
    : customer.name_ar !== primary ? customer.name_ar : null
  const city = (customer as CustomerWithStats & { city_ar?: string | null }).city_ar
    ? (customer as CustomerWithStats & { city_ar?: string | null }).city_ar
    : customer.city
  const identifier = customer.vat_number

  return (
    <tr className="group border-t border-gray-100 hover:bg-gray-50/70 transition-colors">
      {/* Avatar */}
      <td className="px-4 py-3"><div
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
          isBusiness
            ? 'bg-teal-50 text-teal-700'
            : 'bg-primary-50 text-primary-600'
        }`}
      >
        {isBusiness
          ? <Building2 size={15} />
          : primary.charAt(0).toUpperCase()
        }
      </div></td>

      {/* Name */}
      <td className="px-4 py-3 min-w-[220px]">
        <p className="text-sm font-medium text-gray-900 truncate" dir="auto">{primary}</p>
        {secondary && (
          <p
            className="text-xs text-gray-400 truncate"
            dir={customer.name_ar && secondary === customer.name_ar ? 'rtl' : 'ltr'}
          >
            {secondary}
          </p>
        )}
      </td>

      {/* Mobile */}
      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums whitespace-nowrap" dir="ltr">{customer.phone ?? '—'}</td>
      <td className="px-4 py-3 text-sm text-gray-600 max-w-[150px] truncate"><span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{city ?? '—'}</span></td>

      {/* Type */}
      <td className="px-4 py-3"><Badge variant={isBusiness ? 'success' : 'neutral'}>
          {t(isBusiness ? 'business' : 'individual')}
        </Badge></td>

      {/* VAT */}
      <td className="px-4 py-3 text-xs text-gray-500 font-mono whitespace-nowrap" dir="ltr">
        <p className="text-xs text-gray-500 font-mono truncate" dir="ltr">
          {identifier ?? '—'}
        </p>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap" dir="ltr"><span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-gray-400" />{customer.last_purchase_date ? formatSaudiDate(customer.last_purchase_date, 'en') : '—'}</span></td>

      {/* Actions */}
      <td className="px-3 py-2"><div className="flex items-center gap-0.5">
        <button
          onClick={onView}
          title={t('actions.view')}
          aria-label={t('actions.view')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-primary-50 hover:text-primary-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Eye size={14} />
        </button>
        <button
          onClick={onEdit}
          title={t('actions.edit')}
          aria-label={t('actions.edit')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onArchive}
          title={t('actions.archive')}
          aria-label={archiving ? t('actions.archiving') : t('actions.archive')}
          disabled={archiving}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-wait disabled:opacity-50"
        >
          {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
        </button>
      </div></td>
    </tr>
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
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [search,      setSearch]      = useState('')
  const [filterType,  setFilterType]  = useState<FilterType>('all')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<CustomerWithStats | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<CustomerWithStats | null>(null)
  const [archivingIds, setArchivingIds] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    const bid = profile?.branch_id
    if (!bid) { setLoading(false); return }

    setLoading(true)
    setLoadError(null)
    try {
      const endDate = saudiDateStr()
      const start = new Date(`${endDate}T00:00:00Z`)
      start.setUTCFullYear(start.getUTCFullYear() - 10)
      const [customerResult, firstReport] = await Promise.all([
        supabase.from('customers').select('*').eq('branch_id', bid).eq('is_active', true).order('name', { ascending: true }),
        loadCustomerReport({
          filters: { startDate: start.toISOString().slice(0, 10), endDate, branchId: bid, productId: null, productUnitId: null },
          search: '', activity: 'all', minNet: null, sort: 'customer_name', direction: 'asc', page: 1, pageSize: 50,
        }),
      ])
      if (customerResult.error) throw customerResult.error
      const reportRows = [...firstReport.rows]
      for (let page = 2; page <= firstReport.totalPages; page += 1) {
        const result = await loadCustomerReport({
          filters: { startDate: start.toISOString().slice(0, 10), endDate, branchId: bid, productId: null, productUnitId: null },
          search: '', activity: 'all', minNet: null, sort: 'customer_name', direction: 'asc', page, pageSize: 50,
        })
        reportRows.push(...result.rows)
      }
      const lastPurchaseByCustomer = new Map(reportRows.map(row => [row.customerId, row.lastPurchase]))
      const withStats: CustomerWithStats[] = ((customerResult.data ?? []) as unknown as Customer[]).map(c => ({
        ...c,
        total_purchases: 0,
        last_purchase_date: lastPurchaseByCustomer.get(c.id) ?? null,
        purchase_count: 0,
      }))
      setCustomers(withStats)
    } catch (error) {
      console.error('Unable to load customers directory', error)
      setCustomers([])
      setLoadError(t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [profile?.branch_id, t])

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
        actions={undefined}
      />

      {/* ── Filter tabs ─────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[220px] flex-1 basis-[280px]">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder={t('search')} aria-label={t('search')} value={search} onChange={e => setSearch(e.target.value)} className="input h-9 w-full py-1.5 ps-9 pe-9 text-sm" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label={t('common:clearSearch')} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterTab label={t('all')} count={counts.all} active={filterType === 'all'} onClick={() => setFilterType('all')} />
          <FilterTab label={t('individual')} count={counts.individual} active={filterType === 'individual'} onClick={() => setFilterType('individual')} />
          <FilterTab label={t('business')} count={counts.business} active={filterType === 'business'} onClick={() => setFilterType('business')} />
        </div>
        <Button size="sm" className="ms-auto" onClick={openAdd}><Plus size={14} />{t('add')}</Button>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <ContentState kind="loading" className="py-24" />
      ) : loadError ? (
        <ContentState kind="error" title={loadError} action={<Button variant="secondary" onClick={() => void load()}>{t('common:retry')}</Button>} className="py-24" />
      ) : filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} onAdd={openAdd} />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-14 px-4 py-2.5" />
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.name')}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.mobile')}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.city')}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.type')}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.vatNumber')}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">{t('fields.lastPurchase')}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>{filtered.map(c => <CustomerRow key={c.id} customer={c} onEdit={() => openEdit(c)} onView={() => navigate(`/customers/${c.id}`)} onArchive={() => setArchiveTarget(c)} archiving={archivingIds.has(c.id)} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 p-2 lg:hidden">
            {filtered.map(c => <div key={c.id} className="rounded-xl border border-gray-100 p-3"><div className="flex items-start gap-3"><div className="h-8 w-8 shrink-0 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center text-sm font-bold">{c.customer_type === 'business' ? <Building2 size={15} /> : displayName(c).charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-900" dir="auto">{displayName(c)}</p><p className="mt-1 text-xs text-gray-500" dir="ltr">{c.phone ?? '—'} · {(c as CustomerWithStats & { city_ar?: string | null }).city_ar || c.city || '—'}</p><p className="mt-1 text-xs text-gray-400" dir="ltr">{c.last_purchase_date ? formatSaudiDate(c.last_purchase_date, 'en') : '—'}</p></div><div className="flex items-center gap-0.5"><button type="button" onClick={() => navigate(`/customers/${c.id}`)} aria-label={t('actions.view')} className="h-8 w-8 rounded-lg text-gray-400 hover:bg-primary-50 hover:text-primary-600"><Eye size={14} /></button><button type="button" onClick={() => openEdit(c)} aria-label={t('actions.edit')} className="h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100"><Pencil size={14} /></button></div></div></div>)}
          </div>
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
            <Building2 size={14} className="text-teal-600" />
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
