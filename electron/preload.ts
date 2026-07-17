import { contextBridge, ipcRenderer } from 'electron'

// ── IPC listener registry ─────────────────────────────────────────────────────
// ipcRenderer.on() wraps each cb in an anonymous function. Without tracking
// those wrappers, removeListener(channel, cb) silently fails (cb !== wrapper),
// causing listener accumulation and duplicate events (e.g. every window.open()
// opening N tabs because N copies of the handler piled up over tab switches).
const _wrappers = new Map<string, Map<Function, (...args: unknown[]) => void>>()

const VALID_CHANNELS = new Set([
  'tab:updated', 'tab:titleChanged', 'tab:faviconChanged',
  'tab:loadStart', 'tab:loadStop', 'tab:loadError',
  'interceptor:request', 'bridge:incoming', 'tab:openUrl',
  'zoom:level', 'browser:fullscreen',
  'download:start', 'download:update', 'download:done',
  'pip:loadInMain', 'menu:action', 'context-menu:action',
  'extension:installed', 'appLock:locked',
  'ghost:tor-crashed', 'ghost:tor-failed', 'ghost:upgradedToTor',
  'tor:circuitRotated', 'pip:opened', 'pip:closed',
  'update:checking', 'update:available', 'update:not-available',
  'update:progress', 'update:downloaded', 'update:error',
])

