import { isElectron, printCurrentReceipt, type PrintResult } from '@/lib/electron'
import { printCurrentDocument, waitForPrintableAssets } from '@/lib/print/browserPrint'
import { executeAndroidPrint, type PrintDocumentType } from '@/lib/print/androidPrintExecution'

export interface AtomicReceiptPrintRequest {
  invoiceId: string
  documentNumber: string | null
  itemCount: number
  documentType: PrintDocumentType
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
    #${targetId} { display: block !important; visibility: visible !important; }
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
  documentNumber,
  itemCount,
  documentType,
  receiptElementId,
  source,
}: AtomicReceiptPrintRequest): Promise<PrintResult> {
  console.info('[zatca-timing]', {
    event: 'print_requested',
    invoiceId,
    source,
  })
  const receiptRoot = document.getElementById(receiptElementId)
  if (!receiptRoot) return { success: false, errorType: 'PRINT_DOCUMENT_NOT_READY', message: 'Receipt document is not ready.' }
  const removeStyle = installAtomicReceiptPrintStyle(receiptElementId)
  try {
    const execution = await executeAndroidPrint({
      documentType,
      printFormat: 'thermal_receipt',
      source: documentType === 'credit_note' ? 'credit_note_reprint' : 'checkout_first_print',
      documentId: invoiceId,
      documentNumber,
      root: receiptRoot,
      itemCount,
      renderer: async validate => {
        await waitForPrintableAssets(receiptRoot, 7000, { allowConnectedOffscreenRoot: true })
        validate()
        if (!isElectron()) {
          await printCurrentDocument()
          return 'sent_to_printer'
        }
        const result = await printCurrentReceipt()
        if (!result.success) throw new Error(result.errorType ?? 'PRINT_NATIVE_ERROR')
        return 'printer_acknowledged'
      },
    })
    const result: PrintResult = execution.success
      ? { success: true }
      : { success: false, errorType: execution.failure?.code, message: execution.failure?.merchantMessage }
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
