import { renderToStaticMarkup } from 'react-dom/server'
import A4Document, { type A4RenderOptions } from './components/print/A4Document'
import ThermalReceipt, { type ThermalRenderOptions } from './components/print/ThermalReceipt'
import type { DocumentViewModel } from './documentViewModel'
import canonicalStylesheet from './canonical-document.css?raw'

export const CANONICAL_DOCUMENT_RENDERER_VERSION = '1.0.0'

export interface CanonicalDocumentHtmlInput {
  readonly model: DocumentViewModel
  readonly documentType: 'a4' | 'thermal'
  readonly qrImageUrl?: string | null
  readonly headerArtworkUrl?: string | null
  readonly footerArtworkUrl?: string | null
}

/**
 * The only static paper entry point. It deliberately receives an immutable
 * issued-document model and has no data access or financial calculation path.
 */
export function renderDocumentHtml(input: CanonicalDocumentHtmlInput): string {
  const body = input.documentType === 'a4'
    ? renderToStaticMarkup(<A4Document model={input.model} options={{ preview: true, qrImageUrl: input.qrImageUrl ?? null, headerArtworkUrl: input.headerArtworkUrl, footerArtworkUrl: input.footerArtworkUrl } satisfies A4RenderOptions} />)
    : renderToStaticMarkup(<ThermalReceipt model={input.model} options={{ preview: true, qrImageUrl: input.qrImageUrl ?? null } satisfies ThermalRenderOptions} />)
  return `<!doctype html><html lang="${input.model.identity.language === 'ar' ? 'ar' : 'en'}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>${canonicalStylesheet}</style></head><body>${body}</body></html>`
}
