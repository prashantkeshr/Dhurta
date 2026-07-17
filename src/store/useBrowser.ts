import { useState, useEffect, useCallback } from 'react'
import type { Tab, Panel } from '../types'

const api = () => window.dhurta

const INTERNAL_PAGES = ['dhurta://newtab', 'dhurta://history', 'dhurta://bookmarks', 'dhurta://downloads', 'dhurta://omni']

// Only the New Tab / home page and the Omni dashboard default to 200% zoom —
// History/Bookmarks/Downloads stay at the normal 100% default. These pages
// have no BrowserView of their own, so this is applied via CSS zoom on the
// React content wrapper (App.tsx), but the underlying (hidden) per-tab
// webContents zoom factor is also set to the same value so it stays correct
// if the user later switches away and back, and so Ctrl+scroll adjusts from
// a 200% baseline, not 100%.
const DEFAULT_INTERNAL_ZOOM = 2
const ZOOM_200_PAGES = ['dhurta://newtab', 'dhurta://omni']
function defaultsTo200(url?: string) {
  return !url || ZOOM_200_PAGES.includes(url)
}

export function useBrowser() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<number>(-1)
  const [ghostMode, setGhostMode] = useState(false)
  const [activePanel, setActivePanel] = useState<Panel>(null)
  const [urlInput, setUrlInput] = useState('')
  const [jsDisabled, setJsDisabled] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false)
  const [torActive, setTorActive] = useState(false)
  // Ghost Mode is instant now (see toggleGhost) — there's no "connecting" wait
  // state anymore. This just means "Ghost Mode is on but Tor hasn't finished
  // bootstrapping yet", so the UI can show "upgrading to Tor…" instead of a
  // fixed on/off badge. It's derived, not a state variable, so it can never
  // drift out of sync with the two flags it depends on.
  const torConnecting = ghostMode && !torActive
  // Chakra is DERIVED from the settings it bundles, not a standalone flag —
  // this is what makes it reflect reality regardless of whether it was toggled
  // from the sidebar, the Omni dashboard, or the Security panel: whichever one
  // changes the settings, this recomputes from the same source of truth.
  const [chakraSnapshot, setChakraSnapshot] = useState({ antiFingerprint: false, blockWebRTC: false, ipRotation: false })
  const chakraActive = chakraSnapshot.ipRotation && chakraSnapshot.antiFingerprint && chakraSnapshot.blockWebRTC
  const [chakraBusy,     setChakraBusy]     = useState(false)
  const [chakraWarning,  setChakraWarning]  = useState<string | null>(null)
  const [pipActive,    setPipActive]     = useState(false)
  const [pipTitle,     setPipTitle]      = useState('')

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Load the initial security snapshot, then stay in sync via the same
  // dhurta:settingChanged event every toggle surface already dispatches.
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    api().getSecuritySettings().then(s => setChakraSnapshot({
      antiFingerprint: s.antiFingerprint, blockWebRTC: s.blockWebRTC, ipRotation: s.ipRotation,
    })).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail
      const on = value === 'true'
      if (key === 'security_antiFingerprint') setChakraSnapshot(s => ({ ...s, antiFingerprint: on }))
      if (key === 'security_blockWebRTC')     setChakraSnapshot(s => ({ ...s, blockWebRTC: on }))
      if (key === 'security_ipRotation')      setChakraSnapshot(s => ({ ...s, ipRotation: on }))
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [])

  // Ghost Mode can also be toggled from the Omni dashboard, not just the
  // sidebar icon — listen for the shared broadcast so this state (and
  // everything reading it, like the sidebar glow) stays correct either way.
  useEffect(() => {
    const handler = (e: Event) => setGhostMode((e as CustomEvent<boolean>).detail)
    window.addEventListener('dhurta:ghostChanged', handler)
    return () => window.removeEventListener('dhurta:ghostChanged', handler)
  }, [])

  // Bootstrap: restore session or create first tab
  useEffect(() => {
    const isElectron = typeof window.dhurta !== 'undefined'
    if (!isElectron) return

    const bootstrap = async () => {
      const existing = await api().getTabs()
      if (existing.length > 0) {
        // Already have tabs (hot-reload dev scenario)
        const last = existing[existing.length - 1]
        setTabs(existing)
        setActiveTabId(last.id)
        setUrlInput(last.url)
        return
      }

      // Check if session restore is enabled
      const [restoreSetting, savedJson] = await Promise.all([
        api().getSetting('sessionRestore'),
        api().getSetting('sessionTabs'),
      ])

      if (restoreSetting === 'true' && savedJson) {
        try {
          const saved: { url: string; title: string }[] = JSON.parse(savedJson)
          if (saved.length > 0) {
            for (const entry of saved) {
              await api().createTab(entry.url)
            }
            const allTabs = await api().getTabs()
            setTabs(allTabs)
            const last = allTabs[allTabs.length - 1]
            setActiveTabId(last.id)
            setUrlInput(last.url)
            return
          }
        } catch (_) {}
      }

      // Default: open a single new tab (always dhurta://newtab — internal).
      // Set the zoom factor BEFORE setActiveTabId, so the zoom-sync effect
      // below reads the already-correct 200% instead of the 100% default and
      // then flashing to 200% a moment later.
      const tab = await api().createTab()
      await api().zoomSet(tab.id, DEFAULT_INTERNAL_ZOOM).catch(() => {})
      setActiveTabId(tab.id)
      setTabs(await api().getTabs())
    }

    bootstrap()
  }, [])

  // Sync zoom level when active tab changes
  useEffect(() => {
    if (activeTabId < 0 || typeof window.dhurta === 'undefined') return
    api().zoomGet(activeTabId).then(setZoomLevel).catch(() => {})
  }, [activeTabId])

  // ── Stable IPC listeners (registered once, never re-registered on tab switch) ──
  // These handlers do NOT use activeTabId, so putting them in a [] effect means
  // they accumulate zero extra copies regardless of how many times the user
  // switches tabs. Previously they sat in the [activeTabId] effect and piled up
  // one extra copy per tab switch, causing N+1 new tabs on a single popup click.
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return

    const onLoadStart = (id: number) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, loading: true } : t)))
    }

    const onTitleChanged = (data: { id: number; title: string }) => {
      setTabs((prev) => prev.map((t) => (t.id === data.id ? { ...t, title: data.title } : t)))
    }

    const onFaviconChanged = (data: { id: number; favicon: string }) => {
      setTabs((prev) => prev.map((t) => (t.id === data.id ? { ...t, favicon: data.favicon } : t)))
    }

    // ghost carries whether the tab that spawned this window.open() was a Ghost
    // tab — without honoring it, any target="_blank"-style link opened from
    // inside Ghost Mode would silently create a NORMAL tab with the real IP,
    // breaking anonymity for that new tab. See ipc.ts's setWindowOpenHandler.
    const onOpenUrl = (payload: { url: string; ghost?: boolean }) => {
      api().createTab(payload.url, payload.ghost).then(() => api().getTabs()).then(setTabs)
    }

    const onVideoFullscreen = (active: boolean) => {
      setIsVideoFullscreen(active)
    }

    const onPipLoadInMain = (url: string) => {
      api().createTab(url).then(() => api().getTabs()).then(all => {
        setTabs(all)
        const last = all[all.length - 1]
        setActiveTabId(last.id)
        setUrlInput(last.url)
      })
    }

    const onMenuAction = (payload: { action: string; panel?: string; url?: string; tabId?: number; ghost?: boolean }) => {
      if (payload.action === 'panel' && payload.panel) {
        setActivePanel(payload.panel as Panel)
      } else if (payload.action === 'newTab') {
        api().createTab().then(() => api().getTabs()).then(all => {
          setTabs(all); const last = all[all.length - 1]; setActiveTabId(last.id); setUrlInput('')
        })
      } else if (payload.action === 'newGhostTab') {
        api().createTab(undefined, true).then(() => api().getTabs()).then(all => {
          setTabs(all); const last = all[all.length - 1]; setActiveTabId(last.id); setUrlInput('')
        })
      } else if (payload.action === 'duplicateTab') {
        api().duplicateTab().then(() => api().getTabs()).then(all => {
          setTabs(all); const last = all[all.length - 1]; setActiveTabId(last.id); setUrlInput(last.url)
        })
      } else if (payload.action === 'closeTab' && payload.tabId != null) {
        api().closeTab(payload.tabId).then(() => api().getTabs()).then(all => {
          setTabs(all)
          if (all.length > 0) { const last = all[all.length - 1]; setActiveTabId(last.id); setUrlInput(last.url) }
        })
      } else if (payload.action === 'closeOtherTabs' && payload.tabId != null) {
        api().getTabs().then(async all => {
          for (const t of all) if (t.id !== payload.tabId) await api().closeTab(t.id)
          const remaining = await api().getTabs()
          setTabs(remaining)
          if (remaining.length > 0) { setActiveTabId(remaining[0].id); setUrlInput(remaining[0].url) }
        })
      } else if (payload.action === 'bookmarkTab' && payload.tabId != null) {
        api().getTabs().then(all => {
          const t = all.find(x => x.id === payload.tabId)
          if (t && t.url) api().addBookmark({ url: t.url, title: t.title, favicon: t.favicon })
        })
      } else if (payload.action === 'findInPage') {
        window.dispatchEvent(new CustomEvent('dhurta:findInPage'))
      } else if (payload.action === 'openInNewTab' && payload.url) {
        // Same anonymity concern as onOpenUrl above — "Open Link in New Tab"
        // from a Ghost tab's context menu must stay a Ghost tab.
        api().createTab(payload.url, payload.ghost).then(() => api().getTabs()).then(all => {
          setTabs(all); const last = all[all.length - 1]; setActiveTabId(last.id); setUrlInput(last.url)
        })
      } else if (payload.action === 'navigate' && payload.url) {
        window.dispatchEvent(new CustomEvent('dhurta:navigate', { detail: payload.url }))
      }
    }

    // Tor crash — main process detected Tor exited unexpectedly while Ghost Mode was active.
    // Flip torActive so the sidebar shows the warning badge immediately.
    const onTorCrashed = () => { setTorActive(false) }

    // Background Tor bootstrap finished — every ghost tab that was riding the
    // fast proxy rail just got silently re-pointed at real Tor onion routing.
    const onTorUpgraded = () => { setTorActive(true) }

    // Tor failed to start at all (e.g. orphaned process, blocked binary). Ghost
    // tabs stay usable via the fast proxy rail; this just means they'll never
    // upgrade to Tor until the user retries (re-enable Ghost Mode).
    const onTorFailed = (msg: string) => { console.error('[Ghost] Tor failed to start:', msg) }

    const onPipOpened = (title: string) => { setPipActive(true); setPipTitle(title ?? '') }
    const onPipClosed = () => { setPipActive(false); setPipTitle('') }

    api().on('tab:loadStart', onLoadStart as never)
    api().on('tab:titleChanged', onTitleChanged as never)
    api().on('tab:faviconChanged', onFaviconChanged as never)
    api().on('tab:openUrl', onOpenUrl as never)
    api().on('browser:fullscreen', onVideoFullscreen as never)
    api().on('pip:loadInMain', onPipLoadInMain as never)
    api().on('menu:action', onMenuAction as never)
    api().on('context-menu:action', onMenuAction as never)
    api().on('ghost:tor-crashed', onTorCrashed as never)
    api().on('ghost:upgradedToTor', onTorUpgraded as never)
    api().on('ghost:tor-failed', onTorFailed as never)
    api().on('pip:opened', onPipOpened as never)
    api().on('pip:closed', onPipClosed as never)

    return () => {
      api().off('tab:loadStart', onLoadStart as never)
      api().off('tab:titleChanged', onTitleChanged as never)
      api().off('tab:faviconChanged', onFaviconChanged as never)
      api().off('tab:openUrl', onOpenUrl as never)
      api().off('browser:fullscreen', onVideoFullscreen as never)
      api().off('pip:loadInMain', onPipLoadInMain as never)
      api().off('menu:action', onMenuAction as never)
      api().off('context-menu:action', onMenuAction as never)
      api().off('ghost:tor-crashed', onTorCrashed as never)
      api().off('ghost:upgradedToTor', onTorUpgraded as never)
      api().off('ghost:tor-failed', onTorFailed as never)
      api().off('pip:opened', onPipOpened as never)
      api().off('pip:closed', onPipClosed as never)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Active-tab IPC listeners (re-register when active tab changes) ──
  // Only these two genuinely read activeTabId inside their handler bodies.
  useEffect(() => {
    if (activeTabId < 0 || typeof window.dhurta === 'undefined') return

    const onLoadStop = (data: { id: number; url: string; title: string }) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === data.id ? { ...t, url: data.url, title: data.title, loading: false } : t))
      )
      if (data.id === activeTabId) setUrlInput(data.url)
    }

    const onZoomLevel = (data: { tabId: number; level: number }) => {
      if (data.tabId === activeTabId) setZoomLevel(data.level)
    }

    api().on('tab:loadStop', onLoadStop as never)
    api().on('zoom:level', onZoomLevel as never)

    return () => {
      api().off('tab:loadStop', onLoadStop as never)
      api().off('zoom:level', onZoomLevel as never)
    }
  }, [activeTabId])

  const newTab = useCallback(
    async (url?: string, ghost?: boolean) => {
      // Ghost tabs open on dhurta://newtab so the React NewTabPage is shown,
      // not a real URL that would require Tor
      const tab = await api().createTab(url, ghost ?? ghostMode)
      setTabs(await api().getTabs())
      // Set the real zoom factor BEFORE setActiveTabId so the zoom-sync effect
      // (which fires on activeTabId change) reads the correct value immediately.
      const level = defaultsTo200(url)
        ? await api().zoomSet(tab.id, DEFAULT_INTERNAL_ZOOM).catch(() => DEFAULT_INTERNAL_ZOOM)
        : await api().zoomReset(tab.id).catch(() => 1)
      setActiveTabId(tab.id)
      setUrlInput(url ?? '')
      setJsDisabled(false)
      setZoomLevel(level)
    },
    [ghostMode]
  )

  const closeTab = useCallback(async (id: number) => {
    await api().closeTab(id)
    const remaining = await api().getTabs()
    setTabs(remaining)
    if (remaining.length > 0) {
      const next = remaining[remaining.length - 1]
      setActiveTabId(next.id)
      setUrlInput(next.url)
    } else {
      await newTab()
    }
  }, [newTab])

  const switchTab = useCallback(async (id: number) => {
    await api().switchTab(id)
    setActiveTabId(id)
    const tab = tabs.find((t) => t.id === id)
    if (tab) setUrlInput(tab.url)
    setJsDisabled(false)
    const level = await api().zoomGet(id).catch(() => 1)
    setZoomLevel(level)
  }, [tabs])

  const navigate = useCallback(async (url: string) => {
    // Internal dhurta:// pages render instantly in React — don't set loading:true for them.
    const isInternal = INTERNAL_PAGES.includes(url)
    if (activeTabId >= 0) {
      setTabs(prev => prev.map(t => t.id === activeTabId
        ? { ...t, url, loading: isInternal ? false : true } : t))
      setUrlInput(url)
    }
    await api().loadURL(url)
  }, [activeTabId])

  const notifySetting = (key: string, value: string) => {
    api().setSetting(key, value)
    window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key, value } }))
  }

  // Disable whichever of Chakra/Ghost is currently active — used both by each
  // mode's own toggle AND by the other mode's enable path, so switching modes
  // always cleanly turns the previous one off first. Exactly one of Normal /
  // Chakra / Ghost is active at any moment, never a mix of two.
  const disableChakraInternal = useCallback(async () => {
    setChakraBusy(true)
    await api().vpnDisconnect().catch(() => {})
    notifySetting('security_antiFingerprint', 'false')
    notifySetting('security_blockWebRTC', 'false')
    notifySetting('cookieGuard', 'false')
    notifySetting('adBlocker', 'false')
    notifySetting('security_ipRotation', 'false')
    setChakraBusy(false)
  }, [])

  const disableGhostInternal = useCallback(async () => {
    await api().disableGhost()
    setGhostMode(false)
    setTorActive(false)
    window.dispatchEvent(new CustomEvent('dhurta:ghostChanged', { detail: false }))
    notifySetting('security_antiFingerprint', 'false')
    notifySetting('security_blockWebRTC', 'false')
    notifySetting('security_autoClean', 'false')
    notifySetting('security_ipRotation', 'false')
    notifySetting('cookieGuard', 'false')
    notifySetting('adBlocker', 'false')
  }, [])

  const toggleGhost = useCallback(async () => {
    if (ghostMode) {
      await disableGhostInternal()
    } else {
      // Enforce "only one mode at a time" — Ghost is the strongest mode
      // (real Tor onion routing), so it fully supersedes Chakra rather than
      // stacking with it. Seal traffic across the switch so the real IP can't
      // leak through in-flight requests while VPN tears down and Tor boots.
      await api().netKillSwitch().catch(() => {})
      if (chakraActive) await disableChakraInternal()
      // enableGhost() returns almost instantly — it kicks off Tor's bootstrap in
      // the background rather than blocking on it. `tor: true` here only means
      // Tor happened to already be ready (e.g. re-enabling Ghost Mode after a
      // prior session left it running); otherwise torActive flips to true later
      // via the 'ghost:upgradedToTor' event once bootstrap actually completes.
      // The ghost tab below opens immediately either way, riding a fast proxy
      // rail until Tor is ready — never blocked on the ~15-25s bootstrap.
      const result = await api().enableGhost() as { tor?: boolean } | undefined
      // Normal-tab sessions return to their direct baseline; ghost tabs stay
      // proxy/Tor-routed (and fail closed on their own if neither is available).
      await api().netRelease().catch(() => {})
      setTorActive(!!result?.tor)
      setGhostMode(true)
      window.dispatchEvent(new CustomEvent('dhurta:ghostChanged', { detail: true }))
      // Ghost tabs already get anti-fingerprint/WebRTC-block/Tor-routing
      // applied unconditionally under the hood (see createBrowserView) — this
      // just makes every toggle surface (sidebar, Security panel, Omni)
      // visibly reflect that instead of showing them off while Ghost runs.
      // Full bundle, same as Chakra plus Tor: nothing is left unprotected.
      notifySetting('security_antiFingerprint', 'true')
      notifySetting('security_blockWebRTC', 'true')
      notifySetting('security_autoClean', 'true')
      notifySetting('security_ipRotation', 'true')
      notifySetting('cookieGuard', 'true')
      notifySetting('adBlocker', 'true')
      // Open ghost tab on New Tab page — no external URL needed
      await newTab(undefined, true)
    }
  }, [ghostMode, chakraActive, disableChakraInternal, disableGhostInternal, newTab])

  // Chakra — one-click "enable everything except Ghost Mode":
  // VPN, anti-fingerprint, WebRTC block, cookie guard, ad blocker, auto-clean.
  // chakraActive is derived from these same settings, so no separate flag to set.
  const toggleChakra = useCallback(async () => {
    if (chakraActive) {
      setChakraWarning(null)
      await disableChakraInternal()
    } else {
      if (ghostMode) await disableGhostInternal()
      setChakraBusy(true)
      setChakraWarning(null)
      const vpnResult = await api().vpnConnect().catch(() => ({ success: false }))
      const vpnOk = (vpnResult as { success?: boolean }).success === true
      notifySetting('security_antiFingerprint', 'true')
      notifySetting('security_blockWebRTC', 'true')
      notifySetting('cookieGuard', 'true')
      notifySetting('adBlocker', 'true')
      notifySetting('security_ipRotation', vpnOk ? 'true' : 'false')
      setChakraBusy(false)
      if (!vpnOk) {
        const missing: string[] = []
        if (!vpnOk) missing.push('VPN')
        setChakraWarning(
          `Security breach may occur — ${missing.join(', ')} not connected. Chakra requires VPN + Anti-Fingerprint + WebRTC Block.`
        )
      }
    }
  }, [chakraActive, ghostMode, disableChakraInternal, disableGhostInternal])

  const toggleJS = useCallback(async () => {
    if (!activeTabId) return
    const result = await api().nukeJS(activeTabId)
    setJsDisabled(result)
  }, [activeTabId])

  const nuclearWipe = useCallback(async () => {
    if (confirm('NUCLEAR WIPE: This will delete ALL data and quit Dhurta immediately. Proceed?')) {
      await api().nuclearWipe()
    }
  }, [])

  const zoomIn = useCallback(async () => {
    if (activeTabId < 0) return
    const level = await api().zoomIn(activeTabId)
    setZoomLevel(level)
  }, [activeTabId])

  const zoomOut = useCallback(async () => {
    if (activeTabId < 0) return
    const level = await api().zoomOut(activeTabId)
    setZoomLevel(level)
  }, [activeTabId])

  const zoomReset = useCallback(async () => {
    if (activeTabId < 0) return
    const level = await api().zoomReset(activeTabId)
    setZoomLevel(level)
  }, [activeTabId])

  const zoomStep = useCallback(async (direction: 'in' | 'out') => {
    if (activeTabId < 0) return
    const level = await api().zoomStep(activeTabId, direction)
    setZoomLevel(level)
  }, [activeTabId])

  const duplicateTab = useCallback(async (id: number) => {
    await api().duplicateTab()
    const all = await api().getTabs()
    setTabs(all)
    const last = all[all.length - 1]
    setActiveTabId(last.id)
    setUrlInput(last.url)
  }, [])

  const closeOtherTabs = useCallback(async (keepId: number) => {
    const toClose = tabs.filter(t => t.id !== keepId)
    for (const t of toClose) await api().closeTab(t.id)
    const remaining = await api().getTabs()
    setTabs(remaining)
    setActiveTabId(keepId)
    const kept = remaining.find(t => t.id === keepId)
    if (kept) setUrlInput(kept.url)
  }, [tabs])

  return {
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
    pipActive,
    pipTitle,
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
  }
}
