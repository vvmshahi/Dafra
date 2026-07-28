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

const PROFILE_RETRY_DELAYS_MS = [0, 250, 750] as const

async function loadProfileWithRetry(userId: string) {
  let lastError: unknown = null
  for (const delay of PROFILE_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    const result = await supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle()
    if (!result.error) return { profile: result.data as unknown as UserProfile | null, error: null }
    lastError = result.error
  }
  return { profile: null, error: lastError }
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
  const [signingOut, setSigningOut] = useState(false)
  const signOutPending = useRef(false)
  // null = not yet checked, true = has ≥1 branch, false = no branches
  const [hasBranch, setHasBranch] = useState<boolean | null>(null)
  const [firstBranchProvisioningState, setFirstBranchProvisioningState] = useState<string | null>(null)
  const ownerSetupCompletionAttempts = useRef(new Set<string>())
  const currentUserId = useRef<string | null>(null)
  const currentProfile = useRef<UserProfile | null>(null)

  useEffect(() => {
    let mounted = true

    async function fetchBranchCount(_tenantId: string) {
      const { data, error } = await (supabase.rpc as any)('get_first_branch_provisioning_status')
      if (!mounted) return
      if (error) throw error
      const status = Array.isArray(data) ? data[0] : data
      setFirstBranchProvisioningState(status?.state ?? null)
      setHasBranch(status?.access_complete === true)
    }

    async function fetchProfile(userId: string) {
      try {
        if (mounted) setAuthError(null)
        const { profile: data, error } = await loadProfileWithRetry(userId)
        if (!mounted) return
        if (error) throw error
        const p = data as unknown as UserProfile | null
        currentProfile.current = p
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
          currentUserId.current = session.user.id
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
        const sameAuthenticatedUser = currentUserId.current === session.user.id && currentProfile.current !== null
        currentUserId.current = session.user.id
        setUser(session.user)
        setSession(session)
        // Supabase may emit SIGNED_IN again when a hidden tab or desktop window
        // resumes. Keep the mounted route and form tree intact in that case.
        if (sameAuthenticatedUser) return
        setLoading(true)
        setHasBranch(null)
        setFirstBranchProvisioningState(null)
        setAuthError(null)
        fetchProfile(session.user.id)
      }
      if (event === 'SIGNED_OUT') {
        currentUserId.current = null
        currentProfile.current = null
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
      const { data, error } = await (supabase.rpc as any)('get_first_branch_provisioning_status')
      if (error) {
        setAuthError('We could not verify first-branch access. Please retry.')
        return
      }
      const status = Array.isArray(data) ? data[0] : data
      setFirstBranchProvisioningState(status?.state ?? null)
      setHasBranch(status?.access_complete === true)
    }
  }, [])

  const refreshProfile = useCallback(async (): Promise<{ ok: boolean; profile: UserProfile | null; code?: string }> => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return { ok: false, profile: null, code: 'SESSION_MISSING' }
    try {
      const { profile: p, error } = await loadProfileWithRetry(session.user.id)
      if (error) {
        setAuthError('We could not load your account profile. Please retry or sign in again.')
        return { ok: false, profile: currentProfile.current, code: 'PROFILE_QUERY_FAILED' }
      }
      setAuthError(null)
      currentProfile.current = p
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
      return { ok: true, profile: p, code: p ? undefined : 'PROFILE_MISSING' }
    } catch (err) {
      console.error('[useAuth] refreshProfile error:', err)
      setAuthError('We could not load your account profile. Please retry or sign in again.')
      return { ok: false, profile: currentProfile.current, code: 'PROFILE_QUERY_FAILED' }
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
    if (signOutPending.current) return { error: null, pending: true }
    signOutPending.current = true
    setSigningOut(true)
    let error: Error | null = null
    try {
      const result = await supabase.auth.signOut()
      error = result.error
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error('Remote sign-out failed')
    }
    if (error) {
      signOutPending.current = false
      setSigningOut(false)
      return { error, pending: false }
    }

    // Remote revocation is confirmed before user-scoped browser state is
    // removed. Language and other device preferences are intentionally kept.
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (
        key.startsWith('pos_cart_')
        || key.startsWith('meem_')
        || key.startsWith('kubri_')
        || key.startsWith('pos_customer_')
        || key.startsWith('pos_modal_')
      )) {
        toRemove.push(key)
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k))
    currentUserId.current = null
    currentProfile.current = null
    setUser(null)
    setSession(null)
    setProfile(null)
    setTenant(null)
    setBranch(null)
    setHasBranch(true)
    signOutPending.current = false
    setSigningOut(false)
    return { error: null, pending: false }
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
    firstBranchProvisioningState,
    hasRole,
    signIn,
    signUp,
    signOut,
    signingOut,
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
