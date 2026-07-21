import type { A4HeaderStyle, A4TemplateId } from '@/types/database'
import type { DocumentViewModel } from './documentViewModel'

export type A4TemplateRendererId = 'classic_v1' | 'modern_split_v1' | 'minimal_professional_v1'

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

const registry: Record<A4TemplateId, { readonly renderer: A4TemplateRendererId; readonly version: 1 }> = {
  classic: { renderer: 'classic_v1', version: 1 },
  modern_split: { renderer: 'modern_split_v1', version: 1 },
  minimal_professional: { renderer: 'minimal_professional_v1', version: 1 },
}

export function resolveA4Template(model: DocumentViewModel): A4TemplateResolution {
  const requested = model.template
  const candidate = requested.resolvedId as A4TemplateId
  const entry = registry[candidate] ?? registry.classic
  const fallback = requested.fallback || requested.resolvedId !== requested.requestedId || requested.resolvedVersion !== requested.requestedVersion
  return { requestedId: requested.requestedId, requestedVersion: requested.requestedVersion, resolvedId: registry[candidate] ? candidate : 'classic', resolvedVersion: entry.version, renderer: entry.renderer, fallback, fallbackReason: fallback ? requested.fallbackReason ?? 'unknown_historical_template' : null, headerStyle: requested.headerStyle ?? 'standard' }
}

export const A4_TEMPLATE_REGISTRY = registry
