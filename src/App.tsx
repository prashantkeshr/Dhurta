import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBrowser } from './store/useBrowser'
import { useTheme } from './store/useTheme'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import URLBar from './components/URLBar'
import NewTabPage from './components/NewTabPage'
import HistoryPanel from './components/panels/HistoryPanel'
import BookmarksPanel from './components/panels/BookmarksPanel'
import InterceptorPanel from './components/panels/InterceptorPanel'
import NetworkPanel from './components/panels/NetworkPanel'
import SettingsPanel from './components/panels/SettingsPanel'
import SecurityPanel from './components/panels/SecurityPanel'
import ConnectPanel from './components/panels/ConnectPanel'
import DownloadsPanel from './components/panels/DownloadsPanel'
import ExtensionsPanel from './components/panels/ExtensionsPanel'
import DataHubPanel from './components/panels/DataHubPanel'
import TransparencyPanel from './components/panels/TransparencyPanel'
import LockScreen from './components/LockScreen'
import SecurityBreachBanner from './components/SecurityBreachBanner'
import UpdateBanner from './components/UpdateBanner'
import HistoryPage from './pages/HistoryPage'
import BookmarksPage from './pages/BookmarksPage'
import DownloadsPage from './pages/DownloadsPage'
import OmniPage from './pages/OmniPage'
import UpdatePage from './pages/UpdatePage'
import type { SecuritySettings, Extension, LockStatus, Download } from './types'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

const EMPTY_SECURITY: SecuritySettings = {
  ipRotation: false,
  antiFingerprint: false,
  blockWebRTC: false,
  autoClean: false,
}

