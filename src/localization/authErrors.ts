export type AuthErrorKey =
  | 'errors.invalidCredentials'
  | 'errors.network'
  | 'errors.tooManyRequests'
  | 'errors.resetRequestFailed'
  | 'errors.passwordUpdateFailed'
  | 'errors.accountDisabled'
  | 'errors.generic'

export function authErrorKey(error: unknown, fallback: AuthErrorKey): AuthErrorKey {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  const normalized = message.toLowerCase()

  if (/fetch|network|offline|connection/.test(normalized)) return 'errors.network'
  if (/rate|too many|429/.test(normalized)) return 'errors.tooManyRequests'
  if (/invalid login|invalid credentials|incorrect|credentials/.test(normalized)) return 'errors.invalidCredentials'
  if (/disabled|inactive|banned/.test(normalized)) return 'errors.accountDisabled'
  return fallback
}

