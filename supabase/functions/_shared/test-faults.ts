/**
 * Disposable-runtime fault controls. They are inert unless a dedicated secret
 * is configured in the Edge environment and supplied by the test client.
 * Production deployments must not configure DAFRA_TEST_FAULT_SECRET.
 */
export function disposableFault(req: Request, expected: string): boolean {
  const configured = Deno.env.get('DAFRA_TEST_FAULT_SECRET')
  if (!configured || configured.length < 24) return false
  return req.headers.get('x-dafra-test-fault-secret') === configured &&
    req.headers.get('x-dafra-test-fault') === expected
}

export async function disposableDelay(req: Request, expected: string, milliseconds = 750): Promise<void> {
  if (disposableFault(req, expected)) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  }
}
