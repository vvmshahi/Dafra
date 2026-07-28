import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, MessageCircle, Mail, CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { supportConfig } from '@/config/support'
import { useTranslation } from 'react-i18next'
import { resolveBusinessType } from '@/lib/utils/businessType'

const WA_LINK    = supportConfig.whatsappLink
const EMAIL_LINK = supportConfig.emailLink

function ContactButtons({ label }: { label?: string }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col sm:flex-row gap-3 mt-5">
      <a
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
      >
        <MessageCircle size={16} /> {t('subscription.whatsapp')}
      </a>
      <a
        href={EMAIL_LINK}
        className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
      >
        <Mail size={16} /> {t('subscription.email')}
      </a>
    </div>
  )
}

function BusinessTypeCard({ type }: { type: 'trading' | 'service' }) {
  const { t } = useTranslation('settings')
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary-100 bg-primary-50/50 p-5 shadow-card">
      <div className="absolute inset-y-0 start-0 w-1 bg-primary-500" />
      <div className="ps-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-primary-500">{t('businessType.title')}</p>
        <p className="mt-1 text-sm font-bold text-gray-900">{t(`businessType.${type}.label`)}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{t(`businessType.${type}.description`)}</p>
      </div>
    </div>
  )
}

function SupportCard() {
  const { t } = useTranslation('settings')
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-gray-900">{t('subscription.renewUpgrade')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('subscription.updateTiming')}</p>
      <ContactButtons />
    </div>
  )
}

