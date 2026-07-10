'use strict'

const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron')
const { randomUUID } = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { getPrinters, printCurrentWindow } = require('./printer.cjs')

const APP_PROTOCOL = 'kubri'
const APP_HOST = 'app'
const DEV_SERVER_URL = process.env.KUBRI_DESKTOP_DEV_SERVER_URL || 'http://127.0.0.1:5175'
const isPreview = process.argv.includes('--preview')
const isDev = !app.isPackaged && !isPreview

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

let mainWindow = null

function distPath() {
  return path.join(__dirname, '..', 'dist')
}

function appIndexPath() {
  return path.join(distPath(), 'index.html')
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function registerAppProtocol() {
  protocol.handle(APP_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const root = distPath()
    const index = appIndexPath()
    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const candidate = path.join(root, requestPath.replace(/^\/+/, ''))

    if (isInside(root, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return net.fetch(pathToFileURL(candidate).toString())
    }

    return net.fetch(pathToFileURL(index).toString())
  })
}

function safeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function internalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)

    if (url.protocol === `${APP_PROTOCOL}:` && url.hostname === APP_HOST) {
      return true
    }

    if (isDev) {
      return url.origin === new URL(DEV_SERVER_URL).origin
    }

    return false
  } catch {
    return false
  }
}

function openExternal(rawUrl) {
  if (safeExternalUrl(rawUrl)) {
    shell.openExternal(rawUrl)
  }
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  }
}

function iconPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'assets', 'icon.ico')
  }
  return path.join(__dirname, 'assets', 'icon.png')
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}

const DEFAULT_PRINTER_SETTINGS = {
  selectedPrinterName: null,
  paperWidth: 80,
  autoPrintAfterSale: false,
  copies: 1,
  fallbackToPreview: true,
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeCopies(value) {
  const copies = Number(value)
  if (!Number.isFinite(copies)) return 1
  return Math.max(1, Math.min(3, Math.floor(copies)))
}

function normalizePrinterSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const hasSelectedPrinter = Object.prototype.hasOwnProperty.call(source, 'selectedPrinterName')
  const selectedValue = hasSelectedPrinter ? source.selectedPrinterName : source.defaultPrinter
  const selectedPrinterName = typeof selectedValue === 'string' && selectedValue.trim()
    ? selectedValue.trim().slice(0, 512)
    : null
  const paperWidth = Number(source.paperWidth) === 58 ? 58 : 80
  const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt.trim()
    ? source.updatedAt
    : undefined

  return {
    selectedPrinterName,
    paperWidth,
    autoPrintAfterSale: typeof source.autoPrintAfterSale === 'boolean'
      ? source.autoPrintAfterSale
      : DEFAULT_PRINTER_SETTINGS.autoPrintAfterSale,
    copies: normalizeCopies(source.copies ?? DEFAULT_PRINTER_SETTINGS.copies),
    fallbackToPreview: typeof source.fallbackToPreview === 'boolean'
      ? source.fallbackToPreview
      : DEFAULT_PRINTER_SETTINGS.fallbackToPreview,
    ...(updatedAt ? { updatedAt } : {}),
  }
}

function readPrinterSettings() {
  return normalizePrinterSettings(readSettings())
}

