'use strict'

/**
 * Printer helpers — thin wrappers used by ipcMain handlers in main.js.
 * Kept here so main.js stays readable.
 */

/**
 * @param {Electron.WebContents} webContents
 * @param {string|null} printerName
 * @returns {Promise<{success: boolean, errorType: string|null}>}
 */
function printSilent(webContents, printerName) {
  return new Promise((resolve) => {
    webContents.print(
      {
        silent: !!printerName,
        deviceName: printerName || '',
        printBackground: true,
        margins: { marginType: 'printableArea' },
      },
      (success, errorType) => {
        resolve({ success, errorType: errorType || null })
      }
    )
  })
}

/**
 * @param {Electron.WebContents} webContents
 * @returns {Promise<Electron.PrinterInfo[]>}
 */
function getPrinters(webContents) {
  return webContents.getPrintersAsync()
}

module.exports = { printSilent, getPrinters }
