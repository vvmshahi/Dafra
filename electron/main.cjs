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

const RECEIPT_PRESETS = {
  '80mm': { paperWidthMm: 80, printableWidthMm: 72 },
  '58mm': { paperWidthMm: 58, printableWidthMm: 48 },
}

const DEFAULT_PRINTER_SETTINGS = {
  receiptPrinterName: null,
  receiptPaperPreset: '80mm',
  receiptPaperWidthMm: 80,
  receiptPrintableWidthMm: 72,
  receiptScalePercent: 100,
  receiptMarginLeftMm: 2,
  receiptMarginRightMm: 2,
  receiptMarginTopMm: 0,
  receiptMarginBottomMm: 0,
  receiptHorizontalOffsetMm: 0,
  receiptVerticalOffsetMm: 0,
  receiptFontSize: 'normal',
  receiptDensity: 'normal',
  receiptCopies: 1,
  autoPrintReceiptAfterSale: false,
  fallbackToPreview: true,
  a4PrinterName: null,
  a4Copies: 1,
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeCopies(value) {
  const copies = Number(value)
  if (!Number.isFinite(copies)) return 1
  return Math.max(1, Math.min(3, Math.floor(copies)))
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function normalizePrinterName(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 512)
    : null
}

function normalizeReceiptPreset(value, fallback = '80mm') {
  return value === '58mm' || value === '80mm' || value === 'custom' ? value : fallback
}

function normalizeFontSize(value) {
  return value === 'small' || value === 'large' ? value : 'normal'
}

function normalizeDensity(value) {
  return value === 'compact' || value === 'spacious' ? value : 'normal'
}

function settingsWithLegacyAliases(settings) {
  return {
    ...settings,
    selectedPrinterName: settings.receiptPrinterName,
    paperWidth: settings.receiptPaperWidthMm === 58 ? 58 : 80,
    autoPrintAfterSale: settings.autoPrintReceiptAfterSale,
    copies: settings.receiptCopies,
  }
}

function normalizePrinterSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const receiptPrinterName = normalizePrinterName(
    source.receiptPrinterName ?? source.selectedPrinterName ?? source.defaultPrinter,
  )
  const a4PrinterName = normalizePrinterName(source.a4PrinterName)
  const legacyPaperWidth = Number(source.paperWidth) === 58 ? 58 : 80
  const derivedPreset = Number(source.receiptPaperWidthMm ?? legacyPaperWidth) === 58 ? '58mm' : '80mm'
  const receiptPaperPreset = normalizeReceiptPreset(source.receiptPaperPreset, derivedPreset)
  const presetDefaults = RECEIPT_PRESETS[receiptPaperPreset] ?? RECEIPT_PRESETS['80mm']
  const paperFallback = receiptPaperPreset === 'custom'
    ? Number(source.receiptPaperWidthMm ?? legacyPaperWidth)
    : presetDefaults.paperWidthMm
  const receiptPaperWidthMm = receiptPaperPreset === 'custom'
    ? clampNumber(paperFallback, 80, 40, 120)
    : presetDefaults.paperWidthMm
  const printableFallback = source.receiptPrintableWidthMm ?? presetDefaults.printableWidthMm
  const maxPrintable = Math.max(30, receiptPaperWidthMm - 1)
  const receiptPrintableWidthMm = Math.min(
    clampNumber(printableFallback, presetDefaults.printableWidthMm, 30, maxPrintable),
    receiptPaperWidthMm - 1,
  )
  const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt.trim()
    ? source.updatedAt
    : undefined

  return settingsWithLegacyAliases({
    receiptPrinterName,
    receiptPaperPreset,
    receiptPaperWidthMm,
    receiptPrintableWidthMm,
    receiptScalePercent: Math.round(clampNumber(source.receiptScalePercent, 100, 70, 110)),
    receiptMarginLeftMm: clampNumber(source.receiptMarginLeftMm, DEFAULT_PRINTER_SETTINGS.receiptMarginLeftMm, 0, 10),
    receiptMarginRightMm: clampNumber(source.receiptMarginRightMm, DEFAULT_PRINTER_SETTINGS.receiptMarginRightMm, 0, 10),
    receiptMarginTopMm: clampNumber(source.receiptMarginTopMm, DEFAULT_PRINTER_SETTINGS.receiptMarginTopMm, 0, 10),
    receiptMarginBottomMm: clampNumber(source.receiptMarginBottomMm, DEFAULT_PRINTER_SETTINGS.receiptMarginBottomMm, 0, 10),
    receiptHorizontalOffsetMm: clampNumber(source.receiptHorizontalOffsetMm, 0, -10, 10),
    receiptVerticalOffsetMm: clampNumber(source.receiptVerticalOffsetMm, 0, -10, 10),
    receiptFontSize: normalizeFontSize(source.receiptFontSize),
    receiptDensity: normalizeDensity(source.receiptDensity),
    receiptCopies: normalizeCopies(source.receiptCopies ?? source.copies ?? DEFAULT_PRINTER_SETTINGS.receiptCopies),
    autoPrintReceiptAfterSale: typeof source.autoPrintReceiptAfterSale === 'boolean'
      ? source.autoPrintReceiptAfterSale
      : typeof source.autoPrintAfterSale === 'boolean'
        ? source.autoPrintAfterSale
        : DEFAULT_PRINTER_SETTINGS.autoPrintReceiptAfterSale,
    fallbackToPreview: typeof source.fallbackToPreview === 'boolean'
      ? source.fallbackToPreview
      : DEFAULT_PRINTER_SETTINGS.fallbackToPreview,
    a4PrinterName,
    a4Copies: normalizeCopies(source.a4Copies ?? DEFAULT_PRINTER_SETTINGS.a4Copies),
    ...(updatedAt ? { updatedAt } : {}),
  })
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
    'receiptPrinterName',
    'receiptPaperPreset',
    'receiptPaperWidthMm',
    'receiptPrintableWidthMm',
    'receiptScalePercent',
    'receiptMarginLeftMm',
    'receiptMarginRightMm',
    'receiptMarginTopMm',
    'receiptMarginBottomMm',
    'receiptHorizontalOffsetMm',
    'receiptVerticalOffsetMm',
    'receiptFontSize',
    'receiptDensity',
    'receiptCopies',
    'autoPrintReceiptAfterSale',
    'a4PrinterName',
    'a4Copies',
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

  for (const key of ['receiptPrinterName', 'selectedPrinterName', 'a4PrinterName']) {
    if (
      Object.prototype.hasOwnProperty.call(input, key)
      && input[key] !== null
      && (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 512)
    ) {
      throw new Error('Invalid printer name')
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'receiptPaperPreset') && !['80mm', '58mm', 'custom'].includes(input.receiptPaperPreset)) {
    throw new Error('Paper preset must be 80 mm, 58 mm, or custom')
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'paperWidth')
    && Number(input.paperWidth) !== 58
    && Number(input.paperWidth) !== 80
  ) {
    throw new Error('Paper width must be 58 or 80')
  }
  for (const key of ['receiptPaperWidthMm', 'receiptPrintableWidthMm']) {
    if (Object.prototype.hasOwnProperty.call(input, key) && (!Number.isFinite(Number(input[key])) || Number(input[key]) <= 0)) {
      throw new Error('Receipt width must be a positive number')
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'receiptPrintableWidthMm')
    && Object.prototype.hasOwnProperty.call(input, 'receiptPaperWidthMm')
    && Number(input.receiptPrintableWidthMm) >= Number(input.receiptPaperWidthMm)
  ) {
    throw new Error('Printable width must be smaller than the paper width')
  }
  if (Object.prototype.hasOwnProperty.call(input, 'receiptScalePercent') && (Number(input.receiptScalePercent) < 70 || Number(input.receiptScalePercent) > 110)) {
    throw new Error('Scale must be between 70% and 110%')
  }
  for (const key of ['receiptMarginLeftMm', 'receiptMarginRightMm', 'receiptMarginTopMm', 'receiptMarginBottomMm']) {
    if (Object.prototype.hasOwnProperty.call(input, key) && (Number(input[key]) < 0 || Number(input[key]) > 10)) {
      throw new Error('Margins must be between 0 mm and 10 mm')
    }
  }
  for (const key of ['receiptHorizontalOffsetMm', 'receiptVerticalOffsetMm']) {
    if (Object.prototype.hasOwnProperty.call(input, key) && (Number(input[key]) < -10 || Number(input[key]) > 10)) {
      throw new Error('Offsets must be between -10 mm and 10 mm')
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'receiptFontSize') && !['small', 'normal', 'large'].includes(input.receiptFontSize)) {
    throw new Error('Font size must be small, normal, or large')
  }
  if (Object.prototype.hasOwnProperty.call(input, 'receiptDensity') && !['compact', 'normal', 'spacious'].includes(input.receiptDensity)) {
    throw new Error('Density must be compact, normal, or spacious')
  }
  if (
    (Object.prototype.hasOwnProperty.call(input, 'copies')
      && (!Number.isFinite(Number(input.copies)) || Number(input.copies) < 1 || Number(input.copies) > 3))
    || (Object.prototype.hasOwnProperty.call(input, 'receiptCopies')
      && (!Number.isFinite(Number(input.receiptCopies)) || Number(input.receiptCopies) < 1 || Number(input.receiptCopies) > 3))
    || (Object.prototype.hasOwnProperty.call(input, 'a4Copies')
      && (!Number.isFinite(Number(input.a4Copies)) || Number(input.a4Copies) < 1 || Number(input.a4Copies) > 3))
  ) {
    throw new Error('Copies must be between 1 and 3')
  }
  for (const key of ['autoPrintAfterSale', 'autoPrintReceiptAfterSale', 'fallbackToPreview']) {
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
    defaultPrinter: normalized.receiptPrinterName || undefined,
  }

  if (!normalized.receiptPrinterName) {
    delete next.defaultPrinter
  }

  writeSettings(next)
  return normalized
}

