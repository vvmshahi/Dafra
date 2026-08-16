import type { EffectiveBranchBillingConfig } from '@/lib/branches/billingProfile'

export type CatalogueTerminology = 'products' | 'catalogue'

export interface CataloguePresentation {
  terminology: CatalogueTerminology
  navigationLabelKey: CatalogueTerminology
  titleKey: 'title' | 'catalogue'
  addActionKey: 'add' | 'addItem'
  subtitleKey: 'subtitle' | 'catalogueSubtitle'
}

export interface CatalogueItemCreationCapabilities {
  productsEnabled: boolean
  servicesEnabled: boolean
  showItemType: boolean
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

/**
 * Creation-only capability policy for the shared catalogue workspace. Legacy
 * branches retain the existing product-only creation flow; explicit branch
 * profiles are the sole authority for offering saved service creation.
 */
export function getCatalogueItemCreationCapabilities(
  config: EffectiveBranchBillingConfig | null | undefined,
): CatalogueItemCreationCapabilities {
  if (!config || config.legacyProfile) {
    return {
      productsEnabled: true,
      servicesEnabled: false,
      showItemType: false,
    }
  }

  return {
    productsEnabled: config.productsEnabled,
    servicesEnabled: config.servicesEnabled,
    showItemType: config.servicesEnabled,
  }
}
