import { createRoot } from 'react-dom/client'
import A4Document, { type A4RenderOptions } from './components/print/A4Document'
import ThermalReceipt, { type ThermalRenderOptions } from './components/print/ThermalReceipt'
import type { DocumentViewModel } from './documentViewModel'
import canonicalStylesheet from './canonical-document.css?raw'

export interface BrowserDocumentInput {
  readonly model: DocumentViewModel
  readonly format: 'a4' | 'thermal'
  readonly qrImageUrl?: string | null
  readonly headerArtworkUrl?: string | null
  readonly footerArtworkUrl?: string | null
}

/** Browser/WebView host for the same React compositions used by Web/Electron. */
export function renderDocumentInto(target: HTMLElement, input: BrowserDocumentInput): void {
  const styleId = 'kubri-canonical-document-css'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = canonicalStylesheet
    document.head.append(style)
  }
  const content = input.format === 'a4'
    ? <A4Document model={input.model} options={{ preview: true, qrImageUrl: input.qrImageUrl ?? null, headerArtworkUrl: input.headerArtworkUrl, footerArtworkUrl: input.footerArtworkUrl } satisfies A4RenderOptions} />
    : <ThermalReceipt model={input.model} options={{ preview: true, qrImageUrl: input.qrImageUrl ?? null } satisfies ThermalRenderOptions} />
  createRoot(target).render(content)
}

declare global { interface Window { KubriCanonicalDocumentRenderer?: { renderDocumentInto: typeof renderDocumentInto; version: string } } }

window.KubriCanonicalDocumentRenderer = { renderDocumentInto, version: '1.0.0' }
