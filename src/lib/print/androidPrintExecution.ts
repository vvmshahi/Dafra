export type PrintDocumentType = 'invoice' | 'simplified_invoice' | 'credit_note' | 'payment_receipt'
export type PrintFormat = 'thermal_receipt' | 'a4_invoice'
export type PrintSource = 'checkout_first_print' | 'invoice_reprint' | 'credit_note_reprint' | 'printer_test'
export type PrintStage = 'document_loaded' | 'document_validated' | 'render_started' | 'render_completed' | 'android_bridge_available' | 'printer_resolved' | 'print_dispatched' | 'printer_acknowledged' | 'completed'
export type PrintErrorCode = 'PRINT_DOCUMENT_LOAD_FAILED' | 'PRINT_DOCUMENT_NOT_READY' | 'PRINT_RENDER_FAILED' | 'PRINT_EMPTY_RENDER' | 'PRINT_ANDROID_BRIDGE_UNAVAILABLE' | 'PRINT_PRINTER_NOT_CONFIGURED' | 'PRINT_PRINTER_OFFLINE' | 'PRINT_DISPATCH_FAILED' | 'PRINT_ACK_TIMEOUT' | 'PRINT_NATIVE_ERROR'

export interface PrintFailure {
  readonly code: PrintErrorCode
  readonly stage: PrintStage
  readonly merchantMessage: string
}

export interface PrintExecutionResult {
  readonly success: boolean
  /** Browser print dialogs can confirm dispatch only; native integrations may
   * report a stronger acknowledgement through their renderer callback. */
  readonly acknowledgement: 'sent_to_printer' | 'printer_acknowledged' | null
  readonly failure: PrintFailure | null
}

export interface AndroidPrintRequest {
  readonly documentType: PrintDocumentType
  readonly printFormat: PrintFormat
  readonly source: PrintSource
  readonly documentId: string
  readonly documentNumber: string | null
  readonly root: HTMLElement
  readonly itemCount: number
  readonly templateId?: string | null
  readonly renderer: (validateRenderedOutput: () => void) => Promise<'sent_to_printer' | 'printer_acknowledged'>
}

const inFlight = new Map<string, Promise<PrintExecutionResult>>()

const merchantMessage = (code: PrintErrorCode): string => {
  if (code === 'PRINT_DOCUMENT_NOT_READY') return 'This document is not ready to print yet.'
  if (code === 'PRINT_EMPTY_RENDER') return 'The document could not be rendered for printing.'
  if (code === 'PRINT_ANDROID_BRIDGE_UNAVAILABLE') return 'Printer service is not available on this device.'
  if (code === 'PRINT_PRINTER_NOT_CONFIGURED') return 'No printer is configured on this device.'
  if (code === 'PRINT_PRINTER_OFFLINE') return 'The selected printer is not available.'
  return 'Unable to print. Your document has been saved safely.'
}

function errorCode(error: unknown): PrintErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('PRINT_EMPTY_RENDER')) return 'PRINT_EMPTY_RENDER'
  if (message.includes('PRINT_DOCUMENT_NOT_READY')) return 'PRINT_DOCUMENT_NOT_READY'
  if (message.includes('NO_PRINTER_CONFIGURED')) return 'PRINT_PRINTER_NOT_CONFIGURED'
  if (message.includes('PRINTER_OFFLINE') || message.includes('Selected printer was not found')) return 'PRINT_PRINTER_OFFLINE'
  if (message.includes('IPC_UNAVAILABLE') || message.includes('BRIDGE_UNAVAILABLE')) return 'PRINT_ANDROID_BRIDGE_UNAVAILABLE'
  if (message.includes('ACK_TIMEOUT')) return 'PRINT_ACK_TIMEOUT'
  if (message.includes('NATIVE')) return 'PRINT_NATIVE_ERROR'
  if (message.includes('RENDER')) return 'PRINT_RENDER_FAILED'
  return 'PRINT_DISPATCH_FAILED'
}

function diagnostic(request: AndroidPrintRequest, stage: PrintStage, code?: PrintErrorCode) {
  console.info('[print-diagnostics]', {
    timestamp: new Date().toISOString(),
    documentId: request.documentId,
    documentNumber: request.documentNumber,
    documentType: request.documentType,
    printFormat: request.printFormat,
    source: request.source,
    renderer: request.root.dataset.receiptLayout ?? request.templateId ?? null,
    templateId: request.templateId ?? null,
    bridge: 'browser_print_dialog',
    stage,
    code: code ?? null,
  })
}

/** Throws before dispatch when the mounted print document cannot plausibly
 * produce a fiscal document. This deliberately checks rendered content, not
 * mutable invoice/customer data. */
export function validateRenderedPrintOutput(request: Pick<AndroidPrintRequest, 'root' | 'documentNumber' | 'itemCount' | 'printFormat'>): void {
  const { root, documentNumber, itemCount, printFormat } = request
  const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim()
  const hasSeller = Boolean(root.querySelector('.thermal-header, .a4-seller'))
  const hasItems = itemCount === 0 || Boolean(root.querySelector('.thermal-items, .a4-items'))
  const hasTotal = /total|الإجمالي|credit total|إجمالي الإشعار/i.test(text)
  const rect = root.getBoundingClientRect()
  const width = Math.max(rect.width, root.scrollWidth)
  const height = Math.max(rect.height, root.scrollHeight)
  const numberPresent = Boolean(documentNumber && text.includes(documentNumber))
  if (!root.isConnected || text.length < 48 || !numberPresent || !hasSeller || !hasItems || !hasTotal || width <= 0 || height <= 0) {
    throw new Error('PRINT_EMPTY_RENDER')
  }
  if (printFormat === 'thermal_receipt' && !root.querySelector('.thermal-receipt')) throw new Error('PRINT_EMPTY_RENDER')
  if (printFormat === 'a4_invoice' && !root.querySelector('.a4-document')) throw new Error('PRINT_EMPTY_RENDER')
}

export function executeAndroidPrint(request: AndroidPrintRequest): Promise<PrintExecutionResult> {
  const key = `${request.documentId}:${request.printFormat}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const run = (async (): Promise<PrintExecutionResult> => {
    let stage: PrintStage = 'document_loaded'
    try {
      if (!request.root.isConnected) throw new Error('PRINT_DOCUMENT_NOT_READY')
      diagnostic(request, stage)
      stage = 'document_validated'
      diagnostic(request, stage)
      stage = 'render_started'
      diagnostic(request, stage)
      const acknowledgement = await request.renderer(() => validateRenderedPrintOutput(request))
      stage = 'render_completed'
      diagnostic(request, stage)
      stage = 'android_bridge_available'
      diagnostic(request, stage)
      stage = 'printer_resolved'
      diagnostic(request, stage)
      stage = 'print_dispatched'
      diagnostic(request, stage)
      stage = acknowledgement === 'printer_acknowledged' ? 'printer_acknowledged' : 'completed'
      diagnostic(request, stage)
      return { success: true, acknowledgement, failure: null }
    } catch (error) {
      const code = errorCode(error)
      diagnostic(request, stage, code)
      return { success: false, acknowledgement: null, failure: { code, stage, merchantMessage: merchantMessage(code) } }
    }
  })()
  inFlight.set(key, run)
  void run.finally(() => inFlight.delete(key))
  return run
}
