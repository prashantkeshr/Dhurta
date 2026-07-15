import { autoUpdater } from 'electron-updater'
import { ipcMain } from 'electron'
import { getMainWindow } from './main'

function send(channel: string, ...args: unknown[]) {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

export function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Suppress the built-in OS notification — we use our own in-browser banner
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    send('update:available', info)
  })

  autoUpdater.on('update-not-available', () => {
    send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('update:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    send('update:error', err.message)
  })

  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates())
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // Check for updates 5 s after launch, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}
