import { printCurrentReceipt, type PrintResult } from '@/lib/electron'

export interface AtomicReceiptPrintRequest {
  invoiceId: string
  receiptElementId: string
  source: 'atomic_checkout_snapshot' | 'atomic_credit_note_snapshot'
}

function safeElementId(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Invalid atomic receipt print target')
  }
  return value
}

function installAtomicReceiptPrintStyle(receiptElementId: string): () => void {
  const targetId = safeElementId(receiptElementId)
  const styleId = 'atomic-receipt-snapshot-print-style'
  document.getElementById(styleId)?.remove()

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    @media print {
      @page { size: 80mm auto; margin: 0; }
      html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body * { visibility: hidden !important; }
      #${targetId}, #${targetId} * { visibility: visible !important; }
      #${targetId} {
        display: block !important;
        position: absolute !important;
        inset: 0 auto auto 0 !important;
        margin: 0 !important;
        background: white !important;
      }
    }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

export async function printAtomicReceiptSnapshot({
  invoiceId,
  receiptElementId,
  source,
}: AtomicReceiptPrintRequest): Promise<PrintResult> {
  console.info('[zatca-timing]', {
    event: 'print_requested',
    invoiceId,
    source,
  })
  const removeStyle = installAtomicReceiptPrintStyle(receiptElementId)
  try {
    const result = await printCurrentReceipt()
    if (result.success) {
      console.info('[zatca-timing]', {
        event: 'printer_started',
        invoiceId,
        source,
      })
    }
    return result
  } finally {
    removeStyle()
  }
}