function validatePrinterSettingsInput(input, currentSettings = readPrinterSettings()) {
  if (input == null) return currentSettings
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid printer settings')
  }

  const allowedKeys = new Set([
    'selectedPrinterName',
    'paperWidth',
    'autoPrintAfterSale',
    'copies',
    'fallbackToPreview',
    'updatedAt',
  ])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new Error('Unsupported printer setting')
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'selectedPrinterName')
    && input.selectedPrinterName !== null
    && (typeof input.selectedPrinterName !== 'string' || !input.selectedPrinterName.trim() || input.selectedPrinterName.length > 512)
  ) {
    throw new Error('Invalid printer name')
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'paperWidth')
    && Number(input.paperWidth) !== 58
    && Number(input.paperWidth) !== 80
  ) {
    throw new Error('Paper width must be 58 or 80')
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'copies')
    && (!Number.isFinite(Number(input.copies)) || Number(input.copies) < 1 || Number(input.copies) > 3)
  ) {
    throw new Error('Copies must be between 1 and 3')
  }
  for (const key of ['autoPrintAfterSale', 'fallbackToPreview']) {
    if (Object.prototype.hasOwnProperty.call(input, key) && typeof input[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean`)
    }
  }

  return normalizePrinterSettings({
    ...currentSettings,
    ...input,
  })
}

function writePrinterSettings(settings) {
  const normalized = normalizePrinterSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  })
  const existing = readSettings()
  const next = {
    ...existing,
    ...normalized,
    defaultPrinter: normalized.selectedPrinterName || undefined,
  }

  if (!normalized.selectedPrinterName) {
    delete next.defaultPrinter
  }

  writeSettings(next)
  return normalized
}

function getDefaultPrinterName() {
  return readPrinterSettings().selectedPrinterName
}

function saveDefaultPrinterName(printerName) {
  if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > 512) {
    throw new Error('Invalid printer name')
  }

  writePrinterSettings({
    ...readPrinterSettings(),
    selectedPrinterName: printerName,
  })
}

function clearDefaultPrinterName() {
  writePrinterSettings({
    ...readPrinterSettings(),
    selectedPrinterName: null,
  })
}

function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (internalUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'Kubri',
          backgroundColor: '#0F2419',
          webPreferences: webPreferences(),
        },
      }
    }

    openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (internalUrl(url)) return

    event.preventDefault()
    openExternal(url)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Kubri',
    icon: iconPath(),
    webPreferences: webPreferences(),
    show: false,
    backgroundColor: '#0F2419',
  })

  configureWindowNavigation(mainWindow)

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadURL(`${APP_PROTOCOL}://${APP_HOST}/`)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.maximize()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  Menu.setApplicationMenu(null)
}

function appRouteUrl(route) {
  if (!route.startsWith('/')) {
    throw new Error('Invalid app route')
  }

  if (isDev) {
    return new URL(route, DEV_SERVER_URL).toString()
  }

  return `${APP_PROTOCOL}://${APP_HOST}${route}`
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? 'Unknown print error')
}

async function selectedPrinterAvailable(webContents, printerName) {
  if (!printerName) return false

  try {
    const printers = await getPrinters(webContents)
    if (!Array.isArray(printers) || printers.length === 0) return true
    return printers.some((printer) => printer?.name === printerName)
  } catch {
    return true
  }
}

async function assertSelectedPrinterAvailable(webContents, printerName) {
  const available = await selectedPrinterAvailable(webContents, printerName)
  if (!available) {
    throw new Error('Selected printer was not found on this device')
  }
}

function waitForReceiptReady(printWindow, jobId, invoiceId) {
  return new Promise((resolve, reject) => {
    let done = false

    const cleanup = () => {
      ipcMain.off('receipt-print-ready', readyHandler)
      ipcMain.off('receipt-print-failed', failedHandler)
      printWindow.off('closed', closedHandler)
      clearTimeout(timeout)
    }

    const finish = (callback) => {
      if (done) return
      done = true
      cleanup()
      callback()
    }

    const readyHandler = (event, payload = {}) => {
      if (event.sender !== printWindow.webContents) return
      if (payload.jobId !== jobId || payload.invoiceId !== invoiceId) return
      finish(resolve)
    }

    const failedHandler = (event, payload = {}) => {
      if (event.sender !== printWindow.webContents) return
      if (payload.jobId !== jobId || payload.invoiceId !== invoiceId) return
      finish(() => reject(new Error(payload.error || 'Receipt failed to load')))
    }

    const closedHandler = () => {
      finish(() => reject(new Error('Receipt print window closed before it was ready')))
    }

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('Receipt print page did not become ready')))
    }, 30000)

    ipcMain.on('receipt-print-ready', readyHandler)
    ipcMain.on('receipt-print-failed', failedHandler)
    printWindow.on('closed', closedHandler)
  })
}

function createHiddenPrintWindow(width = 420, height = 800, options = {}) {
  const printWindow = new BrowserWindow({
    width,
    height,
    show: false,
    title: 'Kubri Receipt Print',
    backgroundColor: '#ffffff',
    webPreferences: webPreferences(),
  })

  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  printWindow.webContents.on('will-navigate', (event, url) => {
    if (internalUrl(url)) return
    if (options.allowDataUrl && url.startsWith('data:text/html')) return
    event.preventDefault()
  })
  return printWindow
}

