export type AuthRouteState = {
  loading: boolean
  authError: string | null
  isAuthenticated: boolean
  isOnboarded: boolean | null
  role?: string
  firstBranchAccessComplete: boolean | null
}

export type AuthRouteDecision =
  | 'loading' | 'recovery' | 'login' | 'onboarding' | 'setup-branch'
  | 'dashboard' | 'super-admin' | 'branch' | 'allow'

export function decideProtectedRoute(state: AuthRouteState): AuthRouteDecision {
  if (state.loading) return 'loading'
  if (state.authError) return 'recovery'
  if (!state.isAuthenticated) return 'login'
  if (state.isOnboarded === null) return 'loading'
  if (state.isOnboarded === false) return 'onboarding'
  if (state.role === 'owner') {
    if (state.firstBranchAccessComplete === null) return 'loading'
    if (!state.firstBranchAccessComplete) return 'setup-branch'
  }
  return 'allow'
}

export function decideSetupBranchRoute(state: AuthRouteState): AuthRouteDecision {
  if (state.loading) return 'loading'
  if (state.authError) return 'recovery'
  if (!state.isAuthenticated) return 'login'
  if (state.isOnboarded === null) return 'loading'
  if (state.isOnboarded === false) return 'onboarding'
  if (state.role === 'super_admin') return 'super-admin'
  if (state.role === 'branch') return 'branch'
  if (state.firstBranchAccessComplete === null) return 'loading'
  return state.firstBranchAccessComplete ? 'dashboard' : 'allow'
}
