import { useEffect, useRef, useState, type ReactNode } from 'react'

const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123
const CONTINUATION_PAGE_MARGINS = (20 / 25.4) * 96
const DEFAULT_FRAGMENTATION_SEAM = 50
const DENSE_TEMPLATE_FRAGMENTATION_SEAM = 12

export type A4PreviewZoom = 'fit' | 'page' | 'width' | 0.75 | 1 | 1.25

export default function A4PreviewFit({
  children,
  zoom = 'page',
  bounded = false,
  onPageCountChange,
}: {
  children: ReactNode
  zoom?: A4PreviewZoom
  bounded?: boolean
  onPageCountChange?: (count: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const [pageScale, setPageScale] = useState(1)
  const [widthScale, setWidthScale] = useState(1)
  const [documentHeight, setDocumentHeight] = useState(PAGE_HEIGHT)
  useEffect(() => {
    const viewport = viewportRef.current
    const renderedDocument = documentRef.current
    if (!viewport || !renderedDocument) return
    const measure = () => {
      const width = Math.max(1, viewport.clientWidth - 24)
      const height = Math.max(320, viewport.clientHeight || window.innerHeight - 280)
      const nextDocumentHeight = Math.max(PAGE_HEIGHT, renderedDocument.scrollHeight)
      // CSS millimetres land on fractional device pixels. Ignore the rounding
      // seam so an exact 297 mm sheet is not reported as a second page.
      const repeatedTableHeader = renderedDocument.querySelector('thead')?.getBoundingClientRect().height ?? 0
      const template = renderedDocument.querySelector<HTMLElement>('[data-template-resolved]')?.dataset.templateResolved ?? ''
      const fragmentationSeam = /^(modern_split|clean_ledger)@/.test(template)
        ? DENSE_TEMPLATE_FRAGMENTATION_SEAM
        : DEFAULT_FRAGMENTATION_SEAM
      const continuationOverhead = CONTINUATION_PAGE_MARGINS + repeatedTableHeader + fragmentationSeam
      let pageCount = Math.max(1, Math.ceil((nextDocumentHeight - 2) / PAGE_HEIGHT))
      let nextPageCount = pageCount
      do {
        pageCount = nextPageCount
        nextPageCount = Math.max(1, Math.ceil((nextDocumentHeight + ((pageCount - 1) * continuationOverhead) - 2) / PAGE_HEIGHT))
      } while (nextPageCount !== pageCount)
      setWidthScale(Math.min(1, width / PAGE_WIDTH))
      setPageScale(Math.min(1, width / PAGE_WIDTH, height / PAGE_HEIGHT))
      setDocumentHeight(nextDocumentHeight)
      onPageCountChange?.(pageCount)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(renderedDocument)
    return () => observer.disconnect()
  }, [onPageCountChange])
  const scale = zoom === 'page' || zoom === 'fit' ? pageScale : zoom === 'width' ? widthScale : zoom
  return (
    <div
      ref={viewportRef}
      data-a4-preview-viewport
      data-preview-zoom={zoom}
      className={`rounded-xl bg-gray-100 p-3 ${bounded ? 'h-[clamp(30rem,calc(100dvh-18rem),58rem)] min-h-0 overflow-auto' : 'flex min-h-[520px] items-center justify-center overflow-hidden'}`}
    >
      <div className={bounded ? 'mx-auto' : undefined} data-a4-preview-canvas style={{ width: PAGE_WIDTH * scale, height: Math.max(PAGE_HEIGHT, documentHeight) * scale }}>
        <div ref={documentRef} data-a4-preview-document style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
