import { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole, Tenant } from '@/types'

function computeIsOnboarded(profile: UserProfile | null): boolean | null {
  if (profile === null) return null
  if (profile.role === 'owner' && !profile.tenant_id) return false
  return true
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function fetchProfile(userId: string) {
      try {
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
        }
      } catch (err) {
        console.error('[useAuth] fetchProfile error:', err)
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
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user)
        setSession(session)
        setLoading(true)
        fetchProfile(session.user.id)
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setSession(null)
        setProfile(null)
        setTenant(null)
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
      if (key && (key.startsWith('pos_cart_') || key.startsWith('dafra_'))) {
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
    isOnboarded: computeIsOnboarded(profile),
    isAuthenticated,
    isNewUser,
    hasRole,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  }
}