// Raw preferred widths — will be clamped to viewport at runtime
const PANEL_WIDTHS: Record<string, number> = {
  history: 288,
  bookmarks: 288,
  interceptor: 384,
  network: 384,
  settings: 580,
  security: 300,
  connect: 288,
  downloads: 300,
  extensions: 300,
  data: 360,
  transparency: 360,
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme()

  const {
    tabs,
    activeTabId,
    activeTab,
    ghostMode,
    torActive,
    torConnecting,
    chakraActive,
    chakraBusy,
    chakraWarning,
    setChakraWarning,
    toggleChakra,
    activePanel,
    setActivePanel,
    urlInput,
    setUrlInput,
    jsDisabled,
    zoomLevel,
    isVideoFullscreen,
    newTab,
    closeTab,
    switchTab,
    navigate,
    toggleGhost,
    toggleJS,
    nuclearWipe,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomStep,
    duplicateTab,
    closeOtherTabs,
    pipActive,
    pipTitle,
  } = useBrowser()

  const [securityStatus, setSecurityStatus] = useState<SecuritySettings>(EMPTY_SECURITY)
  const [wallpapers, setWallpapers] = useState<string[]>([])
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [lockStatus, setLockStatus] = useState<LockStatus>({ locked: false, hasPin: false })
  const [downloads, setDownloads] = useState<Download[]>([])
  const [warmthLevel, setWarmthLevel] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  // Track window width for responsive panel sizing
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Clamp panel width so the BrowserView always has at least 260px
  const activePanelWidth = useMemo(() => {
    if (!activePanel) return 0
    const raw = PANEL_WIDTHS[activePanel] ?? 288
    const maxAllowed = Math.max(200, windowWidth - 64 - 260) // 64=sidebar, 260=min browser area
    return Math.min(raw, maxAllowed)
  }, [activePanel, windowWidth])

  // ── Screen warmth ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.dhurta.getWarmth().then(setWarmthLevel).catch(() => {})
  }, [])

  const handleWarmthChange = useCallback((level: number) => {
    setWarmthLevel(level)
    if (isElectron) window.dhurta.setWarmth(level).catch(() => {})
  }, [])

  // Compute warmth filter for the React chrome (sidebar, URLBar, panels)
  const warmthStyle = warmthLevel > 0
    ? { filter: `sepia(${(warmthLevel / 200).toFixed(3)}) brightness(${(1 - warmthLevel / 1000).toFixed(3)})` }
    : undefined

  // ── App Lock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.dhurta.appLockStatus().then(setLockStatus).catch(() => {})
    const onLocked = () => {
      window.dhurta.appLockStatus().then(setLockStatus).catch(() => {})
    }
    window.dhurta.on('appLock:locked', onLocked as never)
    return () => window.dhurta.off('appLock:locked', onLocked as never)
  }, [])

  // ── Extensions list (for toolbar) ───────────────────────────────────────────
  const refreshExtensions = useCallback(() => {
    if (!isElectron) return
    window.dhurta.getExtensions().then(setExtensions).catch(() => {})
  }, [])

  useEffect(() => { refreshExtensions() }, [refreshExtensions])

  useEffect(() => {
    if (!isElectron) return
    const handler = () => refreshExtensions()
    window.dhurta.on('extension:installed', handler as never)
    return () => window.dhurta.off('extension:installed', handler as never)
  }, [refreshExtensions])

  // ── Download tracking ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return

    const onStart = (d: Download) => {
      setDownloads(prev => {
        // avoid duplicates on hot-reload
        const without = prev.filter(x => x.id !== d.id)
        return [d, ...without].slice(0, 20)
      })
    }

    const onUpdate = (u: { id: string; receivedBytes: number; totalBytes: number; state: string; percent: number }) => {
      setDownloads(prev => prev.map(d =>
        d.id === u.id
          ? { ...d, receivedBytes: u.receivedBytes, totalBytes: u.totalBytes, state: u.state as Download['state'], percent: u.percent }
          : d
      ))
    }

    const onDone = (u: { id: string; savePath: string; state: string; percent: number }) => {
      setDownloads(prev => prev.map(d =>
        d.id === u.id
          ? { ...d, savePath: u.savePath, state: u.state as Download['state'], percent: u.state === 'completed' ? 100 : u.percent }
          : d
      ))
    }

    window.dhurta.on('download:start',  onStart as never)
    window.dhurta.on('download:update', onUpdate as never)
    window.dhurta.on('download:done',   onDone as never)
    return () => {
      window.dhurta.off('download:start',  onStart as never)
      window.dhurta.off('download:update', onUpdate as never)
      window.dhurta.off('download:done',   onDone as never)
    }
  }, [])

  const loadWallpapers = useCallback(() => {
    if (!isElectron) return
    window.dhurta.getSetting('wallpapers').then(v => {
      try { setWallpapers(JSON.parse(v || '[]')) } catch { setWallpapers([]) }
    }).catch(() => {})
  }, [])

  // Load wallpapers on mount and whenever the settings panel closes
  useEffect(() => { loadWallpapers() }, [activePanel, loadWallpapers])

  // Real-time reload when SettingsPanel saves wallpapers
  useEffect(() => {
    if (!isElectron) return
    const handler = (e: Event) => {
      const { key } = (e as CustomEvent<{ key: string }>).detail
      if (key === 'wallpapers') loadWallpapers()
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [loadWallpapers])

  // Internal dhurta:// pages rendered as React full-page components (no BrowserView)
  const DHURTA_PAGES = ['dhurta://history', 'dhurta://bookmarks', 'dhurta://downloads', 'dhurta://omni', 'dhurta://update'] as const
  const activeDhurtaPage = activeTab?.url && (DHURTA_PAGES as readonly string[]).includes(activeTab.url)
    ? activeTab.url as typeof DHURTA_PAGES[number]
    : null

  const isNewTab =
    !activeTab ||
    activeTab.url === 'dhurta://newtab' ||
    activeTab.url === '' ||
    activeTab.url === 'about:blank'

  const isInternalPage = isNewTab || activeDhurtaPage !== null

  // Load security status on mount / panel close, and keep in sync via real-time events
  useEffect(() => {
    if (!isElectron) return
    window.dhurta.getSecuritySettings().then(setSecurityStatus).catch(() => {})
  }, [activePanel])

  useEffect(() => {
    if (!isElectron) return
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail
      const on = value === 'true'
      if (key === 'security_ipRotation')      setSecurityStatus(s => ({ ...s, ipRotation: on }))
      if (key === 'security_antiFingerprint') setSecurityStatus(s => ({ ...s, antiFingerprint: on }))
      if (key === 'security_blockWebRTC')     setSecurityStatus(s => ({ ...s, blockWebRTC: on }))
      if (key === 'security_autoClean')       setSecurityStatus(s => ({ ...s, autoClean: on }))
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [])

  const handleNavigate = useCallback(
    (url: string) => {
      navigate(url)
      setUrlInput(url)
    },
    [navigate, setUrlInput]
  )

  // Custom navigate event fired from panels (e.g. "Open Chrome Web Store" in ExtensionsPanel)
  useEffect(() => {
    const handler = (e: Event) => handleNavigate((e as CustomEvent).detail)
    window.addEventListener('dhurta:navigate', handler)
    return () => window.removeEventListener('dhurta:navigate', handler)
  }, [handleNavigate])

  const handleOpenFile = useCallback(async () => {
    if (!isElectron) return
    const fileUrl = await window.dhurta.openFile()
    if (fileUrl) handleNavigate(fileUrl)
  }, [handleNavigate])

  const handleBookmark = useCallback(async () => {
    if (!activeTab || !isElectron) return
    await window.dhurta.addBookmark({
      url: activeTab.url,
      title: activeTab.title,
      favicon: activeTab.favicon,
    })
  }, [activeTab])

  const handleBookmarkTab = useCallback(async (tabId: number) => {
    if (!isElectron) return
    const t = tabs.find(t => t.id === tabId)
    if (!t) return
    await window.dhurta.addBookmark({ url: t.url, title: t.title, favicon: t.favicon })
  }, [tabs])

  const handleBack = useCallback(() => {
    if (activeTabId > 0 && isElectron) window.dhurta.goBack(activeTabId)
  }, [activeTabId])

  const handleForward = useCallback(() => {
    if (activeTabId > 0 && isElectron) window.dhurta.goForward(activeTabId)
  }, [activeTabId])

  const handleReload = useCallback(() => {
    if (!activeTab || !isElectron) return
    if (activeTab.loading) window.dhurta.stop(activeTabId)
    else window.dhurta.reload(activeTabId)
  }, [activeTab, activeTabId])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isElectron) return
      if (e.key === 'F11') { e.preventDefault(); window.dhurta.toggleFullscreen() }
      if (e.key === 'F12') { e.preventDefault(); window.dhurta.devToolsToggle('detach') }
      if (e.key === 'Escape' && activePanel) { e.preventDefault(); setActivePanel(null) }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault() } // handled by ThreeDotMenu
      if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn() }
        else if (e.key === '-') { e.preventDefault(); zoomOut() }
        else if (e.key === '0') { e.preventDefault(); zoomReset() }
        else if (e.key === 't') { e.preventDefault(); newTab() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIn, zoomOut, zoomReset, newTab])

  // Ctrl+Scroll zoom in the React chrome area (not inside BrowserView)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!isElectron || !e.ctrlKey) return
      e.preventDefault()
      zoomStep(e.deltaY < 0 ? 'in' : 'out')
    }
    const el = contentRef.current
    el?.addEventListener('wheel', onWheel, { passive: false })
    return () => el?.removeEventListener('wheel', onWheel)
  }, [zoomStep])

  // Tell main process the actual clamped panel width so it repositions BrowserView correctly
  useEffect(() => {
    if (!isElectron) return
    window.dhurta.setPanelWidth(activePanelWidth)
  }, [activePanelWidth])

  // Drag-drop files onto the browser window
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0] as File & { path?: string }
    if (file && file.path) {
      handleNavigate('file:///' + file.path.replace(/\\/g, '/'))
    }
  }, [handleNavigate])

  if (lockStatus.locked) {
    return <LockScreen hasPin={lockStatus.hasPin} onUnlocked={() => setLockStatus(s => ({ ...s, locked: false }))} />
  }

  return (
    <div
      className="flex flex-col h-screen w-screen bg-obsidian overflow-hidden"
      style={warmthStyle}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Chrome hidden when video is fullscreen — BrowserView covers entire window */}
      {!isVideoFullscreen && <TitleBar title={activeTab?.title ?? 'Dhurta'} onOpenOmni={() => handleNavigate('dhurta://omni')} />}

      <div className={['flex overflow-hidden', isVideoFullscreen ? 'h-screen' : 'flex-1'].join(' ')}>
        {/* Sidebar + panel drawer — hidden during video fullscreen */}
        {!isVideoFullscreen && (
          <>
            <Sidebar
              ghostMode={ghostMode}
              torActive={torActive}
              torConnecting={torConnecting}
              chakraActive={chakraActive}
              chakraBusy={chakraBusy}
              chakraWarning={chakraWarning}
              onDismissChakraWarning={() => setChakraWarning(null)}
              activePanel={activePanel}
              onToggleGhost={toggleGhost}
              onToggleChakra={toggleChakra}
              onSetPanel={setActivePanel}
              onNuclearWipe={nuclearWipe}
              onNewTab={() => newTab()}
              onNavigate={handleNavigate}
              onLock={isElectron ? async () => {
                await window.dhurta.appLockLock()
                setLockStatus({ locked: true, hasPin: true })
              } : undefined}
              hasLock={lockStatus.hasPin}
              onSetupLock={() => setLockStatus({ locked: true, hasPin: false })}
            />
            {activePanel && activePanelWidth > 0 && (
              <div
                className="relative flex shrink-0 h-full border-r border-border z-40 overflow-hidden"
                style={{ width: activePanelWidth }}
              >
                {activePanel === 'history' && <HistoryPanel onNavigate={handleNavigate} />}
                {activePanel === 'bookmarks' && (
                  <BookmarksPanel
                    onNavigate={handleNavigate}
                    currentUrl={activeTab?.url ?? ''}
                    currentTitle={activeTab?.title ?? ''}
                  />
                )}
                {activePanel === 'interceptor' && <InterceptorPanel activeTabId={activeTabId} />}
                {activePanel === 'network' && <NetworkPanel activeTabId={activeTabId} />}
                {activePanel === 'settings' && <SettingsPanel />}
                {activePanel === 'security' && <SecurityPanel />}
                {activePanel === 'downloads' && <DownloadsPanel />}
                {activePanel === 'extensions' && <ExtensionsPanel />}
                {activePanel === 'data' && <DataHubPanel onNavigate={handleNavigate} />}
                {activePanel === 'transparency' && <TransparencyPanel />}
                {activePanel === 'connect' && (
                  <ConnectPanel
                    activeUrl={activeTab?.url ?? ''}
                    activeTitle={activeTab?.title ?? ''}
                    onNavigate={handleNavigate}
                  />
                )}
                {/* Close button — visible on hover, always clickable */}
                <button
                  onClick={() => setActivePanel(null)}
                  title="Close panel (Esc)"
                  className="absolute top-2 right-2 z-50 w-5 h-5 flex items-center justify-center text-muted hover:text-saffron bg-surface/80 border border-border/50 hover:border-saffron transition-colors text-[10px]"
                >✕</button>
              </div>
            )}
          </>
        )}

        {/* Main browser area — TabBar/URLBar hidden when BrowserView covers the window (video fullscreen) */}
        <div className="flex flex-col flex-1 overflow-hidden" ref={contentRef}>
          {!isVideoFullscreen && (
            <>
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSwitch={switchTab}
                onClose={closeTab}
                onNew={() => newTab()}
                onNewGhost={() => newTab(undefined, true)}
                onDuplicate={duplicateTab}
                onBookmark={handleBookmarkTab}
                onCloseOthers={closeOtherTabs}
                pipActive={pipActive}
                pipTitle={pipTitle}
              />
              <URLBar
                url={urlInput}
                loading={activeTab?.loading ?? false}
                ghost={activeTab?.ghost ?? false}
                jsDisabled={jsDisabled}
                activeTabId={activeTabId}
                zoomLevel={zoomLevel}
                securityStatus={securityStatus}
                extensions={extensions}
                onNavigate={handleNavigate}
                onBack={handleBack}
                onForward={handleForward}
                onReload={handleReload}
                onToggleJS={toggleJS}
                onBookmark={handleBookmark}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onZoomReset={zoomReset}
                onOpenFile={handleOpenFile}
                onOpenExtensions={() => setActivePanel(activePanel === 'extensions' ? null : 'extensions')}
                downloads={downloads}
                onOpenDownloads={() => handleNavigate('dhurta://downloads')}
                theme={theme}
                onThemeToggle={toggleTheme}
                warmthLevel={warmthLevel}
                onWarmthChange={handleWarmthChange}
              />
            </>
          )}

          {/* Security breach warnings — shown when VPN / WebRTC block / anti-fingerprint are off */}
          {!isVideoFullscreen && (
            <SecurityBreachBanner
              securityStatus={securityStatus}
              ghostMode={ghostMode}
              onOpenSecurity={() => setActivePanel('security')}
              onStatusChange={setSecurityStatus}
            />
          )}

          {/* Auto-update notification — shown when a new version is downloading or ready */}
          {!isVideoFullscreen && (
            <UpdateBanner onOpenUpdatePage={() => handleNavigate('dhurta://update')} />
          )}

          {/* Content area */}
          <div className="flex-1 relative bg-obsidian overflow-hidden">
            {/* Page-load progress bar — Chrome-style thin bar at the top */}
            <PageLoadBar loading={activeTab?.loading ?? false} />

            {/* Internal dhurta:// pages have no BrowserView of their own, so the
                browser's normal Ctrl+scroll zoom (which sets zoom factor on the
                active tab's BrowserView) has no visible effect on them by default.
                Reusing the same zoomLevel value here via CSS zoom makes the
                existing shortcut/state apply visually to these pages too — no
                separate zoom control needed. */}
            <div style={{ zoom: zoomLevel, height: '100%' }}>
              {isNewTab && !isVideoFullscreen && (
                <NewTabPage
                  onNavigate={handleNavigate}
                  ghost={activeTab?.ghost ?? ghostMode}
                  wallpapers={wallpapers}
                  browserTheme={theme}
                />
              )}
              {activeDhurtaPage === 'dhurta://history' && (
                <HistoryPage onNavigate={handleNavigate} />
              )}
              {activeDhurtaPage === 'dhurta://bookmarks' && (
                <BookmarksPage onNavigate={handleNavigate} />
              )}
              {activeDhurtaPage === 'dhurta://downloads' && (
                <DownloadsPage />
              )}
              {activeDhurtaPage === 'dhurta://omni' && (
                <OmniPage activeTabId={activeTabId} theme={theme} />
              )}
              {activeDhurtaPage === 'dhurta://update' && (
                <UpdatePage />
              )}
            </div>
            {/* BrowserView overlays this area for real pages */}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page-load progress bar ────────────────────────────────────────────────────
