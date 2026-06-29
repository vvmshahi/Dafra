import { getProductionOnboardingStatus, type ProductionOnboardingResponse } from '@/lib/zatca/api'

const CACHE_PREFIX = 'zatca_production_status:'
const CACHE_TTL_MS = 5 * 60 * 1000

interface CachedStatus {
  savedAt: number
  status: ProductionOnboardingResponse
}

export function readCachedProductionStatus(branchId: string): ProductionOnboardingResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + branchId)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedStatus
    if (!cached?.status || Date.now() - cached.savedAt > CACHE_TTL_MS) return null
    return cached.status
  } catch {
    return null
  }
}

export function writeCachedProductionStatus(branchId: string, status: ProductionOnboardingResponse): void {
  try {
    const safeStatus: ProductionOnboardingResponse = {
      ok: status.ok,
      preflight: status.preflight,
      dryRun: status.dryRun,
      branchId: status.branchId,
      environment: status.environment,
      onboardingStatus: status.onboardingStatus,
      steps: status.steps,
      functionalityMap: status.functionalityMap,
      connectedAt: status.connectedAt,
      disconnectedAt: status.disconnectedAt,
      updatedAt: status.updatedAt,
      productionCsidExists: status.productionCsidExists,
      productionSecretExists: status.productionSecretExists,
      branchName: status.branchName,
      vatNumber: status.vatNumber,
      crNumber: status.crNumber,
      message: status.message,
    }
    sessionStorage.setItem(CACHE_PREFIX + branchId, JSON.stringify({
      savedAt: Date.now(),
      status: safeStatus,
    }))
  } catch {
    // Cache failures should never block UI.
  }
}

export async function getCachedProductionStatus(branchId: string): Promise<ProductionOnboardingResponse> {
  const status = await getProductionOnboardingStatus(branchId)
  writeCachedProductionStatus(branchId, status)
  return status
}

export function productionStatusLabel(status?: ProductionOnboardingResponse | null, sandboxConnected = false): {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'
} {
  if (status?.onboardingStatus === 'production_connected') {
    return { label: 'ZATCA Phase 2 Connected', tone: 'success' }
  }
  if (status?.onboardingStatus === 'disconnected' || status?.onboardingStatus === 'not_started' || !status) {
    return sandboxConnected
      ? { label: 'Sandbox connected, production not connected', tone: 'warning' }
      : { label: 'Phase 2 setup needed', tone: 'warning' }
  }
  if (status.onboardingStatus === 'compliance_failed' || status.onboardingStatus === 'failed') {
    return { label: 'Phase 2 setup failed', tone: 'danger' }
  }
  return { label: 'Phase 2 setup in progress', tone: 'info' }
}
