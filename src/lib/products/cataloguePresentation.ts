import type { EffectiveBranchBillingConfig } from '@/lib/branches/billingProfile'

export type CatalogueTerminology = 'products' | 'catalogue'

export interface CataloguePresentation {
  terminology: CatalogueTerminology
  navigationLabelKey: CatalogueTerminology
  titleKey: 'title' | 'catalogue'
  addActionKey: 'add' | 'addItem'
  subtitleKey: 'subtitle' | 'catalogueSubtitle'
}

const PRODUCTS_PRESENTATION: CataloguePresentation = {
  terminology: 'products',
  navigationLabelKey: 'products',
  titleKey: 'title',
  addActionKey: 'add',
  subtitleKey: 'subtitle',
}

const CATALOGUE_PRESENTATION: CataloguePresentation = {
  terminology: 'catalogue',
  navigationLabelKey: 'catalogue',
  titleKey: 'catalogue',
  addActionKey: 'addItem',
  subtitleKey: 'catalogueSubtitle',
}

/**
 * Presentation-only terminology for the shared /products workspace. Explicit
 * Services branches use Catalogue; every other case, including legacy NULL
 * profiles, deliberately retains the existing Products terminology.
 */
export function getCataloguePresentation(
  config: EffectiveBranchBillingConfig | null | undefined,
): CataloguePresentation {
  return config?.businessProfile === 'services'
    ? CATALOGUE_PRESENTATION
    : PRODUCTS_PRESENTATION
}