export default function SubscriptionTab() {
  const { t, i18n } = useTranslation('settings')
  const { profile, tenant } = useAuth()
  const sub = useSubscription()

  const [endsAt,    setEndsAt]    = useState<string | null>(null)
  const [planName,  setPlanName]  = useState<string>('')
  const [activeBranches, setActiveBranches] = useState(0)
  const [totalBranches, setTotalBranches] = useState(0)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const tid = profile?.tenant_id
    if (!tid) { setLoading(false); return }
    ;(async () => {
      const [subRes, activeBranchRes, totalBranchRes] = await Promise.all([
        (supabase as any)
          .from('tenant_subscriptions')
          .select('ends_at, subscription_plans(name)')
          .eq('tenant_id', tid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('is_active', true),
        supabase.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
      ])
      setEndsAt(subRes.data?.ends_at ?? null)
      setPlanName(subRes.data?.subscription_plans?.name ?? '')
      setActiveBranches(activeBranchRes.count ?? 0)
      setTotalBranches(totalBranchRes.count ?? 0)
      setLoading(false)
    })()
  }, [profile?.tenant_id])

  const branchUsageLine = t('subscription.branchUsage', { active: activeBranches, max: sub.maxBranches })
  const branchTotalLine = totalBranches === activeBranches
    ? null
    : t('subscription.totalBranches', { count: totalBranches })
  const nextBillingDate = sub.nextDueDate ?? endsAt
  const dateLocale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-SA'
  const businessType = resolveBusinessType(tenant?.business_type)

  if (loading || sub.status === 'loading') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl h-36 animate-pulse bg-gray-100" />
        <div className="card p-6 h-24 animate-pulse bg-gray-50" />
      </div>
    )
  }

  // Lifetime free
  if (sub.isLifetimeFree) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-base font-bold text-emerald-800">{t('subscription.lifetimeFree')}</p>
            <p className="text-sm text-emerald-700 mt-1">
              {t('subscription.lifetimeFreeBody')}
            </p>
            {planName && <p className="text-xs text-emerald-600 mt-2">{t('subscription.plan', { plan: planName })}</p>}
          </div>
        </div>
        <div className="card p-5 flex gap-4">
          <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">{t('subscription.branches')}</p>
            <p>{branchUsageLine}</p>
            {branchTotalLine && <p className="text-xs text-gray-400 mt-0.5">{branchTotalLine}</p>}
          </div>
        </div>
        {tenant && <BusinessTypeCard type={businessType} />}
        <SupportCard />
      </div>
    )
  }

  // Activation, grace, overdue, and suspension states. Only suspension blocks billing.
  if (sub.status === 'activation_required' || sub.status === 'suspended' || sub.status === 'grace_period' || sub.status === 'expired') {
    const inGrace = sub.status === 'grace_period'
    const isSuspended = sub.status === 'suspended'
    const needsActivation = sub.status === 'activation_required'
    const isOverdue = sub.status === 'expired'
    const tone = isSuspended ? 'red' : 'amber'
    return (
      <div className="space-y-5">
        <div className={`flex items-start gap-4 border rounded-2xl p-6 ${tone === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-100'}`}>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${tone === 'red' ? 'bg-red-100' : 'bg-amber-100'}`}>
            <AlertTriangle size={24} className={tone === 'red' ? 'text-red-600' : 'text-amber-600'} />
          </div>
          <div>
            <p className={`text-base font-bold ${tone === 'red' ? 'text-red-800' : 'text-amber-800'}`}>
              {needsActivation
                ? t('subscription.activationRequired')
                : inGrace
                ? t('subscription.gracePeriod')
                : isOverdue
                ? t('subscription.paymentOverdue')
                : t('subscription.suspended')}
            </p>
            <p className={`text-sm mt-1 ${tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
              {needsActivation
                ? t('subscription.activationBody')
                : inGrace
                ? t('subscription.graceBody')
                : isOverdue
                ? t('subscription.overdueBody')
                : t('subscription.suspendedBody')}
            </p>
            {(sub.nextDueDate || sub.graceUntilDate || sub.daysOverdue > 0) && (
              <p className={`text-xs mt-2 ${tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>
                {sub.nextDueDate && <>{t('subscription.nextDue', { date: new Date(sub.nextDueDate).toLocaleDateString(dateLocale) })}</>}
                {sub.graceUntilDate && <> · {t('subscription.graceUntil', { date: new Date(sub.graceUntilDate).toLocaleDateString(dateLocale) })}</>}
                {sub.daysOverdue > 0 && <> · {t('subscription.daysOverdue', { count: sub.daysOverdue })}</>}
              </p>
            )}
          </div>
        </div>
        <div className="card p-5 flex gap-4">
          <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">{t('subscription.branches')}</p>
            <p>{branchUsageLine}</p>
            {branchTotalLine && <p className="text-xs text-gray-400 mt-0.5">{branchTotalLine}</p>}
          </div>
        </div>
        {tenant && <BusinessTypeCard type={businessType} />}
        <SupportCard />
      </div>
    )
  }

  // Expiring soon
  if (sub.showWarning) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-4 bg-amber-50 border border-amber-100 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={24} className="text-amber-600" />
          </div>
          <div>
            <p className="text-base font-bold text-amber-800">
              {t('subscription.paymentDueSoon')}
            </p>
            <p className="text-sm text-amber-700 mt-1">
              {t('subscription.paymentDueBody')}
            </p>
            {sub.nextDueDate && (
              <p className="text-sm text-amber-700 mt-1">
                {t('subscription.dueDate', { date: new Date(sub.nextDueDate).toLocaleDateString(dateLocale) })}
              </p>
            )}
            {planName && <p className="text-xs text-amber-600 mt-1">{t('subscription.plan', { plan: planName })}</p>}
          </div>
        </div>
        <div className="card p-5 flex gap-4">
          <CreditCard size={18} className="text-gray-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700">{t('subscription.branches')}</p>
            <p>{branchUsageLine}</p>
            {branchTotalLine && <p className="text-xs text-gray-400 mt-0.5">{branchTotalLine}</p>}
          </div>
        </div>
        {tenant && <BusinessTypeCard type={businessType} />}
        <SupportCard />
      </div>
    )
  }

  // Active
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-5 text-white shadow-card">
        <div className="absolute inset-y-0 start-0 w-1 bg-gold-500" />
        <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 ring-1 ring-white/15">
          <CheckCircle2 size={22} className="text-emerald-300" />
        </div>
        <div>
          <p className="text-base font-bold text-white">{t('subscription.active')}</p>
          {planName && <p className="text-sm text-gold-200 mt-0.5">{t('subscription.plan', { plan: planName })}</p>}
          {nextBillingDate && (
            <p className="text-xs text-white/65 mt-2">
              {t('subscription.renewsExpires', { date: new Date(nextBillingDate).toLocaleDateString(dateLocale) })}
            </p>
          )}
        </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex gap-4">
        <CreditCard size={18} className="text-primary-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm text-gray-500">
          <p className="font-medium text-gray-700">{t('subscription.branches')}</p>
          <p>{branchUsageLine}</p>
          {branchTotalLine && <p className="text-xs text-gray-400 mt-0.5">{branchTotalLine}</p>}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary-50" role="progressbar" aria-valuemin={0} aria-valuemax={sub.maxBranches} aria-valuenow={activeBranches}>
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min((activeBranches / Math.max(sub.maxBranches, 1)) * 100, 100)}%` }} />
          </div>
        </div>
        </div>
      </div>

      {tenant && <div className="lg:col-span-2"><BusinessTypeCard type={businessType} /></div>}
      <div className="lg:col-span-2"><SupportCard /></div>
    </div>
  )
}
