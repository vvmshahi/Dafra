import { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole, Tenant } from '@/types'

interface AuthState {
  user:        User | null
  session:     Session | null
  profile:     UserProfile | null
  tenant:      Tenant | null
  loading:     boolean
  // null = not yet determined (profile fetch in flight)
  // false = owner with no tenant (must complete onboarding)
  // true  = onboarding done (or not applicable for this role)
  isOnboarded: boolean | null
}

function computeIsOnboarded(profile: UserProfile | null): boolean | null {
  if (profile === null) return null
  if (profile.role === 'owner' && !profile.tenant_id) return false
  return true
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user:        null,
    session:     null,
    profile:     null,
    tenant:      null,
    loading:     true,
    isOnboarded: null,
  })

  // fetchProfile is extracted as a stable standalone function (not a hook
  // callback) so the main useEffect can safely have [] deps.
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    const profile = data as unknown as UserProfile | null

    if (error) {
      console.error('[useAuth] fetchProfile error:', {
        code: error.code, message: error.message, userId,
      })
      return { profile: null, tenant: null }
    }

    let tenant: Tenant | null = null
    if (profile?.tenant_id) {
      const { data: tData, error: tErr } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', profile.tenant_id)
        .maybeSingle()
      if (tErr) console.error('[useAuth] fetchTenant error:', tErr.message)
      else tenant = tData as unknown as Tenant | null
    }

    return { profile, tenant }
  }, [])

  useEffect(() => {
    let mounted = true

    // ── initialize: restore session from localStorage on mount ────────────
    // Uses an async function so we can try/catch and sequence the setState
    // calls correctly. getSession() reads from localStorage (no network call
    // if the JWT is still valid), so it resolves fast.
    const initialize = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return

        if (!session) {
          setState({ user: null, session: null, profile: null, tenant: null,
                     loading: false, isOnboarded: null })
          return
        }

        // Set user immediately so route guards show a spinner (not /login)
        // while the profile network request is in flight.
        setState(prev => ({ ...prev, user: session.user, session }))

        const { profile, tenant } = await fetchProfile(session.user.id)

        if (!mounted) return

        setState({
          user: session.user,
          session,
          profile,
          tenant,
          loading: false,
          isOnboarded: computeIsOnboarded(profile),
        })

        console.log('[useAuth] Session restored:', {
          userId: session.user.id, role: profile?.role,
          isOnboarded: computeIsOnboarded(profile),
        })

      } catch (err) {
        if (!mounted) return
        console.error('[useAuth] initialize error:', err)
        setState({ user: null, session: null, profile: null, tenant: null,
                   loading: false, isOnboarded: null })
      }
    }

    initialize()

    // ── Auth event listener: handles changes AFTER initial load ───────────
    // INITIAL_SESSION is intentionally ignored — initialize() above already
    // handles page-load session restoration to avoid a double profile fetch.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        if (event === 'INITIAL_SESSION') {
          // Already handled by initialize() above.
          return
        }

        if (event === 'SIGNED_OUT') {
          setState({ user: null, session: null, profile: null, tenant: null,
                     loading: false, isOnboarded: null })
          return
        }

        if (event === 'TOKEN_REFRESHED' && session) {
          // Just update the session object; no need to re-fetch the profile.
          setState(prev => ({ ...prev, user: session.user, session }))
          return
        }

        if (event === 'SIGNED_IN' && session) {
          setState(prev => ({ ...prev, user: session.user, session }))
          const { profile, tenant } = await fetchProfile(session.user.id)
          if (!mounted) return
          setState({
            user: session.user,
            session,
            profile,
            tenant,
            loading: false,
            isOnboarded: computeIsOnboarded(profile),
          })
        }
      },
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile]) // fetchProfile is stable (useCallback [])

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const { profile, tenant } = await fetchProfile(session.user.id)
    const isOnboarded = computeIsOnboarded(profile)
    setState(prev => ({ ...prev, profile, tenant, isOnboarded }))
  }, [fetchProfile])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) console.error('[useAuth] signIn error:', error.message, error.status)
    return { error }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: 'owner' } },
    })
    if (error) console.error('[useAuth] signUp error:', error.message)
    return { error }
  }

  const signOut = async () => {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('pos_cart_') || key.startsWith('dafra_'))) {
        toRemove.push(key)
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k))
    await supabase.auth.signOut()
  }

  const hasRole = (...roles: UserRole[]) =>
    state.profile ? roles.includes(state.profile.role) : false

  const isAuthenticated = !!state.user

  const isNewUser = isAuthenticated && !state.loading
    && !!state.profile && !state.profile.tenant_id
    && state.profile.role !== 'super_admin'

  return {
    ...state,
    isAuthenticated,
    isNewUser,
    hasRole,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  }
}
