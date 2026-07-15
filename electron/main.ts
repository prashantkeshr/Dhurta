// Force UTC timezone before any module runs — affects all Node.js date operations.
// Chromium's rendering timezone is handled separately in webviewPreload.js.
process.env.TZ = 'UTC'

import {
  app,
  BrowserWindow,
  session,
  nativeTheme,
  Menu,
} from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase } from './db'
import { setupAdBlocker } from './adBlocker'
import { registerIpcHandlers, saveSession, loadInstalledExtensions, setupWindowListeners } from './ipc'
import { shutdownAllTools } from './tools'
import { setupAutoUpdater } from './updater'

const isDev = !app.isPackaged

// Enable Chromium's native two-finger horizontal-swipe navigation (overscroll → back/forward).
// NOTE: StoragePartitioning (FPI) was removed — it breaks YouTube/Google service workers,
// cross-origin auth flows, and video buffering. Ghost mode achieves isolation via memory:
// partition + Tor proxy instead.
app.commandLine.appendSwitch('enable-features', 'OverscrollHistoryNavigation')

// Strip "Electron/x.x" from the UA for all requests that happen before a session
// is fully initialized (extension requests, initial resource loads, etc.).
app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── Privacy hardening at the Chromium engine level ────────────────────────────
// These switches enforce privacy constraints that JS-level spoofing cannot cover
// because they operate before any renderer script runs.

// Disable hardware-accelerated WebRTC encoding to prevent GPU fingerprinting via
// codec capability probing (a vector our getParameter spoof doesn't cover).
// NOTE: disable-reading-from-canvas and disable-background-networking were removed —
// both broke major sites (YouTube, video streaming, SPAs). Canvas noise is applied
// at the JS level in webviewPreload.js without breaking canvas-dependent sites.

// DNS prefetching resolves hostnames (from <link rel="dns-prefetch"> hints and
// link-hover prediction) via a separate, historically proxy-unaware code path —
// a well-documented way a correctly-configured SOCKS5 proxy (Tor, in Ghost
// Mode) can still leak DNS queries straight to the ISP. Unlike the broader
// disable-background-networking switch above (which broke real sites), this
// one only disables predictive hostname pre-resolution — no page functionality
// depends on it, so this is safe everywhere and closes a real leak vector.
app.commandLine.appendSwitch('dns-prefetch-disable')
// Force WebRTC to only use the proxy connection — never expose local/public IPs
// via STUN/TURN candidate gathering. This is the Chromium-level enforcement;
// the JS-side RTCPeerConnection removal in webviewPreload.js is the defense-in-depth layer.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
// Disable WebRTC multiple routes to prevent enumeration of network interfaces
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check', 'true')

// Catch any main-process crash and log it before the process dies
function appendCrashLog(type: string, detail: string) {
  try {
    const p = path.join(app.getPath('userData'), 'crash-log.json')
    let logs: any[] = []
    try { logs = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (_) {}
    logs.push({ type, detail, ts: new Date().toISOString() })
    if (logs.length > 200) logs = logs.slice(-200)
    fs.writeFileSync(p, JSON.stringify(logs), 'utf8')
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  console.error('[Dhurta] UNCAUGHT EXCEPTION:', err?.stack ?? err)
  appendCrashLog('uncaughtException', err?.stack ?? String(err))
})
process.on('unhandledRejection', (reason) => {
  console.error('[Dhurta] UNHANDLED REJECTION:', reason)
  appendCrashLog('unhandledRejection', String(reason))
})

const BLOCKED_HOSTS = [
  'clients1.google.com',
  'clients2.google.com',
  'update.googleapis.com',
  'safebrowsing.googleapis.com',
]

let mainWindow: BrowserWindow | null = null

export function getMainWindow() {
  return mainWindow
}

function createWindow() {
  // Resolve the logo path — works both in dev (project root) and packaged (resources/)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0A0A0A',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      sandbox: false,
      navigateOnDragDrop: false,
    },
  })

  Menu.setApplicationMenu(null)

  // Force window to front — stays on top briefly then releases
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.center()
  setTimeout(() => mainWindow?.setAlwaysOnTop(false), 2000)

  // Log renderer crashes so we can debug
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Dhurta] RENDERER CRASH:', JSON.stringify(details))
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[Dhurta] LOAD FAILED:', code, desc, url)
  })

  mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2) console.error(`[Renderer L${level}] ${msg} (${src}:${line})`)
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:19173')
    // DevTools inline — don't open detached window (confuses users, eats memory)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Save session before the window is destroyed so tabs can be restored next launch
  mainWindow.on('close', () => {
    saveSession()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system'

  // Security: disable eval in renderer via Content Security Policy
  // Allow 'unsafe-inline' only for Vite dev (inlined styles/scripts); in prod these are file assets
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://localhost:*/*', 'file:///*'] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "img-src 'self' data: blob: https:; " +
            "connect-src 'self' https: wss:; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "font-src 'self' data:;"
          ],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
        },
      })
    }
  )

  try {
    await initDatabase()
  } catch (e) {
    console.error('[Dhurta] DB init failed:', e)
  }

  try {
    await setupAdBlocker(session.defaultSession)
  } catch (e) {
    console.error('[Dhurta] AdBlocker failed:', e)
  }

  // Hard-block sensitive permissions for all regular BrowserView sessions.
  // Ghost sessions have their own stricter handler in createBrowserView().
  // NOTE: 'media' is intentionally NOT blocked — it is required for EME/DRM
  // and video autoplay on sites like YouTube, Netflix, and Twitch.
  session.fromPartition('persist:default').setPermissionRequestHandler((_wc, permission, cb) => {
    const blocked = ['geolocation', 'camera', 'microphone']
    cb(!blocked.includes(permission))
  })

  registerIpcHandlers()

  // Load persisted extensions BEFORE creating the window so they are active
  // in session.defaultSession and persist:default before any BrowserView is created.
  try {
    await loadInstalledExtensions()
  } catch (e) {
    console.error('[Dhurta] Extension load failed:', e)
  }

  createWindow()
  // Attach BrowserView-bounds and VPN-restoration listeners now that the window exists.
  setupWindowListeners()

  // Auto-updater — only in packaged builds; electron-updater throws in dev
  if (!isDev) setupAutoUpdater()

  // Block telemetry and tracking hosts
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      try {
        const url = new URL(details.url)
        const blocked = BLOCKED_HOSTS.some((h) => url.hostname.includes(h))
        callback({ cancel: blocked })
      } catch {
        callback({ cancel: false })
      }
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { shutdownAllTools() })
