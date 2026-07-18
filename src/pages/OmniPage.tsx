import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { SecuritySettings, TransparencyData, RequestEntry, DhurtaAPI } from '../types'
import OmniGlobe from '../components/OmniGlobe'
import OmniWorldMap from '../components/OmniWorldMap'

const api = () => window.dhurta

type IpInfo = Awaited<ReturnType<DhurtaAPI['checkPublicIp']>>

interface LayerDef {
  id: string
  icon: string
  title: string
  desc: string
  active: boolean
  steps: string[]
  onEnable?: () => void
  enableLabel?: string
}

interface Props {
  activeTabId?: number
  theme?: 'dark' | 'light'
}

export default function OmniPage({ activeTabId, theme = 'dark' }: Props) {
  const [settings, setSettings] = useState<SecuritySettings>({
    ipRotation: false, antiFingerprint: false, blockWebRTC: false, autoClean: false,
  })
  const [ghostMode, setGhostMode] = useState(false)
  const [data, setData] = useState<TransparencyData | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // ── IP / DNS leak check ──────────────────────────────────────────────────
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [ipStatus, setIpStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [realIpInfo, setRealIpInfo] = useState<IpInfo | null>(null)
  const [realIpStatus, setRealIpStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  // ── Live GET/POST request feed ───────────────────────────────────────────
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const requestPoll = useRef<ReturnType<typeof setInterval> | null>(null)
  const [blockedCount, setBlockedCount] = useState(0)

  // ── Tor configuration status ─────────────────────────────────────────────
  const [torReady, setTorReady] = useState<boolean | null>(null)

  // ── Fingerprint surface scanner ──────────────────────────────────────────
  const [fp, setFp] = useState<Awaited<ReturnType<DhurtaAPI['getFingerprint']>> | null>(null)
  const [fpStatus, setFpStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  // ── Power Modes: Chakra (moderate) — derived from the settings it controls,
  // so it stays in sync whether toggled here or from the sidebar Chakra icon.
  const chakraActive = settings.antiFingerprint && settings.blockWebRTC && settings.ipRotation
  const [chakraBusy, setChakraBusy] = useState(false)
  const currentMode: 'normal' | 'chakra' | 'ghost' = ghostMode ? 'ghost' : chakraActive ? 'chakra' : 'normal'

  // ── Built-in VPN control widget ──────────────────────────────────────────
  const [vpnCountry, setVpnCountry] = useState('all')
  const [vpnBusy, setVpnBusy] = useState(false)
  const [vpnMsg, setVpnMsg] = useState('')

  // ── Built-in Tor/onion control widget ────────────────────────────────────
  const [exitCountry, setExitCountry] = useState('any')
  const [torBusy, setTorBusy] = useState(false)
  const [torMsg, setTorMsg] = useState('')

  // ── Tor circuit rotation ──────────────────────────────────────────────────
  const [circuitCount, setCircuitCount] = useState(0)
  const [newnymBusy, setNewnymBusy] = useState(false)
  const [lastRotation, setLastRotation] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (typeof window.dhurta === 'undefined') return
    setLoading(true)
    try {
      const [s, ghost, td] = await Promise.all([
        api().getSecuritySettings(),
        api().getGhostState().catch(() => false),
        api().getTransparencyData(),
      ])
      setSettings(s)
      setGhostMode(!!ghost)
      setData(td)
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Tor configuration/onion-routing status — polled since bootstrap can
  // complete after this page has already mounted.
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const poll = () => api().getTorStatus().then(setTorReady).catch(() => setTorReady(false))
    poll()
    const t = setInterval(poll, 4000)
    return () => clearInterval(t)
  }, [])

  // Circuit count — poll and listen for auto-rotation events
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const refresh = () => api().torCircuitCount().then(setCircuitCount).catch(() => {})
    refresh()
    const t = setInterval(refresh, 5000)
    const onRotated = (count: unknown) => {
      setCircuitCount(Number(count))
      setLastRotation(new Date())
    }
    api().on('tor:circuitRotated', onRotated)
    return () => {
      clearInterval(t)
      api().off('tor:circuitRotated', onRotated)
    }
  }, [])

  const checkIp = useCallback(async () => {
    setIpStatus('loading')
    try {
      const res = await api().checkPublicIp(activeTabId)
      if (res.success) { setIpInfo(res); setIpStatus('done') }
      else { setIpInfo(res); setIpStatus('error') }
    } catch (_) {
      setIpStatus('error')
    }
  }, [activeTabId])

  useEffect(() => { checkIp() }, [checkIp])

  const checkRealIp = useCallback(async () => {
    setRealIpStatus('loading')
    try {
      const res = await api().checkRealIp()
      setRealIpInfo(res)
      setRealIpStatus(res.success ? 'done' : 'error')
    } catch (_) {
      setRealIpStatus('error')
    }
  }, [])

  useEffect(() => { checkRealIp() }, [checkRealIp])

  const scanFingerprint = useCallback(async () => {
    setFpStatus('loading')
    try {
      const res = await api().getFingerprint(activeTabId)
      setFp(res)
      setFpStatus(res.success ? 'done' : 'error')
    } catch (_) {
      setFpStatus('error')
    }
  }, [activeTabId])

  useEffect(() => { scanFingerprint() }, [scanFingerprint])

  // Poll the active tab's request log for a live GET/POST feed
  useEffect(() => {
    if (typeof window.dhurta === 'undefined' || activeTabId == null) return
    const poll = () => api().getRequests(activeTabId).then(setRequests).catch(() => {})
    poll()
    requestPoll.current = setInterval(poll, 1500)
    return () => { if (requestPoll.current) clearInterval(requestPoll.current) }
  }, [activeTabId])

  // Poll the ad/tracker blocked counter
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const poll = () => api().getBlockedCount().then(setBlockedCount).catch(() => {})
    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail
      const on = value === 'true'
      if (key === 'security_antiFingerprint') setSettings(s => ({ ...s, antiFingerprint: on }))
      if (key === 'security_blockWebRTC')     setSettings(s => ({ ...s, blockWebRTC: on }))
      if (key === 'security_autoClean')       setSettings(s => ({ ...s, autoClean: on }))
      if (key === 'security_ipRotation')      setSettings(s => ({ ...s, ipRotation: on }))
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [])

  // Ghost Mode can also be toggled from the sidebar icon, not just here —
  // listen for the shared broadcast so this page's status stays correct either way.
  useEffect(() => {
    const handler = (e: Event) => setGhostMode((e as CustomEvent<boolean>).detail)
    window.addEventListener('dhurta:ghostChanged', handler)
    return () => window.removeEventListener('dhurta:ghostChanged', handler)
  }, [])

  const notify = (key: string, value: string) => {
    api().setSetting(key, value)
    window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key, value } }))
  }

  const toggle = async (id: 'antiFingerprint' | 'blockWebRTC' | 'autoClean', value: boolean) => {
    setBusy(id)
    setSettings(s => ({ ...s, [id]: value }))
    try {
      if (id === 'antiFingerprint') await api().setAntiFingerprint(value)
      if (id === 'blockWebRTC') await api().setBlockWebRTC(value)
      if (id === 'autoClean') await api().setAutoClean(value)
    } finally {
      setBusy(null)
    }
  }

  const connectVpn = async () => {
    setBusy('ipRotation')
    setVpnMsg('Connecting…')
    try {
      const res = await api().vpnConnect()
      if (res.success) {
        setSettings(s => ({ ...s, ipRotation: true }))
        notify('security_ipRotation', 'true')
        setVpnMsg(`Connected via ${res.proxy}`)
        checkIp()
      } else {
        setVpnMsg(res.error ?? 'Failed to connect')
      }
    } finally {
      setBusy(null)
    }
  }

  // Shared with setMode() below — dispatches the same broadcast useBrowser.ts
  // listens for, and mirrors the same settings sync so the sidebar, Security
  // panel, and this dashboard all agree on what's active, however it was toggled.
  const disableGhostMode = async () => {
    await api().disableGhost()
    setGhostMode(false)
    window.dispatchEvent(new CustomEvent('dhurta:ghostChanged', { detail: false }))
    notify('security_antiFingerprint', 'false')
    notify('security_blockWebRTC', 'false')
    notify('security_autoClean', 'false')
    notify('security_ipRotation', 'false')
    notify('cookieGuard', 'false')
    notify('adBlocker', 'false')
  }

  const enableGhostMode = async () => {
    await api().enableGhost()
    setGhostMode(true)
    window.dispatchEvent(new CustomEvent('dhurta:ghostChanged', { detail: true }))
    // Full bundle — same as Chakra plus real Tor onion routing — so nothing
    // is left unprotected while Ghost Mode is active.
    notify('security_antiFingerprint', 'true')
    notify('security_blockWebRTC', 'true')
    notify('security_autoClean', 'true')
    notify('security_ipRotation', 'true')
    notify('cookieGuard', 'true')
    notify('adBlocker', 'true')
  }

  const toggleGhost = async () => {
    setBusy('ghost')
    try {
      if (ghostMode) await disableGhostMode()
      else await enableGhostMode()
      checkIp()
    } finally {
      setBusy(null)
    }
  }

  // ── VPN widget handlers ───────────────────────────────────────────────────
  const vpnConnectFull = async () => {
    setVpnBusy(true)
    setVpnMsg('Connecting…')
    try {
      const res = await api().vpnConnect(vpnCountry)
      if (res.success) {
        setSettings(s => ({ ...s, ipRotation: true }))
        notify('security_ipRotation', 'true')
        setVpnMsg(`Connected via ${res.proxy}`)
        checkIp()
      } else {
        setVpnMsg(res.error ?? 'Failed to connect')
      }
    } finally {
      setVpnBusy(false)
    }
  }

  const vpnDisconnectFull = async () => {
    setVpnBusy(true)
    try {
      await api().vpnDisconnect()
      setSettings(s => ({ ...s, ipRotation: false }))
      notify('security_ipRotation', 'false')
      setVpnMsg('Disconnected — direct connection restored')
      checkIp()
    } finally {
      setVpnBusy(false)
    }
  }

  const vpnRotateFull = async () => {
    setVpnBusy(true)
    setVpnMsg('Switching server…')
    try {
      const res = await api().vpnRotate()
      setVpnMsg(res.success ? `Now via ${res.proxy}` : (res.error ?? 'Failed'))
      if (res.success) checkIp()
    } finally {
      setVpnBusy(false)
    }
  }

  // ── Tor/onion widget handlers ─────────────────────────────────────────────
  const requestNewnym = async () => {
    setNewnymBusy(true)
    try {
      const res = await api().torNewnym()
      if (res.success) {
        setCircuitCount(res.count ?? circuitCount + 1)
        setLastRotation(new Date())
        setTorMsg('New Tor circuit established')
      } else {
        setTorMsg(res.error ?? 'NEWNYM failed')
      }
    } finally {
      setNewnymBusy(false)
    }
  }

  const applyExitNode = async () => {
    setTorBusy(true)
    setTorMsg('Applying…')
    try {
      const cc = exitCountry === 'any' ? null : exitCountry
      const res = await api().setExitNode(cc)
      if (res.success) {
        setTorMsg(res.restarted ? `New Tor circuit via ${cc ?? 'any country'}` : 'Will apply when Ghost Mode starts')
        if (res.restarted) checkIp()
      } else {
        setTorMsg(res.error ?? 'Failed to set exit node')
      }
    } finally {
      setTorBusy(false)
    }
  }

  // ── Chakra Mode toggle — mirrors useBrowser.ts's toggleChakra exactly (VPN +
  // Anti-Fingerprint + WebRTC block + Cookie Guard + Ad Blocker in one action),
  // so "moderate protection" is a single real button here too, not just a
  // pointer to the sidebar icon.
  const disableChakra = async () => {
    await api().vpnDisconnect().catch(() => {})
    notify('security_antiFingerprint', 'false')
    notify('security_blockWebRTC', 'false')
    notify('cookieGuard', 'false')
    notify('adBlocker', 'false')
    notify('security_ipRotation', 'false')
    setSettings(s => ({ ...s, antiFingerprint: false, blockWebRTC: false, ipRotation: false }))
  }

  const enableChakra = async () => {
    const vpnResult = await api().vpnConnect().catch(() => ({ success: false }))
    notify('security_antiFingerprint', 'true')
    notify('security_blockWebRTC', 'true')
    notify('cookieGuard', 'true')
    notify('adBlocker', 'true')
    const vpnOk = (vpnResult as { success?: boolean }).success ?? false
    notify('security_ipRotation', vpnOk ? 'true' : 'false')
    setSettings(s => ({ ...s, antiFingerprint: true, blockWebRTC: true, ipRotation: vpnOk }))
  }

  const toggleChakraMode = async () => {
    setChakraBusy(true)
    try {
      if (chakraActive) await disableChakra()
      else await enableChakra()
      checkIp()
    } finally {
      setChakraBusy(false)
    }
  }

  // ── Three mutually-exclusive browsing levels, matching the sidebar's own
  // Ghost/Chakra icons and glow treatment — selecting one here is the same
  // real action as clicking the corresponding sidebar icon, not a separate
  // fourth control.
  const setMode = async (mode: 'normal' | 'chakra' | 'ghost') => {
    if (mode === currentMode) return
    setChakraBusy(true)
    try {
      // Seal traffic for the whole switch-over so the real IP can't leak through
      // in-flight requests during the disable→enable gap. Fail closed until the
      // destination mode has applied its own proxy (or we release to direct).
      await api().netKillSwitch().catch(() => {})

      if (currentMode === 'chakra') await disableChakra()
      if (currentMode === 'ghost') await disableGhostMode()

      if (mode === 'normal') await api().netRelease().catch(() => {})
      if (mode === 'chakra') await enableChakra()               // vpnConnect re-seals then applies the proxy
      if (mode === 'ghost') {
        await enableGhostMode()                                 // ghost tabs route through Tor (fail closed until ready)
        await api().netRelease().catch(() => {})                // normal-tab sessions return to their direct baseline
      }
      checkIp()
    } finally {
      setChakraBusy(false)
    }
  }

  const layers: LayerDef[] = [
    {
      id: 'ghost',
      icon: '👻',
      title: 'Ghost Mode — Tor Routing',
      desc: 'In-memory session, fingerprint spoofed, WebRTC blocked, traffic routed through Tor. Nothing touches disk.',
      active: ghostMode,
      enableLabel: ghostMode ? 'Disable' : 'Enable Ghost Mode',
      onEnable: toggleGhost,
      steps: [
        'Click the Trishula (👻) icon at the top of the sidebar.',
        'Wait for the Tor circuit to connect (a few seconds).',
        'A new Ghost tab opens automatically — all traffic in it is now anonymized.',
      ],
    },
    {
      id: 'ipRotation',
      icon: '🛡️',
      title: 'VPN / IP Rotation',
      desc: 'Routes normal-tab traffic through a proxy server so your real IP is hidden from sites you visit outside Ghost Mode.',
      active: settings.ipRotation,
      enableLabel: settings.ipRotation ? undefined : 'Connect VPN',
      onEnable: settings.ipRotation ? undefined : connectVpn,
      steps: [
        'Open the sidebar Security panel (shield icon).',
        'Pick a server location, or leave it on Auto.',
        'Click "Connect VPN" — takes effect on new requests immediately.',
      ],
    },
    {
      id: 'antiFingerprint',
      icon: '🎭',
      title: 'Anti-Fingerprint Engine (heavy)',
      desc: 'Adds noise to Canvas/Audio output and spoofs WebGL GPU info on top of baseline. Can occasionally affect DRM-protected video.',
      active: settings.antiFingerprint,
      enableLabel: settings.antiFingerprint ? 'Disable' : 'Enable',
      onEnable: () => toggle('antiFingerprint', !settings.antiFingerprint),
      steps: [
        'Open the sidebar Security panel.',
        'Toggle "Anti-Fingerprint Engine" on.',
        'Reload any open tabs for it to take effect.',
      ],
    },
    {
      id: 'blockWebRTC',
      icon: '🔇',
      title: 'Block WebRTC Leaks',
      desc: 'Disables WebRTC so sites can\'t discover your real IP even through a VPN/proxy tunnel. May break voice/video calls.',
      active: settings.blockWebRTC,
      enableLabel: settings.blockWebRTC ? 'Disable' : 'Enable',
      onEnable: () => toggle('blockWebRTC', !settings.blockWebRTC),
      steps: [
        'Open the sidebar Security panel.',
        'Toggle "Block WebRTC Leaks" on.',
        'New tabs opened after this will have WebRTC disabled.',
      ],
    },
    {
      id: 'autoClean',
      icon: '🧹',
      title: 'Auto-Clean on Tab Close',
      desc: 'Instantly wipes cookies, cache, and session storage the moment a tab closes — no lingering traces between sessions.',
      active: settings.autoClean,
      enableLabel: settings.autoClean ? 'Disable' : 'Enable',
      onEnable: () => toggle('autoClean', !settings.autoClean),
      steps: [
        'Open the sidebar Security panel.',
        'Toggle "Auto-Clean Memory" on.',
        'Every tab you close from now on is wiped instantly.',
      ],
    },
    {
      id: 'baseline',
      icon: '🖥️',
      title: 'Ordinary-Machine Normalization',
      desc: 'Always on. Screen resolution, plugin list, CPU core count, RAM, and language are all normalized to common values on every tab — sites can\'t single you out by hardware profile.',
      active: true,
      steps: [
        'No action needed — this runs automatically on every tab, every session.',
        'Covers: screen size, navigator.plugins, hardwareConcurrency, deviceMemory, languages, Do-Not-Track.',
      ],
    },
  ]

  const activeCount = layers.filter(l => l.active).length
  const score = Math.round((activeCount / layers.length) * 100)
  const scoreColor = score >= 80 ? '#39ff14' : score >= 50 ? '#FF4500' : '#ff2bd6'
  const suggestions = layers.filter(l => !l.active)
  // isMasked must reflect what was ACTUALLY measured, not just whether a privacy
  // toggle is on somewhere in the app. Omni renders inside its own tab (reusing
  // whatever tab was active when you opened it) — that tab is not automatically
  // the same tab as a separately-opened Ghost tab, so "Ghost Mode is ON" does NOT
  // mean THIS tab's connection is masked. Once both IPs are in, trust the real
  // comparison; only fall back to the toggle-based guess while data is still
  // loading (so the badge isn't blank), and that fallback is itself corrected
  // below the moment the real check lands.
  const ipsCompared = ipStatus === 'done' && realIpStatus === 'done' && !!ipInfo?.ip && !!realIpInfo?.ip
  const isMasked = ipsCompared ? ipInfo!.ip !== realIpInfo!.ip : (ghostMode || settings.ipRotation)

  // Every distinct destination the active tab has actually talked to, ranked by
  // frequency — the most-contacted host is treated as the page's own (first-party)
  // domain, everything else is a third party that also observed the visit.
  const dataLeaving = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of requests) {
      try {
        const host = new URL(r.url).hostname
        counts.set(host, (counts.get(host) ?? 0) + 1)
      } catch (_) { /* skip unparsable URLs */ }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const primaryHost = sorted[0]?.[0]
    const uniqueHosts = sorted.map(([host, count]) => ({ host, count, isPrimary: host === primaryHost }))
    return { uniqueHosts, thirdPartyCount: uniqueHosts.filter(h => !h.isPrimary).length }
  }, [requests])

  return (
    <div className="omni-root h-full w-full overflow-y-auto relative bg-[#050507] text-[#d4d4d4]" data-omni-theme={theme}>
      <OmniStyles />
      <div className="omni-scanlines" />
      <div className="omni-grid" />

      <div className="relative z-10 max-w-[1680px] mx-auto px-6 py-10">
        {/* Header — theme + zoom follow the browser's own settings (☾/☀ toggle
            in the URL bar, Ctrl+scroll), no separate controls duplicated here */}
        <div className="flex items-center gap-4 mb-2">
          <div className="omni-badge">
            <img src="./dhurta-logo.png" alt="" className="w-9 h-9 object-contain relative z-10" draggable={false} />
          </div>
          <div className="flex-1">
            <h1 className="omni-title text-2xl font-mono font-bold tracking-[0.2em]">DHURTA :: OMNI</h1>
            <p className="text-[11px] font-mono text-[#00fff2]/70 tracking-widest">PRIVACY CONTROL DECK // LOCAL-ONLY // ZERO TELEMETRY</p>
          </div>
        </div>

        {loading ? (
          <p className="text-[11px] font-mono text-[#39ff14] mt-10 animate-pulse">&gt; scanning local privacy state_</p>
        ) : (
          <>
            {/* ── Row 1: Globe + World Map, side by side ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-8">
              <div className="omni-panel omni-cyan flex flex-col items-center justify-center py-4">
                <p className="omni-panel-label text-[#00fff2]">◉ Egress Node — Live 3D View</p>
                <OmniGlobe lat={ipInfo?.lat} lon={ipInfo?.lon} label={ipInfo?.countryCode} size={260} />
                <p className="text-[9px] font-mono text-muted/60 mt-1">drag / scroll to rotate — shows what sites currently see</p>
              </div>

              <div className="omni-panel omni-magenta p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <p className="omni-panel-label text-[#ff2bd6]">🗺 Origin Location — World Map</p>
                  <span className="text-[9px] font-mono text-muted">
                    {realIpStatus === 'done' && realIpInfo
                      ? `${realIpInfo.city ?? '—'}, ${realIpInfo.country ?? '—'}`
                      : realIpStatus === 'loading' ? 'locating…' : '—'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <OmniWorldMap
                    real={realIpStatus === 'done' && realIpInfo ? { lat: realIpInfo.lat, lon: realIpInfo.lon, label: realIpInfo.countryCode } : undefined}
                    masked={isMasked && ipStatus === 'done' && ipInfo ? { lat: ipInfo.lat, lon: ipInfo.lon, label: ipInfo.countryCode } : undefined}
                    width={480} height={260}
                  />
                </div>
                <p className="text-[9px] font-mono text-muted/60 mt-1">
                  {isMasked
                    ? "Magenta pin is your real, unmasked location — where you're actually connecting from. Green pin is what sites currently see (your VPN/Tor exit)."
                    : "Pin marks your real, unmasked IP's location — where you're actually connecting from, regardless of VPN/Ghost Mode."}
                </p>
              </div>
            </div>

            {/* ── Row: IP / DNS Leak Check — full width ── */}
            <div className="omni-panel omni-orange mt-4 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="omni-panel-label text-[#FF4500]">◈ IP / DNS Leak Check</p>
                <button
                  onClick={checkIp}
                  disabled={ipStatus === 'loading'}
                  className="text-[9px] font-mono border border-[#FF4500]/40 text-[#FF4500] hover:bg-[#FF4500]/10 px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {ipStatus === 'loading' ? 'checking…' : '↻ re-check'}
                </button>
              </div>

              {ipStatus === 'loading' && (
                <p className="text-[10px] font-mono text-muted animate-pulse">&gt; querying external lookup service_</p>
              )}
              {ipStatus === 'error' && (
                <p className="text-[10px] font-mono text-[#ff2bd6]">✕ {ipInfo?.error ?? 'Lookup failed (offline or blocked).'}</p>
              )}
              {ipStatus === 'done' && ipInfo && (
                <>
                  <div className={[
                    'text-[10px] font-mono px-2 py-1 mb-3 inline-block border',
                    isMasked ? 'text-[#39ff14] border-[#39ff14]/50 bg-[#39ff14]/5' : 'text-[#ff2bd6] border-[#ff2bd6]/50 bg-[#ff2bd6]/5',
                  ].join(' ')}>
                    {isMasked ? '● MASKED — this is what a DNS/IP checker would see (not your real IP)' : '● EXPOSED — this is your REAL IP, visible to every site and checker you visit'}
                  </div>
                  {ghostMode && !isMasked && (
                    <p className="text-[9px] font-mono text-muted mb-3 -mt-1">
                      This reading is for the tab you're viewing Omni from, which is separate from any Ghost tab you opened —
                      opening Omni doesn't move you into the Ghost tab. Switch to your Ghost tab (👻) to browse anonymously.
                    </p>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-1.5">
                    <OmniStat label="IP Address" value={ipInfo.ip ?? '—'} accent="#00fff2" />
                    <OmniStat label="Country" value={`${ipInfo.country ?? '—'} (${ipInfo.countryCode ?? '—'})`} accent="#00fff2" />
                    <OmniStat label="City / Region" value={`${ipInfo.city ?? '—'}, ${ipInfo.region ?? '—'}`} accent="#9d00ff" />
                    <OmniStat label="ISP / Org" value={ipInfo.org ?? '—'} accent="#9d00ff" />
                    <OmniStat label="Coordinates" value={ipInfo.lat != null ? `${ipInfo.lat.toFixed(2)}, ${ipInfo.lon?.toFixed(2)}` : '—'} accent="#FF4500" />
                    <OmniStat
                      label="Ghost Mode"
                      value={!ghostMode ? 'OFF' : isMasked ? 'ON (Tor)' : 'ON (this tab unprotected)'}
                      accent={ghostMode && isMasked ? '#39ff14' : ghostMode ? '#ff2bd6' : '#FF4500'}
                    />
                  </div>
                </>
              )}
            </div>

            {/* ── Row: Real (unmasked) vs. Currently-Seen IP comparison ── */}
            <div className="omni-panel omni-cyan mt-4 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="omni-panel-label text-[#00fff2]">⇄ Real IP vs. What Sites Currently See</p>
                <button
                  onClick={() => { checkRealIp(); checkIp() }}
                  disabled={realIpStatus === 'loading' || ipStatus === 'loading'}
                  className="text-[9px] font-mono border border-[#00fff2]/40 text-[#00fff2] hover:bg-[#00fff2]/10 px-2 py-1 transition-colors disabled:opacity-40"
                >
                  ↻ re-check both
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border border-white/10 p-3">
                  <p className="text-[9px] font-mono text-muted uppercase tracking-widest mb-1.5">Your Real IP (forced direct)</p>
                  {realIpStatus === 'loading' && <p className="text-[10px] font-mono text-muted animate-pulse">checking…</p>}
                  {realIpStatus === 'error' && <p className="text-[10px] font-mono text-[#ff2bd6]">✕ {realIpInfo?.error ?? 'lookup failed'}</p>}
                  {realIpStatus === 'done' && realIpInfo && (
                    <>
                      <p className="text-xs font-mono text-[#FF4500]">{realIpInfo.ip}</p>
                      <p className="text-[9px] font-mono text-muted mt-0.5">{realIpInfo.country} ({realIpInfo.countryCode}) · {realIpInfo.org}</p>
                    </>
                  )}
                </div>
                <div className="border border-white/10 p-3">
                  <p className="text-[9px] font-mono text-muted uppercase tracking-widest mb-1.5">What A Site Sees Right Now</p>
                  {ipStatus === 'loading' && <p className="text-[10px] font-mono text-muted animate-pulse">checking…</p>}
                  {ipStatus === 'error' && <p className="text-[10px] font-mono text-[#ff2bd6]">✕ {ipInfo?.error ?? 'lookup failed'}</p>}
                  {ipStatus === 'done' && ipInfo && (
                    <>
                      <p className="text-xs font-mono" style={{ color: isMasked ? '#39ff14' : '#ff2bd6' }}>{ipInfo.ip}</p>
                      <p className="text-[9px] font-mono text-muted mt-0.5">{ipInfo.country} ({ipInfo.countryCode}) · {ipInfo.org}</p>
                    </>
                  )}
                </div>
              </div>
              {realIpStatus === 'done' && ipStatus === 'done' && realIpInfo && ipInfo && (
                <p className={['text-[10px] font-mono mt-2', realIpInfo.ip !== ipInfo.ip ? 'text-[#39ff14]' : 'text-[#ff2bd6]'].join(' ')}>
                  {realIpInfo.ip !== ipInfo.ip
                    ? '✓ These differ — your protection is genuinely masking your IP.'
                    : '✕ These match — nothing is masking your IP right now. Enable VPN or Ghost Mode below.'}
                </p>
              )}
            </div>

            {/* ── Row: Browsing Level — the same 3 modes as the sidebar, one mutually-
                 exclusive selector instead of independent toggles ── */}
            <div className="omni-panel omni-magenta mt-4 p-4">
              <p className="omni-panel-label text-[#ff2bd6] mb-3">◈ Browsing Level</p>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Normal */}
                <ModeCard
                  active={currentMode === 'normal'}
                  busy={chakraBusy}
                  accent="#9d00ff"
                  iconSrc="./dhurta-logo.png"
                  title="Normal Browsing"
                  subtitle="No extra protection layer"
                  desc="Default state. Sites see your real IP and standard fingerprint baseline — fine for everyday, non-sensitive browsing."
                  steps={['Click here, or disable Chakra/Ghost from the sidebar icons.']}
                  onClick={() => setMode('normal')}
                  buttonLabel={currentMode === 'normal' ? 'Currently Active' : 'Switch to Normal'}
                />
                {/* Chakra — Moderate */}
                <ModeCard
                  active={currentMode === 'chakra'}
                  busy={chakraBusy}
                  accent="#FF4500"
                  iconSrc="./chakra-icon.png"
                  title="Chakra Shield"
                  subtitle="Moderate — everyday protection"
                  desc="VPN + Anti-Fingerprint + WebRTC block + Cookie Guard + Ad Blocker, bundled in one switch. Fast, most sites keep working normally."
                  steps={['Click here, or the ⚡ Chakra icon in the sidebar.', 'VPN connects automatically (a few seconds).']}
                  onClick={() => setMode('chakra')}
                  buttonLabel={currentMode === 'chakra' ? 'Currently Active' : 'Switch to Chakra Shield'}
                />
                {/* Ghost — Extreme */}
                <ModeCard
                  active={currentMode === 'ghost'}
                  busy={chakraBusy || busy === 'ghost'}
                  accent="#ff2bd6"
                  iconSrc="./dhurta-logo.png"
                  iconGlow
                  title="Ghost Mode"
                  subtitle="Extreme — maximum anonymity"
                  desc="In-memory session, real Tor onion routing, fingerprint spoofed, WebRTC killed. Slower, but nothing survives the session."
                  steps={['Click here, or the 👻 Trishula icon in the sidebar.', 'Wait for the Tor circuit to connect.', 'A fresh Ghost tab opens automatically.']}
                  onClick={() => setMode('ghost')}
                  buttonLabel={currentMode === 'ghost' ? 'Currently Active' : 'Switch to Ghost Mode'}
                />
              </div>
            </div>

            {/* ── Row: Tor configuration status — is onion routing actually ready? ── */}
            <div className="omni-panel omni-cyan mt-4 p-4">
              <div className="flex items-center justify-between">
                <p className="omni-panel-label text-[#00fff2]">🧅 Tor / Onion Routing Configuration</p>
                <span className={[
                  'text-[9px] font-mono px-2 py-1 border',
                  torReady ? 'text-[#39ff14] border-[#39ff14]/50 bg-[#39ff14]/5' : 'text-[#ff2bd6] border-[#ff2bd6]/50 bg-[#ff2bd6]/5',
                ].join(' ')}>
                  {torReady === null ? '· CHECKING…' : torReady ? '● TOR CONFIGURED & READY' : '○ TOR NOT RUNNING'}
                </span>
              </div>
              <p className="text-[10px] font-mono text-muted mt-2 leading-relaxed">
                {torReady
                  ? 'The bundled Tor binary is bootstrapped and listening — Ghost Mode traffic exits through the onion network right now, not your ISP.'
                  : 'Tor is not currently bootstrapped. It starts automatically the moment you enable Ghost Mode above (or the 👻 sidebar icon) — this is expected while Ghost Mode is off.'}
              </p>
            </div>

            {/* ── Row: Built-in VPN + Tor/Onion control widgets ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <div className="omni-panel omni-green p-4">
                <p className="omni-panel-label text-[#39ff14] mb-2">🛡 Built-in Free VPN</p>
                <div className="flex gap-1.5 mb-2">
                  <select
                    value={vpnCountry}
                    onChange={e => setVpnCountry(e.target.value)}
                    disabled={settings.ipRotation}
                    className="flex-1 bg-black/40 border border-white/10 text-[10px] text-text font-mono px-2 py-1.5 outline-none focus:border-[#39ff14] disabled:opacity-50"
                  >
                    <option value="all">Auto (fastest)</option>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="NL">Netherlands</option>
                    <option value="CA">Canada</option>
                    <option value="JP">Japan</option>
                    <option value="SG">Singapore</option>
                  </select>
                </div>
                <div className="flex gap-1.5">
                  {settings.ipRotation ? (
                    <>
                      <button onClick={vpnRotateFull} disabled={vpnBusy} className="flex-1 text-[10px] font-mono border border-[#39ff14]/40 text-[#39ff14] hover:bg-[#39ff14]/10 py-1.5 transition-colors disabled:opacity-40">
                        {vpnBusy ? '…' : '↻ Switch Server'}
                      </button>
                      <button onClick={vpnDisconnectFull} disabled={vpnBusy} className="flex-1 text-[10px] font-mono border border-white/15 text-muted hover:text-text py-1.5 transition-colors disabled:opacity-40">
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button onClick={vpnConnectFull} disabled={vpnBusy} className="w-full text-[10px] font-mono border border-[#39ff14] text-[#39ff14] hover:bg-[#39ff14]/10 py-1.5 transition-colors disabled:opacity-40">
                      {vpnBusy ? 'Connecting…' : 'Connect VPN'}
                    </button>
                  )}
                </div>
                {vpnMsg && <p className="text-[9px] font-mono text-muted mt-1.5 truncate">{vpnMsg}</p>}
              </div>

              <div className="omni-panel omni-magenta p-4">
                <p className="omni-panel-label text-[#ff2bd6] mb-2">🧅 Built-in Tor — Onion Routing</p>
                <div className="flex gap-1.5 mb-2">
                  <select
                    value={exitCountry}
                    onChange={e => setExitCountry(e.target.value)}
                    disabled={torBusy}
                    className="flex-1 bg-black/40 border border-white/10 text-[10px] text-text font-mono px-2 py-1.5 outline-none focus:border-[#ff2bd6] disabled:opacity-50"
                  >
                    <option value="any">Any exit country</option>
                    <option value="US">United States</option>
                    <option value="DE">Germany</option>
                    <option value="NL">Netherlands</option>
                    <option value="FR">France</option>
                    <option value="GB">United Kingdom</option>
                    <option value="CH">Switzerland</option>
                    <option value="SE">Sweden</option>
                    <option value="JP">Japan</option>
                  </select>
                  <button onClick={applyExitNode} disabled={torBusy} className="text-[10px] font-mono border border-[#ff2bd6]/50 text-[#ff2bd6] hover:bg-[#ff2bd6]/10 px-2.5 py-1.5 transition-colors disabled:opacity-40">
                    Apply
                  </button>
                </div>
                <button onClick={toggleGhost} disabled={busy === 'ghost'} className={[
                  'w-full text-[10px] font-mono border py-1.5 transition-colors disabled:opacity-40',
                  ghostMode ? 'border-[#ff2bd6] text-[#ff2bd6] bg-[#ff2bd6]/10' : 'border-white/15 text-muted hover:text-text',
                ].join(' ')}>
                  {busy === 'ghost' ? '…' : ghostMode ? '● Ghost Mode ON — click to disable' : 'Enable Ghost Mode (Tor)'}
                </button>
                {ghostMode && torReady && (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-mono text-[#ff2bd6]/70 tracking-widest">CIRCUIT #{circuitCount} · AUTO-ROTATES EVERY 5 MIN</span>
                      {lastRotation && (
                        <span className="text-[9px] font-mono text-muted">last: {lastRotation.toLocaleTimeString()}</span>
                      )}
                    </div>
                    <button
                      onClick={requestNewnym}
                      disabled={newnymBusy}
                      className="w-full text-[10px] font-mono border border-[#ff2bd6]/40 text-[#ff2bd6] hover:bg-[#ff2bd6]/10 py-1.5 transition-colors disabled:opacity-40"
                    >
                      {newnymBusy ? '↻ requesting…' : '↻ New Circuit (NEWNYM)'}
                    </button>
                  </div>
                )}
                {torMsg && <p className="text-[9px] font-mono text-muted mt-1.5 truncate">{torMsg}</p>}
              </div>
            </div>

            {/* ── Row: Fingerprint surface scanner ── */}
            <div className="omni-panel omni-orange mt-4 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="omni-panel-label text-[#FF4500]">◎ Fingerprint Surface Scanner — Active Tab</p>
                <button
                  onClick={scanFingerprint}
                  disabled={fpStatus === 'loading'}
                  className="text-[9px] font-mono border border-[#FF4500]/40 text-[#FF4500] hover:bg-[#FF4500]/10 px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {fpStatus === 'loading' ? 'scanning…' : '↻ rescan'}
                </button>
              </div>
              {fpStatus === 'error' && (
                <p className="text-[10px] font-mono text-muted">{fp?.error ?? 'Could not scan — open a website in the active tab.'}</p>
              )}
              {fpStatus === 'done' && fp && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FpRow label="Screen size" value={`${fp.screenWidth}×${fp.screenHeight}`} ok={fp.screenWidth === 1920 && fp.screenHeight === 1080} why="A unique resolution narrows you to a small population of devices." />
                  <FpRow label="CPU cores" value={String(fp.hardwareConcurrency)} ok={fp.hardwareConcurrency === 8} why="Real core count can help correlate you across sessions." />
                  <FpRow label="Device memory" value={`${fp.deviceMemory} GB`} ok={fp.deviceMemory === 8} why="Combined with other signals, narrows hardware class." />
                  <FpRow label="Plugins reported" value={String(fp.pluginsCount)} ok={fp.pluginsCount === 0} why="Non-zero plugin lists are increasingly rare and stand out." />
                  <FpRow label="Languages" value={fp.languages ?? '—'} ok={fp.languages === 'en-US, en'} why="Full OS locale list can reveal region/identity." />
                  <FpRow label="Do Not Track" value={fp.doNotTrack ?? 'unset'} ok={fp.doNotTrack === '1'} why="Signals opt-out intent to trackers that respect it." />
                  <FpRow label="navigator.webdriver" value={String(fp.webdriver)} ok={fp.webdriver === false} why="true reveals automation/scripted browser control." />
                  <FpRow label="Platform" value={fp.platform ?? '—'} ok={fp.platform === 'Win32'} why="Must match the Windows User-Agent — a mismatch flags the session as spoofed." />
                  <FpRow label="WebGL renderer" value={fp.webglRenderer || '—'} ok={!!fp.webglRenderer && fp.webglRenderer.includes('GTX 1060')} why="Real GPU strings are a strong device fingerprint (WebGL1 + WebGL2 both spoofed)." />
                  <FpRow label="Timezone" value={fp.timezone ?? '—'} ok={fp.timezone === 'UTC' ? true : null} why="UTC under Ghost/Anti-Fingerprint so a Tor exit country can't be contradicted by your real timezone. Real (local) timezone is expected in Normal mode." />
                  <FpRow label="User-Agent" value={fp.userAgent ?? '—'} ok={null} why="Pinned to one consistent Windows Chrome identity (no more self-contradicting rotation)." />
                </div>
              )}
            </div>

            {/* ── Row 2: Score + Live Requests (network feed gets extra width) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4 mt-4">
              <div className="omni-panel omni-green p-5 flex items-center gap-5">
                <div className="omni-score-ring shrink-0" style={{ '--score-color': scoreColor } as React.CSSProperties}>
                  <svg width="82" height="82" viewBox="0 0 88 88">
                    <circle cx="44" cy="44" r="38" fill="none" stroke="#131316" strokeWidth="6" />
                    <circle
                      cx="44" cy="44" r="38" fill="none" stroke={scoreColor} strokeWidth="6"
                      strokeDasharray={`${(score / 100) * 238.76} 238.76`}
                      strokeLinecap="round"
                      transform="rotate(-90 44 44)"
                      style={{ transition: 'stroke-dasharray .6s ease', filter: `drop-shadow(0 0 6px ${scoreColor}aa)` }}
                    />
                  </svg>
                  <span className="omni-score-num" style={{ color: scoreColor }}>{score}</span>
                </div>
                <div className="flex-1">
                  <p className="omni-panel-label text-[#39ff14]">◆ Privacy Posture</p>
                  <p className="text-[10px] font-mono text-muted mt-1 leading-relaxed">
                    {activeCount}/{layers.length} layers active.{' '}
                    {score === 100 ? 'Maximally hardened.' : `${layers.length - activeCount} suggested below.`}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[9px] font-mono">
                    <span className="text-muted">History:<span className="text-text/80"> {data?.history.count ?? 0}</span></span>
                    <span className="text-muted">Bookmarks:<span className="text-text/80"> {data?.bookmarks.count ?? 0}</span></span>
                    <span className="text-muted">Extensions:<span className="text-text/80"> {data?.extensions.count ?? 0}</span></span>
                    <span className="text-muted">DB:<span className="text-text/80"> {data?.dbSizeKb ?? 0} KB</span></span>
                    <span className="text-muted">Trackers blocked:<span className="text-[#39ff14]"> {blockedCount}</span></span>
                  </div>
                </div>
              </div>

              <div className="omni-panel omni-orange p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="omni-panel-label text-[#FF4500]">▣ Live Request Feed — Active Tab</p>
                  <span className="text-[9px] font-mono text-muted">{requests.length} captured</span>
                </div>
                <div className="omni-scroll max-h-56 overflow-y-auto space-y-1 pr-1">
                  {requests.length === 0 && (
                    <p className="text-[10px] font-mono text-muted/50">No requests captured yet — navigate in the active tab.</p>
                  )}
                  {[...requests].reverse().slice(0, 60).map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-[9px] font-mono border-b border-white/5 pb-1">
                      <span className={[
                        'shrink-0 px-1 border w-11 text-center',
                        r.method === 'POST' ? 'text-[#ff2bd6] border-[#ff2bd6]/40'
                          : r.method === 'GET' ? 'text-[#00fff2] border-[#00fff2]/40'
                          : 'text-[#9d00ff] border-[#9d00ff]/40',
                      ].join(' ')}>{r.method}</span>
                      <span className="text-muted shrink-0">{r.status ?? '…'}</span>
                      <span className="text-text-dim truncate flex-1" title={r.url}>{r.url}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Row: Other data leaving the browser (destinations breakdown) ── */}
            <div className="omni-panel omni-cyan mt-4 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="omni-panel-label text-[#00fff2]">📤 Other Data Leaving This Browser</p>
                <span className="text-[9px] font-mono text-muted">{dataLeaving.uniqueHosts.length} destination(s)</span>
              </div>
              {dataLeaving.uniqueHosts.length === 0 ? (
                <p className="text-[10px] font-mono text-muted/50">No outbound destinations captured yet.</p>
              ) : (
                <>
                  <p className="text-[10px] font-mono text-muted mb-2 leading-relaxed">
                    Every request below carries, at minimum, your IP address, User-Agent, and — for same-domain
                    requests — any cookies set by that site. The primary domain (most-contacted) is where you're
                    browsing; every other domain is a <span className="text-[#ff2bd6]">third party</span> that also
                    now knows you visited that page.
                  </p>
                  <div className="omni-scroll max-h-32 overflow-y-auto space-y-1 pr-1">
                    {dataLeaving.uniqueHosts.map(({ host, count, isPrimary }) => (
                      <div key={host} className="flex items-center gap-2 text-[9px] font-mono border-b border-white/5 pb-1">
                        <span className={[
                          'shrink-0 px-1 border w-16 text-center',
                          isPrimary ? 'text-[#39ff14] border-[#39ff14]/40' : 'text-[#ff2bd6] border-[#ff2bd6]/40',
                        ].join(' ')}>{isPrimary ? '1ST-PARTY' : '3RD-PARTY'}</span>
                        <span className="text-text-dim truncate flex-1">{host}</span>
                        <span className="text-muted shrink-0">{count}×</span>
                      </div>
                    ))}
                  </div>
                  {dataLeaving.thirdPartyCount > 0 && (
                    <p className="text-[10px] font-mono text-[#ff2bd6] mt-2">
                      ⚠ {dataLeaving.thirdPartyCount} of {dataLeaving.uniqueHosts.length} destinations are third parties — the ad blocker already strips known trackers, but not every third-party request is a tracker.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="omni-panel omni-orange mt-4 p-4">
                <p className="omni-panel-label text-[#FF4500] mb-2">⚠ Suggested Next Steps</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setExpanded(s.id)}
                      className="text-[10px] font-mono border border-[#FF4500]/40 text-[#FF4500]/90 hover:bg-[#FF4500]/10 hover:border-[#FF4500] px-2.5 py-1.5 transition-colors"
                    >
                      {s.icon} {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Layers grid */}
            <div className="mt-4 grid grid-cols-1 gap-3">
              {layers.map((layer, i) => {
                const colors = ['#00fff2', '#ff2bd6', '#9d00ff', '#39ff14', '#FF4500', '#00fff2']
                const c = colors[i % colors.length]
                return (
                  <div key={layer.id} className="omni-panel p-4" style={{ borderColor: layer.active ? `${c}55` : undefined }}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg leading-none mt-0.5">{layer.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-mono text-text">{layer.title}</p>
                          <span className={[
                            'text-[9px] font-mono px-1.5 py-px border shrink-0',
                            layer.active ? 'border-[#39ff14]/50 text-[#39ff14]' : 'text-muted border-border',
                          ].join(' ')}>
                            {layer.active ? '● ACTIVE' : '○ INACTIVE'}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-muted mt-1 leading-relaxed">{layer.desc}</p>

                        <div className="flex items-center gap-2 mt-2">
                          {layer.onEnable && (
                            <button
                              onClick={layer.onEnable}
                              disabled={busy === layer.id}
                              style={{ borderColor: `${c}80`, color: c }}
                              className="text-[10px] font-mono border px-2 py-1 transition-colors disabled:opacity-40 hover:bg-white/5"
                            >
                              {busy === layer.id ? '…' : layer.enableLabel}
                            </button>
                          )}
                          <button
                            onClick={() => setExpanded(expanded === layer.id ? null : layer.id)}
                            className="text-[10px] font-mono text-muted hover:text-text px-2 py-1 transition-colors"
                          >
                            {expanded === layer.id ? '▲ Hide steps' : '▼ How to set up'}
                          </button>
                        </div>

                        {expanded === layer.id && (
                          <div className="mt-2 pl-3 space-y-1" style={{ borderLeft: `2px solid ${c}55` }}>
                            {layer.steps.map((step, si) => (
                              <p key={si} className="text-[10px] font-mono text-text-dim leading-relaxed">
                                <span style={{ color: `${c}bb` }}>{si + 1}.</span> {step}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer note */}
            <div className="omni-panel omni-cyan mt-4 p-4">
              <p className="omni-panel-label text-[#00fff2] mb-2">✓ What never leaves this device</p>
              <div className="grid grid-cols-2 gap-1">
                {[
                  'Browsing history & bookmarks',
                  'Passwords or payment data',
                  'Device hardware identifiers',
                  'Any analytics or telemetry',
                ].map(line => (
                  <p key={line} className="text-[10px] font-mono text-muted">✓ {line}</p>
                ))}
              </div>
            </div>

            <p className="text-center text-[9px] font-mono text-muted/40 mt-8 mb-4 tracking-widest">
              DHURTA-OMNI :: RUNS 100% LOCALLY :: NO SERVER :: NO ACCOUNT
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function OmniStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1">
      <span className="text-[9px] font-mono text-muted shrink-0">{label}</span>
      <span className="text-[10px] font-mono text-right truncate" style={{ color: accent }}>{value}</span>
    </div>
  )
}

// ok=true → protected (green), ok=false → leaking (magenta), ok=null → informational only (neutral)
function FpRow({ label, value, ok, why }: { label: string; value: string; ok: boolean | null; why: string }) {
  const color = ok === null ? '#888' : ok ? '#39ff14' : '#ff2bd6'
  const badge = ok === null ? '· INFO' : ok ? '✓ PROTECTED' : '✕ LEAKING'
  return (
    <div className="border border-white/5 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-mono text-muted">{label}</span>
        <span className="text-[8px] font-mono px-1 border" style={{ color, borderColor: `${color}55` }}>{badge}</span>
      </div>
      <p className="text-[10px] font-mono text-text/90 truncate mt-0.5" title={value}>{value}</p>
      <p className="text-[8px] font-mono text-muted/60 mt-0.5 leading-relaxed">{why}</p>
    </div>
  )
}

function ModeCard({
  active, busy, accent, iconSrc, iconGlow, title, subtitle, desc, steps, onClick, buttonLabel,
}: {
  active: boolean; busy: boolean; accent: string; iconSrc: string; iconGlow?: boolean
  title: string; subtitle: string; desc: string; steps: string[]
  onClick: () => void; buttonLabel: string
}) {
  return (
    <div className="border p-3 flex flex-col" style={{ borderColor: active ? `${accent}80` : 'rgba(255,255,255,.1)' }}>
      <div className="flex items-center gap-2">
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={active ? {
            background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`,
            boxShadow: `0 0 10px 2px ${accent}55, inset 0 0 6px 1px ${accent}33`,
          } : undefined}
        >
          <img
            src={iconSrc}
            alt=""
            draggable={false}
            className="w-6 h-6 object-contain"
            style={active
              ? { filter: iconGlow ? `drop-shadow(0 0 6px ${accent}cc)` : undefined, opacity: 1 }
              : { opacity: 0.55 }}
          />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-mono text-text truncate">{title}</p>
          <p className="text-[9px] font-mono text-muted truncate">{subtitle}</p>
        </div>
      </div>
      <p className="text-[10px] font-mono text-muted mt-2 leading-relaxed flex-1">{desc}</p>
      <button
        onClick={onClick}
        disabled={busy || active}
        className="mt-2 w-full text-[10px] font-mono border py-1.5 transition-colors disabled:opacity-60"
        style={active
          ? { borderColor: `${accent}80`, color: accent, background: `${accent}1a` }
          : { borderColor: `${accent}50`, color: accent }}
      >
        {busy ? '…' : buttonLabel}
      </button>
      <div className="mt-2 pl-2 space-y-0.5" style={{ borderLeft: `2px solid ${accent}55` }}>
        {steps.map((step, i) => (
          <p key={i} className="text-[9px] font-mono text-text-dim">{i + 1}. {step}</p>
        ))}
      </div>
    </div>
  )
}

function OmniStyles() {
  return (
    <style>{`
      .omni-root { font-family: Consolas, monospace; }
      .omni-scanlines {
        position: absolute; inset: 0; pointer-events: none; z-index: 1;
        background: repeating-linear-gradient(
          to bottom, rgba(0,255,242,0.012) 0px, rgba(0,255,242,0.012) 1px,
          transparent 1px, transparent 3px
        );
        animation: omni-flicker 6s infinite linear;
      }
      .omni-grid {
        position: absolute; inset: 0; pointer-events: none; z-index: 0;
        background-image:
          linear-gradient(rgba(0,255,242,0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(157,0,255,0.045) 1px, transparent 1px);
        background-size: 42px 42px;
        mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%);
      }
      @keyframes omni-flicker {
        0%, 100% { opacity: 1; }
        92% { opacity: 1; }
        93% { opacity: .85; }
        94% { opacity: 1; }
      }
      .omni-badge {
        width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(circle, rgba(0,255,242,.15) 0%, transparent 70%);
        border: 1px solid rgba(0,255,242,.4);
        box-shadow: 0 0 18px rgba(0,255,242,.35), inset 0 0 12px rgba(0,255,242,.15);
        animation: omni-pulse 2.4s ease-in-out infinite;
      }
      @keyframes omni-pulse {
        0%, 100% { box-shadow: 0 0 14px rgba(0,255,242,.28), inset 0 0 10px rgba(0,255,242,.12); }
        50% { box-shadow: 0 0 26px rgba(255,43,214,.45), inset 0 0 16px rgba(255,43,214,.2); }
      }
      .omni-title {
        color: #f4f4f4;
        text-shadow: 0 0 14px rgba(0,255,242,.55), 0 0 2px rgba(255,43,214,.6);
      }
      .omni-panel {
        background: rgba(12,12,16,.72);
        border: 1px solid rgba(255,255,255,.08);
        backdrop-filter: blur(2px);
        border-radius: 2px;
      }
      .omni-cyan    { box-shadow: 0 0 0 1px rgba(0,255,242,.06), 0 0 24px rgba(0,255,242,.04); }
      .omni-magenta { box-shadow: 0 0 0 1px rgba(255,43,214,.06), 0 0 24px rgba(255,43,214,.04); }
      .omni-green   { box-shadow: 0 0 0 1px rgba(57,255,20,.06), 0 0 24px rgba(57,255,20,.04); }
      .omni-orange  { box-shadow: 0 0 0 1px rgba(255,69,0,.06), 0 0 24px rgba(255,69,0,.04); }
      .omni-panel-label {
        font-size: 10px; font-family: Consolas, monospace; text-transform: uppercase; letter-spacing: .12em;
        text-shadow: 0 0 8px currentColor;
      }
      .omni-score-ring { position: relative; width: 82px; height: 82px; }
      .omni-score-num {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 19px; font-weight: 700; font-family: Consolas, monospace;
      }
      .omni-scroll::-webkit-scrollbar { width: 4px; }
      .omni-scroll::-webkit-scrollbar-thumb { background: rgba(0,255,242,.25); border-radius: 2px; }
      .omni-scroll::-webkit-scrollbar-track { background: transparent; }

      /* ── Light mode — same neon accents, inverted surface so it reads as a
         "hacker terminal on paper" rather than a generic light UI. Scoped via
         the data-omni-theme attribute, set from the browser's own theme prop
         (App.tsx's useTheme()) — no independent theme toggle on this page. ── */
      [data-omni-theme="light"].omni-root { background: #eef0f3 !important; color: #1c1e22 !important; }
      [data-omni-theme="light"] .omni-scanlines { opacity: .35; }
      [data-omni-theme="light"] .omni-grid { opacity: .5; }
      [data-omni-theme="light"] .omni-panel {
        background: rgba(255,255,255,.82) !important;
        border-color: rgba(0,0,0,.09) !important;
      }
      [data-omni-theme="light"] .omni-title { color: #14161a !important; text-shadow: 0 0 10px rgba(0,180,170,.35), 0 0 2px rgba(200,0,160,.35); }
      [data-omni-theme="light"] .text-muted,
      [data-omni-theme="light"] .text-text-dim { color: #5b606a !important; }
      [data-omni-theme="light"] .text-text,
      [data-omni-theme="light"] .text-text\\/80,
      [data-omni-theme="light"] .text-text\\/90 { color: #1c1e22 !important; }
      [data-omni-theme="light"] .text-\\[\\#d4d4d4\\] { color: #262a30 !important; }
      [data-omni-theme="light"] .border-white\\/5,
      [data-omni-theme="light"] .border-white\\/10,
      [data-omni-theme="light"] .border-white\\/15 { border-color: rgba(0,0,0,.12) !important; }
      [data-omni-theme="light"] .bg-black\\/40 { background: rgba(0,0,0,.05) !important; }
      [data-omni-theme="light"] .hover\\:bg-white\\/5:hover,
      [data-omni-theme="light"] .hover\\:bg-white\\/10:hover { background: rgba(0,0,0,.05) !important; }
      [data-omni-theme="light"] .omni-scroll::-webkit-scrollbar-thumb { background: rgba(0,140,135,.35); }
    `}</style>
  )
}
