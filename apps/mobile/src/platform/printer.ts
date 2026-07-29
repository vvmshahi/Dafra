export interface ReceiptPrintJob {
  invoiceNumber: string
  html: string
  paperWidth: '58mm' | '80mm'
}

export interface PrinterAdapter {
  readonly kind: 'system' | 'bluetooth-escpos' | 'network'
  printReceipt(job: ReceiptPrintJob): Promise<void>
  discoverPrinters(): Promise<readonly string[]>
  connect(id: string): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<'ready' | 'unavailable' | 'disconnected'>
}

export class SystemPrintAdapter implements PrinterAdapter {
  readonly kind = 'system' as const
  async printReceipt(_job: ReceiptPrintJob) {
    window.print()
  }
  async discoverPrinters() { return [] }
  async connect() { /* System print requires no direct connection. */ }
  async disconnect() { /* System print requires no direct connection. */ }
  async getStatus() { return 'ready' as const }
}

export class UnsupportedPrinterAdapter implements PrinterAdapter {
  constructor(readonly kind: 'bluetooth-escpos' | 'network') {}
  async printReceipt() { throw new Error(`${this.kind} requires physical-device validation`) }
  async discoverPrinters() { return [] }
  async connect() { throw new Error(`${this.kind} is not implemented in this proof of concept`) }
  async disconnect() {}
  async getStatus() { return 'unavailable' as const }
}
