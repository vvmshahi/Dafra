import { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole, Tenant } from '@/types'

interface AuthState {
  user:    User | null
  session: Session | null
  profile: UserProfile | null
  tenant:  Tenant | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user:    null,
    session: null,
    profile: null,
    tenant:  null,
    loading: true,
  })

  // Fetches profile + tenant in parallel where possible.
  const fetchProfile = useCallback(async (userId: string) => {
    // Cast through unknown: supabase-js@2.45 (PostgrestVersion "12") resolves
    // the Row type to `never` when it contains string-union enum fields.
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    const profile = data as unknown as UserProfile | null

    if (error) {
      console.error('[useAuth] fetchProfile failed:', {
        code: error.code, message: error.message,
        details: error.details, hint: error.hint, userId,
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
      if (tErr) console.error('[useAuth] fetchTenant failed:', tErr.message)
      else tenant = tData as unknown as Tenant | null
    }

    return { profile, tenant }
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const { profile, tenant } = await fetchProfile(session.user.id)
          setState({ user: session.user, session, profile, tenant, loading: false })
        } else {
          setState({ user: null, session: null, profile: null, tenant: null, loading: false })
        }
      },
    )
    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // Call after onboarding to pick up the new tenant_id + role.
  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const { profile, tenant } = await fetchProfile(session.user.id)
    setState(prev => ({ ...prev, profile, tenant }))
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
    // Clear POS cart and any other app-level local storage keys
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

  // True when user is signed in but hasn't completed onboarding yet.
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