// Chrome-style thin bar at the very top of the content area.
// Uses a fake-progress approach: sprints to ~85% while loading, then completes.
function PageLoadBar({ loading }: { loading: boolean }) {
  const [width, setWidth]     = React.useState(0)
  const [visible, setVisible] = React.useState(false)
  const timer  = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const fadeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (loading) {
      // Start: appear at 5% and increment to ~85% over ~2 s
      setVisible(true)
      setWidth(5)
      if (timer.current) clearInterval(timer.current)
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      let w = 5
      timer.current = setInterval(() => {
        // Decelerate as we approach 85%
        const step = Math.max(0.4, (85 - w) * 0.06)
        w = Math.min(85, w + step)
        setWidth(w)
        if (w >= 85) { clearInterval(timer.current!); timer.current = null }
      }, 60)
    } else {
      // Complete: jump to 100% then fade out
      if (timer.current) { clearInterval(timer.current); timer.current = null }
      setWidth(100)
      fadeTimer.current = setTimeout(() => {
        setVisible(false)
        setWidth(0)
      }, 350)
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    }
  }, [loading])

  if (!visible) return null

  return (
    <div
      className="absolute top-0 left-0 right-0 h-[2.5px] z-50 pointer-events-none"
      style={{ background: 'transparent' }}
    >
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          background: 'linear-gradient(90deg, #FF4500 0%, #FF6A33 60%, #FFa040 100%)',
          transition: width === 100 ? 'width 0.2s ease-out' : 'width 0.06s linear',
          boxShadow: '0 0 8px #FF450088',
        }}
      />
    </div>
  )
}
