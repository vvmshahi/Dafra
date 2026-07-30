import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')
const printerPage = readFileSync(new URL('../src/pages/settings/DevicePrinterPage.tsx', import.meta.url), 'utf8')

assert.match(main, /nodeIntegration:\s*false/)
assert.match(main, /contextIsolation:\s*true/)
assert.match(main, /sandbox:\s*true/)
assert.match(main, /function assertTrustedIpcSender\(event\)/)
assert.match(main, /event\.sender !== mainWindow\.webContents/)
assert.match(main, /if \(!internalUrl\(frameUrl\)\)/)
assert.doesNotMatch(main, /enableRemoteModule\s*:/)
assert.match(main, /setWindowOpenHandler\(/)
assert.match(main, /will-navigate/)
assert.match(main, /isInside\(root, candidate\)/)

const handlers = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1])
for (const channel of handlers) {
  const start = main.indexOf(`ipcMain.handle('${channel}'`)
  const body = main.slice(start, main.indexOf('\n  })', start) + 5)
  assert.match(body, /assertTrustedIpcSender\(event\)/, `${channel} lacks sender validation`)
}

assert.match(preload, /contextBridge\.exposeInMainWorld\('electronAPI'/)
assert.doesNotMatch(preload, /ipcRenderer\.sendToHost/)
assert.doesNotMatch(preload, /require\(['"](?:fs|child_process|shell|net)['"]\)/)
assert.match(sidebar, /isElectron\(\)\s*\? \[\.\.\.ownerNav, branchDevicePrinterNavItem\]/)
assert.match(sidebar, /isElectron\(\)\s*\?\s*\[/)
assert.match(printerPage, /if \(!isElectron\(\)\)/)

console.log(`Electron security contract passed (${handlers.length} IPC handlers validated).`)
