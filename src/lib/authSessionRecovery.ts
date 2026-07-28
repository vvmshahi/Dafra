export const AUTH_STORAGE_KEY = 'meem-auth'

export function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? error ?? '',
  )
  return /invalid refresh token|refresh token not found/i.test(message)
}

export function clearStaleAuthSessionData(
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
) {
  storage.removeItem(AUTH_STORAGE_KEY)
}
