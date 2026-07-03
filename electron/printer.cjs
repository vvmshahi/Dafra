'use strict'

function printCurrentWindow(webContents, printerName) {
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
      },
    )
  })
}

function getPrinters(webContents) {
  return webContents.getPrintersAsync()
}

module.exports = { getPrinters, printCurrentWindow }
