import { useEffect, useMemo, useRef } from 'react'
import {
  isEditableScannerTarget,
  KeyboardWedgeCapture,
  OrderedScanQueue,
  type ScannerCapture,
} from '@/lib/barcodes/scanner'

export function useBarcodeScanner({
  enabled,
  blocked,
  onScan,
}: {
  enabled: boolean
  blocked: boolean
  onScan: (capture: ScannerCapture) => Promise<void>
}) {
  const callback = useRef(onScan)
  const queue = useMemo(() => new OrderedScanQueue(), [])
  callback.current = onScan

  useEffect(() => {
    if (!enabled || blocked) return
    const capture = new KeyboardWedgeCapture(scan => {
      queue.enqueue(() => callback.current(scan))
    })
    const listener = (event: KeyboardEvent) => {
      if (isEditableScannerTarget(event.target)) {
        capture.reset()
        return
      }
      if (capture.handle(event) && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => {
      capture.reset()
      window.removeEventListener('keydown', listener, true)
    }
  }, [blocked, enabled, queue])
}
