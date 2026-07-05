const RESERVED_BRANCH_USERNAMES = new Set([
  'admin',
  'support',
  'kubri',
  'superadmin',
  'root',
  'api',
  'www',
  'login',
  'billing',
  'zatca',
  'owner',
  'branch',
  'system',
  'test',
])

const USERNAME_ALLOWED_PATTERN = /^[a-z0-9_-]+$/
const USERNAME_EDGE_SEPARATOR_PATTERN = /^[_-]|[_-]$/
const USERNAME_REPEATED_SEPARATOR_PATTERN = /[_-]{2,}/
const INTERNAL_BRANCH_LOGIN_DOMAIN = '@branch-login.kubri.internal'

export const BRANCH_USERNAME_HELPER_TEXT = 'Use letters, numbers, underscore, or hyphen. 3-32 characters.'
export const BRANCH_USERNAME_INVALID_MESSAGE = 'Use 3-32 lowercase letters, numbers, underscore, or hyphen.'
export const INVALID_LOGIN_CREDENTIALS_MESSAGE = 'Invalid login credentials.'

export function normalizeBranchUsernameInput(value: string): string {
  return value.trim().toLowerCase()
}

export function isInternalBranchAuthEmail(value: string | null | undefined): boolean {
  return Boolean(value?.trim().toLowerCase().endsWith(INTERNAL_BRANCH_LOGIN_DOMAIN))
}

export function validateBranchUsernameInput(value: string): string | null {
  const username = normalizeBranchUsernameInput(value)

  if (!username) return 'Branch username is required'
  if (username.includes('@')) return BRANCH_USERNAME_INVALID_MESSAGE
  if (username.length < 3 || username.length > 32) return BRANCH_USERNAME_INVALID_MESSAGE
  if (!USERNAME_ALLOWED_PATTERN.test(username)) return BRANCH_USERNAME_INVALID_MESSAGE
  if (USERNAME_EDGE_SEPARATOR_PATTERN.test(username)) return BRANCH_USERNAME_INVALID_MESSAGE
  if (USERNAME_REPEATED_SEPARATOR_PATTERN.test(username)) return BRANCH_USERNAME_INVALID_MESSAGE
  if (RESERVED_BRANCH_USERNAMES.has(username)) return 'This username is reserved.'

  return null
}

export function branchUsernameCreateErrorMessage(message: string | null | undefined): string {
  const raw = message?.trim() ?? ''
  if (!raw) return 'Branch login setup failed.'
  if (/already taken|duplicate key|23505/i.test(raw)) return 'Username is already taken.'
  if (/username|reserved|lowercase|separator|3 to 32|3-32|@/i.test(raw)) return BRANCH_USERNAME_INVALID_MESSAGE
  if (/branch_login_usernames|resolve-branch-username|schema cache|could not find|PGRST202/i.test(raw)) {
    return 'Username login setup is not available yet. Apply the Phase 3B SQL patch, then try again.'
  }
  return raw
}
