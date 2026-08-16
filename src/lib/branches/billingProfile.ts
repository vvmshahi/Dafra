import { supabase } from '@/lib/supabase'
import type { BranchBusinessProfile, BranchPosMode } from '@/types'

export interface EffectiveBranchBillingConfig {
  branchId: string
  businessProfile: BranchBusinessProfile | null
  legacyProfile: boolean
  productsEnabled: boolean
  servicesEnabled: boolean
  stockEnabled: boolean
  posMode: BranchPosMode
  customLinesEnabled: boolean
}

export interface BranchBillingProfileUpdate {
  businessProfile?: BranchBusinessProfile | null
  productsEnabled?: boolean
  servicesEnabled?: boolean
  customLinesEnabled?: boolean
}

export interface BranchBillingProfileDefaults {
  productsEnabled: boolean
  servicesEnabled: boolean
  customLinesEnabled: boolean
  stockEnabled: boolean
  posMode: BranchPosMode
}

/**
 * UI recommendations mirror the Phase 1 database defaults. The RPCs remain
 * authoritative for persisted and legacy-compatible effective configuration.
 */
export const BRANCH_BILLING_PROFILE_DEFAULTS: Record<BranchBusinessProfile, BranchBillingProfileDefaults> = {
  retail_trading: {
    productsEnabled: true,
    servicesEnabled: false,
    customLinesEnabled: false,
    stockEnabled: true,
    posMode: 'quick',
  },
  food_beverage: {
    productsEnabled: true,
    servicesEnabled: false,
    customLinesEnabled: false,
    stockEnabled: true,
    posMode: 'touch',
  },
  services: {
    productsEnabled: false,
    servicesEnabled: true,
    customLinesEnabled: false,
    stockEnabled: false,
    posMode: 'touch',
  },
}

export const BRANCH_BILLING_PROFILE_OPTIONS: readonly BranchBusinessProfile[] = [
  'retail_trading',
  'food_beverage',
  'services',
]

export function branchBillingProfileDefaults(profile: BranchBusinessProfile): BranchBillingProfileDefaults {
  return BRANCH_BILLING_PROFILE_DEFAULTS[profile]
}

const isBusinessProfile = (value: unknown): value is BranchBusinessProfile => (
  value === 'retail_trading' || value === 'food_beverage' || value === 'services'
)

const isPosMode = (value: unknown): value is BranchPosMode => value === 'touch' || value === 'quick'

/**
 * Normalizes the only backend contract future Branch Settings, POS, Web,
 * React Native, and Electron work should consume. The database remains the
 * authority for legacy/profile precedence and scope checks.
 */
export function normalizeEffectiveBranchBillingConfig(value: unknown): EffectiveBranchBillingConfig {
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (typeof config.branch_id !== 'string' || !config.branch_id) {
    throw new Error('Branch billing configuration is missing a branch id')
  }
  if (config.business_profile !== null && !isBusinessProfile(config.business_profile)) {
    throw new Error('Branch billing configuration contains an invalid profile')
  }
  if (!isPosMode(config.pos_mode)) {
    throw new Error('Branch billing configuration contains an invalid POS mode')
  }

  return {
    branchId: config.branch_id,
    businessProfile: config.business_profile ?? null,
    legacyProfile: config.legacy_profile === true,
    productsEnabled: config.products_enabled === true,
    servicesEnabled: config.services_enabled === true,
    stockEnabled: config.stock_enabled === true,
    posMode: config.pos_mode,
    customLinesEnabled: config.custom_lines_enabled === true,
  }
}

export async function loadEffectiveBranchBillingConfig(branchId: string) {
  const { data, error } = await (supabase as any).rpc('get_effective_branch_billing_config', {
    p_branch_id: branchId,
  })
  if (error) throw error
  return normalizeEffectiveBranchBillingConfig(data)
}

export async function updateBranchBillingProfileConfig(
  branchId: string,
  update: BranchBillingProfileUpdate,
) {
  const payload: Record<string, unknown> = {}
  if ('businessProfile' in update) payload.business_profile = update.businessProfile
  if ('productsEnabled' in update) payload.products_enabled = update.productsEnabled
  if ('servicesEnabled' in update) payload.services_enabled = update.servicesEnabled
  if ('customLinesEnabled' in update) payload.custom_lines_enabled = update.customLinesEnabled

  const { data, error } = await (supabase as any).rpc('update_branch_billing_profile_config', {
    p_branch_id: branchId,
    p_payload: payload,
  })
  if (error) throw error
  return normalizeEffectiveBranchBillingConfig(data)
}
