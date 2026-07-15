import { createContext, createElement, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Branch, UserProfile, UserRole, Tenant } from '@/types'
import { markOwnerSetupCompleteSilently } from '@/lib/ownerSetupCompletion'
import {
  INVALID_LOGIN_CREDENTIALS_MESSAGE,
  normalizeBranchUsernameInput,
  validateBranchUsernameInput,
} from '@/lib/utils/branchUsername'

function computeIsOnboarded(profile: UserProfile | null): boolean | null {
  if (profile === null) return null
  if (profile.role === 'owner' && !profile.tenant_id) return false
  return true
}

function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true
}

function logDesktopAuthDiagnostic(event: string, session: Session | null) {
  if (!isElectronEnvironment()) return

  const parts = [
    `[Kubri Auth] event=${event}`,
    `timestamp=${new Date().toISOString()}`,
    `session=${session ? 'true' : 'false'}`,
    'environment=electron',
  ]
  if (session?.user?.id) parts.push(`userId=${session.user.id}`)
  console.info(parts.join(' '))
}

type AuthContextValue = ReturnType<typeof useProvideAuth>

const AuthContext = createContext<AuthContextValue | null>(null)

function useProvideAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  // null = not yet checked, true = has ≥1 branch, false = no branches
  const [hasBranch, setHasBranch] = useState<boolean | null>(null)
  const ownerSetupCompletionAttempts = useRef(new Set<string>())

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
          if (p.branch_id) {
            const { data: bData } = await supabase
              .from('branches')
              .select('*')
              .eq('id', p.branch_id)
              .maybeSingle()
            if (!mounted) return
            setBranch(bData as unknown as Branch | null)
          } else {
            setBranch(null)
          }
          if (p.role === 'owner') {
            const attemptKey = `${p.id}:${p.tenant_id}`
            if (p.is_active !== false && !ownerSetupCompletionAttempts.current.has(attemptKey)) {
              ownerSetupCompletionAttempts.current.add(attemptKey)
              void markOwnerSetupCompleteSilently('owner_profile_load', { knownOwner: true })
            }
            await fetchBranchCount(p.tenant_id)
          } else {
            // Branch users and super admins don't need the branch gate
            if (mounted) setHasBranch(true)
          }
        } else {
          setBranch(null)
          // No tenant yet (mid-onboarding) — branch gate doesn't apply
          if (mounted) setHasBranch(true)
        }
      } catch (err) {
        console.error('[useAuth] fetchProfile error:', err)
        if (mounted) {
          setProfile(null)
          setTenant(null)
          setBranch(null)
          setHasBranch(false)
          setAuthError('We could not load your account profile. Please retry or sign in again.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (!mounted) return
        if (error) {
          logDesktopAuthDiagnostic('INITIAL_SESSION_ERROR', null)
          setLoading(false)
          setHasBranch(true)
          return
        }

        logDesktopAuthDiagnostic('INITIAL_SESSION', session ?? null)
        if (session?.user) {
          setUser(session.user)
          setSession(session)
          fetchProfile(session.user.id)
        } else {
          setLoading(false)
          setHasBranch(true)
        }
      })
      .catch((error) => {
        if (!mounted) return
        void error
        logDesktopAuthDiagnostic('INITIAL_SESSION_ERROR', null)
        setLoading(false)
        setHasBranch(true)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      logDesktopAuthDiagnostic(event, session ?? null)
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
        setBranch(null)
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
        if (p.branch_id) {
          const { data: bData } = await supabase
            .from('branches')
            .select('*')
            .eq('id', p.branch_id)
            .maybeSingle()
          setBranch(bData as unknown as Branch | null)
        } else {
          setBranch(null)
        }
      } else {
        setBranch(null)
      }
    } catch (err) {
      console.error('[useAuth] refreshProfile error:', err)
    }
  }, [])

  const signIn = async (identifier: string, password: string) => {
    const trimmedIdentifier = identifier.trim()
    let authEmail = trimmedIdentifier

    if (!trimmedIdentifier.includes('@')) {
      const username = normalizeBranchUsernameInput(trimmedIdentifier)
      const usernameError = validateBranchUsernameInput(username)
      if (usernameError) return { error: new Error(INVALID_LOGIN_CREDENTIALS_MESSAGE) }

      const { data, error: resolverError } = await supabase.functions.invoke<{
        ok?: boolean
        authEmail?: unknown
        message?: unknown
      }>('resolve-branch-username', {
        body: { username },
      })

      if (resolverError || data?.ok !== true || typeof data.authEmail !== 'string') {
        console.error('[useAuth] branch username resolver failed:', resolverError?.message ?? data?.message ?? 'not resolved')
        return { error: new Error(INVALID_LOGIN_CREDENTIALS_MESSAGE) }
      }

      authEmail = data.authEmail
    }

    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password })
    if (error) {
      console.error('[useAuth] signIn error:', error.message, error.status)
      return { error: new Error(INVALID_LOGIN_CREDENTIALS_MESSAGE) }
    }
    return { error: null }
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
    branch,
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
