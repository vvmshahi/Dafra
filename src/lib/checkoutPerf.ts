const MAX_TIMING_MS = 3_600_000

export interface PosCheckoutPerfContext {
  requestId: string
  startedAt: number
}

export function createPosCheckoutPerfContext(): PosCheckoutPerfContext {
  return {
    requestId: crypto.randomUUID(),
    startedAt: performance.now(),
  }
}

export function logPosCheckoutPerf(
  context: PosCheckoutPerfContext,
  event: string,
  spanStartedAt: number,
  status: 'ok' | 'error' | 'skipped' = 'ok',
): void {
  try {
    const now = performance.now()
    const bounded = (value: number) =>
      Math.round(Math.min(MAX_TIMING_MS, Math.max(0, value)) * 10) / 10
    console.info('[pos-checkout-perf]', {
      event,
      requestId: context.requestId,
      durationMs: bounded(now - spanStartedAt),
      elapsedMs: bounded(now - context.startedAt),
      action: 'checkout_simplified',
      status,
      coldStartCandidate: false,
    })
  } catch {
    // Performance diagnostics must never affect checkout behavior.
  }
}
