'use strict'

const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron')
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

function getDefaultPrinterName() {
  const value = readSettings().defaultPrinter
  return typeof value === 'string' && value.trim() ? value : null
}

function saveDefaultPrinterName(printerName) {
  if (typeof printerName !== 'string' || !printerName.trim() || printerName.length > 512) {
    throw new Error('Invalid printer name')
  }

  writeSettings({
    ...readSettings(),
    defaultPrinter: printerName,
  })
}

function clearDefaultPrinterName() {
  const settings = readSettings()
  delete settings.defaultPrinter
  writeSettings(settings)
}

function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (internalUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'Kubri POS',
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
    title: 'Kubri POS',
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

function registerPrinterIpc() {
  ipcMain.handle('print-silent', async (event) => {
    const printerName = getDefaultPrinterName()
    return printCurrentWindow(event.sender, printerName)
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
