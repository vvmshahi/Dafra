export interface LoginLocationState {
  from?: unknown
}

export function approvedLoginReturnPath(state: unknown): string | null {
  const from = (state as LoginLocationState | null | undefined)?.from
  if (typeof from !== 'string') return null
  if (!from.startsWith('/') || from.startsWith('//')) return null
  if (from === '/' || from === '/login' || from.startsWith('/login?')) return null
  return from
}
