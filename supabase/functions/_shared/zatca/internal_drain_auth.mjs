export function jwtRole(token) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) return null
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export function hasServiceRoleDrainCredentials({
  callerJWT,
  apiKey,
  serviceRoleKey,
}) {
  return typeof serviceRoleKey === 'string'
    && serviceRoleKey.length > 0
    && callerJWT === serviceRoleKey
    && apiKey === serviceRoleKey
    && jwtRole(callerJWT) === 'service_role'
}

export function isStrictDrainBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const allowed = new Set(['action', 'batchSize'])
  return body.action === 'drain_outbox'
    && Object.keys(body).every(key => allowed.has(key))
}

export function authorizeDrainRequest({
  body,
  callerJWT,
  apiKey,
  serviceRoleKey,
}) {
  if (body?.action !== 'drain_outbox') {
    return { isDrain: false, allowed: false, status: null, code: null }
  }
  if (!hasServiceRoleDrainCredentials({ callerJWT, apiKey, serviceRoleKey })) {
    return {
      isDrain: true,
      allowed: false,
      status: 403,
      code: 'SERVICE_ROLE_REQUIRED',
    }
  }
  if (!isStrictDrainBody(body)) {
    return {
      isDrain: true,
      allowed: false,
      status: 400,
      code: 'DRAIN_SCOPE_NOT_ALLOWED',
    }
  }
  return { isDrain: true, allowed: true, status: 200, code: null }
}
