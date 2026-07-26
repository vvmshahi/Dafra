export function jwtClaims(token) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) return null
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return {
      role: typeof payload?.role === 'string' ? payload.role : null,
      ref: typeof payload?.ref === 'string' ? payload.ref : null,
    }
  } catch {
    return null
  }
}

export async function timingSafeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const encoder = new TextEncoder()
  const leftEncoded = encoder.encode(left)
  const rightEncoded = encoder.encode(right)
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', leftEncoded),
    crypto.subtle.digest('SHA-256', rightEncoded),
  ])
  const leftBytes = new Uint8Array(leftDigest)
  const rightBytes = new Uint8Array(rightDigest)
  let mismatch = leftEncoded.length ^ rightEncoded.length
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index]
  }
  return mismatch === 0
}

export async function hasServiceRoleDrainCredentials({
  callerJWT,
  apiKey,
  dispatchToken,
  expectedDispatchToken,
  expectedProjectRef,
}) {
  if (
    typeof callerJWT !== 'string' || !callerJWT
    || typeof apiKey !== 'string' || !apiKey
    || typeof dispatchToken !== 'string' || !dispatchToken
    || typeof expectedDispatchToken !== 'string' || !expectedDispatchToken
    || typeof expectedProjectRef !== 'string' || !expectedProjectRef
  ) return false

  const claims = jwtClaims(callerJWT)
  if (claims?.role !== 'service_role' || claims.ref !== expectedProjectRef) return false

  const [matchingGatewayJwt, matchingDispatchToken] = await Promise.all([
    timingSafeEqualText(callerJWT, apiKey),
    timingSafeEqualText(dispatchToken, expectedDispatchToken),
  ])
  return matchingGatewayJwt && matchingDispatchToken
}

export function isStrictDrainBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const allowed = new Set(['action', 'batchSize'])
  return body.action === 'drain_outbox'
    && Object.keys(body).every(key => allowed.has(key))
}

export async function authorizeDrainRequest({
  body,
  callerJWT,
  apiKey,
  dispatchToken,
  expectedDispatchToken,
  expectedProjectRef,
}) {
  if (body?.action !== 'drain_outbox') {
    return { isDrain: false, allowed: false, status: null, code: null }
  }
  if (!await hasServiceRoleDrainCredentials({
    callerJWT,
    apiKey,
    dispatchToken,
    expectedDispatchToken,
    expectedProjectRef,
  })) {
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
