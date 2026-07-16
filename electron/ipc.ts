import {
  ipcMain,
  BrowserWindow,
  BrowserView,
  session,
  app,
  dialog,
  shell,
  Menu,
  MenuItem,
  clipboard,
  nativeImage,
  DownloadItem,
  net,
} from 'electron'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { getDb, nukeDatabase, runIncinerate } from './db'
import { getMainWindow } from './main'
import { startTor, stopTor, isTorReady, getTorProxyRules, addTorReadyListener, addTorExitListener, setExitNodeCountry } from './tor'
import { enableAdBlocker, getBlockedCount } from './adBlocker'
import { isLockEnabled, verifyPin, verifyRecovery, setupPin, changePin, clearPin } from './appLock'
import { resolveToolUrl, shutdownAllTools } from './tools'

// ── App Lock — session state ──────────────────────────────────────────────────
let _sessionUnlocked = false

// ── Extension persistence registry ───────────────────────────────────────────
// Tracks every installed extension dir so they reload automatically on startup.
// Unpacked extensions point to the user's own directory; extracted (crx/amo/webstore)
// point inside userData so they survive across restarts until explicitly removed.

interface ExtEntry {
  id: string
  name: string
  path: string
  source: 'unpacked' | 'crx' | 'webstore' | 'amo'
}

function _extRegistryPath() {
  return path.join(app.getPath('userData'), 'extensions-registry.json')
}

function readExtRegistry(): ExtEntry[] {
  try { return JSON.parse(fs.readFileSync(_extRegistryPath(), 'utf8')) } catch { return [] }
}

function writeExtRegistry(entries: ExtEntry[]) {
  try { fs.writeFileSync(_extRegistryPath(), JSON.stringify(entries, null, 2), 'utf8') }
  catch (e) { console.error('[Extensions] registry write failed:', e) }
}

function addToExtRegistry(entry: ExtEntry) {
  const reg = readExtRegistry().filter(e => e.id !== entry.id && e.path !== entry.path)
  reg.push(entry)
  writeExtRegistry(reg)
}

// Returns the path to delete (null for unpacked extensions — don't delete user's folder)
function removeFromExtRegistry(id: string): string | null {
  const reg = readExtRegistry()
  const entry = reg.find(e => e.id === id)
  writeExtRegistry(reg.filter(e => e.id !== id))
  return (entry && entry.source !== 'unpacked') ? entry.path : null
}

async function _loadExtIntoSessions(extPath: string): Promise<Electron.Extension | null> {
  try {
    const ext = await session.defaultSession.loadExtension(extPath, { allowFileAccess: true })
    try { await session.fromPartition('persist:default').loadExtension(extPath, { allowFileAccess: true }) } catch (_) {}
    return ext
  } catch (e) {
    console.warn('[Extensions] load failed:', extPath, String(e))
    return null
  }
}

// Called once at startup — reloads all previously installed extensions.
// Also scans userData/crx-extensions and userData/amo-extensions as a
// migration path for extensions installed before the registry existed.
export async function loadInstalledExtensions() {
  const registry = readExtRegistry()
  const loadedPaths = new Set<string>()

  // 1. Load everything in the registry
  for (const entry of registry) {
    const manifestPath = path.join(entry.path, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      console.warn('[Extensions] manifest missing, skipping:', entry.path)
      continue
    }
    const ext = await _loadExtIntoSessions(entry.path)
    if (ext) {
      loadedPaths.add(entry.path)
      if (ext.id !== entry.id) addToExtRegistry({ ...entry, id: ext.id })
      console.log(`[Extensions] ✓ ${ext.name} (${ext.id})`)
    }
  }

  // 2. Scan disk dirs for extensions not yet in the registry (migration / recovery)
  const scanDirs: Array<[string, ExtEntry['source']]> = [
    [path.join(app.getPath('userData'), 'crx-extensions'), 'crx'],
    [path.join(app.getPath('userData'), 'amo-extensions'), 'amo'],
  ]
  for (const [dir, source] of scanDirs) {
    if (!fs.existsSync(dir)) continue
    for (const sub of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, sub)
      if (loadedPaths.has(fullPath)) continue
      if (!fs.existsSync(path.join(fullPath, 'manifest.json'))) continue
      const ext = await _loadExtIntoSessions(fullPath)
      if (ext) {
        loadedPaths.add(fullPath)
        addToExtRegistry({ id: ext.id, name: ext.name, path: fullPath, source })
        console.log(`[Extensions] ✓ (migrated) ${ext.name}`)
      }
    }
  }
}

// ── Extension helpers ─────────────────────────────────────────────────────────

// Resolve __MSG_key__ localized names from _locales/<locale>/messages.json
function resolveExtMessage(msg: string, extPath: string, defaultLocale?: string): string {
  if (!msg || !msg.startsWith('__MSG_')) return msg
  const key = msg.slice(6, -2) // strip __MSG_ prefix and __ suffix
  const locales = [defaultLocale, 'en', 'en_US', 'en_GB'].filter(Boolean) as string[]
  for (const locale of locales) {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(extPath, '_locales', locale, 'messages.json'), 'utf8'))
      const entry = msgs[key] || msgs[key.toLowerCase()]
      if (entry?.message) return entry.message
    } catch (_) {}
  }
  return msg
}

// Find the best URL to launch for an extension. Tries in order:
// 1. Standard popup (action.default_popup / browser_action.default_popup)
// 2. Sandbox pages (game extensions use these to bypass CSP)
// 3. chrome.tabs.create URL from background script (game extensions often do this)
// 4. Options page
// 5. Common HTML files at extension root
function findExtensionLaunchUrl(manifest: any, extId: string, extPath: string): string | undefined {
  const pp = manifest.action?.default_popup || manifest.browser_action?.default_popup
  if (pp) return `chrome-extension://${extId}/${pp.replace(/^\//, '')}`

  const sandboxPage = manifest.sandbox?.pages?.[0]
  if (sandboxPage) return `chrome-extension://${extId}/${sandboxPage.replace(/^\//, '')}`

  const bgFile = manifest.background?.service_worker
    || (Array.isArray(manifest.background?.scripts) ? manifest.background.scripts[0] : undefined)
  if (bgFile) {
    try {
      const bgContent = fs.readFileSync(path.join(extPath, bgFile), 'utf8')
      const m = bgContent.match(/chrome\.tabs\.create\s*\(\s*\{[^}]*url\s*:\s*["']([^"']+)["']/)
      if (m && !m[1].startsWith('http')) {
        return `chrome-extension://${extId}/${m[1].replace(/^\//, '')}`
      }
    } catch (_) {}
  }

  const op = manifest.options_page || manifest.options_ui?.page
  if (op) return `chrome-extension://${extId}/${op.replace(/^\//, '')}`

  for (const candidate of ['popup.html', 'index.html', 'game.html', 'main.html', 'app.html']) {
    if (fs.existsSync(path.join(extPath, candidate))) {
      return `chrome-extension://${extId}/${candidate}`
    }
  }

  return undefined
}

// ── Download / Warmth popup windows ─────────────────────────────────────────
// These are native BrowserWindow children positioned below the URL bar button.
// BrowserView renders as a native OS layer above all React HTML, so only a
// child BrowserWindow can appear above it — the same technique Chrome uses for
// extension popups.
let _downloadPopupWin: BrowserWindow | null = null
let _warmthPopupWin:   BrowserWindow | null = null
let _appsPopupWin:     BrowserWindow | null = null
let _toolsPopupWin:    BrowserWindow | null = null

function _createPopup(
  win: BrowserWindow,
  htmlFile: string,
  width: number, height: number,
  screenX: number, screenY: number,
): BrowserWindow {
  const popup = new BrowserWindow({
    parent: win,
    modal: false,
    x: Math.round(screenX),
    y: Math.round(screenY),
    width,
    height,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,  // must be above BrowserView native layer on Windows
    backgroundColor: '#141414',
    webPreferences: {
      preload: path.join(__dirname, 'popupPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  popup.setMenu(null)
  popup.loadFile(htmlFile)
  popup.on('blur', () => { if (!popup.isDestroyed()) popup.close() })
  return popup
}

// ── Extension popup window (Chrome-style per-extension popup) ─────────────────
let _extPopupWin: BrowserWindow | null = null

function openExtensionPopup(
  win: BrowserWindow,
  ext: { id: string; name: string; path: string; popupPage?: string; optionsPage?: string }
) {
  // Close any existing popup first
  if (_extPopupWin && !_extPopupWin.isDestroyed()) {
    _extPopupWin.close()
    _extPopupWin = null
  }

  const targetUrl = ext.popupPage || ext.optionsPage
  if (!targetUrl) {
    win.webContents.send('menu:action', { action: 'panel', panel: 'extensions' })
    return
  }

  // Position: bottom-right corner, just below the URLBar (~90px from top)
  // Use getBounds() (includes frame) so coordinates are correct on all platforms.
  const wb = win.getBounds()
  const popupW = 520
  const popupH = 700
  const px = Math.max(0, wb.x + wb.width - popupW - 4)
  const py = Math.max(0, wb.y + 90)

  const popup = new BrowserWindow({
    // NO parent — parent/child relationship triggers focus ping-pong that
    // fires blur on the popup immediately during creation, hiding it before
    // the user can see it.
    width:  popupW,
    height: popupH,
    x: px,
    y: py,
    frame:       true,   // show title bar so user can drag/close game windows
    transparent: false,
    resizable:   true,   // games need to be resizable
    movable:     true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#0a0a0a',
    title:       ext.name || 'Extension',
    // show: true — don't wait for ready-to-show; if the URL fails to load
    // ready-to-show never fires and the window stays hidden forever.
    show: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: false, // extension pages handle their own isolation
      sandbox:          false,
      session:          session.defaultSession, // same session extension was loaded into
    },
  })

  _extPopupWin = popup

  popup.loadURL(targetUrl).catch(err => {
    console.error('[ExtPopup] load failed:', targetUrl, err)
  })

  // Bring popup to front after a tick so it renders above the main window
  // even though alwaysOnTop is set (needed on some Windows DWM states)
  setTimeout(() => {
    if (popup && !popup.isDestroyed()) {
      popup.moveTop()
      popup.focus()
    }
  }, 80)

  popup.once('closed', () => { _extPopupWin = null })

  // Close when the MAIN WINDOW regains focus — this is the reliable "click
  // outside the popup" signal.  We delay registration so that the focus
  // transfer from main→popup during window creation doesn't trigger it.
  let _focusHandler: (() => void) | null = null
  const registerClose = () => {
    if (popup.isDestroyed()) return
    _focusHandler = () => {
      if (popup && !popup.isDestroyed()) popup.close()
      _focusHandler = null
    }
    win.once('focus', _focusHandler)
  }
  const t = setTimeout(registerClose, 900)

  popup.once('closed', () => {
    clearTimeout(t)
    if (_focusHandler) { win.removeListener('focus', _focusHandler); _focusHandler = null }
  })
}

// ── Pop-out floating window ───────────────────────────────────────────────────
let popoutWin: BrowserWindow | null = null
let popoutView: BrowserView | null = null

const POPOUT_CHROME_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent:#FF4500;--bg:#141414;--surface:#1c1c1c;--border:#2a2a2a;--muted:#707070;--text:#d4d4d4}
html,body{background:var(--bg);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;height:36px;color:var(--text);border-radius:12px 12px 0 0}
.bar{display:flex;align-items:center;height:36px;background:var(--surface);border-bottom:1px solid var(--border);gap:2px;padding:0 6px;-webkit-app-region:drag;user-select:none;border-radius:12px 12px 0 0}
.no-drag{-webkit-app-region:no-drag}
button{-webkit-app-region:no-drag;background:transparent;border:none;color:var(--muted);cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:7px;font-size:12px;transition:background .12s,color .12s;flex-shrink:0}
button:hover{color:var(--text);background:rgba(255,255,255,.08)}
button:disabled{opacity:.3;cursor:default}
button:disabled:hover{background:none;color:var(--muted)}
#close:hover{color:#fff;background:#e5342e}
.badge{font-size:8px;color:var(--accent);border:1px solid var(--accent);padding:1px 5px;border-radius:5px;letter-spacing:.06em;flex-shrink:0;line-height:14px;margin-right:2px}
.url{flex:1;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;font-family:Consolas,monospace}
.sep{width:1px;height:16px;background:var(--border);flex-shrink:0;margin:0 2px}
.active{color:var(--accent)!important}
</style></head>
<body><div class="bar">
  <span class="badge no-drag">PIP</span>
  <button id="back" class="no-drag" title="Back">&#9664;</button>
  <button id="fwd" class="no-drag" title="Forward">&#9654;</button>
  <button id="reload" class="no-drag" title="Reload">&#8635;</button>
  <span class="url" id="url-disp">Loading&#8230;</span>
  <button id="trans" class="no-drag" title="Transparency">&#9711;</button>
  <button id="pin" class="no-drag active" title="Toggle always-on-top">&#128204;</button>
  <div class="sep no-drag"></div>
  <button id="focus" class="no-drag" title="Back to browser (focus)">&#10697;</button>
  <button id="main" class="no-drag" title="Open in main tab">&#8599;</button>
  <div class="sep no-drag"></div>
  <button id="min" class="no-drag" title="Minimize">&#9472;</button>
  <button id="max" class="no-drag" title="Maximize">&#9723;</button>
  <button id="close" class="no-drag" title="Close">&#10005;</button>
</div>
<script>
const a=window.dhurtaPip;
if(a){
  document.getElementById('back').onclick=()=>a.goBack();
  document.getElementById('fwd').onclick=()=>a.goForward();
  document.getElementById('reload').onclick=()=>a.reload();
  document.getElementById('close').onclick=()=>a.close();
  document.getElementById('main').onclick=()=>a.openInMain();
  document.getElementById('focus').onclick=()=>a.focusMain();
  document.getElementById('min').onclick=()=>a.minimize();

  const maxBtn=document.getElementById('max');
  maxBtn.onclick=()=>a.toggleMaximize();
  a.onMaximizeState(isMax=>{
    maxBtn.innerHTML=isMax?'&#10064;':'&#9723;';
    maxBtn.title=isMax?'Restore':'Maximize';
  });

  let pinned=true;
  const pinBtn=document.getElementById('pin');
  pinBtn.onclick=()=>{pinned=!pinned;a.setAlwaysOnTop(pinned);pinBtn.className='no-drag'+(pinned?' active':'')};

  const transVals=[1,0.85,0.68,0.5];
  let transIdx=0;
  const transBtn=document.getElementById('trans');
  transBtn.onclick=()=>{
    transIdx=(transIdx+1)%transVals.length;
    a.setOpacity(transVals[transIdx]);
    transBtn.className='no-drag'+(transIdx>0?' active':'');
    transBtn.title='Opacity: '+Math.round(transVals[transIdx]*100)+'%';
  };

  a.onUrlChanged(u=>{const el=document.getElementById('url-disp');el.textContent=u;el.title=u});
  a.onTitleChanged(t=>{document.title=t});
  a.onNavState(s=>{
    document.getElementById('back').disabled=!s.canGoBack;
    document.getElementById('fwd').disabled=!s.canGoForward;
  });
}
</script></body></html>`

interface DownloadRecord {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  percent: number   // 0-100, or -1 when size unknown
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  speed?: number    // bytes/sec, smoothed EMA
}

const downloads    = new Map<string, DownloadRecord>()
const downloadItems = new Map<string, DownloadItem>()  // live item refs for pause/resume/cancel
// Speed tracking: last snapshot per download id
const _dlLastBytes = new Map<string, number>()
const _dlLastMs    = new Map<string, number>()

interface Tab {
  id: number
  view: BrowserView
  url: string
  title: string
  favicon: string
  loading: boolean
  ghost: boolean
  jsDisabled: boolean
  requests: RequestEntry[]
}

interface RequestEntry {
  id: string
  method: string
  url: string
  type: string
  timestamp: number
  status?: number
}

let tabIdCounter = 1
const tabs = new Map<number, Tab>()
let activeTabId = -1
let ghostEnabled = false
let currentPanelWidth = 0
let warmthLevel = 0  // 0-100; applied as sepia+brightness filter to every BrowserView page


// Warmth is now managed by webviewPreload.js via ipcRenderer.
// Main process only needs to push level changes to each tab's webContents.
function applyWarmthToWebContents(wc: Electron.WebContents) {
  if (wc.isDestroyed()) return
  wc.send('display:warmthChanged', warmthLevel)
}

// Gesture flags — cached from DB so we don't hit SQLite on every wheel event.
// Updated immediately when the user changes settings.
let gesturePinchZoom = true   // pinch-out (zoom in) via trackpad
let gestureSwipe     = true   // two-finger horizontal swipe → back / forward

// Bridge (browser-to-browser connect)
let bridgeServer: http.Server | null = null
let bridgeCode: string | null = null

// Layout constants — each row is border-box (height + its own border-b of 1px):
//   TitleBar h-10 (40) +1  = 41
//   TabBar   h-9  (36) +1  = 37
//   URLBar   h-9  (36) +1  = 37
// Total = 115px. Must match exactly, or the BrowserView native layer paints over
// the bottom of the URL bar (making its buttons unclickable) or leaves a gap.
const CHROME_HEIGHT = 115

function getTabBounds(win: BrowserWindow) {
  // setBounds() and getBounds() both use logical (device-independent) pixels on
  // all platforms — no DPI scaling needed. The original bug was getContentSize()
  // returning wrong values; getBounds() is correct and must NOT be multiplied by
  // the display scaleFactor.
  const { width: w, height: h } = win.getBounds()
  const x = 64 + currentPanelWidth
  return {
    x,
    y: CHROME_HEIGHT,
    width:  Math.max(100, w - x),
    height: Math.max(100, h - CHROME_HEIGHT),
  }
}

// Internal dhurta:// pages that render as React components — BrowserView is hidden for these.
const DHURTA_INTERNAL_PAGES = new Set([
  'dhurta://newtab', 'dhurta://history', 'dhurta://downloads', 'dhurta://bookmarks', 'dhurta://omni',
])

function isNewTabUrl(url: string) {
  return !url || url === 'about:blank' || url === '' || DHURTA_INTERNAL_PAGES.has(url)
}

function getSecurityFlag(key: string): boolean {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value === 'true'
  } catch { return false }
}

function getSearchUrl(query: string): string {
  const q = encodeURIComponent(query)
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('searchEngine') as any
    const engine = row?.value ?? 'google'
    const customRow = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('searchEngineCustomUrl') as any
    const customUrl = customRow?.value ?? ''
    switch (engine) {
      case 'brave':      return `https://search.brave.com/search?q=${q}`
      case 'google':     return `https://www.google.com/search?q=${q}`
      case 'bing':       return `https://www.bing.com/search?q=${q}`
      case 'duckduckgo': return `https://duckduckgo.com/?q=${q}`
      case 'custom':     return customUrl ? customUrl.replace('%s', query) : `https://search.brave.com/search?q=${q}`
      default:           return `https://search.brave.com/search?q=${q}`
    }
  } catch { return `https://www.google.com/search?q=${q}` }
}

async function fetchFreeProxy(country = 'all'): Promise<string | null> {
  const cc = country === 'all' ? 'all' : country.toUpperCase()
  const sources = [
    `https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5&timeout=10000&country=${cc}&ssl=all&anonymity=elite`,
    `https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=${cc}&ssl=all&anonymity=elite`,
  ]
  for (const src of sources) {
    try {
      const resp = await fetch(src, { signal: AbortSignal.timeout(8000) })
      const text = await resp.text()
      const proxies = text.split('\n')
        .map(l => l.trim())
        .filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
      if (proxies.length > 0) {
        return proxies[Math.floor(Math.random() * Math.min(proxies.length, 30))]
      }
    } catch { continue }
  }
  return null
}


function codeToPort(code: string): number {
  return 40000 + (parseInt(code, 10) % 20000)
}

async function lookupIp(sess: Electron.Session) {
  const providers = [
    { url: 'https://ipapi.co/json/', map: (j: any) => ({
      ip: j.ip, country: j.country_name, countryCode: j.country_code,
      city: j.city, region: j.region, lat: j.latitude, lon: j.longitude, org: j.org,
    })},
    { url: 'http://ip-api.com/json/', map: (j: any) => ({
      ip: j.query, country: j.country, countryCode: j.countryCode,
      city: j.city, region: j.regionName, lat: j.lat, lon: j.lon, org: j.isp,
    })},
  ]
  for (const p of providers) {
    try {
      const resp = await net.fetch(p.url, { session: sess, signal: AbortSignal.timeout(6000) } as any)
      if (!resp.ok) continue
      const json = await resp.json()
      const mapped = p.map(json)
      if (mapped.ip) return { success: true, ...mapped }
    } catch (_) { continue }
  }
  return { success: false, error: 'Could not reach an IP-lookup service (offline, or all providers blocked).' }
}

async function createBrowserView(ghost: boolean): Promise<BrowserView> {
  // Ghost = isolated in-memory session (nothing persists to disk), routed through
  // the bundled Tor binary so traffic — including DNS, via SOCKS5 remote resolution —
  // exits via the Tor network instead of the real ISP connection.
  const partition = ghost ? `memory:ghost-${Date.now()}` : 'persist:default'
  const sess = session.fromPartition(partition)

  const antiFP = ghost || getSecurityFlag('security_antiFingerprint')
  const blockWebRTC = ghost || getSecurityFlag('security_blockWebRTC')

  if (ghost) {
    sess.setPermissionRequestHandler((_wc, permission, cb) => {
      if (permission === 'media' || permission === 'geolocation') cb(false)
      else cb(true)
    })
    // Always apply Tor proxy — fail-closed: if Tor hasn't bootstrapped yet,
    // Chromium gets ECONNREFUSED (blocked) rather than routing directly to the ISP.
    // proxyBypassRules: '' ensures even local-looking hostnames are still tunneled.
    // MUST be awaited: session.setProxy() is genuinely async (hands off to the
    // network service) — createBrowserView used to return the BrowserView
    // immediately without waiting, so a caller that navigates right away
    // (tab:duplicate did exactly this) could fire the first request before
    // the proxy was actually wired up, leaking the real IP/DNS unproxied.
    await sess.setProxy({ proxyRules: getTorProxyRules(), proxyBypassRules: '' })
    // Each ghost tab gets its own unique memory: partition, so we must explicitly
    // enable the ad blocker for it (persist:default is handled once in main.ts).
    try { enableAdBlocker(sess) } catch (_) {}
    // Normalize privacy-relevant request headers on every outbound request.
    // Accept-Language is the important one: the JS-side spoof only changes
    // navigator.language(s); the actual Accept-Language HTTP header still carried
    // the real OS locale to every server — a leak on its own AND a contradiction
    // with the spoofed navigator.language ('en-US' in JS vs. real locale in the
    // header) that itself fingerprints the session as spoofed. Pin both to en-US.
    sess.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['DNT'] = '1'
      details.requestHeaders['Sec-GPC'] = '1'
      details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9'
      callback({ requestHeaders: details.requestHeaders })
    })
  } else {
    // Geolocation reveals a precise real-world location regardless of IP/proxy spoofing —
    // deny it outright whenever anti-fingerprint protection is on.
    if (antiFP) {
      sess.setPermissionRequestHandler((_wc, permission, cb) => {
        if (permission === 'geolocation') cb(false)
        else cb(true)
      })
      // Same Accept-Language normalization as ghost mode — without it, the
      // anti-fingerprint JS spoof of navigator.language is contradicted by the
      // real-locale Accept-Language header.
      sess.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['DNT'] = '1'
        details.requestHeaders['Sec-GPC'] = '1'
        details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9'
        callback({ requestHeaders: details.requestHeaders })
      })
    }
    // Only reset to direct if VPN is NOT active — never clobber an active VPN proxy
    const vpnActive = getSecurityFlag('security_ipRotation')
    if (vpnActive) {
      const proxyRow = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('activeProxy') as any
      if (proxyRow?.value) await sess.setProxy({ proxyRules: `socks5://${proxyRow.value}` })
    } else {
      await sess.setProxy({ proxyRules: 'direct://' })
    }
  }

  // Remove "Electron/x.x.x" from UA — many sites (Brave Search, Google, etc.) detect
  // Electron and render broken/simplified layouts. A plain Chrome UA fixes this.
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  sess.setUserAgent(chromeUA)

  sess.cookies.on('changed', (_e, _cookie, _cause, _removed) => {})

  const additionalArguments: string[] = []
  if (ghost) additionalArguments.push('--ghost')
  if (antiFP) additionalArguments.push('--anti-fingerprint')
  if (blockWebRTC) additionalArguments.push('--block-webrtc')

  const view = new BrowserView({
    webPreferences: {
      preload: require('path').join(__dirname, 'webviewPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,        // preload needs Node/require; contextIsolation keeps page isolated
      session: sess,
      webSecurity: true,
      additionalArguments,
      // Allow PDF viewer and local file access
      plugins: true,
    },
  })

  // WebRTC IP handling policy — Chromium-level enforcement that prevents the
  // network stack from gathering ICE candidates with the real IP. The JS-side
  // RTCPeerConnection block in webviewPreload.js stops page code from calling
  // the API, but without this policy Chromium's internal ICE agent can still
  // leak real IPs in STUN/TURN candidates before JS even runs.
  if (blockWebRTC || ghost) {
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  }

  return view
}

