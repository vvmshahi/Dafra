import { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole } from '@/types'

interface AuthState {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    loading: true,
  })

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    // maybeSingle() returns { data: null, error: null } for 0 rows.
    // single() returns PGRST116 error for 0 rows, which PostgREST surfaces
    // as "Database error querying schema" in the browser console.
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      // Log with full detail so the real PostgREST error is visible in devtools.
      console.error('[useAuth] fetchProfile failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        userId,
      })
      return null
    }

    return data
  }, [])

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on mount (covers the getSession()
    // call that was here before). Keeping both caused a race: two simultaneous
    // fetchProfile calls → two setState calls → profile could land as null.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const profile = await fetchProfile(session.user.id)
          setState({ user: session.user, session, profile, loading: false })
        } else {
          setState({ user: null, session: null, profile: null, loading: false })
        }
      },
    )

    return () => subscription.unsubscribe()
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
      options: { data: { full_name: fullName } },
    })
    if (error) console.error('[useAuth] signUp error:', error.message)
    return { error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const hasRole = (...roles: UserRole[]) =>
    state.profile ? roles.includes(state.profile.role) : false

  const isAuthenticated = !!state.user

  return {
    ...state,
    isAuthenticated,
    hasRole,
    signIn,
    signUp,
    signOut,
  }
}
