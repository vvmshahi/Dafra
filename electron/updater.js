'use strict'

/**
 * Auto-updater setup — called from main.js after the window is ready.
 * Checks GitHub Releases for a new version and prompts the user to restart.
 *
 * @param {Electron.BrowserWindow} mainWindow
 * @param {import('electron-updater').AppUpdater} autoUpdater
 * @param {import('electron').Dialog} dialog
 */
function setupAutoUpdater(mainWindow, autoUpdater, dialog) {
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
}

module.exports = { setupAutoUpdater }
