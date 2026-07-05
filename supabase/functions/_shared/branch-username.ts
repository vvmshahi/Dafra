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
const INTERNAL_BRANCH_LOGIN_DOMAIN = 'branch-login.kubri.internal'

export type BranchUsernameValidationResult =
  | { ok: true; normalizedUsername: string }
  | { ok: false; normalizedUsername: string; message: string }

export function normalizeBranchUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validateBranchUsername(value: unknown): BranchUsernameValidationResult {
  const normalizedUsername = normalizeBranchUsername(value)

  if (!normalizedUsername) {
    return { ok: false, normalizedUsername, message: 'Enter a username.' }
  }

  if (normalizedUsername.includes('@')) {
    return { ok: false, normalizedUsername, message: 'Usernames cannot contain @.' }
  }

  if (normalizedUsername.length < 3 || normalizedUsername.length > 32) {
    return { ok: false, normalizedUsername, message: 'Usernames must be 3 to 32 characters.' }
  }

  if (!USERNAME_ALLOWED_PATTERN.test(normalizedUsername)) {
    return { ok: false, normalizedUsername, message: 'Use lowercase letters, numbers, underscore, or hyphen only.' }
  }

  if (USERNAME_EDGE_SEPARATOR_PATTERN.test(normalizedUsername)) {
    return { ok: false, normalizedUsername, message: 'Usernames cannot start or end with underscore or hyphen.' }
  }

  if (USERNAME_REPEATED_SEPARATOR_PATTERN.test(normalizedUsername)) {
    return { ok: false, normalizedUsername, message: 'Usernames cannot contain repeated separators.' }
  }

  if (RESERVED_BRANCH_USERNAMES.has(normalizedUsername)) {
    return { ok: false, normalizedUsername, message: 'This username is reserved.' }
  }

  return { ok: true, normalizedUsername }
}

export function internalBranchAuthEmail(normalizedUsername: string, branchId: string): string {
  const username = normalizeBranchUsername(normalizedUsername)
  const branchSuffix = branchId.replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 10)

  if (!branchSuffix) {
    throw new Error('Branch id is required to generate an internal auth email.')
  }

  return `${username}.${branchSuffix}@${INTERNAL_BRANCH_LOGIN_DOMAIN}`
}
