'use strict'

function normalizeCopies(copies) {
  const value = Number(copies)
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(3, Math.floor(value)))
}

function printCurrentWindow(webContents, printerName, options = {}) {
  const hasPrinter = typeof printerName === 'string' && printerName.trim().length > 0
  const printOptions = {
    silent: options.silent ?? hasPrinter,
    deviceName: hasPrinter ? printerName.trim() : '',
    printBackground: true,
    margins: options.margins ?? { marginType: 'printableArea' },
    copies: normalizeCopies(options.copies),
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
  return webContents.getPrintersAsync()
}

module.exports = { getPrinters, printCurrentWindow }
