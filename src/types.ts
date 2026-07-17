export interface Tab {
  id: number
  url: string
  title: string
  favicon: string
  loading: boolean
  ghost: boolean
  active: boolean
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  favicon: string
  visited_at: number
}

export interface Bookmark {
  id: number
  url: string
  title: string
  favicon: string
  created_at: number
}

export interface RequestEntry {
  id: string
  method: string
  url: string
  type: string
  timestamp: number
  status?: number
}

export type Panel =
  | null
  | 'history'
  | 'bookmarks'
  | 'interceptor'
  | 'network'
  | 'settings'
  | 'security'
  | 'connect'
  | 'downloads'
  | 'extensions'
  | 'data'
  | 'transparency'

export interface LockStatus {
  locked: boolean
  hasPin: boolean
}

export interface TransparencyData {
  history:     { count: number; oldestDate: string | null; newestDate: string | null }
  bookmarks:   { count: number }
  extensions:  { count: number; names: string[] }
  settings:    Record<string, string>
  dbSizeKb:    number
  crashLogs:   number
}

export interface Download {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  percent: number        // 0-100, or -1 if size unknown
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  speed?: number         // bytes/sec, present during active downloads
}

export interface Extension {
  id: string
  name: string
  version: string
  description: string
  path?: string
  icons?: Record<string, string>
  optionsPage?: string   // chrome-extension:// URL to options page, if present
  popupPage?: string     // chrome-extension:// URL to browser action popup, if present
}

export interface SecuritySettings {
  ipRotation: boolean
  antiFingerprint: boolean
  blockWebRTC: boolean
  autoClean: boolean
}

export interface BridgePeerState {
  url: string
  title: string
  favicon?: string
}