function attachViewEvents(tab: Tab) {
  const win = getMainWindow()
  if (!win) return

  const wc = tab.view.webContents

  // Screen warmth overlay is now managed by webviewPreload.js (ipcRenderer-based).
  // It fetches the current level on load and listens for 'display:warmthChanged' pushes.

  // Disable trackpad pinch-to-zoom. Pinch zoom changes the visual viewport scale,
  // which makes window.innerWidth appear smaller to the page → responsive sites
  // switch to mobile breakpoints even though the window is full-width.
  // Keyboard zoom (Ctrl+/-) still works because it goes through setZoomFactor(),
  // which is separate from the visual zoom level clamped here.
  wc.setVisualZoomLevelLimits(1, 1)

  wc.on('did-start-loading', () => {
    tab.loading = true
    tab.requests = []
    win.webContents.send('tab:loadStart', tab.id)
  })

  wc.on('did-stop-loading', () => {
    tab.loading = false
    tab.url = wc.getURL()
    tab.title = wc.getTitle()

    // Electron's BrowserView has a race between setBounds (compositor path) and
    // the page's first CSS layout pass. The compositor update arrives too late,
    // so responsive sites pick mobile breakpoints because they see a zero-width
    // viewport. The fix: use the DevTools Protocol directly via
    // enableDeviceEmulation to explicitly tell the renderer its correct
    // dimensions, then immediately release the override with
    // disableDeviceEmulation. This is identical to what Chrome does internally
    // when you toggle the DevTools Device Toolbar off — it forces a full
    // viewport recalculation at the correct size. The 50 ms delay gives the
    // compositor time to commit the intermediate override before we release it,
    // ensuring the renderer re-reads the actual frame dimensions (which
    // setBounds already set correctly). No visual flicker occurs because this
    // runs after the page has already painted.
    const currentWin = getMainWindow()
    if (currentWin && !isNewTabUrl(tab.url)) {
      const b = getTabBounds(currentWin)
      try {
        wc.enableDeviceEmulation({
          screenPosition: 'desktop',
          screenSize: { width: b.width, height: b.height },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: b.width, height: b.height },
          deviceScaleFactor: 0,
          scale: 1,
        })
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.disableDeviceEmulation()
        }, 50)
      } catch (_) {}
    }

    win.webContents.send('tab:loadStop', {
      id: tab.id,
      url: tab.url,
      title: tab.title,
    })

    if (!tab.ghost && tab.url && !tab.url.startsWith('dhurta://')) {
      getDb()
        .prepare('INSERT INTO history (url, title, favicon) VALUES (?, ?, ?)')
        .run(tab.url, tab.title, tab.favicon)
    }

    // Inject "Install in Dhurta" button on Chrome Web Store extension detail pages.
    // Regex handles both URL formats:
    //   chromewebstore.google.com/detail/<name>/<id>
    //   chromewebstore.google.com/detail/<id>          (no name segment)
    //   chrome.google.com/webstore/detail/<name>/<id>  (legacy)
    const wsMatch = tab.url?.match(
      /https:\/\/(?:chrome\.google\.com\/webstore\/detail\/(?:[^/]+\/)?|chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?)([a-z]{32})/
    )
    if (wsMatch) {
      const extId = wsMatch[1]
      // window.__dhurta.installExt is exposed via contextBridge.exposeInMainWorld in
      // webviewPreload.js — this is the only reliable cross-context-isolation bridge.
      wc.executeJavaScript(`
        ;(function() {
          if (document.getElementById('__dhurta_install_btn')) return
          var btn = document.createElement('button')
          btn.id = '__dhurta_install_btn'
          btn.textContent = '⚡ Install in Dhurta'
          btn.style.cssText = [
            'position:fixed','bottom:24px','right:24px','z-index:2147483647',
            'background:#FF4500','color:#fff','border:none',
            'padding:11px 20px','font:700 13px/1 system-ui',
            'border-radius:6px','cursor:pointer',
            'box-shadow:0 4px 16px rgba(0,0,0,.45)',
            'transition:background .15s',
          ].join(';')
          btn.onmouseenter = function() { btn.style.background='#e03d00' }
          btn.onmouseleave = function() { btn.style.background='#FF4500' }
          btn.onclick = function() {
            if (!window.__dhurta || !window.__dhurta.installExt) {
              btn.textContent = '✕ Bridge not ready — reload page'
              btn.style.background = '#cc0000'
              return
            }
            btn.textContent = 'Installing…'
            btn.disabled = true
            btn.style.opacity = '0.75'
            window.__dhurta.installExt('${extId}').then(function(r) {
              if (r && r.error) {
                btn.textContent = '✕ ' + r.error
                btn.style.background = '#cc0000'
              } else {
                btn.textContent = '✓ Installed: ' + ((r && r.name) || '${extId}')
                btn.style.background = '#1a8a3a'
              }
              btn.style.opacity = '1'
              setTimeout(function() { if (btn.parentNode) btn.remove() }, 6000)
            }).catch(function(e) {
              btn.textContent = '✕ ' + String(e)
              btn.style.background = '#cc0000'
              btn.style.opacity = '1'
            })
          }
          document.body && document.body.appendChild(btn)
        })()
      `).catch(() => {})
    }
  })

  // dom-ready: inject chrome.webstore shim + MutationObserver that intercepts
  // the native "Add to Chrome" button. dom-ready fires before the page's React
  // bundle runs — the shim must be in place before any webstore API calls.
  wc.on('dom-ready', () => {
    const url = wc.getURL()
    if (!url.includes('chromewebstore.google.com') && !url.includes('chrome.google.com/webstore')) return
    // Extract extension ID from the URL so we can call installExt directly
    const idMatch = url.match(/([a-z]{32})/)
    const pageExtId = idMatch ? idMatch[1] : ''
    wc.executeJavaScript(`
      ;(function() {
        // ── 1. chrome.webstore shim (old API) ────────────────────────────────
        if (!window.chrome) window.chrome = {}
        if (!window.chrome.webstore) {
          var _bridge = window.__dhurta
          window.chrome.webstore = {
            install: function(urlOrId, success, failure) {
              var m = (urlOrId||'').match(/([a-z]{32})/)
              var extId = m ? m[1] : null
              if (!extId) { if(failure) failure('INVALID_ID','Bad ID'); return }
              if (_bridge && _bridge.installExt) {
                _bridge.installExt(extId).then(function(r) {
                  if(r&&r.error){ if(failure) failure('OTHER_ERROR',r.error) }
                  else           { if(success) success() }
                }).catch(function(e){ if(failure) failure('OTHER_ERROR',String(e)) })
              } else { if(failure) failure('OTHER_ERROR','Bridge unavailable') }
            },
            onInstallStageChanged:{ addListener:function(){}, removeListener:function(){}, hasListener:function(){ return false } },
            onDownloadProgress:   { addListener:function(){}, removeListener:function(){}, hasListener:function(){ return false } },
          }
        }

        // ── 2. Intercept native "Add to Chrome" button ───────────────────────
        // The new Web Store is a React SPA; buttons render after dom-ready.
        // MutationObserver keeps watching until the button appears then patches it.
        var PAGE_EXT_ID = '${pageExtId}'
        if (!PAGE_EXT_ID) return

        function patchBtn(btn) {
          if (btn.__dhurtaPatched) return
          btn.__dhurtaPatched = true
          btn.addEventListener('click', function(e) {
            e.preventDefault()
            e.stopImmediatePropagation()
            var bridge = window.__dhurta
            if (!bridge || !bridge.installExt) { alert('Dhurta bridge not ready — reload the page'); return }
            var orig = btn.textContent
            btn.textContent = 'Installing…'
            btn.disabled = true
            bridge.installExt(PAGE_EXT_ID).then(function(r) {
              btn.disabled = false
              if (r && r.error) {
                btn.textContent = 'Error: ' + r.error
                btn.style.background = '#c00'
                btn.style.color = '#fff'
              } else {
                btn.textContent = '✓ Installed in Dhurta'
                btn.style.background = '#1a8a3a'
                btn.style.color = '#fff'
              }
            }).catch(function(e) {
              btn.disabled = false; btn.textContent = orig
            })
          }, true)  // capture=true so we beat the React handler
        }

        function scanButtons() {
          document.querySelectorAll('button,a[role=button]').forEach(function(el) {
            var txt = (el.textContent||el.getAttribute('aria-label')||'').trim().toLowerCase()
            if (txt === 'add to chrome' || txt === 'add to browser' || txt === 'add extension') {
              patchBtn(el)
            }
          })
        }

        scanButtons()
        var obs = new MutationObserver(scanButtons)
        obs.observe(document.documentElement, { childList:true, subtree:true })
      })()
    `).catch(() => {})
  })

  // AMO dom-ready: intercept "Add to Firefox" buttons on addons.mozilla.org
  wc.on('dom-ready', () => {
    const url = wc.getURL()
    if (!url.includes('addons.mozilla.org')) return
    // Extract slug from URL: /en-US/firefox/addon/{slug}/
    const slugMatch = url.match(/addons\.mozilla\.org\/[^/]+\/firefox\/addon\/([^/?#]+)/)
    const pageSlug = slugMatch ? slugMatch[1] : ''
    wc.executeJavaScript(`
      ;(function() {
        var SLUG = '${pageSlug}'

        function patchAMOBtn(btn) {
          if (btn.__dhurtaAMOPatched) return
          btn.__dhurtaAMOPatched = true
          // Insert a sibling "Install in Dhurta" button
          var dhBtn = document.createElement('button')
          dhBtn.textContent = '⚡ Add to Dhurta'
          dhBtn.style.cssText = [
            'display:inline-flex','align-items:center','gap:6px',
            'background:#FF4500','color:#fff','border:none',
            'padding:10px 18px','font:700 13px/1 system-ui',
            'border-radius:4px','cursor:pointer','margin-left:8px',
            'box-shadow:0 2px 8px rgba(0,0,0,.3)',
            'transition:background .15s',
          ].join(';')
          dhBtn.onmouseenter = function() { dhBtn.style.background='#e03d00' }
          dhBtn.onmouseleave = function() { dhBtn.style.background='#FF4500' }
          dhBtn.onclick = function(e) {
            e.preventDefault()
            e.stopImmediatePropagation()
            var slug = SLUG
            // Fallback: try to extract slug from current URL
            if (!slug) {
              var m = location.pathname.match(/\\/addon\\/([^/?#]+)/)
              slug = m ? m[1] : ''
            }
            if (!slug) { alert('Could not determine extension slug'); return }
            var bridge = window.__dhurta
            if (!bridge || !bridge.installExtFromAMO) {
              dhBtn.textContent = '✕ Bridge unavailable — reload page'
              dhBtn.style.background = '#c00'
              return
            }
            dhBtn.textContent = 'Installing…'
            dhBtn.disabled = true
            dhBtn.style.opacity = '0.7'
            bridge.installExtFromAMO(slug).then(function(r) {
              if (r && r.error) {
                dhBtn.textContent = '✕ ' + r.error
                dhBtn.style.background = '#c00'
                dhBtn.style.opacity = '1'
                dhBtn.disabled = false
              } else {
                dhBtn.textContent = '✓ Installed: ' + ((r && r.name) || slug)
                dhBtn.style.background = '#1a8a3a'
                dhBtn.style.opacity = '1'
                setTimeout(function() { if (dhBtn.parentNode) dhBtn.remove() }, 6000)
              }
            }).catch(function(e) {
              dhBtn.textContent = '✕ ' + String(e)
              dhBtn.style.background = '#c00'
              dhBtn.style.opacity = '1'
              dhBtn.disabled = false
            })
          }
          btn.parentNode && btn.parentNode.insertBefore(dhBtn, btn.nextSibling)
        }

        function scanAMOButtons() {
          document.querySelectorAll('button,a').forEach(function(el) {
            var txt = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase()
            if (txt === 'add to firefox' || txt === 'download file') {
              patchAMOBtn(el)
            }
          })
        }

        scanAMOButtons()
        var obs = new MutationObserver(scanAMOButtons)
        obs.observe(document.documentElement, { childList:true, subtree:true })
      })()
    `).catch(() => {})
  })

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title
    win.webContents.send('tab:titleChanged', { id: tab.id, title })
  })

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (favicons[0]) {
      tab.favicon = favicons[0]
      win.webContents.send('tab:faviconChanged', { id: tab.id, favicon: favicons[0] })
    }
  })

  wc.on('render-process-gone', (_e, details) => {
    console.error(`[Dhurta] Tab renderer crashed (tab ${tab.id}):`, JSON.stringify(details))
    if (wc.isDestroyed()) return
    const crashPage = path.join(__dirname, 'offline.html')
    wc.loadFile(crashPage, { query: { code: 'CRASH', url: wc.getURL() || '' } }).catch(() => {
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        `<html style="background:#0A0A0A;color:#C0C0C0;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%">` +
        `<div style="font-size:13px;letter-spacing:3px;color:#FF4500;margin-bottom:12px">DHURTA</div>` +
        `<div style="font-size:18px;margin-bottom:8px">Tab crashed — ${details.reason}</div>` +
        `<button onclick="history.back()" style="background:transparent;border:1px solid #FF4500;color:#FF4500;padding:8px 24px;font-family:monospace;cursor:pointer">↺ Reload</button>` +
        `</html>`
      )).catch(() => {})
    })
    win.webContents.send('tab:loadError', { id: tab.id, code: -2, desc: 'Renderer crashed: ' + details.reason, url: '' })
  })

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 = ERR_ABORTED (user navigated away) — not a real error.
    // isMainFrame=false = sub-resource (ad/tracker blocked by ad-blocker) — not a page error.
    if (code === -3 || !isMainFrame) return
    if (wc.isDestroyed()) return
    win.webContents.send('tab:loadError', { id: tab.id, code, desc, url })
    const offlinePage = path.join(__dirname, 'offline.html')
    wc.loadFile(offlinePage, { query: { code: String(code), url: url || '' } }).catch(() => {
      if (wc.isDestroyed()) return
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        `<html style="background:#0A0A0A;color:#C0C0C0;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%">` +
        `<div style="font-size:13px;letter-spacing:3px;color:#FF4500;margin-bottom:12px">DHURTA</div>` +
        `<div style="font-size:18px;margin-bottom:8px">No internet connection</div>` +
        `<div style="font-size:10px;color:#444;margin-bottom:20px">${esc(url || '')}</div>` +
        `<button onclick="history.back()" style="background:transparent;border:1px solid #FF4500;color:#FF4500;padding:8px 24px;font-family:monospace;cursor:pointer">↺ Try Again</button>` +
        `</html>`
      )).catch(() => {})
    })
  })

  // Popup windows: explicitly-sized popups (OAuth, install dialogs, payment flows, etc.)
  // open as real child BrowserWindows with alwaysOnTop so they appear above the BrowserView.
  // Large or unsized opens become new tabs instead.
  wc.setWindowOpenHandler(({ url, features }) => {
    if (!url || url.startsWith('about:')) return { action: 'deny' }
    // Parse width/height tolerantly — some sites use "width = 600" with spaces
    const fw = parseInt(features.replace(/\s/g, '').match(/width=(\d+)/i)?.[1] ?? '0', 10)
    const fh = parseInt(features.replace(/\s/g, '').match(/height=(\d+)/i)?.[1] ?? '0', 10)
    // Treat any explicitly-sized window smaller than 1400×900 as a popup
    const isPopup = fw > 0 && fh > 0 && fw < 1400 && fh < 900
    if (isPopup) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          // No parent — child windows on Windows are constrained inside the parent
          // and can't be dragged freely. alwaysOnTop makes it float above the BrowserView.
          width: fw, height: fh,
          alwaysOnTop: true,
          movable: true,
          resizable: true,
          autoHideMenuBar: true,
          frame: true,
          webPreferences: {
            preload: path.join(__dirname, 'webviewPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            session: tab.view.webContents.session,
          },
        },
      }
    }
    // Carry the triggering tab's ghost flag so a link that opens in a new tab
    // from inside Ghost Mode stays inside Ghost Mode — without this, a plain
    // target="_blank" link (anything not matching the small-popup-size check
    // above) silently created a NORMAL tab with the real IP/connection, which
    // is a real anonymity leak, not just a UX quirk.
    win.webContents.send('tab:openUrl', { url, ghost: tab.ghost })
    return { action: 'deny' }
  })

  // Attach right-click context menu to any popup created via setWindowOpenHandler
  wc.on('did-create-window', (popupWin) => {
    popupWin.webContents.on('context-menu', (_e, params) => {
      const items: Electron.MenuItemConstructorOptions[] = []
      if (params.isEditable) {
        if (params.editFlags?.canCut)   items.push({ label: 'Cut',   click: () => popupWin.webContents.cut() })
        if (params.editFlags?.canCopy || params.selectionText)
                                        items.push({ label: 'Copy',  click: () => popupWin.webContents.copy() })
        if (params.editFlags?.canPaste) items.push({ label: 'Paste', click: () => popupWin.webContents.paste() })
        items.push({ type: 'separator' })
      }
      if (params.selectionText && !params.isEditable) {
        items.push({ label: 'Copy', click: () => clipboard.writeText(params.selectionText) })
        items.push({ type: 'separator' })
      }
      if (params.linkURL) {
        items.push({ label: 'Open Link in New Tab', click: () => win.webContents.send('context-menu:action', { action: 'openInNewTab', url: params.linkURL, ghost: tab.ghost }) })
        items.push({ label: 'Copy Link Address',    click: () => clipboard.writeText(params.linkURL) })
        items.push({ type: 'separator' })
      }
      if (params.mediaType === 'image' && params.srcURL) {
        items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) })
        items.push({ label: 'Save Image As…',     click: () => popupWin.webContents.downloadURL(params.srcURL) })
        items.push({ type: 'separator' })
      }
      items.push({ label: 'Back',    enabled: popupWin.webContents.canGoBack(),    click: () => popupWin.webContents.goBack() })
      items.push({ label: 'Forward', enabled: popupWin.webContents.canGoForward(), click: () => popupWin.webContents.goForward() })
      items.push({ label: 'Reload',  click: () => popupWin.webContents.reload() })
      items.push({ type: 'separator' })
      items.push({ label: 'Inspect', click: () => popupWin.webContents.inspectElement(params.x, params.y) })
      if (items.length === 0) items.push({ label: 'Paste', click: () => popupWin.webContents.paste() })
      Menu.buildFromTemplate(items).popup({ window: popupWin })
    })
  })

  // Zoom sync: keyboard zoom (Ctrl +/-/0) via before-input-event.
  // Pinch-to-zoom via input-event below — we use setZoomFactor (layout zoom) so
  // visualViewport.scale stays at 1 and responsive sites keep their desktop layout.
  wc.on('zoom-changed', (_e, _direction) => {
    // Keep the zoom level indicator in sync when zoom changes by any means.
    setTimeout(() => {
      if (wc.isDestroyed()) return
      win.webContents.send('zoom:level', { tabId: tab.id, level: wc.getZoomFactor() })
    }, 50)
  })


  wc.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || !input.control || input.meta || input.shift) return
    let next: number | null = null
    if (input.key === '=' || input.key === '+') {
      next = Math.min(3, Math.round((wc.getZoomFactor() + 0.1) * 10) / 10)
    } else if (input.key === '-') {
      next = Math.max(0.3, Math.round((wc.getZoomFactor() - 0.1) * 10) / 10)
    } else if (input.key === '0') {
      next = 1
    }
    if (next !== null) {
      wc.setZoomFactor(next)
      win.webContents.send('zoom:level', { tabId: tab.id, level: next })
    }
  })

  // HTML5 fullscreen via preload's fullscreenchange listener (more reliable than
  // enter-html-full-screen which sometimes doesn't fire for shadow-DOM video players)
  wc.on('ipc-message', (_e, channel, ...args) => {
    const w = getMainWindow()
    if (channel === 'view:fullscreenEnter') {
      if (!w) return
      tab.view.setAutoResize({ width: false, height: false })
      const { width, height } = w.getBounds()
      tab.view.setBounds({ x: 0, y: 0, width, height })
      w.webContents.send('browser:fullscreen', true)
    } else if (channel === 'view:fullscreenLeave') {
      if (!w) return
      tab.view.setBounds(getTabBounds(w))
      tab.view.setAutoResize({ width: true, height: true })
      w.webContents.send('browser:fullscreen', false)
    } else if (channel === 'pip:opened') {
      w?.webContents.send('pip:opened', args[0] ?? '')
    } else if (channel === 'pip:closed') {
      w?.webContents.send('pip:closed')
    } else if (channel === 'window:focusMain') {
      if (w) { if (w.isMinimized()) w.restore(); w.focus(); w.moveTop() }
    }
  })

  // HTML5 video fullscreen — expand BrowserView to cover entire window
  // (kept as belt-and-suspenders alongside the preload ipc-message approach above)
  wc.on('enter-html-full-screen', () => {
    const { width: w, height: h } = win.getBounds()
    tab.view.setAutoResize({ width: false, height: false })
    tab.view.setBounds({ x: 0, y: 0, width: w, height: h })
    win.webContents.send('browser:fullscreen', true)
    // Re-apply after a short delay in case Chromium layout raced the setBounds call
    setTimeout(() => {
      if (!win.isDestroyed() && !tab.view.webContents.isDestroyed()) {
        const { width: w2, height: h2 } = win.getBounds()
        tab.view.setBounds({ x: 0, y: 0, width: w2, height: h2 })
      }
    }, 150)
    // Inject a brief "Press Esc to exit fullscreen" hint into the page
    wc.executeJavaScript(`
      ;(function(){
        let el = document.getElementById('__dhurta_fs_hint')
        if (el) { el.style.opacity='1'; setTimeout(()=>{ el.style.opacity='0' }, 3000); return }
        el = document.createElement('div')
        el.id = '__dhurta_fs_hint'
        el.style.cssText = 'position:fixed;top:10px;right:12px;z-index:2147483647;background:rgba(0,0,0,.7);color:#fff;font:11px/26px Consolas,monospace;padding:0 12px;border-radius:3px;opacity:1;transition:opacity .6s;pointer-events:auto;cursor:pointer;'
        el.textContent = '✕  Press Esc or F11 to exit fullscreen'
        el.onclick = () => document.exitFullscreen && document.exitFullscreen()
        document.body && document.body.appendChild(el)
        setTimeout(() => { el.style.opacity = '0' }, 3000)
      })()
    `).catch(() => {})
  })

  wc.on('leave-html-full-screen', () => {
    tab.view.setBounds(getTabBounds(win))
    tab.view.setAutoResize({ width: true, height: true })
    win.webContents.send('browser:fullscreen', false)
    // Remove hint if still visible
    wc.executeJavaScript(`const h=document.getElementById('__dhurta_fs_hint');if(h)h.remove()`).catch(()=>{})
  })

  // Right-click context menu — native OS menu that renders above the BrowserView
  wc.on('context-menu', (_e, params) => {
    const win = getMainWindow()
    if (!win) return

    const items: Electron.MenuItemConstructorOptions[] = []

    // Navigation
    items.push({ label: 'Back',    enabled: wc.canGoBack(),    click: () => wc.goBack() })
    items.push({ label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() })
    items.push({ label: 'Reload',  click: () => wc.reload() })
    items.push({ type: 'separator' })

    // Link actions
    if (params.linkURL) {
      items.push({ label: 'Open Link in New Tab', click: () => win.webContents.send('context-menu:action', { action: 'openInNewTab', url: params.linkURL, ghost: tab.ghost }) })
      items.push({ label: 'Copy Link Address',    click: () => clipboard.writeText(params.linkURL) })
      items.push({ type: 'separator' })
    }

    // Image actions
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: 'Open Image in New Tab', click: () => win.webContents.send('context-menu:action', { action: 'openInNewTab', url: params.srcURL, ghost: tab.ghost }) })
      items.push({ label: 'Copy Image Address',    click: () => clipboard.writeText(params.srcURL) })
      items.push({ label: 'Save Image As…',        click: () => wc.downloadURL(params.srcURL) })
      items.push({ type: 'separator' })
    }

    // Text / clipboard
    if (params.selectionText) {
      items.push({ label: 'Copy', click: () => wc.copy() })
      items.push({
        label: `Search for "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '…' : ''}"`,
        click: () => {
          const url = getSearchUrl(params.selectionText)
          win.webContents.send('context-menu:action', { action: 'openInNewTab', url, ghost: tab.ghost })
        },
      })
      items.push({ type: 'separator' })
    }

    if (params.isEditable) {
      if (params.editFlags.canCut)   items.push({ label: 'Cut',        click: () => wc.cut() })
      if (params.editFlags.canCopy)  items.push({ label: 'Copy',       click: () => wc.copy() })
      if (params.editFlags.canPaste) items.push({ label: 'Paste',      click: () => wc.paste() })
      items.push({ label: 'Paste and Match Style', click: () => wc.pasteAndMatchStyle() })
      items.push({ label: 'Select All',            click: () => wc.selectAll() })
      items.push({ type: 'separator' })
    }

    // Page actions
    items.push({
      label: 'Save Page As…',
      click: () => wc.savePage(
        path.join(app.getPath('downloads'), (wc.getTitle() || 'page') + '.html'),
        'HTMLComplete'
      ).catch(() => {}),
    })
    items.push({ label: 'Print…',           click: () => wc.print() })
    items.push({ label: 'View Page Source',  click: () => win.webContents.send('context-menu:action', { action: 'openInNewTab', url: 'view-source:' + wc.getURL(), ghost: tab.ghost }) })
    items.push({ type: 'separator' })
    items.push({ label: 'Inspect Element',   click: () => wc.inspectElement(params.x, params.y) })
    items.push({
      label: 'Add to Bookmarks',
      click: () => {
        const url = wc.getURL()
        const title = wc.getTitle()
        if (url && !isNewTabUrl(url)) {
          try {
            getDb().prepare('INSERT OR IGNORE INTO bookmarks (url, title, favicon) VALUES (?, ?, ?)').run(url, title, '')
            win.webContents.send('context-menu:action', { action: 'bookmarkAdded' })
          } catch (_) {}
        }
      },
    })

    Menu.buildFromTemplate(items).popup({ window: win })
  })

  // API Interceptor
  wc.session.webRequest.onSendHeaders(
    { urls: ['*://*/*'] },
    (details) => {
      const entry: RequestEntry = {
        id: String(details.id),
        method: details.method,
        url: details.url,
        type: details.resourceType,
        timestamp: Date.now(),
      }
      tab.requests.push(entry)
      if (tab.requests.length > 500) tab.requests.shift()
      if (!win.webContents.isDestroyed()) {
        win.webContents.send('interceptor:request', { tabId: tab.id, entry })
      }
    }
  )
}

