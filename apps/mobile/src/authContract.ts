const USERNAME_ALLOWED_PATTERN = /^[a-z0-9_-]+$/
const USERNAME_EDGE_SEPARATOR_PATTERN = /^[_-]|[_-]$/
const USERNAME_REPEATED_SEPARATOR_PATTERN = /[_-]{2,}/
const RESERVED = new Set([
  'admin', 'support', 'kubri', 'superadmin', 'root', 'api', 'www', 'login',
  'billing', 'zatca', 'owner', 'branch', 'system', 'test',
])

export type IdentifierKind = 'email' | 'branch-username'

export function classifyIdentifier(value: string): IdentifierKind {
  return value.trim().includes('@') ? 'email' : 'branch-username'
}

// This intentionally mirrors src/lib/utils/branchUsername.ts.
export function normalizeBranchUsername(value: string) {
  return value.trim().toLowerCase()
}

export function validateBranchUsername(value: string): string | null {
  const username = normalizeBranchUsername(value)
  if (!username) return 'Branch username is required.'
  if (username.includes('@') || username.length < 3 || username.length > 32) return 'Use 3–32 lowercase letters, numbers, underscore, or hyphen.'
  if (!USERNAME_ALLOWED_PATTERN.test(username)) return 'Use 3–32 lowercase letters, numbers, underscore, or hyphen.'
  if (USERNAME_EDGE_SEPARATOR_PATTERN.test(username) || USERNAME_REPEATED_SEPARATOR_PATTERN.test(username)) return 'Use 3–32 lowercase letters, numbers, underscore, or hyphen.'
  if (RESERVED.has(username)) return 'This Branch username is reserved.'
  return null
}

export function safeAuthMessage(category:
  | 'username-not-found' | 'invalid-password' | 'email-credentials'
  | 'resolver-unavailable' | 'network' | 'session-expired',
) {
  if (category === 'username-not-found') return 'We could not find that Branch username.'
  if (category === 'invalid-password') return 'The password is incorrect.'
  if (category === 'resolver-unavailable') return 'Branch username sign-in is temporarily unavailable. Try again shortly.'
  if (category === 'network') return 'Unable to connect. Check your internet connection and try again.'
  if (category === 'session-expired') return 'Your session expired. Sign in again.'
  return 'The email or password is incorrect.'
}