export interface DhurtaAPI {
  platform: string
  minimize(): Promise<void>
  maximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  loadURL(url: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  stop(id: number): Promise<void>
  createTab(url?: string, ghost?: boolean): Promise<Tab>
  closeTab(id: number): Promise<void>
  switchTab(id: number): Promise<void>
  getTabs(): Promise<Tab[]>
  enableGhost(): Promise<void>
  disableGhost(): Promise<void>
  getGhostState(): Promise<boolean>
  getTorStatus(): Promise<boolean>
  setExitNode(country: string | null): Promise<{ success: boolean; restarted?: boolean; error?: string }>
  torNewnym(): Promise<{ success: boolean; count?: number; error?: string }>
  torCircuitCount(): Promise<number>
  getTorBootstrapProgress(): Promise<{
    percent: number; tag: string; summary: string; elapsedMs: number; etaMs: number | null
  }>
  setWarmth(level: number): Promise<void>
  getWarmth(): Promise<number>
  showDownloadPopup(pos: { x: number; y: number }): Promise<void>
  showWarmthPopup(pos: { x: number; y: number }): Promise<void>
  showSitePopup(pos: { x: number; y: number }, tabId: number, url: string): Promise<void>
  getWindowPos(): Promise<[number, number]>
  zoomIn(tabId: number): Promise<number>
  zoomOut(tabId: number): Promise<number>
  zoomReset(tabId: number): Promise<number>
  zoomGet(tabId: number): Promise<number>
  zoomStep(tabId: number, direction: 'in' | 'out'): Promise<number>
  zoomSet(tabId: number, level: number): Promise<number>
  nukeJS(tabId: number): Promise<boolean>
  nuclearWipe(): Promise<void>
  clearCookies(): Promise<void>
  openFile(): Promise<string | null>
  pickImage(): Promise<string | null>
  toggleFullscreen(): Promise<boolean>
  checkOnline(): Promise<boolean>
  vpnConnect(country?: string): Promise<{ success: boolean; proxy?: string; country?: string; error?: string }>
  vpnDisconnect(): Promise<void>
  vpnRotate(): Promise<{ success: boolean; proxy?: string; error?: string }>
  netKillSwitch(): Promise<void>
  netRelease(): Promise<void>
  checkPublicIp(tabId?: number): Promise<{
    success: boolean; ip?: string; country?: string; countryCode?: string
    city?: string; region?: string; lat?: number; lon?: number; org?: string; error?: string
  }>
  checkRealIp(): Promise<{
    success: boolean; ip?: string; country?: string; countryCode?: string
    city?: string; region?: string; lat?: number; lon?: number; org?: string; error?: string
  }>
  getBlockedCount(): Promise<number>
  getFingerprint(tabId?: number): Promise<{
    success?: boolean; error?: string
    userAgent?: string; platform?: string
    screenWidth?: number; screenHeight?: number; colorDepth?: number; devicePixelRatio?: number
    hardwareConcurrency?: number; deviceMemory?: number; languages?: string
    doNotTrack?: string | null; webdriver?: boolean; pluginsCount?: number
    timezone?: string; webglVendor?: string; webglRenderer?: string
  }>
  addHistory(entry: { url: string; title: string; favicon?: string }): Promise<void>
  getHistory(query?: string, limit?: number): Promise<HistoryEntry[]>
  deleteHistory(id: number): Promise<void>
  setIncinerate(days: number): Promise<void>
  addBookmark(b: { url: string; title: string; favicon?: string }): Promise<void>
  getBookmarks(): Promise<Bookmark[]>
  deleteBookmark(id: number): Promise<void>
  updateBookmark(id: number, updates: { url?: string; title?: string }): Promise<boolean>
  reorderBookmarks(orderedIds: number[]): Promise<void>
  getBookmarkOrder(): Promise<number[]>
  getSetting(key: string): Promise<string>
  setSetting(key: string, value: string): Promise<void>
  setPanelWidth(width: number): Promise<void>
  getSecuritySettings(): Promise<SecuritySettings>
  setIPRotation(enabled: boolean): Promise<{ success: boolean; proxy?: string; error?: string }>
  setAntiFingerprint(enabled: boolean): Promise<void>
  setBlockWebRTC(enabled: boolean): Promise<void>
  setAutoClean(enabled: boolean): Promise<void>
  rotateProxy(): Promise<{ success: boolean; proxy?: string; error?: string }>
  bridgeHost(): Promise<{ code: string; port: number }>
  bridgeStop(): Promise<void>
  bridgePeek(code: string): Promise<BridgePeerState | null>
  bridgePush(code: string, url: string, title: string): Promise<boolean>
  getRequests(tabId: number): Promise<RequestEntry[]>
  pipVideoMode(): Promise<{ success?: boolean; action?: string; error?: string }>
  pipOpenPage(url?: string): Promise<{ success?: boolean; error?: string }>
  pipClose(): Promise<void>
  pipStatus(): Promise<{ isOpen: boolean; url: string }>
  devToolsToggle(mode?: string): Promise<void>
  duplicateTab(): Promise<Tab | null>
  findInPage(text: string): Promise<void>
  findInPageNext(text: string, forward?: boolean): Promise<void>
  findInPageStop(): Promise<void>
  getDownloads(): Promise<Download[]>
  clearDownloads(): Promise<Download[]>
  openDownloadItem(id: string): Promise<void>
  showDownloadInFolder(id: string): Promise<void>
  pauseDownload(id: string): Promise<void>
  resumeDownload(id: string): Promise<void>
  cancelDownload(id: string): Promise<void>
  removeDownload(id: string): Promise<Download[]>
  deleteDownloadFile(id: string): Promise<Download[]>
  getDownloadDefaultPath(): Promise<string>
  setDownloadDefaultPath(): Promise<string | null>
  openExtensionPopup(id: string): Promise<{ ok?: boolean; error?: string } | void>
  loadExtension(): Promise<{ id?: string; name?: string; version?: string; error?: string }>
  loadCrxExtension(): Promise<{ id?: string; name?: string; version?: string; error?: string }>
  installExtensionFromAMO(slug: string): Promise<{ id?: string; name?: string; error?: string }>
  getExtensions(): Promise<Extension[]>
  removeExtension(id: string): Promise<boolean>
  openExtensionOptions(id: string): Promise<{ url?: string; error?: string }>
  showExtensionTrayMenu(): Promise<void>
  isBookmarked(url: string): Promise<boolean>
  showThreeDotMenu(opts: { url: string }): Promise<void>
  showTabContextMenu(opts: { tabId: number; tabCount: number; x: number; y: number }): Promise<void>
  showAppsPopup(pos: { x: number; y: number }): Promise<void>
  getAppIconDataUrl(url: string): Promise<string | null>
  closePip(): Promise<void>
  focusMain(): Promise<void>
  appLockStatus(): Promise<LockStatus>
  appLockSetup(pin: string): Promise<{ recovery: string }>
  appLockUnlock(pin: string): Promise<{ ok: boolean }>
  appLockLock(): Promise<boolean>
  appLockClear(pin: string): Promise<{ ok: boolean }>
  appLockChangePin(oldPin: string, newPin: string): Promise<{ ok: boolean }>
  appLockRecover(phrase: string): Promise<{ ok: boolean }>
  getTransparencyData(): Promise<TransparencyData>
  exportMyData(): Promise<string>
  sendCrashReport(): Promise<{ success: boolean; url?: string; error?: string }>
  on(channel: string, cb: (...args: unknown[]) => void): void
  off(channel: string, cb: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    dhurta: DhurtaAPI
  }
}
