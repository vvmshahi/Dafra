import { useEffect, useState } from 'react'
import { CreditCard, TrendingUp, AlertCircle, Clock, Star } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { supabase } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

type ComputedStatus = 'active' | 'lifetime_free' | 'grace_period' | 'expired' | 'cancelled' | 'suspended'

interface SubRow {
  id:             string
  tenantName:     string
  plan:           string | null
  priceMonthly:   number
  starts_at:      string
  ends_at:        string | null
  suspended:      boolean
  computedStatus: ComputedStatus
  mrr:            number
  daysLeft:       number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRACE_MS = 7 * 86_400_000

function computeStatus(rawStatus: string, ends_at: string | null, suspended: boolean): ComputedStatus {
  if (suspended) return 'suspended'
  if (rawStatus === 'lifetime_free') return 'lifetime_free'
  if (rawStatus === 'cancelled') return 'cancelled'
  if (rawStatus === 'active' && ends_at === null) return 'lifetime_free'
  if (rawStatus === 'active' && ends_at !== null) {
    const exp = new Date(ends_at).getTime()
    const now = Date.now()
    if (exp >= now) return 'active'
    if (now < exp + GRACE_MS) return 'grace_period'
    return 'expired'
  }
  return 'expired'
}

const STATUS_VARIANT: Record<ComputedStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  active:'success', lifetime_free:'success', grace_period:'warning', expired:'danger', cancelled:'default', suspended:'danger',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const { t } = useTranslation('admin')
  const [rows,    setRows]    = useState<SubRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadError(false)
      const { data, error } = await (supabase as any)
        .from('tenant_subscriptions')
        .select('id, status, starts_at, ends_at, subscription_plans(name, price_monthly), tenants(name, suspended_at)')
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) {
        console.error('Unable to load subscriptions', error)
        setLoadError(true)
        setLoading(false)
        return
      }

      const list: SubRow[] = (data ?? []).map((s: any) => {
        const planName    = s.subscription_plans?.name ?? null
        const price       = s.subscription_plans?.price_monthly ?? 0
        const suspended   = !!s.tenants?.suspended_at
        const computed    = computeStatus(s.status, s.ends_at, suspended)
        const mrr         = computed === 'active' ? price : 0

        let daysLeft: number | null = null
        if (s.ends_at) {
          daysLeft = Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 86400000)
        }

        return {
          id:             s.id,
          tenantName:     s.tenants?.name ?? t('unknown'),
          plan:           planName,
          priceMonthly:   price,
          starts_at:      s.starts_at,
          ends_at:        s.ends_at,
          suspended,
          computedStatus: computed,
          mrr,
          daysLeft,
        }
      })

      setRows(list)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [t])

  // Derived stats
  const totalMrr   = rows.reduce((s, r) => s + r.mrr, 0)
  const phase1     = rows.filter(r => r.plan === 'Phase 1')
  const phase2     = rows.filter(r => r.plan === 'Phase 2')
  const lifetime   = rows.filter(r => r.computedStatus === 'lifetime_free')
  const grace      = rows.filter(r => r.computedStatus === 'grace_period')

  const now      = Date.now()
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getTime()
  const expiring = rows.filter(r =>
    r.ends_at && r.computedStatus === 'active' &&
    new Date(r.ends_at).getTime() <= monthEnd && new Date(r.ends_at).getTime() >= now
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('subscriptions.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('subscriptions.subtitle')}</p>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('subscriptions.loadFailed')}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{t('subscriptions.totalMrr')}</p>
            <p className="text-xl font-bold text-gray-900"><Rial amount={totalMrr} /></p>
            <p className="text-xs text-gray-400 mt-0.5">{t('subscriptions.paying', { count: rows.filter(r => r.computedStatus === 'active').length })}</p>
          </div>
        </div>

        <div className="card p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{t('subscriptions.phase1')}</p>
            <p className="text-xl font-bold text-gray-900">{t('subscriptions.active', { count: phase1.filter(r => r.computedStatus === 'active').length })}</p>
            <p className="text-xs text-gray-400 mt-0.5"><Rial amount={phase1.reduce((s, r) => s + r.mrr, 0)} /> {t('subscriptions.mrr')}</p>
          </div>
        </div>

        <div className="card p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={18} className="text-primary-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{t('subscriptions.phase2')}</p>
            <p className="text-xl font-bold text-gray-900">{t('subscriptions.active', { count: phase2.filter(r => r.computedStatus === 'active').length })}</p>
            <p className="text-xs text-gray-400 mt-0.5"><Rial amount={phase2.reduce((s, r) => s + r.mrr, 0)} /> {t('subscriptions.mrr')}</p>
          </div>
        </div>

        <div className="card p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
            <Star size={18} className="text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{t('subscriptions.lifetimeFree')}</p>
            <p className="text-xl font-bold text-gray-900">{lifetime.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t('subscriptions.noExpiry')}</p>
          </div>
        </div>
      </div>

      {/* Alert banners */}
      {(grace.length > 0 || expiring.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {grace.length > 0 && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">{t('subscriptions.graceAlert', { count: grace.length })}</p>
                <p className="text-xs text-red-600 mt-0.5">{grace.map(r => r.tenantName).join(', ')}</p>
              </div>
            </div>
          )}
          {expiring.length > 0 && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-4">
              <Clock size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700">{t('subscriptions.expiring', { count: expiring.length })}</p>
                <p className="text-xs text-amber-600 mt-0.5">{expiring.map(r => r.tenantName).join(', ')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* All subscriptions table */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('subscriptions.all', { count: rows.length })}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['client', 'plan', 'mrr', 'started', 'expires', 'status'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {t(`subscriptions.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const variant = STATUS_VARIANT[r.computedStatus]
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900" dir="auto">{r.tenantName}</td>
                    <td className="px-5 py-3.5">
                      {r.plan ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          r.plan === 'Phase 2' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'
                        }`}>{r.plan}</span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-700 tabular-nums">
                      {r.mrr > 0 ? <Rial amount={r.mrr} /> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">{r.starts_at.slice(0, 10)}</td>
                    <td className="px-5 py-3.5 text-xs">
                      {r.computedStatus === 'lifetime_free' ? (
                        <span className="text-emerald-600 font-medium">{t('status.lifetime_free')}</span>
                      ) : r.ends_at ? (
                        <span className={
                          r.computedStatus === 'grace_period' ? 'text-red-600 font-semibold'
                          : r.computedStatus === 'expired'    ? 'text-red-400'
                          : 'text-gray-400'
                        }>
                          {r.ends_at.slice(0, 10)}
                          {r.daysLeft !== null && r.daysLeft > 0 && r.daysLeft <= 30 && (
                            <span className="text-amber-600 ms-1">{t('subscriptions.days', { count: r.daysLeft })}</span>
                          )}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant={variant} dot>{t(`status.${r.computedStatus}`, { defaultValue: t('unknown') })}</Badge>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <AlertCircle size={24} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">{t('subscriptions.none')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
