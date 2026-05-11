'use strict'

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const Store = require('electron-store')

const APP_URL = 'https://dafra.vercel.app'
const store = new Store()

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'Meem — ميم',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false,
    backgroundColor: '#0F2419',
  })

  mainWindow.loadURL(APP_URL)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.maximize()
  })

  // Open external links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Remove default menu bar (keeps app clean for POS use)
  Menu.setApplicationMenu(null)
}

app.whenReady().then(() => {
  createWindow()

  // Check for updates after 5 s so the window is visible first
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, 5000)
})

app.on('window-all-closed', () => {
  app.quit()
})

// ── IPC: Printing ─────────────────────────────────────────────────────────────

// Silent print to the saved default printer (falls back to print dialog if none saved)
ipcMain.handle('print-silent', async () => {
  const printerName = store.get('defaultPrinter', null)

  return new Promise((resolve) => {
    mainWindow.webContents.print(
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
})

// Return the list of printers installed on this machine
ipcMain.handle('get-printers', async () => {
  return mainWindow.webContents.getPrintersAsync()
})

// Persist the chosen default printer
ipcMain.handle('save-printer', async (_event, printerName) => {
  store.set('defaultPrinter', printerName)
  return { success: true }
})

// Return the currently persisted default printer name (or null)
ipcMain.handle('get-default-printer', async () => {
  return store.get('defaultPrinter', null)
})

// Remove the persisted default printer
ipcMain.handle('clear-printer', async () => {
  store.delete('defaultPrinter')
  return { success: true }
})

// ── Auto-updater ──────────────────────────────────────────────────────────────

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-downloaded', () => {
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready — Meem',
      message: 'A new version is ready to install.',
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
})

autoUpdater.on('error', (err) => {
  console.error('[updater] error:', err.message)
})
