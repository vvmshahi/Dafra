import { supabase } from '@/lib/supabase'

export class ZatcaEdgeAuthenticationError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again to continue.')
    this.name = 'ZatcaEdgeAuthenticationError'
  }
}

function edgeStatus(error: unknown): number | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  return typeof status === 'number' ? status : null
}

/**
 * Invokes the protected ZATCA Edge endpoint with the active browser session.
 * The same request object is replayed at most once, and only after a 401.
 */
export async function invokeAuthenticatedZatca(body: Record<string, unknown>) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (sessionError || !accessToken) throw new ZatcaEdgeAuthenticationError()

  const invoke = (token: string) => supabase.functions.invoke('zatca-submit', {
    headers: { Authorization: `Bearer ${token}` },
    body,
  })

  const initialResult = await invoke(accessToken)
  if (edgeStatus(initialResult.error) !== 401) return initialResult

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
  const refreshedAccessToken = refreshed.session?.access_token
  if (refreshError || !refreshedAccessToken) throw new ZatcaEdgeAuthenticationError()

  return invoke(refreshedAccessToken)
}