// When a tab has no more back history, "going back" returns to the home page
// by resetting the tab URL and hiding the BrowserView so the React NewTabPage shows.
function goBackOrHome(wc: Electron.WebContents, tabId: number) {
  if (wc.canGoBack()) {
    wc.goBack()
    return
  }
  const tab = tabs.get(tabId)
  if (!tab || isNewTabUrl(tab.url)) return
  tab.url = ''
  tab.title = 'New Tab'
  const win = getMainWindow()
  if (win) {
    win.removeBrowserView(tab.view)
    win.webContents.send('tab:loadStop', { id: tabId, url: '', title: 'New Tab' })
  }
}

function showTab(id: number) {
  const win = getMainWindow()
  if (!win) return

  for (const [, t] of tabs) {
    win.removeBrowserView(t.view)
  }

  const tab = tabs.get(id)
  if (!tab) return

  activeTabId = id

  if (!isNewTabUrl(tab.url)) {
    win.addBrowserView(tab.view)
    tab.view.setBounds(getTabBounds(win))
    tab.view.setAutoResize({ width: true, height: true })
  }
}

const POPOUT_BAR_HEIGHT = 36

function openPopoutWindow(url: string) {
  // If window already open, just navigate it to the new URL
  if (popoutWin && !popoutWin.isDestroyed()) {
    popoutView?.webContents.loadURL(url)
    popoutWin.focus()
    return
  }

  popoutWin = new BrowserWindow({
    width: 480,
    height: 340,
    minWidth: 300,
    minHeight: 180,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    movable: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#141414',
    webPreferences: {
      preload: path.join(__dirname, 'popoutPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  popoutWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(POPOUT_CHROME_HTML)}`)

  // Content BrowserView — shares the same session as normal tabs
  popoutView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'webviewPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:default',
    },
  })

  popoutWin.addBrowserView(popoutView)

  const resizeContent = () => {
    if (!popoutWin || popoutWin.isDestroyed() || !popoutView) return
    const [w, h] = popoutWin.getContentSize()
    popoutView!.setBounds({ x: 0, y: POPOUT_BAR_HEIGHT, width: w, height: Math.max(0, h - POPOUT_BAR_HEIGHT) })
  }

  popoutView.setAutoResize({ width: true, height: true })
  resizeContent()
  popoutWin.on('resize', resizeContent)
  popoutWin.on('maximize',   () => popoutWin?.webContents.send('pip:maximizeState', true))
  popoutWin.on('unmaximize', () => popoutWin?.webContents.send('pip:maximizeState', false))

  popoutView.webContents.loadURL(url)

  const sendNavState = () => {
    if (!popoutView || popoutWin?.isDestroyed()) return
    popoutWin?.webContents.send('pip:navState', {
      canGoBack: popoutView.webContents.canGoBack(),
      canGoForward: popoutView.webContents.canGoForward(),
    })
  }

  // Forward URL / title / nav-state changes to the chrome bar
  popoutView.webContents.on('did-navigate', (_e, navUrl) => {
    popoutWin?.webContents.send('pip:urlChanged', navUrl)
    sendNavState()
  })
  popoutView.webContents.on('did-navigate-in-page', () => sendNavState())
  popoutView.webContents.on('page-title-updated', (_e, title) => {
    popoutWin?.webContents.send('pip:titleChanged', title)
  })

  popoutWin.on('closed', () => {
    popoutWin = null
    popoutView = null
    // Closing the pop-out (✕ button, Alt+F4, etc.) should also bring the main
    // browser window forward — matches the video PiP's "close also refocuses
    // the browser" behavior for a consistent "back to browser" experience.
    const mainWin = getMainWindow()
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
      mainWin.moveTop()
    }
  })
}

