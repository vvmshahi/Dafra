import { useEffect, useRef, useState, type ReactNode } from 'react'

const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123

export type A4PreviewZoom = 'fit' | 'page' | 'width' | 0.75 | 1 | 1.25

export default function A4PreviewFit({
  children,
  zoom = 'page',
  bounded = false,
}: {
  children: ReactNode
  zoom?: A4PreviewZoom
  bounded?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pageScale, setPageScale] = useState(1)
  const [widthScale, setWidthScale] = useState(1)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const width = Math.max(1, viewport.clientWidth - 24)
      const height = Math.max(1, viewport.clientHeight - 24)
      setWidthScale(Math.min(1, width / PAGE_WIDTH))
      setPageScale(Math.min(1, width / PAGE_WIDTH, height / PAGE_HEIGHT))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const scale = zoom === 'page' || zoom === 'fit' ? pageScale : zoom === 'width' ? widthScale : zoom
  return (
    <div
      ref={viewportRef}
      data-a4-preview-viewport
      data-preview-zoom={zoom}
      className={`rounded-xl bg-gray-100 p-3 ${bounded ? 'h-[clamp(30rem,calc(100dvh-14.5rem),58rem)] min-h-[30rem] overflow-auto' : 'flex min-h-[520px] items-center justify-center overflow-hidden'}`}
    >
      <div className={bounded ? 'mx-auto' : undefined} style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
        <div style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
