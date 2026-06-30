type SupabaseClientLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
}

export interface AuditEventInput {
  action: string
  tenantId?: string | null
  branchId?: string | null
  actorUserId?: string | null
  actorRole?: string | null
  targetType?: string | null
  targetId?: string | null
  severity?: 'debug' | 'info' | 'warning' | 'error' | 'critical'
  status?: 'attempted' | 'succeeded' | 'failed' | 'blocked'
  metadata?: Record<string, unknown>
  ipHash?: string | null
  requestId?: string | null
}

export interface RateLimitInput extends AuditEventInput {
  scope: string
  scopeId: string
  maxAttempts: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  failOpen?: boolean
  retryAfterSeconds: number
  attempts?: number
  maxAttempts?: number
}

const SENSITIVE_KEY = /authorization|auth|bearer|token|password|otp|secret|private|csr|certificate|csid|xml|request_body|raw_response/i

export async function hashRequestIp(req: Request): Promise<string | null> {
  const salt = Deno.env.get('AUDIT_IP_HASH_SALT')
  if (!salt) return null

  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwardedFor ||
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-real-ip')?.trim()

  if (!ip) return null

  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function requestId(req: Request): string | null {
  return req.headers.get('x-request-id') ||
    req.headers.get('cf-ray') ||
    req.headers.get('x-vercel-id') ||
    null
}

export function sanitizeMetadata(value: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (depth > 2) return {}

  const clean: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (raw === undefined) continue
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      clean[key] = typeof raw === 'string' && raw.length > 300 ? raw.slice(0, 300) : raw
      continue
    }
    if (Array.isArray(raw)) {
      clean[key] = raw
        .slice(0, 20)
        .map(item => {
          if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return item
          if (typeof item === 'object') return sanitizeMetadata(item as Record<string, unknown>, depth + 1)
          return String(item).slice(0, 120)
        })
      continue
    }
    if (typeof raw === 'object') {
      clean[key] = sanitizeMetadata(raw as Record<string, unknown>, depth + 1)
    }
  }
  return clean
}

export async function auditEvent(db: SupabaseClientLike, input: AuditEventInput): Promise<void> {
  try {
    const { error } = await db.rpc('record_audit_event', {
      p_action: input.action,
      p_tenant_id: input.tenantId ?? null,
      p_branch_id: input.branchId ?? null,
      p_actor_user_id: input.actorUserId ?? null,
      p_actor_role: input.actorRole ?? null,
      p_target_type: input.targetType ?? null,
      p_target_id: input.targetId ?? null,
      p_severity: input.severity ?? 'info',
      p_status: input.status ?? 'attempted',
      p_metadata: sanitizeMetadata(input.metadata ?? {}),
      p_ip_hash: input.ipHash ?? null,
      p_request_id: input.requestId ?? null,
    })
    if (error) {
      console.warn('[security] audit_event skipped:', safeLogMessage(error.message))
    }
  } catch (err) {
    console.warn('[security] audit_event failed open:', safeLogMessage(err instanceof Error ? err.message : String(err)))
  }
}

export async function enforceRateLimit(db: SupabaseClientLike, input: RateLimitInput): Promise<RateLimitResult> {
  try {
    const { data, error } = await db.rpc('consume_rate_limit', {
      p_action: input.action,
      p_scope: input.scope,
      p_scope_id: input.scopeId,
      p_max_attempts: input.maxAttempts,
      p_window_seconds: input.windowSeconds,
      p_tenant_id: input.tenantId ?? null,
      p_branch_id: input.branchId ?? null,
      p_actor_user_id: input.actorUserId ?? null,
      p_actor_role: input.actorRole ?? null,
      p_target_type: input.targetType ?? null,
      p_target_id: input.targetId ?? null,
      p_metadata: sanitizeMetadata(input.metadata ?? {}),
      p_ip_hash: input.ipHash ?? null,
      p_request_id: input.requestId ?? null,
    })

    if (error) {
      console.warn('[security] rate_limit failed open:', safeLogMessage(error.message))
      return { allowed: true, failOpen: true, retryAfterSeconds: 0 }
    }

    const payload = (data ?? {}) as Record<string, unknown>
    return {
      allowed: payload.allowed !== false,
      retryAfterSeconds: Number(payload.retry_after_seconds ?? 0),
      attempts: Number(payload.attempts ?? 0),
      maxAttempts: Number(payload.max_attempts ?? input.maxAttempts),
    }
  } catch (err) {
    console.warn('[security] rate_limit exception failed open:', safeLogMessage(err instanceof Error ? err.message : String(err)))
    return { allowed: true, failOpen: true, retryAfterSeconds: 0 }
  }
}

export function rateLimitBody(result: RateLimitResult): Record<string, unknown> {
  return {
    error: 'Too many attempts. Please try again later.',
    retryAfterSeconds: result.retryAfterSeconds,
  }
}

function safeLogMessage(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  if (SENSITIVE_KEY.test(value)) return 'Sensitive detail redacted.'
  return value.slice(0, 240)
}
