import { createContext, createElement, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole, Tenant } from '@/types'

function computeIsOnboarded(profile: UserProfile | null): boolean | null {
  if (profile === null) return null
  if (profile.role === 'owner' && !profile.tenant_id) return false
  return true
}

type AuthContextValue = ReturnType<typeof useProvideAuth>

const AuthContext = createContext<AuthContextValue | null>(null)

function useProvideAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  // null = not yet checked, true = has ≥1 branch, false = no branches
  const [hasBranch, setHasBranch] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true

    async function fetchBranchCount(tenantId: string) {
      const { count } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      if (!mounted) return
      setHasBranch((count ?? 0) > 0)
    }

    async function fetchProfile(userId: string) {
      try {
        if (mounted) setAuthError(null)
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()
        if (!mounted) return
        if (error) throw error
        const p = data as unknown as UserProfile | null
        setProfile(p)
        if (p?.tenant_id) {
          const { data: tData } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', p.tenant_id)
            .maybeSingle()
          if (!mounted) return
          setTenant(tData as unknown as Tenant | null)
          if (p.role === 'owner') {
            await fetchBranchCount(p.tenant_id)
          } else {
            // Branch users and super admins don't need the branch gate
            if (mounted) setHasBranch(true)
          }
        } else {
          // No tenant yet (mid-onboarding) — branch gate doesn't apply
          if (mounted) setHasBranch(true)
        }
      } catch (err) {
        console.error('[useAuth] fetchProfile error:', err)
        if (mounted) {
          setProfile(null)
          setTenant(null)
          setHasBranch(false)
          setAuthError('We could not load your account profile. Please retry or sign in again.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        setSession(session)
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
        setHasBranch(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user)
        setSession(session)
        setLoading(true)
        setHasBranch(null)
        setAuthError(null)
        fetchProfile(session.user.id)
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setSession(null)
        setProfile(null)
        setTenant(null)
        setHasBranch(null)
        setAuthError(null)
        setLoading(false)
      }
      if (event === 'TOKEN_REFRESHED' && session) {
        setUser(session.user)
        setSession(session)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const refreshBranchCount = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const { data: p } = await supabase
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', session.user.id)
      .maybeSingle()
    const prof = p as { role: string; tenant_id: string | null } | null
    if (prof?.role === 'owner' && prof?.tenant_id) {
      const { count } = await supabase
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', prof.tenant_id)
      setHasBranch((count ?? 0) > 0)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      const p = data as unknown as UserProfile | null
      setProfile(p)
      if (p?.tenant_id) {
        const { data: tData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', p.tenant_id)
          .maybeSingle()
        setTenant(tData as unknown as Tenant | null)
      }
    } catch (err) {
      console.error('[useAuth] refreshProfile error:', err)
    }
  }, [])

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
      if (key && (key.startsWith('pos_cart_') || key.startsWith('meem_'))) {
        toRemove.push(key)
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k))
    await supabase.auth.signOut()
  }

  const hasRole = (...roles: UserRole[]) =>
    profile ? roles.includes(profile.role) : false

  const isAuthenticated = !!user

  const isNewUser = isAuthenticated && !loading
    && !!profile && !profile.tenant_id
    && profile.role !== 'super_admin'

  return {
    user,
    session,
    profile,
    tenant,
    loading,
    authError,
    isOnboarded: computeIsOnboarded(profile),
    isAuthenticated,
    isNewUser,
    hasBranch,
    hasRole,
    signIn,
    signUp,
    signOut,
    refreshProfile,
    refreshBranchCount,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useProvideAuth()
  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return value
}
