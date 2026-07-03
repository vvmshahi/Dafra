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
})
