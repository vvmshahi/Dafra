import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { CreditCard, Building2, Users, Package, CheckCircle2, ArrowRight, Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { TenantSubscription, SubscriptionPlan } from '@/types'

/* ── Types ──────────────────────────────────────────────────── */

type SubWithPlan = TenantSubscription & { plan: SubscriptionPlan }

interface Usage {
  branches: number
  users: number
  products: number
}

/* ── Usage bar ───────────────────────────────────────────────── */

function UsageBar({
  label, icon: Icon, used, max, unit = '',
}: {
  label: string; icon: React.ElementType; used: number; max: number; unit?: string
}) {
  const unlimited = max === -1
  const pct       = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100))
  const warn       = pct >= 80 && !unlimited
  const danger     = pct >= 95 && !unlimited

  return (
    <div className="flex items-center gap-4">
      <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Icon size={15} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-700">{label}</span>
          <span className={`text-xs font-semibold tabular-nums ${danger ? 'text-red-600' : warn ? 'text-amber-600' : 'text-gray-600'}`}>
            {used} / {unlimited ? '∞' : `${max}${unit}`}
          </span>
        </div>
        {!unlimited && (
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                danger ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-primary-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {unlimited && (
          <div className="h-1.5 bg-primary-100 rounded-full overflow-hidden">
            <div className="h-full w-full bg-primary-500/30 rounded-full" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Plan card ───────────────────────────────────────────────── */

function PlanCard({ sub, plan }: { sub: TenantSubscription; plan: SubscriptionPlan }) {
  const trialActive  = sub.status === 'trial' && sub.trial_ends_at
  const daysLeft     = trialActive
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at!).getTime() - Date.now()) / 86_400_000))
    : null

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2419] to-[#1B6B3A] p-6 text-white">
      {/* Subtle pattern */}
      <div className="absolute inset-0 opacity-5">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="sp" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#sp)" />
        </svg>
      </div>

      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/60 text-xs font-medium">Current Plan</p>
            <h2 className="text-2xl font-black text-white mt-1">{plan.name}</h2>
            {plan.name_ar && (
              <p className="text-white/60 text-sm mt-0.5" style={{ fontFamily: 'Cairo' }}>{plan.name_ar}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-3xl font-black text-gold-400">
              {plan.price_monthly === 0 ? 'Free' : <Rial amount={plan.price_monthly} />}
            </p>
            {plan.price_monthly > 0 && <p className="text-white/40 text-xs">/ month</p>}
          </div>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-2 mt-4">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
            sub.status === 'active'  ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
            : sub.status === 'trial' ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
            : 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30'
          }`}>
            {sub.status.toUpperCase()}
          </span>
          {daysLeft !== null && (
            <span className="text-[10px] text-white/50">
              Trial ends in <strong className="text-white/80">{daysLeft} days</strong>
            </span>
          )}
          {sub.ends_at && sub.status === 'active' && (
            <span className="text-[10px] text-white/50">
              Renews <strong className="text-white/80">{new Date(sub.ends_at).toLocaleDateString('en-SA')}</strong>
            </span>
          )}
        </div>

        {/* Plan features */}
        {Array.isArray(plan.features) && plan.features.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-1.5">
            {(plan.features as string[]).map(f => (
              <div key={f} className="flex items-center gap-1.5 text-[11px] text-white/70">
                <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main tab ─────────────────────────────────────────────────── */

export default function SubscriptionTab() {
  const { profile } = useAuth()
  const [sub, setSub]       = useState<SubWithPlan | null>(null)
  const [usage, setUsage]   = useState<Usage>({ branches: 0, users: 0, products: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.tenant_id) { setLoading(false); return }
    const tid = profile.tenant_id
    ;(async () => {
      setLoading(true)
      const [subRes, branchRes, userRes, productRes] = await Promise.all([
        supabase
          .from('tenant_subscriptions')
          .select('*, plan:subscription_plans(*)')
          .eq('tenant_id', tid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
      ])
      setSub(subRes.data as SubWithPlan | null)
      setUsage({
        branches: branchRes.count ?? 0,
        users:    userRes.count ?? 0,
        products: productRes.count ?? 0,
      })
      setLoading(false)
    })()
  }, [profile?.tenant_id])

  /* ── All plans (for upgrade display) ─ */
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  useEffect(() => {
    supabase.from('subscription_plans').select('*').eq('is_active', true).order('price_monthly').then(r => {
      setPlans((r.data as SubscriptionPlan[]) ?? [])
    })
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl h-44 animate-pulse bg-gray-100" />
        <div className="card p-6 h-32 animate-pulse bg-gray-50" />
      </div>
    )
  }

  if (!sub) {
    return (
      <div className="card p-12 text-center">
        <CreditCard size={36} className="text-gray-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500">No subscription found</p>
        <p className="text-xs text-gray-400 mt-1">Contact support to activate your account</p>
      </div>
    )
  }

  const plan = sub.plan

  return (
    <div className="space-y-5">

      {/* Plan card */}
      <PlanCard sub={sub} plan={plan} />

      {/* Usage */}
      <div className="card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-900">Usage</h3>
        <UsageBar label="Branches"    icon={Building2} used={usage.branches} max={plan.max_branches} />
        <UsageBar label="Users"       icon={Users}     used={usage.users}    max={plan.max_users} />
        <UsageBar label="Products"    icon={Package}   used={usage.products} max={plan.max_products} />
      </div>

      {/* Billing details */}
      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Billing Details</h3>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { label: 'Monthly price',   value: plan.price_monthly === 0 ? 'Free' : <><Rial amount={plan.price_monthly} /><span className="text-xs font-normal text-gray-400">/mo</span></> },
              { label: 'Yearly price',    value: plan.price_yearly  === 0 ? 'Free' : <><Rial amount={plan.price_yearly}  /><span className="text-xs font-normal text-gray-400">/yr</span></> },
              { label: 'Subscription ID', value: sub.moyasar_subscription_id ?? '—' },
              { label: 'Started',         value: new Date(sub.starts_at).toLocaleDateString('en-SA') },
            ] as { label: string; value: ReactNode }[]
          ).map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-[10px] text-gray-400 font-medium">{label}</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade plans */}
      {plans.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={14} className="text-gold-500" /> Available Plans
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {plans.map(p => {
              const isCurrent = p.id === plan.id
              return (
                <div key={p.id} className={`card p-5 flex flex-col gap-3 ${isCurrent ? 'ring-2 ring-primary-500' : ''}`}>
                  <div>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full ring-1 ring-primary-200 mb-2 inline-block">
                        CURRENT PLAN
                      </span>
                    )}
                    <p className="font-bold text-gray-900">{p.name}</p>
                    <p className="text-xl font-black text-gray-900 mt-1">
                      {p.price_monthly === 0 ? 'Free' : <Rial amount={p.price_monthly} />}
                      {p.price_monthly > 0 && <span className="text-xs font-normal text-gray-400">/mo</span>}
                    </p>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-gray-500 flex-1">
                    <p className="flex justify-between"><span>Branches</span> <strong>{p.max_branches}</strong></p>
                    <p className="flex justify-between"><span>Users</span> <strong>{p.max_users}</strong></p>
                    <p className="flex justify-between"><span>Products</span> <strong>{p.max_products === -1 ? 'Unlimited' : p.max_products}</strong></p>
                  </div>
                  <button
                    disabled={isCurrent}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-primary-500 text-white hover:bg-primary-600'
                    }`}
                  >
                    {isCurrent ? 'Current' : 'Upgrade'} {!isCurrent && <ArrowRight size={11} />}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 text-center">
            Billing is processed via Moyasar. Contact support to change plans.
          </p>
        </div>
      )}
    </div>
  )
}
