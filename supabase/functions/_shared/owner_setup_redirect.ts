const OWNER_SETUP_REDIRECT_ENV = 'OWNER_SETUP_REDIRECT_URL'
const RESET_PASSWORD_PATH = '/reset-password'
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function resolveOwnerSetupRedirectUrl(): string {
  const raw = Deno.env.get(OWNER_SETUP_REDIRECT_ENV)?.trim()
  if (!raw) {
    throw new Error(`${OWNER_SETUP_REDIRECT_ENV} is required`)
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${OWNER_SETUP_REDIRECT_ENV} must be a valid URL`)
  }

  const isLocalhostDevUrl = url.protocol === 'http:' && LOCALHOST_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !isLocalhostDevUrl) {
    throw new Error(`${OWNER_SETUP_REDIRECT_ENV} must use HTTPS outside localhost development`)
  }

  if (url.username || url.password) {
    throw new Error(`${OWNER_SETUP_REDIRECT_ENV} must not include credentials`)
  }

  if (url.pathname !== RESET_PASSWORD_PATH || url.search || url.hash) {
    throw new Error(`${OWNER_SETUP_REDIRECT_ENV} must point exactly to ${RESET_PASSWORD_PATH}`)
  }

  return url.toString()
}
