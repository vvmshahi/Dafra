import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export interface SubscriptionState {
  status:          'active' | 'grace_period' | 'suspended' | 'expired' | 'cancelled' | 'lifetime_free' | 'activation_required' | 'loading'
  isBlocked:       boolean
  showWarning:     boolean
  daysUntilExpiry: number
  isLifetimeFree:  boolean
  isPhase2:        boolean
  plan:            string
  maxBranches:     number
  suspendedAt:     string | null
  suspendedReason: string | null
}

const DEFAULT: SubscriptionState = {
  status: 'loading', isBlocked: false, showWarning: false,
  daysUntilExpiry: 999, isLifetimeFree: false, isPhase2: false, plan: '', maxBranches: 1,
  suspendedAt: null, suspendedReason: null,
}

const ALLOW_MISSING_SUBSCRIPTION = import.meta.env.VITE_ALLOW_MISSING_SUBSCRIPTION === 'true'

export function useSubscription(): SubscriptionState {
  const { profile } = useAuth()
  const [state, setState] = useState<SubscriptionState>(DEFAULT)

  useEffect(() => {
    const tid = profile?.tenant_id
    if (!tid) {
      setState({ ...DEFAULT, status: 'active' })
      return
    }

    ;(async () => {
      const [{ data: sub }, { data: tenant }] = await Promise.all([
        (supabase as any)
          .from('tenant_subscriptions')
          .select('status, ends_at, trial_ends_at, cancelled_at, subscription_plans(name, max_branches, features)')
          .eq('tenant_id', tid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from('tenants')
          .select('is_active, suspended_at, suspended_reason, max_branches')
          .eq('id', tid)
          .maybeSingle(),
      ])

      const isManuallySuspended = tenant?.is_active === false || !!tenant?.suspended_at

      if (!sub) {
        setState({
          ...DEFAULT,
          status: isManuallySuspended
            ? 'suspended'
            : ALLOW_MISSING_SUBSCRIPTION ? 'active' : 'activation_required',
          isBlocked: isManuallySuspended,
          showWarning: ALLOW_MISSING_SUBSCRIPTION,
          isPhase2: false,
          plan: ALLOW_MISSING_SUBSCRIPTION ? 'Pilot access' : 'Activation required',
          maxBranches: tenant?.max_branches ?? 1,
          suspendedAt: tenant?.suspended_at ?? null,
          suspendedReason: tenant?.suspended_reason ?? null,
        })
        return
      }

      const now         = Date.now()
      const endsAt      = sub.ends_at ? new Date(sub.ends_at).getTime() : null
      const planName    = sub.subscription_plans?.name ?? ''
      // Per-client limit (set by super admin) takes priority over plan default
      const maxBranches = tenant?.max_branches ?? sub.subscription_plans?.max_branches ?? 1
      const features    = sub.subscription_plans?.features ?? []
      const isPhase2    = Array.isArray(features) ? features.includes('zatca_phase2') : false

      const isLifetimeFree = sub.status === 'active' && endsAt === null

      const daysUntilExpiry = endsAt
        ? Math.ceil((endsAt - now) / 86_400_000)
        : 9999

      const isExpired   = endsAt !== null && now > endsAt
      const graceEnds   = endsAt ? endsAt + 7 * 86_400_000 : null
      const isInGrace   = isExpired && graceEnds !== null && now < graceEnds
      const isPastGrace = isExpired && (graceEnds === null || now >= graceEnds)
      const daysInGrace = isInGrace && graceEnds
        ? Math.ceil((graceEnds - now) / 86_400_000)
        : 0

      const isBlocked    = isManuallySuspended
      const showWarning  = !isLifetimeFree && !isBlocked && daysUntilExpiry <= 7 && daysUntilExpiry >= 0

      let status: SubscriptionState['status'] = 'active'
      if (isManuallySuspended) status = 'suspended'
      else if (isLifetimeFree) status = 'lifetime_free'
      else if (sub.status === 'cancelled') status = 'cancelled'
      else if (isInGrace)   status = 'grace_period'
      else if (isPastGrace) status = 'expired'
      else if (isExpired)   status = 'expired'

      setState({
        status,
        isBlocked,
        showWarning,
        daysUntilExpiry: isInGrace ? daysInGrace : Math.max(0, daysUntilExpiry),
        isLifetimeFree,
        isPhase2,
        plan: planName,
        maxBranches,
        suspendedAt: tenant?.suspended_at ?? null,
        suspendedReason: tenant?.suspended_reason ?? null,
      })
    })()
  }, [profile?.tenant_id])

  return state
}
