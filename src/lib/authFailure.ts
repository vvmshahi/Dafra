export type AuthFailureKind =
  | 'invalid_credentials'
  | 'network'
  | 'rate_limited'
  | 'configuration'
  | 'unavailable'

type AuthErrorLike = {
  message?: unknown
  code?: unknown
  status?: unknown
  name?: unknown
}

function details(error: unknown): { message: string; code: string; status: number | null; name: string } {
  const value = (error && typeof error === 'object' ? error : {}) as AuthErrorLike
  const statusNumber = Number(value.status)
  return {
    message: String(value.message ?? error ?? '').toLowerCase(),
    code: String(value.code ?? '').toLowerCase(),
    status: Number.isFinite(statusNumber) && statusNumber > 0 ? statusNumber : null,
    name: String(value.name ?? '').toLowerCase(),
  }
}

export function classifyAuthFailure(error: unknown): AuthFailureKind {
  const { message, code, status, name } = details(error)
  const combined = `${message} ${code} ${name}`

  if (status === 429 || /rate|too many/.test(combined)) return 'rate_limited'
  if (/placeholder\.supabase|missing vite_supabase|configuration|project.*(not found|invalid)/.test(combined)) return 'configuration'
  if (/failed to fetch|fetch failed|network|offline|dns|timeout|timed out|connection|aborterror|load failed/.test(combined)) return 'network'
  if (status === 400 || status === 401 || /invalid login credentials|invalid credentials|invalid password/.test(combined)) {
    return 'invalid_credentials'
  }
  return 'unavailable'
}

export function safeAuthError(kind: AuthFailureKind): Error {
  switch (kind) {
    case 'invalid_credentials':
      return new Error('Invalid login credentials.')
    case 'network':
      return new Error('Unable to connect to authentication service.')
    case 'rate_limited':
      return new Error('Too many login attempts. Please wait and try again.')
    case 'configuration':
      return new Error('Desktop application configuration error. Please update or reinstall Kubri.')
    default:
      return new Error('Authentication service is temporarily unavailable. Please try again.')
  }
}

export function authFailureDiagnostic(error: unknown): { kind: AuthFailureKind; status: number | null; code: string } {
  const value = (error && typeof error === 'object' ? error : {}) as AuthErrorLike
  const statusNumber = Number(value.status)
  return {
    kind: classifyAuthFailure(error),
    status: Number.isFinite(statusNumber) && statusNumber > 0 ? statusNumber : null,
    code: typeof value.code === 'string' ? value.code.slice(0, 80) : '',
  }
}
