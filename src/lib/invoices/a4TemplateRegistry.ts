import type { A4HeaderStyle, A4TemplateId } from '@/types/database'
import type { DocumentViewModel } from './documentViewModel'

export type A4TemplateRendererId =
  | 'classic_v1'
  | 'modern_statement_v1'
  | 'minimal_professional_v1'
  | 'executive_frame_v1'
  | 'accounting_ledger_v1'
  | 'contemporary_modular_v1'

export interface A4TemplateDescriptor {
  readonly renderer: A4TemplateRendererId
  readonly version: 1
  readonly thumbnailClass: string
  readonly qrRegion: 'lower-left' | 'top-right' | 'footer-centre' | 'framed-top-right' | 'ledger-lower-left' | 'lower-verification-card'
  readonly landmarks: readonly string[]
}

export interface A4TemplateResolution {
  readonly requestedId: string
  readonly requestedVersion: number
  readonly resolvedId: A4TemplateId
  readonly resolvedVersion: 1
  readonly renderer: A4TemplateRendererId
  readonly fallback: boolean
  readonly fallbackReason: string | null
  readonly headerStyle: A4HeaderStyle
}

const registry: Record<A4TemplateId, A4TemplateDescriptor> = {
  classic: { renderer: 'classic_v1', version: 1, thumbnailClass: 'classic', qrRegion: 'lower-left', landmarks: ['classic-head', 'balanced-parties', 'full-table', 'classic-summary'] },
  modern_split: { renderer: 'modern_statement_v1', version: 1, thumbnailClass: 'modern_split', qrRegion: 'top-right', landmarks: ['statement-identity', 'statement-summary', 'asymmetric-parties', 'highlight-total'] },
  minimal_professional: { renderer: 'minimal_professional_v1', version: 1, thumbnailClass: 'minimal_professional', qrRegion: 'footer-centre', landmarks: ['editorial-head', 'typographic-parties', 'oversized-total', 'verification-footer'] },
  executive_green: { renderer: 'executive_frame_v1', version: 1, thumbnailClass: 'executive_green', qrRegion: 'framed-top-right', landmarks: ['page-frame', 'executive-modules', 'metadata-band', 'contact-strip'] },
  clean_ledger: { renderer: 'accounting_ledger_v1', version: 1, thumbnailClass: 'clean_ledger', qrRegion: 'ledger-lower-left', landmarks: ['ledger-header', 'ledger-party-cells', 'dense-table', 'ledger-verification'] },
  contemporary_border: { renderer: 'contemporary_modular_v1', version: 1, thumbnailClass: 'contemporary_border', qrRegion: 'lower-verification-card', landmarks: ['modular-identity', 'party-modules', 'total-card', 'verification-card'] },
}

export function resolveA4Template(model: DocumentViewModel): A4TemplateResolution {
  const requested = model.template
  const candidate = requested.resolvedId as A4TemplateId
  const entry = registry[candidate] ?? registry.classic
  const fallback = requested.fallback || requested.resolvedId !== requested.requestedId || requested.resolvedVersion !== requested.requestedVersion
  return { requestedId: requested.requestedId, requestedVersion: requested.requestedVersion, resolvedId: registry[candidate] ? candidate : 'classic', resolvedVersion: entry.version, renderer: entry.renderer, fallback, fallbackReason: fallback ? requested.fallbackReason ?? 'unknown_historical_template' : null, headerStyle: requested.headerStyle ?? 'standard' }
}

export const A4_TEMPLATE_REGISTRY = registry
export const A4_TEMPLATE_IDS = Object.freeze(Object.keys(registry) as A4TemplateId[])
