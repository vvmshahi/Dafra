'use strict'

function normalizeCopies(copies, maximum = 10) {
  const value = Number(copies)
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(maximum, Math.floor(value)))
}

function printCurrentWindow(webContents, printerName, options = {}) {
  const hasPrinter = typeof printerName === 'string' && printerName.trim().length > 0
  const printOptions = {
    silent: options.silent ?? hasPrinter,
    deviceName: hasPrinter ? printerName.trim() : '',
    printBackground: true,
    margins: options.margins ?? { marginType: 'printableArea' },
    copies: normalizeCopies(options.copies, options.maxCopies ?? 10),
  }

  if (options.pageSize) printOptions.pageSize = options.pageSize
  if (Number.isFinite(Number(options.scaleFactor))) printOptions.scaleFactor = Number(options.scaleFactor)
  if (typeof options.landscape === 'boolean') printOptions.landscape = options.landscape

  return new Promise((resolve) => {
    webContents.print(
      printOptions,
      (success, errorType) => {
        resolve({ success, errorType: errorType || null })
      },
    )
  })
}

function getPrinters(webContents) {
  return webContents.getPrintersAsync().then((printers) => (Array.isArray(printers) ? printers : []).map((printer) => ({
    name: typeof printer?.name === 'string' ? printer.name.slice(0, 512) : '',
    displayName: typeof printer?.displayName === 'string' ? printer.displayName.slice(0, 512) : undefined,
    description: typeof printer?.description === 'string' ? printer.description.slice(0, 512) : undefined,
    status: Number.isFinite(Number(printer?.status)) ? Number(printer.status) : undefined,
    isDefault: printer?.isDefault === true,
  })).filter(printer => printer.name))
}

module.exports = { getPrinters, printCurrentWindow }