function getDefaultPrinterName() {
  return readPrinterSettings().receiptPrinterName
}

function saveDefaultPrinterName(printerName) {
  if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > 512) {
    throw new Error('Invalid printer name')
  }

  writePrinterSettings({
    ...readPrinterSettings(),
    receiptPrinterName: printerName,
  })
}

function clearDefaultPrinterName() {
  writePrinterSettings({
    ...readPrinterSettings(),
    receiptPrinterName: null,
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

function millimetresToMicrons(mm) {
  return Math.round(Number(mm) * 1000)
}

function millimetresToPrintPixels(mm) {
  return Math.round((Number(mm) * 96) / 25.4)
}

function pixelsToMillimetres(px) {
  return (Number(px) * 25.4) / 96
}

function receiptPrintOptions(settings, heightMm) {
  return {
    silent: true,
    copies: settings.receiptCopies,
    pageSize: {
      width: millimetresToMicrons(settings.receiptPaperWidthMm),
      height: millimetresToMicrons(Math.max(120, Math.min(3000, heightMm))),
    },
    margins: {
      marginType: 'custom',
      top: millimetresToPrintPixels(settings.receiptMarginTopMm),
      bottom: millimetresToPrintPixels(settings.receiptMarginBottomMm),
      left: millimetresToPrintPixels(settings.receiptMarginLeftMm),
      right: millimetresToPrintPixels(settings.receiptMarginRightMm),
    },
    scaleFactor: settings.receiptScalePercent,
  }
}

function receiptProfileParams(settings) {
  const params = new URLSearchParams({
    paperWidthMm: String(settings.receiptPaperWidthMm),
    printableWidthMm: String(settings.receiptPrintableWidthMm),
    marginLeftMm: String(settings.receiptMarginLeftMm),
    marginRightMm: String(settings.receiptMarginRightMm),
    marginTopMm: String(settings.receiptMarginTopMm),
    marginBottomMm: String(settings.receiptMarginBottomMm),
    horizontalOffsetMm: String(settings.receiptHorizontalOffsetMm),
    verticalOffsetMm: String(settings.receiptVerticalOffsetMm),
    scalePercent: String(settings.receiptScalePercent),
    fontSize: settings.receiptFontSize,
    density: settings.receiptDensity,
  })
  return params
}

async function measureReceiptHeightMm(printWindow, settings) {
  const heightPx = await printWindow.webContents.executeJavaScript(`
    (() => {
      const receipt = document.getElementById('thermal-receipt') || document.body;
      const rect = receipt.getBoundingClientRect();
      return Math.ceil(Math.max(rect.height, receipt.scrollHeight, document.body.scrollHeight, document.documentElement.scrollHeight));
    })()
  `)
  const contentHeightMm = pixelsToMillimetres(heightPx)
  return contentHeightMm
    + settings.receiptMarginTopMm
    + settings.receiptMarginBottomMm
    + Math.abs(settings.receiptVerticalOffsetMm)
    + 20
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
    if (!settings.receiptPrinterName) {
      return {
        success: false,
        errorType: 'NO_PRINTER_CONFIGURED',
        message: 'No receipt printer is configured on this device.',
        settings,
      }
    }

    await assertSelectedPrinterAvailable(sender, settings.receiptPrinterName)

    const jobId = randomUUID()
    const printWindow = createHiddenPrintWindow(settings.receiptPaperWidthMm <= 58 ? 320 : 420, 900)
    const ready = waitForReceiptReady(printWindow, jobId, invoiceId)
    const params = receiptProfileParams(settings)
    params.set('electronPrint', '1')
    params.set('printJobId', jobId)
    const route = `/print/receipt/${invoiceId}?${params.toString()}`

    try {
      await Promise.all([
        printWindow.loadURL(appRouteUrl(route)),
        ready,
      ])
      const receiptHeightMm = await measureReceiptHeightMm(printWindow, settings)
      const result = await printCurrentWindow(
        printWindow.webContents,
        settings.receiptPrinterName,
        receiptPrintOptions(settings, receiptHeightMm),
      )

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
  const fontSize = settings.receiptFontSize === 'small' ? 10 : settings.receiptFontSize === 'large' ? 12 : 11
  const lineHeight = settings.receiptDensity === 'compact' ? 1.25 : settings.receiptDensity === 'spacious' ? 1.55 : 1.4

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Kubri Test Print</title>
    <style>
      @page { size: ${settings.receiptPaperWidthMm}mm auto; margin: 0; }
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
        width: ${settings.receiptPrintableWidthMm}mm;
        max-width: ${settings.receiptPrintableWidthMm}mm;
        margin: 0 auto;
        padding: 2mm 0 3mm;
        box-sizing: border-box;
        font-size: ${fontSize}px;
        line-height: ${lineHeight};
        transform: translate(${settings.receiptHorizontalOffsetMm}mm, ${settings.receiptVerticalOffsetMm}mm) scale(${settings.receiptScalePercent / 100});
        transform-origin: top center;
      }
      .center { text-align: center; }
      .brand { font-size: 16px; font-weight: 800; margin-bottom: 4px; }
      .rule { border-top: 1px dashed #000; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; gap: 3mm; }
      .row span:first-child { min-width: 0; overflow-wrap: anywhere; }
      .row strong, .amount { flex-shrink: 0; white-space: nowrap; }
      .muted { color: #333; }
      .ok { font-weight: 800; margin-top: 8px; }
      .edge { border: 1px solid #000; padding: 2mm; font-family: monospace; }
      .item { margin: 2mm 0; overflow-wrap: anywhere; }
      .qr { width: min(34mm, 70%); aspect-ratio: 1; margin: 2mm auto; border: 1px solid #000; display: grid; place-items: center; font-size: 9px; }
    </style>
  </head>
  <body>
    <main class="receipt">
      <div class="center brand">Kubri</div>
      <div class="center">Printer Test Receipt</div>
      <div class="rule"></div>
      <div class="edge">| LEFT EDGE ${' '.repeat(8)} RIGHT EDGE |</div>
      <div class="rule"></div>
      <div class="row"><span>Printer</span><strong>${escapeHtml(settings.receiptPrinterName)}</strong></div>
      <div class="row"><span>Preset</span><strong>${escapeHtml(settings.receiptPaperPreset)}</strong></div>
      <div class="row"><span>Paper</span><strong>${settings.receiptPaperWidthMm}mm</strong></div>
      <div class="row"><span>Printable</span><strong>${settings.receiptPrintableWidthMm}mm</strong></div>
      <div class="row"><span>Scale</span><strong>${settings.receiptScalePercent}%</strong></div>
      <div class="row"><span>Copies</span><strong>${settings.receiptCopies}</strong></div>
      <div class="rule"></div>
      <div class="item">Long English product name for clipping check with quantity and VAT alignment</div>
      <div class="row"><span>2 x SAR 12.50</span><span class="amount">SAR 25.00</span></div>
      <div class="item" dir="rtl">نص عربي لاختبار محاذاة الطباعة وحواف الإيصال</div>
      <div class="row"><span>VAT 15%</span><span class="amount">SAR 3.75</span></div>
      <div class="row"><span>Subtotal</span><span class="amount">SAR 25.00</span></div>
      <div class="row"><span>Total</span><strong>SAR 28.75</strong></div>
      <div class="qr">TEST QR</div>
      <div class="rule"></div>
      <div class="muted">${escapeHtml(now)}</div>
      <div class="center ok">Cut line - no content should be clipped</div>
    </main>
  </body>
</html>`
}

async function runTestPrint(sender, inputSettings = null) {
  try {
    const settings = validatePrinterSettingsInput(inputSettings, readPrinterSettings())
    if (!settings.receiptPrinterName) {
      return {
        success: false,
        errorType: 'NO_PRINTER_CONFIGURED',
        message: 'No receipt printer is configured on this device.',
        settings,
      }
    }

    await assertSelectedPrinterAvailable(sender, settings.receiptPrinterName)

    const printWindow = createHiddenPrintWindow(settings.receiptPaperWidthMm <= 58 ? 320 : 420, 900, {
      allowDataUrl: true,
    })
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testPrintHtml(settings))}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      const receiptHeightMm = await measureReceiptHeightMm(printWindow, settings)
      const result = await printCurrentWindow(
        printWindow.webContents,
        settings.receiptPrinterName,
        receiptPrintOptions(settings, receiptHeightMm),
      )

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

async function printA4CurrentWindow(sender) {
  try {
    const settings = readPrinterSettings()
    if (settings.a4PrinterName) {
      await assertSelectedPrinterAvailable(sender, settings.a4PrinterName)
    }

    const result = await printCurrentWindow(sender, settings.a4PrinterName, {
      silent: Boolean(settings.a4PrinterName),
      copies: settings.a4Copies,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 57, bottom: 57, left: 57, right: 57 },
      landscape: false,
    })

    return {
      ...result,
      settings,
      message: result.success ? null : (result.errorType || 'A4 print failed.'),
    }
  } catch (error) {
    return {
      success: false,
      errorType: 'A4_PRINT_FAILED',
      message: safeErrorMessage(error),
      settings: readPrinterSettings(),
    }
  }
}

function testA4Html(settings) {
  const now = new Date().toLocaleString()
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Kubri A4 Test Print</title>
    <style>
      @page { size: A4; margin: 15mm; }
      html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #111; }
      .page { padding: 0; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0F2419; padding-bottom: 14px; margin-bottom: 20px; }
      .title { color: #0F2419; font-size: 22px; font-weight: 800; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; }
      th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
      th:last-child, td:last-child { text-align: right; }
      .total { margin-top: 18px; margin-left: auto; width: 220px; background: #f3f4f6; padding: 12px; font-weight: 800; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="header">
        <div>
          <div class="title">Kubri A4 Test Invoice</div>
          <div>System default or selected A4 printer</div>
        </div>
        <div>${escapeHtml(now)}</div>
      </div>
      <p>This page verifies that A4 printing does not use thermal receipt width.</p>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
        <tbody>
          <tr><td>Long product line for A4 alignment test</td><td>2</td><td>SAR 99.00</td></tr>
          <tr><td>Arabic / English mixed content اختبار</td><td>1</td><td>SAR 49.00</td></tr>
        </tbody>
      </table>
      <div class="total"><span>Total</span><span>SAR 148.00</span></div>
    </main>
  </body>
</html>`
}

async function runTestA4(sender, inputSettings = null) {
  try {
    const settings = validatePrinterSettingsInput(inputSettings, readPrinterSettings())
    if (settings.a4PrinterName) {
      await assertSelectedPrinterAvailable(sender, settings.a4PrinterName)
    }

    const printWindow = createHiddenPrintWindow(900, 1200, { allowDataUrl: true })
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(testA4Html(settings))}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      const result = await printCurrentWindow(printWindow.webContents, settings.a4PrinterName, {
        silent: Boolean(settings.a4PrinterName),
        copies: settings.a4Copies,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 57, bottom: 57, left: 57, right: 57 },
        landscape: false,
      })

      return {
        ...result,
        settings,
        message: result.success ? null : (result.errorType || 'A4 test print failed.'),
      }
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.close()
      }
    }
  } catch (error) {
    return {
      success: false,
      errorType: 'A4_TEST_PRINT_FAILED',
      message: safeErrorMessage(error),
      settings: readPrinterSettings(),
    }
  }
}

function registerPrinterIpc() {
  ipcMain.handle('print-silent', async (event) => {
    const printerName = getDefaultPrinterName()
    return printCurrentWindow(event.sender, printerName, {
      copies: readPrinterSettings().receiptCopies,
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
    if (next.receiptPrinterName) {
      await assertSelectedPrinterAvailable(event.sender, next.receiptPrinterName)
    }
    if (next.a4PrinterName) {
      await assertSelectedPrinterAvailable(event.sender, next.a4PrinterName)
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

  ipcMain.handle('print-a4-invoice', async (event) => {
    return printA4CurrentWindow(event.sender)
  })

  ipcMain.handle('test-print-a4', async (event, settings) => {
    return runTestA4(event.sender, settings)
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