async function applyProxyToAllSessions(proxyRules: string) {
  const config = { proxyRules }
  await Promise.all([
    session.defaultSession.setProxy(config),
    session.fromPartition('persist:default').setProxy(config),
    ...[...tabs.values()].filter(t => !t.ghost && !t.view.webContents.isDestroyed()).map(t => t.view.webContents.session.setProxy(config)),
  ])
}

function getDownloadDir(): string {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('downloadPath') as any
    if (row?.value && fs.existsSync(row.value)) return row.value
  } catch (_) {}
  return app.getPath('downloads')
}

// Module-level download handler — shared by all sessions (regular + ghost).
// Window is resolved lazily at event-fire time so this works before createWindow().
function _handleWillDownload(_event: Electron.Event, item: DownloadItem) {
  const win = getMainWindow()
  if (!win) return

  // Auto-save to configured download folder (user-settable, defaults to ~/Downloads).
  // Without setSavePath(), Electron shows a native dialog hidden behind BrowserView.
  const downloadDir  = getDownloadDir()
  const baseFilename = item.getFilename() || 'download'
  let savePath = path.join(downloadDir, baseFilename)
  if (fs.existsSync(savePath)) {
    const ext  = path.extname(baseFilename)
    const base = path.basename(baseFilename, ext)
    let n = 1
    do { savePath = path.join(downloadDir, `${base} (${n++})${ext}`) }
    while (fs.existsSync(savePath))
  }
  item.setSavePath(savePath)

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const record: DownloadRecord = {
    id,
    filename: path.basename(savePath),
    url: item.getURL(),
    savePath,
    totalBytes: item.getTotalBytes(),
    receivedBytes: 0,
    percent: 0,
    state: 'progressing',
    startTime: Date.now(),
  }
  downloads.set(id, record)
  downloadItems.set(id, item)
  win.webContents.send('download:start', { ...record })
  // Mirror to the download popup if it's open
  if (_downloadPopupWin && !_downloadPopupWin.isDestroyed()) {
    _downloadPopupWin.webContents.send('download:start', { ...record })
  }

  item.on('updated', (_e, state) => {
    const w = getMainWindow()
    if (!w) return
    // Distinguish genuinely interrupted from user-paused (both fire as 'interrupted')
    const isPaused = state === 'interrupted' && item.isPaused()
    record.state         = isPaused ? 'paused' : state as 'progressing' | 'interrupted'
    record.receivedBytes = item.getReceivedBytes()
    record.totalBytes    = item.getTotalBytes()
    record.percent       = record.totalBytes > 0
      ? Math.round((record.receivedBytes / record.totalBytes) * 100)
      : -1

    // Speed calculation — exponential moving average (α=0.3) for smoothness
    if (record.state === 'progressing') {
      const now      = Date.now()
      const lastMs   = _dlLastMs.get(id)
      const lastBytes = _dlLastBytes.get(id)
      if (lastMs !== undefined && lastBytes !== undefined) {
        const dt = (now - lastMs) / 1000   // seconds
        if (dt > 0.05) {                   // skip if < 50 ms (no meaningful delta)
          const instant = (record.receivedBytes - lastBytes) / dt
          record.speed  = record.speed !== undefined
            ? 0.3 * instant + 0.7 * record.speed
            : instant
        }
      }
      _dlLastMs.set(id, now)
      _dlLastBytes.set(id, record.receivedBytes)
    } else {
      record.speed = 0
    }

    const upd = {
      id,
      receivedBytes: record.receivedBytes,
      totalBytes:    record.totalBytes,
      state:         record.state,
      percent:       record.percent,
      speed:         record.speed ?? 0,
    }
    w.webContents.send('download:update', upd)
    if (_downloadPopupWin && !_downloadPopupWin.isDestroyed()) {
      _downloadPopupWin.webContents.send('download:update', upd)
    }
  })

  item.once('done', (_e, state) => {
    const w = getMainWindow()
    downloadItems.delete(id)
    _dlLastMs.delete(id)
    _dlLastBytes.delete(id)
    record.state         = state as 'completed' | 'cancelled' | 'interrupted'
    record.savePath      = item.getSavePath()
    record.receivedBytes = item.getReceivedBytes()
    record.percent       = state === 'completed' ? 100 : record.percent
    const done = { id, savePath: record.savePath, state: record.state, percent: record.percent }
    w?.webContents.send('download:done', done)
    if (_downloadPopupWin && !_downloadPopupWin.isDestroyed()) {
      _downloadPopupWin.webContents.send('download:done', done)
    }
  })
}

// Track a session's downloads. Safe to call multiple times with the same session —
// Electron deduplicates event listeners by reference, and _handleWillDownload is a
// stable module-level function, so re-registering is a no-op.
function attachDownloadSession(sess: Electron.Session) {
  sess.on('will-download', _handleWillDownload)
}

// Called unconditionally at registerIpcHandlers() time (BEFORE createWindow).
// The handler resolves getMainWindow() lazily, so no win reference is needed here.
function setupDownloadTracking() {
  attachDownloadSession(session.defaultSession)
  attachDownloadSession(session.fromPartition('persist:default'))
}

export function saveSession() {
  try {
    const tabsToSave = [...tabs.values()]
      .filter((t) => !t.ghost && !isNewTabUrl(t.url))
      .map((t) => ({ url: t.url, title: t.title }))
    getDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('sessionTabs', JSON.stringify(tabsToSave))
  } catch (e) {
    console.error('[Dhurta] Failed to save session:', e)
  }
}

