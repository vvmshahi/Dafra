import { supabase } from '@/lib/supabase'
import { resolveInvoicePresentationSettings, type InvoiceSettingsBranchDefaults, type NormalizedInvoiceSettings } from './presentationSettings'

export interface RuntimePresentationBranch extends InvoiceSettingsBranchDefaults {
  readonly presentation_settings?: unknown
}

export interface ResolvedRuntimePresentation extends NormalizedInvoiceSettings {
  readonly logoUrl: string | null
}

/** Resolve a stored branch-assets object path exactly as the settings preview does. */
export function resolveInvoiceLogoUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null
  if (/^(?:https?:|data:|blob:)/i.test(assetPath)) return assetPath
  try {
    return supabase.storage.from('branch-assets').getPublicUrl(assetPath).data.publicUrl || null
  } catch {
    return null
  }
}

/**
 * Single runtime presentation resolver for stored invoices and POS output.
 * The branch row is the source of legacy defaults and, when present, the saved
 * V1 presentation_settings object. This helper never touches compliance data.
 */
export function resolveRuntimeInvoicePresentation({
  branch,
  savedSettings,
}: {
  branch: RuntimePresentationBranch
  savedSettings?: unknown
}): ResolvedRuntimePresentation {
  const rawSettings = savedSettings === undefined ? branch.presentation_settings : savedSettings
  const normalized = resolveInvoicePresentationSettings({ savedSettings: rawSettings, branch })
  return {
    ...normalized,
    logoUrl: normalized.presentation.logo.visible
      ? resolveInvoiceLogoUrl(normalized.presentation.logo.asset_path)
      : null,
  }
}
