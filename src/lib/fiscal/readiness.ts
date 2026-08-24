import { supabase } from '@/lib/supabase'

export type FiscalReadiness = {
  branchId: string
  fiscalRegime: 'generation' | 'integration'
  activationState: 'generation_active' | 'integration_setup' | 'integration_active'
  policyRevision: number
  generationReady: boolean
  generationMissingFields: string[]
  integrationReadiness: { ready: boolean; missingFields: string[] }
}

export async function getFiscalReadiness(branchId: string): Promise<FiscalReadiness> {
  const { data, error } = await (supabase as any).rpc('get_generation_readiness_v1', { p_branch_id: branchId })
  if (error) throw error
  return data as FiscalReadiness
}

export async function beginIntegrationSetup(branchId: string) {
  const { data, error } = await (supabase as any).rpc('begin_integration_setup_v1', { p_branch_id: branchId })
  if (error) throw error
  return data
}