export function registerIpcHandlers() {
  // All security features are STRICTLY off by default — never activate until the user explicitly enables them.
  // INSERT OR IGNORE seeds false rows on first run without overwriting any value the user has set.
  const SECURITY_DEFAULTS: [string, string][] = [
    ['security_autoClean',       'false'],
    ['security_antiFingerprint', 'false'],
    ['security_blockWebRTC',     'false'],
    ['security_ipRotation',      'false'],
    ['security_cookieGuard',     'false'],
    ['security_adBlocker',       'false'],
  ]
  for (const [key, val] of SECURITY_DEFAULTS) {
    getDb().prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, val)
  }

  // Restore persisted warmth level so the setting survives restarts
  const _wRow = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('display_warmth') as any
  if (_wRow?.value) warmthLevel = Math.max(0, Math.min(100, Number(_wRow.value) || 0))

  // Screen warmth — reduces blue light / eye strain by applying sepia+brightness to all pages
  ipcMain.handle('display:setWarmth', (_e, level: number) => {
    warmthLevel = Math.max(0, Math.min(100, Math.round(level)))
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('display_warmth', String(warmthLevel))
    for (const [, tab] of tabs) {
      applyWarmthToWebContents(tab.view.webContents)
    }
  })
  ipcMain.handle('display:getWarmth', () => warmthLevel)

  // Window controls
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('window:close', () => getMainWindow()?.close())
  ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized())
  ipcMain.handle('window:getPos', () => getMainWindow()?.getPosition() ?? [0, 0])

  // ── Native popup windows for Download tray and Warmth slider ─────────────
  // BrowserView is a native OS layer above React HTML; the only way to show a
  // popup above it is a child BrowserWindow (same technique Chrome uses for
  // extension popups). The renderer sends button screen coordinates so we
  // position the popup directly below the clicked button.

  ipcMain.handle('popup:showDownloads', (_e, pos: { x: number; y: number }) => {
    const win = getMainWindow()
    if (!win) return
    if (_downloadPopupWin && !_downloadPopupWin.isDestroyed()) {
      _downloadPopupWin.close()
      return
    }
    _downloadPopupWin = _createPopup(
      win, path.join(__dirname, 'downloadPopup.html'), 320, 420, pos.x, pos.y
    )
    _downloadPopupWin.on('closed', () => { _downloadPopupWin = null })
    _downloadPopupWin.webContents.once('did-finish-load', () => {
      if (!_downloadPopupWin || _downloadPopupWin.isDestroyed()) return
      const list = [...downloads.values()].sort((a, b) => b.startTime - a.startTime).slice(0, 20)
      _downloadPopupWin.webContents.send('downloads:data', list)
    })
  })

  ipcMain.handle('popup:showWarmth', (_e, pos: { x: number; y: number }) => {
    const win = getMainWindow()
    if (!win) return
    if (_warmthPopupWin && !_warmthPopupWin.isDestroyed()) {
      _warmthPopupWin.close()
      return
    }
    _warmthPopupWin = _createPopup(
      win, path.join(__dirname, 'warmthPopup.html'), 260, 100, pos.x, pos.y
    )
    _warmthPopupWin.on('closed', () => { _warmthPopupWin = null })
    _warmthPopupWin.webContents.once('did-finish-load', () => {
      if (!_warmthPopupWin || _warmthPopupWin.isDestroyed()) return
      _warmthPopupWin.webContents.send('warmth:value', warmthLevel)
    })
  })

  // Close the popup that sent this request (used by popup's own "Close" button)
  ipcMain.handle('popup:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  // "View all downloads" in the download popup navigates the main window
  ipcMain.handle('popup:navigateMain', async (_e, url: string) => {
    const win = getMainWindow()
    if (!win || !url) return
    // Handle dhurta-tool:// protocol — routes to local tool projects
    if (url.startsWith('dhurta-tool://')) {
      const toolId = url.replace('dhurta-tool://', '')
      const resolved = await resolveToolUrl(toolId)
      if (resolved) win.webContents.send('menu:action', { action: 'navigate', url: resolved })
      return
    }
    win.webContents.send('menu:action', { action: 'navigate', url })
  })

  // Apps popup — native BrowserWindow positioned beside the sidebar button (like download popup)
  ipcMain.handle('popup:showApps', (_e, pos: { x: number; y: number }) => {
    const win = getMainWindow()
    if (!win) return
    if (_appsPopupWin && !_appsPopupWin.isDestroyed()) {
      _appsPopupWin.close()
      _appsPopupWin = null
      return
    }
    _appsPopupWin = _createPopup(win, path.join(__dirname, 'appsPopup.html'), 248, 300, pos.x, pos.y)
    _appsPopupWin.on('closed', () => { _appsPopupWin = null })
  })

  // Tools popup — native BrowserWindow for Dhurta ecosystem tools
  ipcMain.handle('popup:showTools', (_e, pos: { x: number; y: number }) => {
    const win = getMainWindow()
    if (!win) return
    if (_toolsPopupWin && !_toolsPopupWin.isDestroyed()) {
      _toolsPopupWin.close()
      _toolsPopupWin = null
      return
    }
    _toolsPopupWin = _createPopup(win, path.join(__dirname, 'toolsPopup.html'), 280, 380, pos.x, pos.y)
    _toolsPopupWin.on('closed', () => { _toolsPopupWin = null })
  })

  // Tools dispatcher — opens the selected tool in the appropriate context
  ipcMain.handle('tools:open', async (_e, toolId: string) => {
    const win = getMainWindow()
    if (!win) return
    switch (toolId) {
      case 'setu':
      case 'connect': {
        const resolved = await resolveToolUrl(toolId)
        if (resolved) win.webContents.send('menu:action', { action: 'navigate', url: resolved })
        break
      }
      case 'developer': {
        const tab = tabs.get(activeTabId)
        if (tab) tab.view.webContents.toggleDevTools()
        break
      }
      case 'omni':
        win.webContents.send('menu:action', { action: 'navigate', url: 'dhurta://omni' })
        break
      case 'bridge':
        win.webContents.send('menu:action', { action: 'panel', panel: 'connect' })
        break
    }
  })

  // Read saved apps from settings DB for the apps popup
  ipcMain.handle('popup:getApps', () => {
    try {
      const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('dhurtaApps') as { value: string } | undefined
      if (row?.value) return JSON.parse(row.value)
    } catch (_) {}
    return []
  })

  // Dhurta Apps favicons — fetched once and cached as base64 data URLs in the
  // settings DB (keyed by source URL) so the apps grid renders correctly even
  // fully offline, instead of re-fetching a remote favicon.ico every time.
  ipcMain.handle('apps:getIconDataUrl', async (_e, url: string) => {
    if (!url || url.startsWith('data:')) return url
    try {
      const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('dhurtaAppIconCache') as { value: string } | undefined
      const cache: Record<string, string> = row?.value ? JSON.parse(row.value) : {}
      if (cache[url]) return cache[url]

      const resp = await net.fetch(url, { signal: AbortSignal.timeout(6000) } as any)
      if (!resp.ok) return null
      const contentType = resp.headers.get('content-type') || 'image/x-icon'
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length === 0 || buf.length > 2_000_000) return null
      const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`

      cache[url] = dataUrl
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('dhurtaAppIconCache', JSON.stringify(cache))
      return dataUrl
    } catch (_) {
      return null
    }
  })

  // Focus the main browser window — called by PiP "back to browser" button via preload IPC relay
  ipcMain.handle('window:focusMain', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    win.moveTop()
  })

  // Close PiP from the tab-bar chip — executes JS in the active BrowserView
  ipcMain.handle('pip:close', () => {
    const tab = tabs.get(activeTabId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.view.webContents.executeJavaScript(`
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function(){})
      }
    `).catch(() => {})
  })

  // Tab management
  ipcMain.handle('tab:create', async (_e, url?: string, ghost = false) => {
    const id = tabIdCounter++
    // Await so the session's proxy (Tor for ghost, VPN/direct otherwise) is
    // fully applied before anything below can navigate — see createBrowserView.
    const view = await createBrowserView(ghost)
    const tab: Tab = {
      id,
      view,
      url: url || 'dhurta://newtab',
      title: ghost ? 'Ghost Tab' : 'New Tab',
      favicon: '',
      loading: false,
      ghost,
      jsDisabled: false,
      requests: [],
    }
    tabs.set(id, tab)
    attachViewEvents(tab)
    // Ghost tabs use a unique per-tab session not covered by setupDownloadTracking.
    // Register the download handler on it now so ghost downloads auto-save too.
    if (ghost) attachDownloadSession(view.webContents.session)
    showTab(id)
    if (url) view.webContents.loadURL(url)
    return { id, url: tab.url, title: tab.title, ghost }
  })

  ipcMain.handle('tab:close', async (_e, id: number) => {
    const tab = tabs.get(id)
    if (!tab) return
    const win = getMainWindow()
    if (win) win.removeBrowserView(tab.view)

    // Ghost tabs use an in-memory partition that never persists to disk, but we
    // explicitly clear all storage and cache on close to free RAM immediately and
    // ensure nothing lingers between sessions even within the same app run.
    if (tab.ghost) {
      try {
        await tab.view.webContents.session.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
        })
        await tab.view.webContents.session.clearCache()
      } catch (_) {}
    } else if (getSecurityFlag('security_autoClean')) {
      try {
        await tab.view.webContents.session.clearStorageData()
        await tab.view.webContents.session.clearCache()
      } catch (_) {}
    }

    ;(tab.view.webContents as any).close?.()
    tabs.delete(id)

    if (activeTabId === id) {
      const remaining = [...tabs.keys()]
      if (remaining.length > 0) showTab(remaining[remaining.length - 1])
      else activeTabId = -1
    }
    return true
  })

  ipcMain.handle('tab:switch', (_e, id: number) => {
    showTab(id)
    return true
  })

  ipcMain.handle('tab:getAll', () => {
    return [...tabs.values()].map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      loading: t.loading,
      ghost: t.ghost,
      active: t.id === activeTabId,
    }))
  })

  // Navigation
  ipcMain.handle('nav:loadURL', async (_e, url: string) => {
    const tab = tabs.get(activeTabId)
    if (!tab) return
    // Block javascript: protocol to prevent XSS injection via the URL bar
    if (!url || url.trim().toLowerCase().startsWith('javascript:')) return
    // dhurta-tool:// protocol — resolve to local project files
    if (url.startsWith('dhurta-tool://')) {
      const toolId = url.replace('dhurta-tool://', '')
      const resolved = await resolveToolUrl(toolId)
      if (!resolved) return
      tab.url = resolved
      const win = getMainWindow()
      if (win) {
        for (const [, t] of tabs) win.removeBrowserView(t.view)
        win.addBrowserView(tab.view)
        tab.view.setBounds(getTabBounds(win))
        tab.view.setAutoResize({ width: true, height: true })
      }
      tab.view.webContents.loadURL(resolved)
      return
    }
    let resolved = url
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('dhurta://') &&
      !url.startsWith('file://')
    ) {
      if (url.includes('.') && !url.includes(' ')) {
        resolved = 'https://' + url
      } else {
        resolved = getSearchUrl(url)
      }
    }
    // dhurta:// internal pages render in React — hide BrowserView, don't loadURL.
    if (DHURTA_INTERNAL_PAGES.has(resolved)) {
      tab.url = resolved
      const isHistory   = resolved === 'dhurta://history'
      const isDownloads = resolved === 'dhurta://downloads'
      const isBookmarks = resolved === 'dhurta://bookmarks'
      const isOmni      = resolved === 'dhurta://omni'
      tab.title = isHistory ? 'History' : isDownloads ? 'Downloads' : isBookmarks ? 'Bookmarks' : isOmni ? 'Dhurta Omni — Privacy' : 'New Tab'
      // SVG favicons for internal pages so tabs show a recognizable icon
      const svgFavicon = (svg: string) =>
        `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
      tab.favicon = isHistory
        ? svgFavicon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#FF4500" stroke-width="1.5"/><path d="M8 4.5v3.5l2.5 1.5" stroke="#FF4500" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>')
        : isDownloads
        ? svgFavicon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><line x1="8" y1="2" x2="8" y2="11" stroke="#FF4500" stroke-width="1.5" stroke-linecap="round"/><polyline points="4.5,7.5 8,11.5 11.5,7.5" stroke="#FF4500" stroke-width="1.5" stroke-linecap="round" fill="none"/><line x1="2" y1="14" x2="14" y2="14" stroke="#FF4500" stroke-width="1.5" stroke-linecap="round"/></svg>')
        : isBookmarks
        ? svgFavicon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3 2h10v12l-5-3-5 3V2z" fill="none" stroke="#FF4500" stroke-width="1.5" stroke-linejoin="round"/></svg>')
        : isOmni
        ? svgFavicon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1.5L2 4v4c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V4L8 1.5z" fill="none" stroke="#FF4500" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="7.5" r="1.6" fill="#FF4500"/></svg>')
        : ''
      tab.loading = false
      const win = getMainWindow()
      if (win) for (const [, t] of tabs) win.removeBrowserView(t.view)
      getMainWindow()?.webContents.send('tab:updated', {
        id: activeTabId, url: tab.url, title: tab.title,
        loading: false, favicon: tab.favicon, ghost: tab.ghost, active: true,
      })
      return
    }

    tab.url = resolved

    const win = getMainWindow()
    if (win) {
      for (const [, t] of tabs) win.removeBrowserView(t.view)
      win.addBrowserView(tab.view)
      tab.view.setBounds(getTabBounds(win))
      tab.view.setAutoResize({ width: true, height: true })
    }

    tab.view.webContents.loadURL(resolved)
  })

  ipcMain.handle('nav:goBack', (_e, id: number) => {
    const tab = tabs.get(id)
    if (!tab) return
    goBackOrHome(tab.view.webContents, id)
  })
  ipcMain.handle('nav:goForward', (_e, id: number) => {
    tabs.get(id)?.view.webContents.goForward()
  })
  ipcMain.handle('nav:reload', (_e, id: number) => {
    tabs.get(id)?.view.webContents.reload()
  })
  ipcMain.handle('nav:stop', (_e, id: number) => {
    tabs.get(id)?.view.webContents.stop()
  })

  // Ghost mode — boots the bundled Tor binary so ghost tabs route through the
  // real Tor network. If Tor fails to bootstrap (no internet, blocked, etc.)
  // Ghost Mode still activates with fingerprint spoofing + WebRTC block, but
  // without Tor routing — the renderer is told so it can warn the user.
  ipcMain.handle('ghost:enable', async () => {
    ghostEnabled = true
    try {
      await startTor()
      return { tor: true }
    } catch (e) {
      console.error('[Dhurta] Tor failed to start:', e)
      return { tor: false }
    }
  })
  ipcMain.handle('ghost:disable', () => { ghostEnabled = false })
  ipcMain.handle('ghost:state', () => ghostEnabled)
  ipcMain.handle('ghost:torStatus', () => isTorReady())

  // Set Tor exit-node country (ISO 3166-1 alpha-2 or null for any country).
  // If Tor is already running, restarts it so the new ExitNodes torrc line takes effect.
  ipcMain.handle('ghost:setExitNode', async (_e, country: string | null) => {
    setExitNodeCountry(country)
    if (!isTorReady()) return { success: true, restarted: false }
    stopTor()
    try {
      await startTor()
      // Re-apply proxy to all open ghost sessions (same SOCKS port, but fresh circuit)
      for (const [, tab] of tabs) {
        if (tab.ghost) {
          tab.view.webContents.session
            .setProxy({ proxyRules: getTorProxyRules(), proxyBypassRules: '' })
            .catch(() => {})
        }
      }
      return { success: true, restarted: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // Zoom
  ipcMain.handle('zoom:in', (_e, tabId: number) => {
    const wc = tabs.get(tabId)?.view.webContents
    if (!wc) return 1
    const next = Math.min(3, Math.round((wc.getZoomFactor() + 0.1) * 10) / 10)
    wc.setZoomFactor(next)
    return next
  })
  ipcMain.handle('zoom:out', (_e, tabId: number) => {
    const wc = tabs.get(tabId)?.view.webContents
    if (!wc) return 1
    const next = Math.max(0.3, Math.round((wc.getZoomFactor() - 0.1) * 10) / 10)
    wc.setZoomFactor(next)
    return next
  })
  ipcMain.handle('zoom:reset', (_e, tabId: number) => {
    const wc = tabs.get(tabId)?.view.webContents
    if (!wc) return 1
    wc.setZoomFactor(1)
    return 1
  })
  ipcMain.handle('zoom:get', (_e, tabId: number) => {
    return tabs.get(tabId)?.view.webContents.getZoomFactor() ?? 1
  })
  // Ctrl+Scroll from renderer chrome area
  ipcMain.handle('zoom:step', (_e, tabId: number, direction: 'in' | 'out') => {
    const wc = tabs.get(tabId)?.view.webContents
    if (!wc) return 1
    const delta = direction === 'in' ? 0.1 : -0.1
    const next = Math.max(0.3, Math.min(3, Math.round((wc.getZoomFactor() + delta) * 10) / 10))
    wc.setZoomFactor(next)
    return next
  })
  // Set an exact zoom factor — used to default internal dhurta:// pages to 200%
  ipcMain.handle('zoom:set', (_e, tabId: number, level: number) => {
    const wc = tabs.get(tabId)?.view.webContents
    if (!wc) return 1
    const clamped = Math.max(0.3, Math.min(3, level))
    wc.setZoomFactor(clamped)
    return clamped
  })

  // Privacy
  ipcMain.handle('privacy:nukeJS', (_e, tabId: number) => {
    const tab = tabs.get(tabId)
    if (!tab) return
    tab.jsDisabled = !tab.jsDisabled
    tab.view.webContents.session.setPermissionRequestHandler(
      (_wc, perm, cb) => {
        if (tab.jsDisabled && perm === 'geolocation') cb(false)
        else cb(true)
      }
    )
    tab.view.webContents.executeJavaScript(
      tab.jsDisabled
        ? `document.querySelectorAll('script').forEach(s=>s.remove())`
        : ''
    )
    return tab.jsDisabled
  })

  ipcMain.handle('privacy:clearCookies', async () => {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  })

  ipcMain.handle('privacy:nuclearWipe', async () => {
    const win = getMainWindow()
    for (const [, t] of tabs) {
      if (win) win.removeBrowserView(t.view)
      ;(t.view.webContents as any).close?.()
    }
    tabs.clear()
    await session.defaultSession.clearStorageData()
    await session.defaultSession.clearCache()
    nukeDatabase()
    app.exit(0)
  })

  // File open dialog
  ipcMain.handle('file:open', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'All Supported Files', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'ogg', 'flac', 'html', 'htm'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac'] },
        { name: 'Web', extensions: ['html', 'htm'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return 'file:///' + result.filePaths[0].replace(/\\/g, '/')
  })

  // History
  ipcMain.handle('history:add', (_e, entry: { url: string; title: string; favicon?: string }) => {
    getDb()
      .prepare('INSERT INTO history (url, title, favicon) VALUES (?, ?, ?)')
      .run(entry.url, entry.title, entry.favicon ?? '')
  })

  ipcMain.handle('history:get', (_e, query?: string, limit = 200) => {
    if (query) {
      return getDb()
        .prepare('SELECT * FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT ?')
        .all(`%${query}%`, `%${query}%`, limit)
    }
    return getDb()
      .prepare('SELECT * FROM history ORDER BY visited_at DESC LIMIT ?')
      .all(limit)
  })

  ipcMain.handle('history:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM history WHERE id = ?').run(id)
  })

  ipcMain.handle('history:setIncinerate', (_e, days: number) => {
    getDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('incinerateDays', String(days))
    runIncinerate()
  })

  // Bookmarks
  ipcMain.handle('bookmark:add', (_e, b: { url: string; title: string; favicon?: string }) => {
    getDb()
      .prepare('INSERT OR IGNORE INTO bookmarks (url, title, favicon) VALUES (?, ?, ?)')
      .run(b.url, b.title, b.favicon ?? '')
  })
  ipcMain.handle('bookmark:getAll', () => {
    return getDb().prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all()
  })
  ipcMain.handle('bookmark:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  })
  ipcMain.handle('bookmark:reorder', (_e, orderedIds: number[]) => {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('bookmarkOrder', JSON.stringify(orderedIds))
  })
  ipcMain.handle('bookmark:getOrder', () => {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('bookmarkOrder') as { value: string } | undefined
    try { return JSON.parse(row?.value ?? '[]') } catch { return [] }
  })

  // Settings
  ipcMain.handle('settings:get', (_e, key: string) => {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value
  })
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value)
    // Keep gesture caches in sync so input-event handlers don't need to hit the DB
    if (key === 'gesturePinchZoom') gesturePinchZoom = value !== 'false'
    if (key === 'gestureSwipe')     gestureSwipe     = value !== 'false'
  })

  // API Interceptor
  ipcMain.handle('interceptor:getRequests', (_e, tabId: number) => {
    return tabs.get(tabId)?.requests ?? []
  })

  // Security settings
  ipcMain.handle('security:getSettings', () => ({
    ipRotation: getSecurityFlag('security_ipRotation'),
    antiFingerprint: getSecurityFlag('security_antiFingerprint'),
    blockWebRTC: getSecurityFlag('security_blockWebRTC'),
    autoClean: getSecurityFlag('security_autoClean'),
  }))

  ipcMain.handle('security:setIPRotation', async (_e, enabled: boolean) => {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_ipRotation', String(enabled))
    if (enabled) {
      const proxy = await fetchFreeProxy()
      if (proxy) {
        await applyProxyToAllSessions(`socks5://${proxy}`)
        getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', proxy)
        return { success: true, proxy }
      }
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_ipRotation', 'false')
      return { success: false, error: 'No proxies found. Try again in a moment.' }
    } else {
      await applyProxyToAllSessions('direct://')
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', '')
      return { success: true }
    }
  })

  ipcMain.handle('security:rotateProxy', async () => {
    const proxy = await fetchFreeProxy()
    if (proxy) {
      await applyProxyToAllSessions(`socks5://${proxy}`)
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', proxy)
      return { success: true, proxy }
    }
    return { success: false, error: 'No proxies found. Try again in a moment.' }
  })

  ipcMain.handle('security:setAntiFingerprint', (_e, enabled: boolean) => {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_antiFingerprint', String(enabled))
  })
  ipcMain.handle('security:setBlockWebRTC', (_e, enabled: boolean) => {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_blockWebRTC', String(enabled))
  })
  ipcMain.handle('security:setAutoClean', (_e, enabled: boolean) => {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_autoClean', String(enabled))
  })

  // Panel width sync
  ipcMain.handle('panel:setWidth', (_e, width: number) => {
    currentPanelWidth = width
    const win = getMainWindow()
    const tab = tabs.get(activeTabId)
    if (win && tab && !isNewTabUrl(tab.url)) {
      tab.view.setBounds(getTabBounds(win))
    }
  })

  // BrowserView conceal/reveal — used by React dropdowns (AppsGrid) so they can sit
  // ABOVE the BrowserView native layer while open. Instead of removing the BrowserView
  // (which shows the black #0A0A0A BrowserWindow background), we shrink it away from
  // the dropdown so most of the page remains visible:
  //  'right' = tab-bar apps button (dropdown on right) → trim width from right edge
  //  'left'  = sidebar apps button (dropdown on left)  → shift x right to expose left edge
  const DROPDOWN_SPACE = 296 // AppsGrid is w-[280px] + 16px safety margin
  ipcMain.handle('view:conceal', (_e, side: 'left' | 'right' = 'right') => {
    const win = getMainWindow()
    const tab = tabs.get(activeTabId)
    if (!win || !tab || isNewTabUrl(tab.url)) return
    const b = getTabBounds(win)
    tab.view.setAutoResize({ width: false, height: false })
    if (side === 'left') {
      // Sidebar: dropdown opens to the right of the 64px sidebar nav (x ≈ 66).
      // Shift BrowserView right so the dropdown area (x=66 to x≈346) is in HTML layer.
      const newX = b.x + DROPDOWN_SPACE
      tab.view.setBounds({ x: newX, y: b.y, width: Math.max(100, b.width - DROPDOWN_SPACE), height: b.height })
    } else {
      // Tab bar: dropdown is right-aligned at window right edge.
      // Trim BrowserView width from the right so right 296px is HTML layer.
      tab.view.setBounds({ x: b.x, y: b.y, width: Math.max(100, b.width - DROPDOWN_SPACE), height: b.height })
    }
  })
  ipcMain.handle('view:reveal', () => {
    const win = getMainWindow()
    const tab = tabs.get(activeTabId)
    if (!win || !tab || isNewTabUrl(tab.url)) return
    tab.view.setBounds(getTabBounds(win))
    tab.view.setAutoResize({ width: true, height: true })
  })

  // Native tab context menu — renders above BrowserViews via Menu.popup()
  // Actions are dispatched back to React via menu:action so the React state updates.
  ipcMain.handle('tab:showContextMenu', (_e, opts: { tabId: number; tabCount: number; x: number; y: number }) => {
    const win = getMainWindow()
    if (!win) return
    const send = (action: string, extra?: Record<string, unknown>) =>
      win.webContents.send('menu:action', { action, ...extra })
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: 'New Tab',       click: () => send('newTab') },
      { label: 'New Ghost Tab', click: () => send('newGhostTab') },
      { type: 'separator' },
      { label: 'Duplicate Tab',       click: () => send('duplicateTab') },
      { label: 'Bookmark This Tab',   click: () => send('bookmarkTab',   { tabId: opts.tabId }) },
      { type: 'separator' },
      { label: 'Close Tab',           click: () => send('closeTab',      { tabId: opts.tabId }) },
      ...(opts.tabCount > 1
        ? [{ label: 'Close Other Tabs', click: () => send('closeOtherTabs', { tabId: opts.tabId }) } as Electron.MenuItemConstructorOptions]
        : []),
    ]
    Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(opts.x), y: Math.round(opts.y) })
  })

  // App-level fullscreen (F11)
  ipcMain.handle('window:toggleFullscreen', () => {
    const win = getMainWindow()
    if (!win) return false
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    // Reposition BrowserView on both enter and leave so the view never overlaps
    // the React chrome (URL bar, tab bar, sidebar).  When entering fullscreen the
    // window dimensions change but setAutoResize only adjusts width/height, not
    // x/y — an explicit setBounds call keeps the view correctly anchored.
    const tab = tabs.get(activeTabId)
    if (tab && !isNewTabUrl(tab.url)) {
      // Delay slightly so win.getBounds() returns the post-transition size.
      setTimeout(() => {
        const w = getMainWindow()
        if (w && tab) tab.view.setBounds(getTabBounds(w))
      }, 80)
    }
    return next
  })

  // DevTools — open/close for active tab
  ipcMain.handle('devtools:toggle', (_e, mode: 'detach' | 'right' | 'bottom' = 'detach') => {
    const tab = tabs.get(activeTabId)
    if (!tab) return
    const wc = tab.view.webContents
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode })
  })

  // Duplicate tab
  ipcMain.handle('tab:duplicate', async () => {
    const tab = tabs.get(activeTabId)
    if (!tab) return null
    const id = tabIdCounter++
    // Await — this handler immediately loadURL()s the SAME real page the
    // original tab was on, with zero delay. Without waiting for the new
    // session's proxy to actually be applied first, duplicating a Ghost tab
    // would fire that first request through an unconfigured (direct) session,
    // leaking the real IP/DNS for exactly the site the user was trying to
    // browse anonymously.
    const view = await createBrowserView(tab.ghost)
    const newTab: Tab = {
      id, view,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      loading: false,
      ghost: tab.ghost,
      jsDisabled: false,
      requests: [],
    }
    tabs.set(id, newTab)
    attachViewEvents(newTab)
    showTab(id)
    if (tab.url && !isNewTabUrl(tab.url)) view.webContents.loadURL(tab.url)
    return { id, url: newTab.url, title: newTab.title, ghost: newTab.ghost }
  })

  // Find in page
  ipcMain.handle('findInPage:start', (_e, text: string) => {
    tabs.get(activeTabId)?.view.webContents.findInPage(text, { forward: true, findNext: false })
  })
  ipcMain.handle('findInPage:next', (_e, text: string, forward = true) => {
    tabs.get(activeTabId)?.view.webContents.findInPage(text, { forward, findNext: true })
  })
  ipcMain.handle('findInPage:stop', () => {
    tabs.get(activeTabId)?.view.webContents.stopFindInPage('clearSelection')
  })

  // Downloads — read + lifecycle controls
  ipcMain.handle('downloads:getAll', () => [...downloads.values()].sort((a, b) => b.startTime - a.startTime))
  ipcMain.handle('downloads:clear', () => {
    downloads.forEach((d, id) => { if (d.state !== 'progressing' && d.state !== 'paused') downloads.delete(id) })
    return [...downloads.values()].sort((a, b) => b.startTime - a.startTime)
  })
  ipcMain.handle('downloads:openItem', (_e, id: string) => {
    const d = downloads.get(id)
    if (d?.savePath) shell.openPath(d.savePath)
  })
  ipcMain.handle('downloads:showInFolder', (_e, id: string) => {
    const d = downloads.get(id)
    if (d?.savePath) shell.showItemInFolder(d.savePath)
  })
  ipcMain.handle('downloads:pause', (_e, id: string) => {
    downloadItems.get(id)?.pause()
  })
  ipcMain.handle('downloads:resume', (_e, id: string) => {
    downloadItems.get(id)?.resume()
  })
  ipcMain.handle('downloads:cancel', (_e, id: string) => {
    downloadItems.get(id)?.cancel()
  })
  ipcMain.handle('downloads:remove', (_e, id: string) => {
    downloadItems.get(id)?.cancel()
    downloads.delete(id)
    downloadItems.delete(id)
    return [...downloads.values()].sort((a, b) => b.startTime - a.startTime)
  })
  ipcMain.handle('downloads:deleteFile', (_e, id: string) => {
    const d = downloads.get(id)
    if (d?.savePath) { try { fs.unlinkSync(d.savePath) } catch (_) {} }
    downloadItems.get(id)?.cancel()
    downloads.delete(id)
    downloadItems.delete(id)
    return [...downloads.values()].sort((a, b) => b.startTime - a.startTime)
  })
  ipcMain.handle('downloads:getDefaultPath', () => getDownloadDir())
  ipcMain.handle('downloads:setDefaultPath', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose Download Folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Select Folder',
    })
    if (result.canceled || !result.filePaths[0]) return null
    const chosen = result.filePaths[0]
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('downloadPath', chosen)
    return chosen
  })

  // Extensions
  ipcMain.handle('extensions:load', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Load Unpacked Extension',
      properties: ['openDirectory'],
      buttonLabel: 'Load Extension',
    })
    if (result.canceled || !result.filePaths[0]) return { error: 'Cancelled' }
    try {
      const extPath = result.filePaths[0]
      const ext = await _loadExtIntoSessions(extPath)
      if (!ext) return { error: 'Failed to load extension' }
      addToExtRegistry({ id: ext.id, name: ext.name, path: extPath, source: 'unpacked' })
      const win2 = getMainWindow()
      if (win2) win2.webContents.send('extension:installed', { id: ext.id, name: ext.name })
      return { id: ext.id, name: ext.name, version: (ext as any).version ?? '' }
    } catch (e) {
      return { error: String(e) }
    }
  })
  ipcMain.handle('extensions:getAll', () => {
    return session.defaultSession.getAllExtensions().map(e => {
      let optionsPage: string | undefined
      let popupPage: string | undefined
      let icons: Record<string, string> | undefined
      let name = e.name
      let description = (e as any).description ?? ''
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(e.path, 'manifest.json'), 'utf8'))
        // Resolve localized __MSG_*__ name/description strings
        name = resolveExtMessage(e.name, e.path, manifest.default_locale)
        description = resolveExtMessage(description, e.path, manifest.default_locale)
        // Options page — manifest v2 "options_page", v3 "options_ui.page"
        const op = manifest.options_page || manifest.options_ui?.page
        if (op) optionsPage = `chrome-extension://${e.id}/${op.replace(/^\//, '')}`
        // Best launch URL — popup, sandbox, background-script target, common HTML
        const launchUrl = findExtensionLaunchUrl(manifest, e.id, e.path)
        if (launchUrl) popupPage = launchUrl
        // Icons
        if (manifest.icons) icons = manifest.icons
      } catch (_) {}
      return {
        id: e.id,
        name,
        path: e.path,
        version: (e as any).version ?? '',
        description,
        ...(optionsPage && { optionsPage }),
        ...(popupPage && { popupPage }),
        ...(icons && { icons }),
      }
    })
  })

  ipcMain.handle('extensions:openOptions', (_e, extId: string) => {
    const ext = session.defaultSession.getAllExtensions().find(e => e.id === extId)
    if (!ext) return { error: 'Extension not found' }
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'))
      const op = manifest.options_page || manifest.options_ui?.page
      const pp = manifest.action?.default_popup || manifest.browser_action?.default_popup
      const target = op || pp
      if (!target) return { error: 'No options or popup page defined' }
      const url = `chrome-extension://${extId}/${target}`
      return { url }
    } catch (e) {
      return { error: String(e) }
    }
  })
  ipcMain.handle('extensions:remove', async (_e, id: string) => {
    try {
      // Remove from both sessions
      try { await session.defaultSession.removeExtension(id) } catch (_) {}
      try { await session.fromPartition('persist:default').removeExtension(id) } catch (_) {}

      // Remove from registry and delete extracted files (not unpacked user dirs)
      const dirToDelete = removeFromExtRegistry(id)
      if (dirToDelete && fs.existsSync(dirToDelete)) {
        try { fs.rmSync(dirToDelete, { recursive: true, force: true }) }
        catch (e) { console.warn('[Extensions] Could not delete dir:', dirToDelete, e) }
      }

      // Close popup if it was showing this extension
      if (_extPopupWin && !_extPopupWin.isDestroyed()) {
        _extPopupWin.close()
        _extPopupWin = null
      }

      return true
    } catch (e) {
      console.error('[Extensions] remove failed:', e)
      return false
    }
  })

  // Open a specific extension's popup window directly (from Extensions panel "Open" button)
  ipcMain.handle('extensions:openPopup', (_e, extId: string) => {
    const win = getMainWindow()
    if (!win) return { error: 'No window' }
    const exts = session.defaultSession.getAllExtensions()
    const ext  = exts.find(e => e.id === extId)
    if (!ext) {
      console.error('[ExtPopup] Extension not found in session:', extId, '— loaded:', exts.map(e => e.id))
      return { error: 'Extension not loaded in session' }
    }
    let popupPage: string | undefined
    let optionsPage: string | undefined
    let name = ext.name
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'))
      name = resolveExtMessage(ext.name, ext.path, manifest.default_locale)
      const op = manifest.options_page || manifest.options_ui?.page
      if (op) optionsPage = `chrome-extension://${extId}/${op.replace(/^\//, '')}`
      popupPage = findExtensionLaunchUrl(manifest, extId, ext.path)
    } catch (e) {
      console.error('[ExtPopup] Failed to read manifest for', extId, e)
    }
    console.log('[ExtPopup] Launching', name, '→', popupPage || optionsPage || 'NO URL FOUND')
    openExtensionPopup(win, { id: ext.id, name, path: ext.path, popupPage, optionsPage })
    return { ok: true }
  })

  // Show the extension tray as a native OS popup menu — avoids BrowserView z-index issues.
  // Clicking an extension with a popup opens a child BrowserWindow (Chrome-style).
  ipcMain.handle('extensions:showTrayMenu', () => {
    const win = getMainWindow()
    if (!win) return

    const exts = session.defaultSession.getAllExtensions()
    const menuItems: MenuItem[] = []

    for (const ext of exts) {
      let popupPage: string | undefined
      let optionsPage: string | undefined
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'))
        const pp = manifest.action?.default_popup || manifest.browser_action?.default_popup
        if (pp) popupPage = `chrome-extension://${ext.id}/${pp}`
        const op = manifest.options_page || manifest.options_ui?.page
        if (op) optionsPage = `chrome-extension://${ext.id}/${op}`
      } catch (_) {}

      const extSnap = { id: ext.id, name: ext.name, path: ext.path, popupPage, optionsPage }
      menuItems.push(new MenuItem({
        label: ext.name || ext.id,
        click: () => openExtensionPopup(win, extSnap),
      }))
    }

    if (menuItems.length === 0) {
      menuItems.push(new MenuItem({ label: 'No extensions installed', enabled: false }))
    }

    menuItems.push(new MenuItem({ type: 'separator' }))
    menuItems.push(new MenuItem({
      label: 'Manage Extensions',
      click: () => win.webContents.send('menu:action', { action: 'panel', panel: 'extensions' }),
    }))

    const menu = Menu.buildFromTemplate(menuItems)
    menu.popup({ window: win })
  })

  // Install extension from a .crx file — extracts it and loads as unpacked
  ipcMain.handle('extensions:installCrx', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Install Extension (.crx)',
      properties: ['openFile'],
      filters: [{ name: 'Chrome Extension', extensions: ['crx', 'zip'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { error: 'Cancelled' }
    try {
      const crxPath = result.filePaths[0]
      const data = fs.readFileSync(crxPath)

      // CRX3 format: magic 4 bytes + version 4 bytes + header_size 4 bytes + protobuf header + ZIP data
      // CRX2 format: magic 4 bytes + version 4 bytes + pub_key_len 4 bytes + sig_len 4 bytes + pub_key + sig + ZIP data
      let zipStart = 0
      const magic = data.slice(0, 4).toString('utf8')
      if (magic === 'Cr24') {
        const version = data.readUInt32LE(4)
        if (version === 3) {
          const headerSize = data.readUInt32LE(8)
          zipStart = 12 + headerSize
        } else if (version === 2) {
          const pubKeyLen = data.readUInt32LE(8)
          const sigLen = data.readUInt32LE(12)
          zipStart = 16 + pubKeyLen + sigLen
        } else {
          zipStart = 0 // treat whole file as zip
        }
      }

      const zipData = data.slice(zipStart)
      const extDir = path.join(app.getPath('userData'), 'crx-extensions', `crx-${Date.now()}`)
      fs.mkdirSync(extDir, { recursive: true })

      const tmpZip = path.join(app.getPath('temp'), `dhurta-ext-${Date.now()}.zip`)
      fs.writeFileSync(tmpZip, zipData)

      // Use Windows built-in PowerShell Expand-Archive — no external dependency needed
      const { spawnSync } = require('child_process')
      const ps = spawnSync(
        'powershell',
        ['-NonInteractive', '-Command',
         `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${extDir.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, encoding: 'utf8' }
      )
      try { fs.unlinkSync(tmpZip) } catch (_) {}

      if (ps.status !== 0) {
        fs.rmSync(extDir, { recursive: true, force: true })
        return { error: 'ZIP extraction failed: ' + (ps.stderr || 'unknown error') }
      }

      const ext = await _loadExtIntoSessions(extDir)
      if (!ext) return { error: 'Failed to load extension after extraction' }
      addToExtRegistry({ id: ext.id, name: ext.name, path: extDir, source: 'crx' })
      const win2 = getMainWindow()
      if (win2) win2.webContents.send('extension:installed', { id: ext.id, name: ext.name })
      return { id: ext.id, name: ext.name, version: (ext as any).version ?? '' }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Install extension directly from Chrome Web Store using the extension ID.
  // Fetches the official CRX from Google's update server (same source Chrome uses),
  // extracts it, and loads it via session.loadExtension.
  ipcMain.handle('extensions:installFromWebStore', async (_e, extId: string) => {
    if (!extId || !/^[a-z]{32}$/.test(extId)) return { error: 'Invalid extension ID' }
    try {
      const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=131.0.0.0&x=id%3D${extId}%26uc`
      // Use Node's https to download the CRX
      const crxData: Buffer = await new Promise((resolve, reject) => {
        const https = require('https')
        const chunks: Buffer[] = []
        const req = https.get(crxUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
        }, (res: any) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            const redirect = res.headers.location
            https.get(redirect, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } }, (res2: any) => {
              res2.on('data', (c: Buffer) => chunks.push(c))
              res2.on('end', () => resolve(Buffer.concat(chunks)))
              res2.on('error', reject)
            })
            return
          }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        })
        req.on('error', reject)
      })

      // Reuse the same CRX extraction logic already in extensions:installCrx
      let zipStart = 0
      const magic = crxData.slice(0, 4).toString('utf8')
      if (magic === 'Cr24') {
        const version = crxData.readUInt32LE(4)
        if (version === 3) { zipStart = 12 + crxData.readUInt32LE(8) }
        else if (version === 2) { zipStart = 16 + crxData.readUInt32LE(8) + crxData.readUInt32LE(12) }
      }
      const zipData = crxData.slice(zipStart)
      const extDir = path.join(app.getPath('userData'), 'crx-extensions', `ws-${extId}`)
      fs.mkdirSync(extDir, { recursive: true })
      const tmpZip = path.join(app.getPath('temp'), `dhurta-ws-${extId}.zip`)
      fs.writeFileSync(tmpZip, zipData)
      const { spawnSync } = require('child_process')
      const ps = spawnSync('powershell', ['-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${extDir.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, encoding: 'utf8' })
      try { fs.unlinkSync(tmpZip) } catch (_) {}
      if (ps.status !== 0) return { error: 'Extract failed: ' + (ps.stderr ?? 'unknown') }

      const ext = await _loadExtIntoSessions(extDir)
      if (!ext) return { error: 'Failed to load extension after extraction' }
      addToExtRegistry({ id: ext.id, name: ext.name, path: extDir, source: 'webstore' })

      // Notify renderer: auto-open Extensions panel + trigger list refresh
      const win = getMainWindow()
      if (win) {
        win.webContents.send('extension:installed', { id: ext.id, name: ext.name })
        win.webContents.send('menu:action', { action: 'panel', panel: 'extensions' })
      }

      return { id: ext.id, name: ext.name }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Install Firefox Add-on (XPI) from the Mozilla AMO catalogue.
  // Flow: AMO API → XPI URL → download → extract ZIP → patch manifest → inject polyfill → loadExtension.
  ipcMain.handle('extensions:installFromAMO', async (_e, slug: string) => {
    if (!slug || !/^[\w.-]+$/.test(slug)) return { error: 'Invalid add-on slug' }
    try {
      const https = require('https') as typeof import('https')
      const { spawnSync } = require('child_process') as typeof import('child_process')

      // Helper: HTTP GET with redirect following (up to 5 hops), returns Buffer + JSON parse util
      function httpsGet(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
        return new Promise((resolve, reject) => {
          let hops = 0
          const defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
            'Accept': '*/*',
            ...headers,
          }
          function doGet(u: string) {
            if (++hops > 5) { reject(new Error('Too many redirects')); return }
            const req = https.get(u, { headers: defaultHeaders }, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                doGet(res.headers.location as string); return
              }
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return
              }
              const chunks: Buffer[] = []
              res.on('data', (c: Buffer) => chunks.push(c))
              res.on('end', () => resolve(Buffer.concat(chunks)))
              res.on('error', reject)
            })
            req.on('error', reject)
          }
          doGet(url)
        })
      }

      // 1. Resolve XPI download URL from AMO API v5
      const amoApiUrl = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/`
      let addonMeta: any
      try {
        const raw = await httpsGet(amoApiUrl, { 'Accept': 'application/json' })
        addonMeta = JSON.parse(raw.toString('utf8'))
      } catch (e) {
        return { error: `AMO API error: ${String(e)}` }
      }

      if (addonMeta?.detail) {
        // AMO returns {"detail":"Not found."} for unknown slugs
        return { error: `Add-on not found on AMO: "${slug}". Check the exact slug from the AMO URL.` }
      }

      // Try multiple paths where the XPI URL might live
      const xpiUrl: string =
        addonMeta?.current_version?.files?.[0]?.url ||
        addonMeta?.current_version?.file?.url ||      // some API versions use singular
        addonMeta?.current_version?.download_url ||
        ''

      if (!xpiUrl) {
        const debugInfo = JSON.stringify({
          hasCurrentVersion: !!addonMeta?.current_version,
          filesLen: addonMeta?.current_version?.files?.length,
        })
        return { error: `Could not locate XPI URL for "${slug}" (${debugInfo})` }
      }

      const addonName: string =
        (typeof addonMeta?.name === 'object' ? addonMeta.name?.['en-US'] : addonMeta?.name) ||
        addonMeta?.slug || slug

      // 2. Download XPI — the URL usually redirects to addons.cdn.mozilla.net
      let xpiData: Buffer
      try {
        xpiData = await httpsGet(xpiUrl)
      } catch (e) {
        return { error: `Download failed: ${String(e)}` }
      }

      // 3. Extract XPI (which is a plain ZIP)
      const extDir = path.join(app.getPath('userData'), 'amo-extensions', slug)
      fs.mkdirSync(extDir, { recursive: true })
      const tmpZip = path.join(app.getPath('temp'), `dhurta-amo-${slug}.zip`)
      fs.writeFileSync(tmpZip, xpiData)

      const ps = spawnSync('powershell', ['-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${extDir.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, encoding: 'utf8' })
      try { fs.unlinkSync(tmpZip) } catch (_) {}
      if (ps.status !== 0) return { error: 'ZIP extraction failed: ' + (ps.stderr || 'unknown') }

      // 4. Read manifest and inject browser-polyfill for Firefox-only extensions
      const manifestPath = path.join(extDir, 'manifest.json')
      let manifest: any
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }
      catch (_) { return { error: 'Could not read manifest.json from add-on' } }

      const polyfillSrc = path.join(__dirname, 'browser-polyfill.min.js')
      const polyfillDest = path.join(extDir, 'browser-polyfill.min.js')
      const hasPolyfillFile = fs.existsSync(polyfillSrc)

      // Only inject polyfill for extensions that declare Firefox-specific settings
      // (i.e., they use browser.* API and need the bridge to chrome.*)
      const isFirefoxExt = !!(manifest.browser_specific_settings?.gecko || manifest.applications?.gecko)
      if (isFirefoxExt && hasPolyfillFile) {
        fs.copyFileSync(polyfillSrc, polyfillDest)

        if (manifest.manifest_version === 2) {
          // Patch background scripts: inject polyfill as first entry
          if (manifest.background?.scripts && Array.isArray(manifest.background.scripts)) {
            if (!manifest.background.scripts.includes('browser-polyfill.min.js')) {
              manifest.background.scripts.unshift('browser-polyfill.min.js')
            }
          }
          // Patch content_scripts: inject polyfill as first js entry in each rule
          if (Array.isArray(manifest.content_scripts)) {
            manifest.content_scripts = manifest.content_scripts.map((cs: any) => {
              if (Array.isArray(cs.js) && !cs.js.includes('browser-polyfill.min.js')) {
                return { ...cs, js: ['browser-polyfill.min.js', ...cs.js] }
              }
              return cs
            })
          }
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
        }
        // MV3 service_worker extensions cannot be patched this way — they run as-is.
        // Most MV3 Firefox extensions already bundle their own polyfill.
      }

      const ext = await _loadExtIntoSessions(extDir)
      if (!ext) return { error: 'Failed to load add-on after extraction' }
      addToExtRegistry({ id: ext.id, name: addonName, path: extDir, source: 'amo' })

      const win = getMainWindow()
      if (win) {
        win.webContents.send('extension:installed', { id: ext.id, name: addonName })
        win.webContents.send('menu:action', { action: 'panel', panel: 'extensions' })
      }

      return { id: ext.id, name: addonName }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Bookmark update — edit URL or title of an existing bookmark
  ipcMain.handle('bookmark:update', (_e, id: number, updates: { url?: string; title?: string }) => {
    try {
      const sets: string[] = []
      const vals: (string | number)[] = []
      if (updates.url  !== undefined) { sets.push('url = ?');   vals.push(updates.url) }
      if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title) }
      if (sets.length === 0) return false
      vals.push(id)
      getDb().prepare(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
      return true
    } catch { return false }
  })

  // Bookmark check — does the current URL already exist in bookmarks?
  ipcMain.handle('bookmark:check', (_e, url: string) => {
    try {
      const row = getDb().prepare('SELECT id FROM bookmarks WHERE url = ?').get(url) as any
      return !!row
    } catch { return false }
  })

  // ── Transparency Dashboard ────────────────────────────────────────────────────
  ipcMain.handle('transparency:getData', () => {
    const db = getDb()
    const histCount  = (db.prepare('SELECT COUNT(*) as n FROM history').get() as any).n
    const histRange  = db.prepare('SELECT MIN(visited_at) as oldest, MAX(visited_at) as newest FROM history').get() as any
    const bmCount    = (db.prepare('SELECT COUNT(*) as n FROM bookmarks').get() as any).n
    const exts       = session.defaultSession.getAllExtensions()
    const settingRows = db.prepare('SELECT key, value FROM settings').all() as any[]
    const settingsMap: Record<string, string> = {}
    settingRows.forEach((r: any) => { settingsMap[r.key] = r.value })
    const dbPath = path.join(app.getPath('userData'), 'dhurta.db')
    let dbSizeKb = 0
    try { dbSizeKb = Math.round(fs.statSync(dbPath).size / 1024) } catch (_) {}
    const crashPath = path.join(app.getPath('userData'), 'crash-log.json')
    let crashLogs = 0
    try { crashLogs = (JSON.parse(fs.readFileSync(crashPath, 'utf8')) as any[]).length } catch (_) {}
    const fmt = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleDateString() : null
    return {
      history:    { count: histCount, oldestDate: fmt(histRange?.oldest), newestDate: fmt(histRange?.newest) },
      bookmarks:  { count: bmCount },
      extensions: { count: exts.length, names: exts.map((e: any) => e.name) },
      settings:   settingsMap,
      dbSizeKb,
      crashLogs,
    }
  })

  ipcMain.handle('transparency:export', () => {
    const db = getDb()
    const history   = db.prepare('SELECT url, title, visited_at FROM history ORDER BY visited_at DESC').all()
    const bookmarks = db.prepare('SELECT url, title, created_at FROM bookmarks ORDER BY created_at DESC').all()
    const settings  = db.prepare('SELECT key, value FROM settings').all()
    const exts      = session.defaultSession.getAllExtensions().map((e: any) => ({ id: e.id, name: e.name, version: e.version }))
    return JSON.stringify({ history, bookmarks, settings, extensions: exts, exportedAt: new Date().toISOString() }, null, 2)
  })

  ipcMain.handle('transparency:sendCrashReport', async () => {
    const crashPath = path.join(app.getPath('userData'), 'crash-log.json')
    let logs: any[] = []
    try { logs = JSON.parse(fs.readFileSync(crashPath, 'utf8')) } catch (_) {}
    if (logs.length === 0) return { success: false, error: 'No crash logs to send' }
    try {
      const body = JSON.stringify({
        description: 'Dhurta anonymous crash report',
        public: false,
        files: { 'crash-report.json': { content: JSON.stringify({ version: app.getVersion(), platform: process.platform, crashes: logs }, null, 2) } },
      })
      const result: any = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'api.github.com', path: '/gists', method: 'POST',
          headers: { 'User-Agent': 'Dhurta-Browser', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (res) => {
            let data = ''
            res.on('data', (c) => { data += c })
            res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
          })
        req.on('error', reject)
        req.write(body)
        req.end()
      })
      fs.writeFileSync(crashPath, '[]', 'utf8')
      return { success: true, url: result.html_url }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ── App Lock ──────────────────────────────────────────────────────────────────
  ipcMain.handle('appLock:status', () => ({
    locked: isLockEnabled() && !_sessionUnlocked,
    hasPin: isLockEnabled(),
  }))

  ipcMain.handle('appLock:setup', (_e, pin: string) => {
    const recovery = setupPin(pin)
    _sessionUnlocked = true
    return { recovery }
  })

  ipcMain.handle('appLock:unlock', (_e, pin: string) => {
    const ok = verifyPin(pin)
    if (ok) _sessionUnlocked = true
    return { ok }
  })

  ipcMain.handle('appLock:lock', () => {
    _sessionUnlocked = false
    const win = getMainWindow()
    if (win) win.webContents.send('appLock:locked')
    return true
  })

  ipcMain.handle('appLock:clear', (_e, pin: string) => {
    if (!verifyPin(pin)) return { ok: false }
    clearPin()
    return { ok: true }
  })

  ipcMain.handle('appLock:changePin', (_e, oldPin: string, newPin: string) => {
    return { ok: changePin(oldPin, newPin) }
  })

  ipcMain.handle('appLock:recover', (_e, phrase: string) => {
    if (!verifyRecovery(phrase)) return { ok: false }
    clearPin()
    _sessionUnlocked = true
    return { ok: true }
  })

  // Native three-dot menu — renders at OS level so it appears ABOVE BrowserViews
  ipcMain.handle('menu:showThreeDot', (_e, opts: { url: string }) => {
    const win = getMainWindow()
    if (!win) return

    const send = (action: string, payload?: object) =>
      win.webContents.send('menu:action', { action, ...payload })

    const menu = Menu.buildFromTemplate([
      // ── Panels ────────────────────────────────────────────────────────────
      { label: 'History',          click: () => send('panel', { panel: 'history' }) },
      { label: 'Bookmarks',        click: () => send('panel', { panel: 'bookmarks' }) },
      { label: 'Downloads',        click: () => send('panel', { panel: 'downloads' }) },
      { label: 'Data Hub',         click: () => send('panel', { panel: 'data' }) },
      { label: 'Extensions',       click: () => send('panel', { panel: 'extensions' }) },
      { label: 'Settings',         click: () => send('panel', { panel: 'settings' }) },
      { label: 'Security',         click: () => send('panel', { panel: 'security' }) },
      { label: 'Transparency',     click: () => send('panel', { panel: 'transparency' }) },
      { type: 'separator' },
      // ── Page tools ────────────────────────────────────────────────────────
      { label: 'Find in Page',     accelerator: 'CmdOrCtrl+F', click: () => send('findInPage') },
      { label: 'Pop Out Page',     click: () => {
        const tab = tabs.get(activeTabId)
        const url = tab?.url ?? ''
        if (!isNewTabUrl(url)) openPopoutWindow(url)
      }},
      { label: 'Video PiP',        click: () => {
        const tab = tabs.get(activeTabId)
        if (!tab) return
        tab.view.webContents.executeJavaScript(`
          const v=[...document.querySelectorAll('video')].filter(x=>!x.paused&&x.readyState>=2).sort((a,b)=>b.videoWidth*b.videoHeight-a.videoWidth*a.videoHeight)[0]||document.querySelector('video')
          if(v&&document.pictureInPictureEnabled)v.requestPictureInPicture().catch(()=>{})
        `).catch(() => {})
      }},
      { type: 'separator' },
      // ── Tab ───────────────────────────────────────────────────────────────
      { label: 'New Tab',          accelerator: 'CmdOrCtrl+T', click: () => send('newTab') },
      { label: 'New Ghost Tab',    click: () => send('newGhostTab') },
      { label: 'Duplicate Tab',    click: () => send('duplicateTab') },
      { type: 'separator' },
      // ── Page ──────────────────────────────────────────────────────────────
      { label: 'Bookmark This Page', click: () => {
        const tab = tabs.get(activeTabId)
        if (!tab || isNewTabUrl(tab.url)) return
        try {
          getDb().prepare('INSERT OR IGNORE INTO bookmarks (url, title, favicon) VALUES (?, ?, ?)').run(tab.url, tab.title, tab.favicon)
          win.webContents.send('context-menu:action', { action: 'bookmarkAdded' })
        } catch (_) {}
      }},
      { label: 'Copy URL',          click: () => { const tab = tabs.get(activeTabId); if (tab) clipboard.writeText(tab.url) }},
      { label: 'View Source',        click: () => { const tab = tabs.get(activeTabId); if (tab) send('openInNewTab', { url: 'view-source:' + tab.url, ghost: tab.ghost }) }},
      { label: 'Print',             click: () => { tabs.get(activeTabId)?.view.webContents.print() }},
      { type: 'separator' },
      // ── DevTools ──────────────────────────────────────────────────────────
      { label: 'DevTools',           accelerator: 'F12', click: () => {
        const wc = tabs.get(activeTabId)?.view.webContents
        if (!wc) return
        wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' })
      }},
      { label: 'DevTools — Mobile',  click: () => {
        const wc = tabs.get(activeTabId)?.view.webContents
        if (!wc) return
        wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'bottom' })
      }},
    ])
    menu.popup({ window: win })
  })

  // ── Picture-in-Picture / Pop-out window ─────────────────────────────────────
  // Video PiP — triggers HTML5 requestPictureInPicture() on the playing video
  ipcMain.handle('pip:videoMode', async () => {
    const tab = tabs.get(activeTabId)
    if (!tab) return { error: 'No active tab' }
    try {
      const result = await tab.view.webContents.executeJavaScript(`
        (function () {
          var playing = [...document.querySelectorAll('video')]
            .filter(function (v) { return !v.paused && v.readyState >= 2 })
            .sort(function (a, b) { return (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight) })[0]
          var video = playing || document.querySelector('video')
          if (!video) return { error: 'No video found on this page.' }
          if (document.pictureInPictureElement === video) {
            document.exitPictureInPicture()
            return { success: true, action: 'exit' }
          }
          if (!document.pictureInPictureEnabled) return { error: 'Picture-in-Picture is not supported here.' }
          return video.requestPictureInPicture()
            .then(function () { return { success: true, action: 'enter' } })
            .catch(function (e) { return { error: String(e) } })
        })()
      `)
      return result
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Page pop-out — detach current URL into a floating always-on-top window
  ipcMain.handle('pip:openPage', (_e, url?: string) => {
    const tab = tabs.get(activeTabId)
    const targetUrl = url || tab?.url || 'about:blank'
    if (!targetUrl || targetUrl === 'dhurta://newtab' || targetUrl === 'about:blank') {
      return { error: 'No page to pop out' }
    }
    openPopoutWindow(targetUrl)
    return { success: true }
  })

  ipcMain.handle('pip:winClose', () => {
    if (popoutWin && !popoutWin.isDestroyed()) popoutWin.close()
  })

  ipcMain.handle('pip:goBack', () => {
    popoutView?.webContents.goBack()
  })

  ipcMain.handle('pip:goForward', () => {
    popoutView?.webContents.goForward()
  })

  ipcMain.handle('pip:reload', () => {
    popoutView?.webContents.reload()
  })

  ipcMain.handle('pip:setAlwaysOnTop', (_e, val: boolean) => {
    if (popoutWin && !popoutWin.isDestroyed()) popoutWin.setAlwaysOnTop(val, 'screen-saver')
  })

  ipcMain.handle('pip:setOpacity', (_e, val: number) => {
    if (popoutWin && !popoutWin.isDestroyed()) popoutWin.setOpacity(val)
  })

  ipcMain.handle('pip:minimize', () => {
    if (popoutWin && !popoutWin.isDestroyed()) popoutWin.minimize()
  })

  ipcMain.handle('pip:toggleMaximize', () => {
    if (!popoutWin || popoutWin.isDestroyed()) return
    if (popoutWin.isMaximized()) popoutWin.unmaximize()
    else popoutWin.maximize()
  })

  // Focus the main browser window without closing the pop-out (matches video PiP's ⬡ Browser button)
  ipcMain.handle('pip:focusMain', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    win.moveTop()
  })

  ipcMain.handle('pip:openInMain', () => {
    if (!popoutView) return
    const url = popoutView.webContents.getURL()
    if (url) {
      const win = getMainWindow()
      win?.webContents.send('pip:loadInMain', url)
    }
    if (popoutWin && !popoutWin.isDestroyed()) popoutWin.close()
  })

  ipcMain.handle('pip:status', () => ({
    isOpen: !!(popoutWin && !popoutWin.isDestroyed()),
    url: popoutView?.webContents.getURL() ?? '',
  }))

  // ── Gesture routing ──────────────────────────────────────────────────────────
  // webviewPreload.js sends these IPCs from inside BrowserView pages.
  // event.sender is the BrowserView's webContents — operate on it directly.

  ipcMain.on('gesture:swipe', (event, direction: string) => {
    if (!gestureSwipe) return
    const wc = event.sender
    if (direction === 'left') {
      for (const [id, t] of tabs) {
        if (t.view.webContents === wc) { goBackOrHome(wc, id); break }
      }
    } else if (direction === 'right') {
      wc.goForward()
    }
  })

  // Pinch-to-zoom detected in the preload via Ctrl+Wheel.
  //   'in'  = pinch out (spread fingers) → zoom in,  capped at 200%
  //   'out' = pinch in  (squeeze)        → zoom out, floored at 90%
  ipcMain.on('gesture:zoom', (event, direction: 'in' | 'out') => {
    if (!gesturePinchZoom) return
    const wc = event.sender
    if (wc.isDestroyed()) return
    const current = wc.getZoomFactor()
    const next = direction === 'in'
      ? Math.min(2.0, parseFloat((current + 0.05).toFixed(2)))
      : Math.max(0.9, parseFloat((current - 0.05).toFixed(2)))
    if (next === current) return
    wc.setZoomFactor(next)
    const win = getMainWindow()
    if (win) {
      for (const [id, t] of tabs) {
        if (t.view.webContents === wc) {
          win.webContents.send('zoom:level', { tabId: id, level: next })
          break
        }
      }
    }
  })

  // Load gesture flags from DB so the in-memory cache is correct from the first gesture.
  try {
    const pg = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('gesturePinchZoom') as any
    const gs = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('gestureSwipe') as any
    if (pg) gesturePinchZoom = pg.value !== 'false'
    if (gs) gestureSwipe     = gs.value !== 'false'
  } catch (_) {}

  // Download tracking: register will-download on all known sessions immediately.
  // This MUST be called unconditionally — getMainWindow() is null here (createWindow
  // hasn't run yet), so the old `if (win)` guard silently skipped it every launch.
  // The handler now resolves the window lazily at event-fire time.
  setupDownloadTracking()

  // NOTE: Window resize listeners and VPN restoration are deferred to
  // setupWindowListeners(), which must be called from main.ts AFTER createWindow()
  // runs.  getMainWindow() is null here, so any code inside an `if (win)` guard
  // placed here would silently never execute.

  // Image picker for wallpaper — read file and return base64 data URL so it
  // works reliably regardless of spaces/special chars in the file path.
  ipcMain.handle('file:pickImage', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose Wallpaper',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const filePath = result.filePaths[0]
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      // Fallback: use properly-encoded file:// URL
      return pathToFileURL(result.filePaths[0]).href
    }
  })

  // VPN — free public proxy with optional country selection
  ipcMain.handle('vpn:connect', async (_e, country?: string) => {
    const proxy = await fetchFreeProxy(country)
    if (!proxy) {
      return { success: false, error: `No servers found${country && country !== 'all' ? ' for ' + country : ''}. Try Auto or another country.` }
    }
    await applyProxyToAllSessions(`socks5://${proxy}`)
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_ipRotation', 'true')
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('vpnCountry', country ?? 'all')
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', proxy)
    return { success: true, proxy, country: country ?? 'Auto' }
  })

  ipcMain.handle('vpn:disconnect', async () => {
    await applyProxyToAllSessions('direct://')
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('security_ipRotation', 'false')
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', '')
  })

  ipcMain.handle('vpn:rotate', async () => {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('vpnCountry') as any
    const country = row?.value ?? 'all'
    const proxy = await fetchFreeProxy(country)
    if (!proxy) {
      return { success: false, error: 'No servers available right now. Try again.' }
    }
    await applyProxyToAllSessions(`socks5://${proxy}`)
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', proxy)
    return { success: true, proxy }
  })

  // Public-IP / geolocation check — what a DNS/IP checker on the open web would
  // see for the CURRENTLY ACTIVE TAB's egress. Routed via net.fetch bound to that
  // tab's own session so it honors whatever proxy/Tor circuit is actually active
  // (or reveals the real ISP IP when no protection is on) — an accurate "what's
  // leaking right now" readout for the Omni dashboard, not a generic lookup.
  ipcMain.handle('omni:checkIp', async (_e, tabId?: number) => {
    const tab = tabId != null ? tabs.get(tabId) : tabs.get(activeTabId)
    const sess = tab?.view.webContents.session ?? session.defaultSession
    return lookupIp(sess)
  })

  // "Real" unmasked IP — routed through a dedicated session partition that is
  // FORCED to direct:// right before every check, regardless of whatever proxy
  // state VPN/Ghost Mode have set elsewhere. VPN connect applies its proxy to
  // session.defaultSession too (see applyProxyToAllSessions), so that session
  // can't be used as a "what's my real IP" baseline while VPN is on — this
  // dedicated partition is never touched by that code path, only by this
  // handler, so it always reflects the true underlying connection.
  let _directCheckSession: Electron.Session | null = null
  ipcMain.handle('omni:checkRealIp', async () => {
    if (!_directCheckSession) _directCheckSession = session.fromPartition('persist:omni-direct-check')
    await _directCheckSession.setProxy({ proxyRules: 'direct://' })
    return lookupIp(_directCheckSession)
  })

  // Network connectivity check — actual internet reachability (not just adapter status).
  // The renderer's navigator.onLine only reflects whether a network adapter exists,
  // which is always true in Electron even when the real internet is unreachable.
  ipcMain.handle('net:checkOnline', async () => {
    try {
      const resp = await net.fetch('https://clients3.google.com/generate_204', {
        signal: AbortSignal.timeout(5000),
      } as any)
      return resp.status === 204 || resp.ok
    } catch {
      try {
        const resp = await net.fetch('http://www.gstatic.com/generate_204', {
          signal: AbortSignal.timeout(4000),
        } as any)
        return resp.status === 204 || resp.ok
      } catch { return false }
    }
  })

  // Ad/tracker blocking counter — concrete "here's what was stopped" stat.
  ipcMain.handle('omni:getBlockedCount', () => getBlockedCount())

  // Live fingerprint scan of the active tab — reads the ACTUAL values a real
  // website sees right now (not this internal dhurta:// page's own values,
  // which run in a different, unprotected context). Flags each surface as
  // leaking or protected against the baseline-normalized values webviewPreload.js
  // sets on every tab.
  ipcMain.handle('omni:getFingerprint', async (_e, tabId?: number) => {
    const tab = tabId != null ? tabs.get(tabId) : tabs.get(activeTabId)
    if (!tab || isNewTabUrl(tab.url)) {
      return { error: 'No website open in the active tab — open a page to scan it.' }
    }
    try {
      const result = await tab.view.webContents.executeJavaScript(`
        (function () {
          var gl = null
          try {
            var c = document.createElement('canvas')
            gl = c.getContext('webgl') || c.getContext('experimental-webgl')
          } catch (_) {}
          var vendor = '', renderer = ''
          try {
            if (gl) {
              var ext = gl.getExtension('WEBGL_debug_renderer_info')
              if (ext) {
                vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
                renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
              }
            }
          } catch (_) {}
          return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            screenWidth: screen.width,
            screenHeight: screen.height,
            colorDepth: screen.colorDepth,
            devicePixelRatio: window.devicePixelRatio,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            languages: (navigator.languages || []).join(', '),
            doNotTrack: navigator.doNotTrack,
            webdriver: navigator.webdriver,
            pluginsCount: navigator.plugins ? navigator.plugins.length : 0,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            webglVendor: vendor,
            webglRenderer: renderer,
          }
        })()
      `)
      return { success: true, ...result }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Bridge — browser-to-browser connect via 6-digit code
  ipcMain.handle('bridge:host', () => {
    if (bridgeServer) { try { bridgeServer.close() } catch (_) {} }
    bridgeCode = String(Math.floor(100000 + Math.random() * 900000))
    const port = codeToPort(bridgeCode)

    bridgeServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
      if (req.method === 'GET') {
        const tab = tabs.get(activeTabId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ url: tab?.url ?? '', title: tab?.title ?? '', favicon: tab?.favicon ?? '' }))
      } else if (req.method === 'POST') {
        let body = ''
        req.on('data', (d) => { body += d })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            if (data.url) getMainWindow()?.webContents.send('bridge:incoming', data)
          } catch (_) {}
          res.writeHead(200); res.end('ok')
        })
      } else {
        res.writeHead(404); res.end()
      }
    })
    bridgeServer.listen(port, '0.0.0.0')
    return { code: bridgeCode, port }
  })

  ipcMain.handle('bridge:stop', () => {
    if (bridgeServer) { try { bridgeServer.close() } catch (_) {} }
    bridgeServer = null
    bridgeCode = null
  })

  // Peek at a peer's state (main process does the HTTP fetch — no CSP issues)
  ipcMain.handle('bridge:peek', (_e, code: string) => {
    const port = codeToPort(code)
    return new Promise<object | null>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 3000 }, (res) => {
        let body = ''
        res.on('data', (d) => { body += d })
        res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    })
  })

  // Push our URL to a peer that is hosting
  ipcMain.handle('bridge:push', (_e, code: string, url: string, title: string) => {
    const port = codeToPort(code)
    const data = JSON.stringify({ url, title })
    return new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => { res.resume(); res.on('end', () => resolve(true)) }
      )
      req.on('error', () => resolve(false))
      req.write(data)
      req.end()
    })
  })

  // Cookie auto-purge every 60 minutes
  setInterval(async () => {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  }, 60 * 60 * 1000)

  // When Tor finishes bootstrapping, retroactively apply the proxy to any ghost
  // sessions that were created while Tor was still connecting. This ensures tabs
  // opened the moment Ghost Mode is toggled are not left without a proxy.
  addTorReadyListener(() => {
    for (const [, tab] of tabs) {
      if (tab.ghost) {
        tab.view.webContents.session
          .setProxy({ proxyRules: getTorProxyRules(), proxyBypassRules: '' })
          .catch(() => {})
      }
    }
  })

  // If Tor crashes after having been running, notify the renderer so the sidebar
  // can flip torActive to false and warn the user that Ghost Mode lost its circuit.
  addTorExitListener(() => {
    getMainWindow()?.webContents.send('ghost:tor-crashed')
  })

  // Search suggestions — fetched server-side so CORS never blocks the renderer.
  // Returns up to 8 suggestion strings in OpenSearch list format.
  ipcMain.handle('suggest:fetch', async (_e, engine: string, query: string) => {
    const q = query?.trim()
    if (!q) return []
    const enc = encodeURIComponent(q)
    let url: string
    switch (engine) {
      case 'google':     url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${enc}`; break
      case 'bing':       url = `https://api.bing.com/osjson.aspx?query=${enc}`; break
      case 'ecosia':     url = `https://ac.ecosia.org/?q=${enc}&type=list`; break
      case 'yahoo':      url = `https://ff.search.yahoo.com/gossip?command=${enc}&output=fxjson`; break
      // startpage, qwant, brave, duckduckgo, custom all fall through to DDG
      default:           url = `https://duckduckgo.com/ac/?q=${enc}&type=list`; break
    }
    try {
      const resp = await net.fetch(url, { signal: AbortSignal.timeout(3000) } as any)
      if (!resp.ok) return []
      const json = await resp.json() as any
      // OpenSearch format: [queryStr, [s1, s2, ...]]
      if (Array.isArray(json) && Array.isArray(json[1])) return (json[1] as string[]).slice(0, 8)
      // DDG ac format: [{phrase: "..."}, ...]
      if (Array.isArray(json) && json.length > 0 && json[0]?.phrase)
        return (json as Array<{ phrase: string }>).map(x => x.phrase).slice(0, 8)
      return []
    } catch { return [] }
  })

  // Site info — connection, cookie count, and permission status for the active tab's origin
  ipcMain.handle('site:getInfo', async (_e, tabId: number) => {
    const tab = tabs.get(tabId) ?? tabs.get(activeTabId)
    if (!tab) return null
    const url = tab.view.webContents.getURL()
    if (!url || url.startsWith('dhurta://') || url === 'about:blank' || url === '') return null
    let domain = '', isHttps = false, origin = ''
    try {
      const u = new URL(url)
      domain = u.hostname
      isHttps = u.protocol === 'https:'
      origin = u.origin
    } catch { return null }
    const ses = tab.view.webContents.session
    const cookies = await ses.cookies.get({ domain }).catch(() => [] as any[])
    return { url, domain, isHttps, origin, cookieCount: cookies.length }
  })

  // Clear cookies + storage for the active tab's origin
  ipcMain.handle('site:clearData', async (_e, tabId: number) => {
    const tab = tabs.get(tabId) ?? tabs.get(activeTabId)
    if (!tab) return false
    const url = tab.view.webContents.getURL()
    if (!url || url.startsWith('dhurta://')) return false
    let origin = ''
    try { origin = new URL(url).origin } catch { return false }
    const ses = tab.view.webContents.session
    await ses.clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] }).catch(() => {})
    await ses.clearCache().catch(() => {})
    return true
  })

  // Clear site from history by domain
  ipcMain.handle('site:clearHistory', async (_e, domain: string) => {
    if (!domain) return
    const db = getDb()
    db.prepare("DELETE FROM history WHERE url LIKE ?").run(`%${domain}%`)
  })
}