async function printReceiptByInvoice(sender, request = {}) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('Invalid receipt print request')
    }

    const invoiceId = typeof request.invoiceId === 'string' ? request.invoiceId.trim() : ''
    if (!UUID_PATTERN.test(invoiceId)) {
      throw new Error('Invalid invoice id')
    }

    const settings = validatePrinterSettingsInput(request.options ?? null, readPrinterSettings())
    if (!settings.selectedPrinterName) {
      return {
        success: false,
        errorType: 'NO_PRINTER_CONFIGURED',
        message: 'No receipt printer is configured on this device.',
        settings,
      }
    }

    await assertSelectedPrinterAvailable(sender, settings.selectedPrinterName)

    const jobId = randomUUID()
    const printWindow = createHiddenPrintWindow(settings.paperWidth === 58 ? 320 : 420, 900)
    const ready = waitForReceiptReady(printWindow, jobId, invoiceId)
    const route = `/print/receipt/${invoiceId}?electronPrint=1&printJobId=${encodeURIComponent(jobId)}&paperWidth=${settings.paperWidth}`

    try {
      await Promise.all([
        printWindow.loadURL(appRouteUrl(route)),
        ready,
      ])
      const result = await printCurrentWindow(printWindow.webContents, settings.selectedPrinterName, {
        silent: true,
        copies: settings.copies,
      })

      return {
        ...result,
        settings,
        message: result.success ? null : (result.errorType || 'Receipt print failed.'),
      }
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.close()
      }
    }
  } catch (error) {
    return {
      success: false,
      errorType: 'DIRECT_PRINT_FAILED',
      message: safeErrorMessage(error),
      settings: readPrinterSettings(),
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function testPrintHtml(settings) {
  const now = new Date().toLocaleString()

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Kubri Test Print</title>
    <style>
      @page { size: ${settings.paperWidth}mm auto; margin: 0 3mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt {
        width: ${settings.paperWidth === 58 ? '52mm' : '72mm'};
        margin: 0 auto;
        padding: 8px 0 10px;
        font-size: ${settings.paperWidth === 58 ? '10px' : '11px'};
        line-height: 1.35;
      }
      .center { text-align: center; }
      .brand { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
      .rule { border-top: 1px dashed #000; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      .muted { color: #333; }
      .ok { font-weight: 800; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main class="receipt">
      <div class="center brand">Kubri</div>
      <div class="center">Printer Test Receipt</div>
      <div class="rule"></div>
      <div class="row"><span>Printer</span><strong>${escapeHtml(settings.selectedPrinterName)}</strong></div>
      <div class="row"><span>Paper</span><strong>${settings.paperWidth}mm</strong></div>
      <div class="row"><span>Copies</span><strong>${settings.copies}</strong></div>
      <div class="rule"></div>
      <div class="muted">${escapeHtml(now)}</div>
      <div class="center ok">Test print complete</div>
    </main>
  </body>
</html>`
}

async function runTestPrint(sender, inputSettings = null) {
  try {
    const settings = validatePrinterSettingsInput(inputSettings, readPrinterSettings())
    if (!settings.selectedPrinterName) {
      return {
        success: false,
        errorType: 'NO_PRINTER_CONFIGURED',
        message: 'No receipt printer is configured on this device.',
        settings,
      }
    }

    await assertSelectedPrinterAvailable(sender, settings.selectedPrinterName)

    const printWindow = createHiddenPrintWindow(settings.paperWidth === 58 ? 320 : 420, 700, {
      allowDataUrl: true,
    })
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testPrintHtml(settings))}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      const result = await printCurrentWindow(printWindow.webContents, settings.selectedPrinterName, {
        silent: true,
        copies: settings.copies,
      })

      return {
        ...result,
        settings,
        message: result.success ? null : (result.errorType || 'Test print failed.'),
      }
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.close()
      }
    }
  } catch (error) {
    return {
      success: false,
      errorType: 'TEST_PRINT_FAILED',
      message: safeErrorMessage(error),
      settings: readPrinterSettings(),
    }
  }
}

function registerPrinterIpc() {
  ipcMain.handle('print-silent', async (event) => {
    const printerName = getDefaultPrinterName()
    return printCurrentWindow(event.sender, printerName, {
      copies: readPrinterSettings().copies,
    })
  })

  ipcMain.handle('get-printers', async (event) => {
    return getPrinters(event.sender)
  })

  ipcMain.handle('save-printer', async (_event, printerName) => {
    saveDefaultPrinterName(printerName)
    return { success: true }
  })

  ipcMain.handle('get-default-printer', async () => {
    return getDefaultPrinterName()
  })

  ipcMain.handle('clear-printer', async () => {
    clearDefaultPrinterName()
    return { success: true }
  })

  ipcMain.handle('get-printer-settings', async () => {
    return readPrinterSettings()
  })

  ipcMain.handle('save-printer-settings', async (event, settings) => {
    const next = validatePrinterSettingsInput(settings, readPrinterSettings())
    if (next.selectedPrinterName) {
      await assertSelectedPrinterAvailable(event.sender, next.selectedPrinterName)
    }
    return {
      success: true,
      settings: writePrinterSettings(next),
    }
  })

  ipcMain.handle('clear-printer-settings', async () => {
    return {
      success: true,
      settings: writePrinterSettings(DEFAULT_PRINTER_SETTINGS),
    }
  })

  ipcMain.handle('test-print', async (event, settings) => {
    return runTestPrint(event.sender, settings)
  })

  ipcMain.handle('print-receipt', async (event, request) => {
    return printReceiptByInvoice(event.sender, request)
  })
}

app.whenReady().then(() => {
  if (!isDev) {
    registerAppProtocol()
  }

  registerPrinterIpc()
  createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
