'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  printSilent: () =>
    ipcRenderer.invoke('print-silent'),

  getPrinters: () =>
    ipcRenderer.invoke('get-printers'),

  savePrinter: (printerName) =>
    ipcRenderer.invoke('save-printer', printerName),

  getDefaultPrinter: () =>
    ipcRenderer.invoke('get-default-printer'),

  clearPrinter: () =>
    ipcRenderer.invoke('clear-printer'),

  getPrinterSettings: () =>
    ipcRenderer.invoke('get-printer-settings'),

  savePrinterSettings: (settings) =>
    ipcRenderer.invoke('save-printer-settings', settings),

  clearPrinterSettings: () =>
    ipcRenderer.invoke('clear-printer-settings'),

  testPrint: (settings) =>
    ipcRenderer.invoke('test-print', settings),

  printReceipt: (request) =>
    ipcRenderer.invoke('print-receipt', request),

  receiptReady: (payload) =>
    ipcRenderer.send('receipt-print-ready', payload),

  receiptFailed: (payload) =>
    ipcRenderer.send('receipt-print-failed', payload),
})