// ── Post-window setup ─────────────────────────────────────────────────────────
// Must be called from main.ts AFTER createWindow() so getMainWindow() is valid.
// registerIpcHandlers() runs before the window exists, so anything that needs the
// BrowserWindow instance must live here instead.
export function setupWindowListeners() {
  const win = getMainWindow()
  if (!win) {
    console.warn('[Dhurta] setupWindowListeners: no main window yet — call after createWindow()')
    return
  }

  // Right-click menu for the React chrome (new-tab page, URL bar, search bar).
  // BrowserView tabs have their own handler wired up in attachViewEvents.
  win.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      if (params.editFlags?.canCut)   items.push({ label: 'Cut',        click: () => win.webContents.cut() })
      if (params.editFlags?.canCopy || params.selectionText)
                                      items.push({ label: 'Copy',       click: () => win.webContents.copy() })
                                      items.push({ label: 'Paste',      click: () => win.webContents.paste() })
                                      items.push({ label: 'Select All', click: () => win.webContents.selectAll() })
    } else if (params.selectionText) {
      items.push({ label: 'Copy', click: () => win.webContents.copy() })
    }
    // Always show a menu — non-editable blank areas get Paste (so users can paste URLs)
    if (items.length === 0) {
      items.push({ label: 'Paste', click: () => win.webContents.paste() })
    }
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  // ── BrowserView bounds ────────────────────────────────────────────────────
  // Recalculate BrowserView bounds on every window state change so the view
  // never overlaps the React chrome (sidebar 64 px left, URL bar + tab bar 112 px top).
  // setAutoResize({ width, height }) handles proportional resize but does NOT
  // update x/y — explicit setBounds is needed after maximize/restore/fullscreen.
  const updateActiveBounds = () => {
    const tab = tabs.get(activeTabId)
    if (!tab || isNewTabUrl(tab.url)) return
    tab.view.setBounds(getTabBounds(win))
  }
  // Double-fire: once immediately (for synchronous transitions) and once after a
  // short delay (so getBounds() reflects the settled post-transition size on Windows).
  const updateWithDelay = () => {
    updateActiveBounds()
    setTimeout(updateActiveBounds, 80)
  }
  win.on('resize',           updateWithDelay)
  win.on('restore',          updateWithDelay)
  win.on('maximize',         updateWithDelay)
  win.on('unmaximize',       updateWithDelay)
  win.on('enter-full-screen', updateWithDelay)
  win.on('leave-full-screen', updateWithDelay)

  // ── macOS 3-finger swipe navigation ──────────────────────────────────────
  ;(win as any).on('swipe', (_e: unknown, direction: string) => {
    if (!gestureSwipe) return
    const tab = tabs.get(activeTabId)
    if (!tab) return
    if (direction === 'left')  goBackOrHome(tab.view.webContents, activeTabId)
    else if (direction === 'right') tab.view.webContents.goForward()
  })

  // ── Chakra Shield startup defaults ────────────────────────────────────────
  // On a brand-new install OR after Nuclear Wipe (which deletes the entire DB),
  // the 'chakra_initialized' key is absent. Write all Chakra security flags as
  // enabled so the browser launches with full protection by default — the user
  // never has to manually activate it. The VPN-restoration block below will see
  // security_ipRotation=true and connect a proxy automatically.
  {
    const initialized = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('chakra_initialized') as { value: string } | undefined
    if (!initialized) {
      const db = getDb()
      const set = (k: string, v: string) =>
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v)
      set('security_antiFingerprint', 'true')
      set('security_blockWebRTC',     'true')
      set('security_autoClean',       'true')
      set('cookieGuard',              'true')
      set('adBlocker',                'true')
      set('security_ipRotation',      'true')
      set('chakra_initialized',       'true')
    }
  }

  // ── VPN restoration ───────────────────────────────────────────────────────
  // Re-apply the saved proxy so VPN survives app restarts.
  // On first launch / after Nuclear Wipe, Chakra sets security_ipRotation=true
  // but activeProxy is empty — fetch a fresh proxy in the background so VPN
  // is actually active from the start, not just flagged as active in the DB.
  if (getSecurityFlag('security_ipRotation')) {
    const proxyRow = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('activeProxy') as any
    if (proxyRow?.value) {
      applyProxyToAllSessions(`socks5://${proxyRow.value}`).catch(() => {})
    } else {
      fetchFreeProxy().then(proxy => {
        if (!proxy) return
        return applyProxyToAllSessions(`socks5://${proxy}`).then(() => {
          getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('activeProxy', proxy)
        })
      }).catch(() => {})
    }
  }
}
