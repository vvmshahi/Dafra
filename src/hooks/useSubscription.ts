import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export interface SubscriptionState {
  status:          'active' | 'grace_period' | 'suspended' | 'expired' | 'cancelled' | 'lifetime_free' | 'loading'
  isBlocked:       boolean
  showWarning:     boolean
  daysUntilExpiry: number
  isLifetimeFree:  boolean
  plan:            string
  maxBranches:     number
}

const DEFAULT: SubscriptionState = {
  status: 'loading', isBlocked: false, showWarning: false,
  daysUntilExpiry: 999, isLifetimeFree: false, plan: '', maxBranches: 1,
}

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
          .select('status, ends_at, trial_ends_at, cancelled_at, subscription_plans(name, max_branches)')
          .eq('tenant_id', tid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from('tenants')
          .select('is_active, max_branches')
          .eq('id', tid)
          .maybeSingle(),
      ])

      if (!sub) {
        setState({ ...DEFAULT, status: 'active' })
        return
      }

      const now         = Date.now()
      const endsAt      = sub.ends_at ? new Date(sub.ends_at).getTime() : null
      const planName    = sub.subscription_plans?.name ?? ''
      // Per-client limit (set by super admin) takes priority over plan default
      const maxBranches = tenant?.max_branches ?? sub.subscription_plans?.max_branches ?? 1

      const isLifetimeFree = sub.status === 'active' && endsAt === null
      const isSuspended    = tenant?.is_active === false || sub.status === 'cancelled'

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

      const isBlocked    = (!isLifetimeFree && isPastGrace) || isSuspended
      const showWarning  = !isLifetimeFree && !isBlocked && daysUntilExpiry <= 7 && daysUntilExpiry >= 0

      let status: SubscriptionState['status'] = 'active'
      if (isLifetimeFree)  status = 'lifetime_free'
      else if (isSuspended) status = 'suspended'
      else if (isInGrace)   status = 'grace_period'
      else if (isPastGrace) status = 'expired'
      else if (sub.status === 'cancelled') status = 'cancelled'
      else if (isExpired)   status = 'expired'

      setState({
        status,
        isBlocked,
        showWarning,
        daysUntilExpiry: isInGrace ? daysInGrace : Math.max(0, daysUntilExpiry),
        isLifetimeFree,
        plan: planName,
        maxBranches,
      })
    })()
  }, [profile?.tenant_id])

  return state
}
