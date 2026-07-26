export const REPORTING_OUTCOMES = Object.freeze({
  accepted: 'accepted',
  transientFailure: 'transient_failure',
  definiteRejection: 'definite_rejection',
  ambiguousOutcome: 'ambiguous_outcome',
})

// Four total network/preflight dispatch attempts. The database enforces the
// same limit and is authoritative if this module and a worker ever drift.
export const REPORTING_MAX_TRANSIENT_ATTEMPTS = 4
export const REPORTING_MAX_BATCH_SIZE = 10

const TRANSIENT_HTTP_STATUSES = new Set([425, 429])

export function classifyReportingHttpOutcome({
  httpStatus,
  reportingStatus,
  validationStatus,
  errorCodes = [],
}) {
  const normalizedErrors = Array.isArray(errorCodes)
    ? errorCodes.filter(code => typeof code === 'string' && code.trim())
    : []

  const normalizedValidationStatus = typeof validationStatus === 'string'
    ? validationStatus.trim().toUpperCase()
    : ''
  const explicitValidationFailure = normalizedErrors.length > 0
    || ['ERROR', 'FAILED', 'INVALID', 'NOT_VALID'].includes(normalizedValidationStatus)

  // Validation evidence is deterministic even if a malformed upstream
  // response happens to carry a 2xx or 5xx status.
  if (explicitValidationFailure) {
    return REPORTING_OUTCOMES.definiteRejection
  }

  if (
    Number.isInteger(httpStatus)
    && httpStatus >= 200
    && httpStatus < 300
    && reportingStatus === 'REPORTED'
  ) {
    return REPORTING_OUTCOMES.accepted
  }

  // A remote request-timeout response does not establish whether the upstream
  // reporting operation reached ZATCA. Replaying it is unsafe.
  if (httpStatus === 408) {
    return REPORTING_OUTCOMES.ambiguousOutcome
  }

  // These statuses are explicit throttling/precondition responses and do
  // not prove that ZATCA deterministically rejected the invoice content.
  if (TRANSIENT_HTTP_STATUSES.has(httpStatus)) {
    return REPORTING_OUTCOMES.transientFailure
  }

  if (
    Number.isInteger(httpStatus) && httpStatus >= 500 && httpStatus <= 599
  ) {
    return REPORTING_OUTCOMES.transientFailure
  }

  // Other 2xx responses without REPORTED, deterministic 4xx responses, 3xx,
  // and malformed response statuses are blocked for operator review.
  return REPORTING_OUTCOMES.definiteRejection
}

export function reportingRetryDecision(attemptCount) {
  const normalizedAttempt = Number.isInteger(attemptCount) && attemptCount > 0
    ? attemptCount
    : 1
  if (normalizedAttempt >= REPORTING_MAX_TRANSIENT_ATTEMPTS) {
    return {
      retryable: false,
      retryAfterSeconds: null,
      reason: 'MAX_TRANSIENT_ATTEMPTS_REACHED',
    }
  }
  return {
    retryable: true,
    retryAfterSeconds: Math.min(900, 60 * (2 ** (normalizedAttempt - 1))),
    reason: 'TRANSIENT_REPORTING_FAILURE',
  }
}

export function clampReportingBatchSize(value) {
  const requested = Number(value)
  return Number.isInteger(requested)
    ? Math.min(REPORTING_MAX_BATCH_SIZE, Math.max(1, requested))
    : REPORTING_MAX_BATCH_SIZE
}
