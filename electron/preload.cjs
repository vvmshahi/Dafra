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

  testPrintA4: (settings) =>
    ipcRenderer.invoke('test-print-a4', settings),

  printReceipt: (request) =>
    ipcRenderer.invoke('print-receipt', request),

  printA4Invoice: () =>
    ipcRenderer.invoke('print-a4-invoice'),

  receiptReady: (payload) =>
    ipcRenderer.send('receipt-print-ready', payload),

  receiptFailed: (payload) =>
    ipcRenderer.send('receipt-print-failed', payload),
})
