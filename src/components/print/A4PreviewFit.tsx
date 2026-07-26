import { useEffect, useRef, useState, type ReactNode } from 'react'

const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123

export default function A4PreviewFit({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const width = Math.max(1, viewport.clientWidth - 24)
      const height = Math.max(1, viewport.clientHeight - 24)
      setScale(Math.min(1, width / PAGE_WIDTH, height / PAGE_HEIGHT))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  return <div ref={viewportRef} className="flex min-h-[520px] items-center justify-center overflow-hidden rounded-xl bg-gray-100 p-3"><div style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}><div style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div></div></div>
}