contextBridge.exposeInMainWorld('dhurta', {
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Navigation
  loadURL: (url: string) => ipcRenderer.invoke('nav:loadURL', url),
  goBack: (id: number) => ipcRenderer.invoke('nav:goBack', id),
  goForward: (id: number) => ipcRenderer.invoke('nav:goForward', id),
  reload: (id: number) => ipcRenderer.invoke('nav:reload', id),
  stop: (id: number) => ipcRenderer.invoke('nav:stop', id),

  // Tabs
  createTab: (url?: string, ghost?: boolean) => ipcRenderer.invoke('tab:create', url, ghost),
  closeTab: (id: number) => ipcRenderer.invoke('tab:close', id),
  switchTab: (id: number) => ipcRenderer.invoke('tab:switch', id),
  getTabs: () => ipcRenderer.invoke('tab:getAll'),

  // Ghost mode
  enableGhost: () => ipcRenderer.invoke('ghost:enable'),
  disableGhost: () => ipcRenderer.invoke('ghost:disable'),
  getGhostState: () => ipcRenderer.invoke('ghost:state'),
  getTorStatus: () => ipcRenderer.invoke('ghost:torStatus'),
  setExitNode: (country: string | null) => ipcRenderer.invoke('ghost:setExitNode', country),
  torNewnym: () => ipcRenderer.invoke('tor:newnym'),
  torCircuitCount: () => ipcRenderer.invoke('tor:circuitCount'),

  // Screen warmth (eye-protection blue-light filter)
  setWarmth: (level: number) => ipcRenderer.invoke('display:setWarmth', level),
  getWarmth: () => ipcRenderer.invoke('display:getWarmth'),

  // Native popup windows (download tray + warmth slider)
  // pos = { x, y } in SCREEN coordinates (viewport coords + window position)
  showDownloadPopup: (pos: { x: number; y: number }) => ipcRenderer.invoke('popup:showDownloads', pos),
  showWarmthPopup:   (pos: { x: number; y: number }) => ipcRenderer.invoke('popup:showWarmth', pos),
  getWindowPos: () => ipcRenderer.invoke('window:getPos') as Promise<[number, number]>,

  // Zoom
  zoomIn: (tabId: number) => ipcRenderer.invoke('zoom:in', tabId),
  zoomOut: (tabId: number) => ipcRenderer.invoke('zoom:out', tabId),
  zoomReset: (tabId: number) => ipcRenderer.invoke('zoom:reset', tabId),
  zoomGet: (tabId: number) => ipcRenderer.invoke('zoom:get', tabId),
  zoomStep: (tabId: number, direction: 'in' | 'out') => ipcRenderer.invoke('zoom:step', tabId, direction),
  zoomSet: (tabId: number, level: number) => ipcRenderer.invoke('zoom:set', tabId, level),

  // Privacy
  nukeJS: (tabId: number) => ipcRenderer.invoke('privacy:nukeJS', tabId),
  nuclearWipe: () => ipcRenderer.invoke('privacy:nuclearWipe'),
  clearCookies: () => ipcRenderer.invoke('privacy:clearCookies'),

  // File open dialog
  openFile: () => ipcRenderer.invoke('file:open'),
  pickImage: () => ipcRenderer.invoke('file:pickImage'),

  // History
  addHistory: (entry: { url: string; title: string; favicon?: string }) => ipcRenderer.invoke('history:add', entry),
  getHistory: (query?: string, limit?: number) => ipcRenderer.invoke('history:get', query, limit),
  deleteHistory: (id: number) => ipcRenderer.invoke('history:delete', id),
  setIncinerate: (days: number) => ipcRenderer.invoke('history:setIncinerate', days),

  // Bookmarks
  addBookmark: (b: { url: string; title: string; favicon?: string }) => ipcRenderer.invoke('bookmark:add', b),
  getBookmarks: () => ipcRenderer.invoke('bookmark:getAll'),
  deleteBookmark: (id: number) => ipcRenderer.invoke('bookmark:delete', id),
  reorderBookmarks: (orderedIds: number[]) => ipcRenderer.invoke('bookmark:reorder', orderedIds),
  getBookmarkOrder: () => ipcRenderer.invoke('bookmark:getOrder'),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // Panel layout sync
  setPanelWidth: (width: number) => ipcRenderer.invoke('panel:setWidth', width),

  // Security
  getSecuritySettings: () => ipcRenderer.invoke('security:getSettings'),
  setIPRotation: (enabled: boolean) => ipcRenderer.invoke('security:setIPRotation', enabled),
  rotateProxy: () => ipcRenderer.invoke('security:rotateProxy'),
  setAntiFingerprint: (enabled: boolean) => ipcRenderer.invoke('security:setAntiFingerprint', enabled),
  setBlockWebRTC: (enabled: boolean) => ipcRenderer.invoke('security:setBlockWebRTC', enabled),
  setAutoClean: (enabled: boolean) => ipcRenderer.invoke('security:setAutoClean', enabled),

  // Window fullscreen
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),

  // Network connectivity (real internet check, not just adapter)
  checkOnline: () => ipcRenderer.invoke('net:checkOnline') as Promise<boolean>,

  // VPN
  vpnConnect: (country?: string) => ipcRenderer.invoke('vpn:connect', country),
  vpnDisconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  vpnRotate: () => ipcRenderer.invoke('vpn:rotate'),

  // Kill-switch — seals traffic during privacy-mode transitions (fail closed)
  netKillSwitch: () => ipcRenderer.invoke('net:killSwitch'),
  netRelease: () => ipcRenderer.invoke('net:release'),
  checkPublicIp: (tabId?: number) => ipcRenderer.invoke('omni:checkIp', tabId),
  checkRealIp: () => ipcRenderer.invoke('omni:checkRealIp'),
  getBlockedCount: () => ipcRenderer.invoke('omni:getBlockedCount'),
  getFingerprint: (tabId?: number) => ipcRenderer.invoke('omni:getFingerprint', tabId),

  // Picture-in-Picture / Pop-out
  pipVideoMode: () => ipcRenderer.invoke('pip:videoMode'),
  pipOpenPage: (url?: string) => ipcRenderer.invoke('pip:openPage', url),
  pipClose: () => ipcRenderer.invoke('pip:winClose'),
  pipStatus: () => ipcRenderer.invoke('pip:status'),

  // DevTools
  devToolsToggle: (mode?: string) => ipcRenderer.invoke('devtools:toggle', mode),

  // Tab actions
  duplicateTab: () => ipcRenderer.invoke('tab:duplicate'),

  // Find in page
  findInPage: (text: string) => ipcRenderer.invoke('findInPage:start', text),
  findInPageNext: (text: string, forward?: boolean) => ipcRenderer.invoke('findInPage:next', text, forward),
  findInPageStop: () => ipcRenderer.invoke('findInPage:stop'),

  // Downloads
  getDownloads:           () =>           ipcRenderer.invoke('downloads:getAll'),
  clearDownloads:         () =>           ipcRenderer.invoke('downloads:clear'),
  openDownloadItem:       (id: string) => ipcRenderer.invoke('downloads:openItem', id),
  showDownloadInFolder:   (id: string) => ipcRenderer.invoke('downloads:showInFolder', id),
  pauseDownload:          (id: string) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload:         (id: string) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload:         (id: string) => ipcRenderer.invoke('downloads:cancel', id),
  removeDownload:         (id: string) => ipcRenderer.invoke('downloads:remove', id),
  deleteDownloadFile:     (id: string) => ipcRenderer.invoke('downloads:deleteFile', id),
  getDownloadDefaultPath: ()           => ipcRenderer.invoke('downloads:getDefaultPath'),
  setDownloadDefaultPath: ()           => ipcRenderer.invoke('downloads:setDefaultPath'),

  // Extensions
  openExtensionPopup: (id: string) => ipcRenderer.invoke('extensions:openPopup', id),
  loadExtension: () => ipcRenderer.invoke('extensions:load'),
  loadCrxExtension: () => ipcRenderer.invoke('extensions:installCrx'),
  installExtensionFromWebStore: (extId: string) => ipcRenderer.invoke('extensions:installFromWebStore', extId),
  installExtensionFromAMO: (slug: string) => ipcRenderer.invoke('extensions:installFromAMO', slug),
  getExtensions: () => ipcRenderer.invoke('extensions:getAll'),
  removeExtension: (id: string) => ipcRenderer.invoke('extensions:remove', id),
  openExtensionOptions: (id: string) => ipcRenderer.invoke('extensions:openOptions', id),
  showExtensionTrayMenu: () => ipcRenderer.invoke('extensions:showTrayMenu'),

  // Bookmark utilities
  isBookmarked: (url: string) => ipcRenderer.invoke('bookmark:check', url),
  updateBookmark: (id: number, updates: { url?: string; title?: string }) => ipcRenderer.invoke('bookmark:update', id, updates),

  // App Lock
  appLockStatus:    () => ipcRenderer.invoke('appLock:status'),
  appLockSetup:     (pin: string) => ipcRenderer.invoke('appLock:setup', pin),
  appLockUnlock:    (pin: string) => ipcRenderer.invoke('appLock:unlock', pin),
  appLockLock:      () => ipcRenderer.invoke('appLock:lock'),
  appLockClear:     (pin: string) => ipcRenderer.invoke('appLock:clear', pin),
  appLockChangePin: (oldPin: string, newPin: string) => ipcRenderer.invoke('appLock:changePin', oldPin, newPin),
  appLockRecover:   (phrase: string) => ipcRenderer.invoke('appLock:recover', phrase),

  // Transparency Dashboard
  getTransparencyData: () => ipcRenderer.invoke('transparency:getData'),
  exportMyData: () => ipcRenderer.invoke('transparency:export'),
  sendCrashReport: () => ipcRenderer.invoke('transparency:sendCrashReport'),

  // Native OS menus — render above BrowserViews
  showThreeDotMenu: (opts: { url: string }) => ipcRenderer.invoke('menu:showThreeDot', opts),

  // Tab context menu — native OS menu so it renders above BrowserViews
  showTabContextMenu: (opts: { tabId: number; tabCount: number; x: number; y: number }) =>
    ipcRenderer.invoke('tab:showContextMenu', opts),

  // BrowserView conceal/reveal — React dropdowns call these so they're visible above web pages
  concealBrowserView: (side?: 'left' | 'right') => ipcRenderer.invoke('view:conceal', side ?? 'right'),
  revealBrowserView:  () => ipcRenderer.invoke('view:reveal'),

  // Sidebar apps popup — native BrowserWindow like the download popup
  showAppsPopup: (pos: { x: number; y: number }) => ipcRenderer.invoke('popup:showApps', pos),
  showToolsPopup: (pos: { x: number; y: number }) => ipcRenderer.invoke('popup:showTools', pos),
  getAppIconDataUrl: (url: string) => ipcRenderer.invoke('apps:getIconDataUrl', url),

  // PiP controls from the main window (tab-bar chip)
  closePip: () => ipcRenderer.invoke('pip:close'),
  focusMain: () => ipcRenderer.invoke('window:focusMain'),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate:   () => ipcRenderer.invoke('update:install'),

  // Search suggestions (fetched via main process to bypass CORS)
  fetchSuggestions: (engine: string, query: string) =>
    ipcRenderer.invoke('suggest:fetch', engine, query) as Promise<string[]>,

  // Site info panel — connection, cookie count, clear data, history wipe
  siteGetInfo:      (tabId: number) => ipcRenderer.invoke('site:getInfo', tabId),
  siteClearData:    (tabId: number) => ipcRenderer.invoke('site:clearData', tabId) as Promise<boolean>,
  siteClearHistory: (domain: string) => ipcRenderer.invoke('site:clearHistory', domain),

  // Bridge — browser-to-browser connect
  bridgeHost: () => ipcRenderer.invoke('bridge:host'),
  bridgeStop: () => ipcRenderer.invoke('bridge:stop'),
  bridgePeek: (code: string) => ipcRenderer.invoke('bridge:peek', code),
  bridgePush: (code: string, url: string, title: string) => ipcRenderer.invoke('bridge:push', code, url, title),

  // API interceptor
  getRequests: (tabId: number) => ipcRenderer.invoke('interceptor:getRequests', tabId),

  // Events from main — wrapper-tracked so off() actually removes the right listener
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    if (!VALID_CHANNELS.has(channel)) return
    // Guard: if cb is already registered, remove the old wrapper first so it
    // cannot accumulate (e.g. if off() was skipped due to an early return).
    if (!_wrappers.has(channel)) _wrappers.set(channel, new Map())
    const chMap = _wrappers.get(channel)!
    const existing = chMap.get(cb)
    if (existing) ipcRenderer.removeListener(channel, existing)
    const wrapper = (_e: unknown, ...args: unknown[]) => cb(...args)
    chMap.set(cb, wrapper)
    ipcRenderer.on(channel, wrapper)
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    const chMap = _wrappers.get(channel)
    if (!chMap) return
    const wrapper = chMap.get(cb)
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper)
      chMap.delete(cb)
    }
  },
})
