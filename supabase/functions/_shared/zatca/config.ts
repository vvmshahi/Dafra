export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export type OnboardingStatus =
  | 'not_started'
  | 'generating_csr'
  | 'compliance_csid_requested'
  | 'compliance_samples_passed'
  | 'production_csid_requested'
  | 'production_connected'
  | 'compliance_failed'
  | 'failed'

export type FunctionalityMap = '0100' | '1000' | '1100'

export const PRODUCTION_CORE_BASE_URL =
  Deno.env.get('ZATCA_PRODUCTION_BASE_URL') ??
  'https://gw-fatoora.zatca.gov.sa/e-invoicing/core'

const SENSITIVE_PATTERNS = [
  /otp/i,
  /secret/i,
  /csid/i,
  /token/i,
  /certificate/i,
  /private[_ -]?key/i,
  /authorization/i,
  /csr/i,
  /xml/i,
]

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function safeErrorMessage(err: unknown): string {
  const fallback = 'ZATCA production onboarding failed. Sensitive details were redacted.'
  const raw = err instanceof Error ? err.message : String(err ?? fallback)
  if (!raw || raw.length > 240) return fallback
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(raw))) return fallback
  return raw
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isFunctionalityMap(value: unknown): value is FunctionalityMap {
  return value === '0100' || value === '1000' || value === '1100'
}

export function validateOtp(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value)
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function productionCallsAllowed(): boolean {
  return Deno.env.get('ALLOW_ZATCA_PRODUCTION_ONBOARDING') === 'true'
}
