import React, { useEffect, useState } from 'react'
import type { SecuritySettings } from '../../types'

const api = () => window.dhurta

const TOR_EXIT_COUNTRIES = [
  { code: 'any', label: 'Any country (default)' },
  { code: 'US', label: 'United States' },
  { code: 'DE', label: 'Germany' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'FR', label: 'France' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'SE', label: 'Sweden' },
  { code: 'JP', label: 'Japan' },
  { code: 'CA', label: 'Canada' },
]

const VPN_COUNTRIES = [
  { code: 'all', label: 'Auto (fastest)' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'CA', label: 'Canada' },
  { code: 'JP', label: 'Japan' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AU', label: 'Australia' },
]

export default function SecurityPanel() {
  const [settings, setSettings] = useState<SecuritySettings>({
    ipRotation: false,
    antiFingerprint: false,
    blockWebRTC: false,
    autoClean: false,
  })
  const [vpnCountry, setVpnCountry] = useState('all')
  const [vpnStatus, setVpnStatus] = useState('')
  const [vpnBusy, setVpnBusy] = useState(false)
  const [loading, setLoading] = useState<Exclude<keyof SecuritySettings, 'ipRotation'> | null>(null)
  const [exitCountry, setExitCountry] = useState('any')
  const [exitBusy, setExitBusy] = useState(false)
  const [exitStatus, setExitStatus] = useState('')

  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    api().getSecuritySettings().then(setSettings)
    api().getSetting('vpnCountry').then(v => setVpnCountry(v ?? 'all')).catch(() => {})
    api().getSetting('security_ipRotation').then(v => {
      if (v === 'true') setVpnStatus('VPN connected')
    }).catch(() => {})
  }, [])

  // Sync with Chakra toggle — it fires dhurta:settingChanged for each setting it changes
  useEffect(() => {
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail
      const on = value === 'true'
      if (key === 'security_antiFingerprint') setSettings(s => ({ ...s, antiFingerprint: on }))
      if (key === 'security_blockWebRTC')     setSettings(s => ({ ...s, blockWebRTC: on }))
      if (key === 'security_autoClean')       setSettings(s => ({ ...s, autoClean: on }))
      if (key === 'security_ipRotation') {
        setSettings(s => ({ ...s, ipRotation: on }))
        setVpnStatus(on ? 'VPN connected via Chakra' : 'Disconnected')
      }
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [])

  const handleSetExitNode = async () => {
    setExitBusy(true)
    setExitStatus('Applying…')
    try {
      const cc = exitCountry === 'any' ? null : exitCountry
      const res = await api().setExitNode(cc)
      if (res.success) {
        setExitStatus(res.restarted
          ? `Exit node set — new Tor circuit via ${cc ? TOR_EXIT_COUNTRIES.find(c => c.code === cc)?.label ?? cc : 'any country'}`
          : `Will apply when Ghost Mode starts`)
      } else {
        setExitStatus(res.error ?? 'Failed to set exit node')
      }
    } finally {
      setExitBusy(false)
    }
  }

  const handleVpnConnect = async () => {
    setVpnBusy(true)
    setVpnStatus('Connecting…')
    try {
      const res = await api().vpnConnect(vpnCountry)
      if (res.success) {
        setSettings(s => ({ ...s, ipRotation: true }))
        setVpnStatus(`Connected via ${res.proxy}`)
      } else {
        setVpnStatus(res.error ?? 'Failed to connect')
        setSettings(s => ({ ...s, ipRotation: false }))
      }
    } finally {
      setVpnBusy(false)
    }
  }

  const handleVpnDisconnect = async () => {
    setVpnBusy(true)
    try {
      await api().vpnDisconnect()
      setSettings(s => ({ ...s, ipRotation: false }))
      setVpnStatus('Disconnected — direct connection restored')
    } finally {
      setVpnBusy(false)
    }
  }

  const handleVpnRotate = async () => {
    setVpnBusy(true)
    setVpnStatus('Switching server…')
    try {
      const res = await api().vpnRotate()
      setVpnStatus(res.success ? `Now via ${res.proxy}` : (res.error ?? 'Failed'))
    } finally {
      setVpnBusy(false)
    }
  }

  const handleToggle = async (key: Exclude<keyof SecuritySettings, 'ipRotation'>, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setLoading(key)
    try {
      if (key === 'antiFingerprint') await api().setAntiFingerprint(value)
      else if (key === 'blockWebRTC') await api().setBlockWebRTC(value)
      else if (key === 'autoClean') await api().setAutoClean(value)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-80">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Security & VPN</h2>
        <p className="text-[10px] text-muted font-mono mt-0.5">Client-side · no accounts · no cost</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* VPN */}
        <div className={['border p-2.5 space-y-2 transition-colors', settings.ipRotation ? 'border-saffron bg-obsidian' : 'border-border bg-obsidian'].join(' ')}>
          <div className="flex items-center gap-2">
            <span className="text-sm">🛡️</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text font-mono">Free VPN</p>
              <p className="text-[10px] text-muted font-mono mt-0.5 leading-relaxed">
                Routes your traffic through a free public server, hiding your real IP. No sign-up needed.
              </p>
            </div>
            <span className={['text-[9px] font-mono px-1.5 py-px border shrink-0', settings.ipRotation ? 'text-saffron border-saffron' : 'text-muted border-border'].join(' ')}>
              {settings.ipRotation ? 'ON' : 'OFF'}
            </span>
          </div>

          {/* Country selector */}
          <div>
            <label className="text-[10px] text-muted font-mono block mb-1">Server location</label>
            <select
              value={vpnCountry}
              onChange={(e) => setVpnCountry(e.target.value)}
              disabled={settings.ipRotation}
              className="w-full bg-surface border border-border text-xs text-text font-mono px-2 py-1 outline-none focus:border-saffron disabled:opacity-50"
            >
              {VPN_COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          {vpnStatus && (
            <p className="text-[10px] font-mono text-text-dim truncate">{vpnStatus}</p>
          )}

          {/* Buttons */}
          <div className="flex gap-1.5">
            {settings.ipRotation ? (
              <>
                <button
                  onClick={handleVpnRotate}
                  disabled={vpnBusy}
                  className="flex-1 text-[10px] font-mono text-text border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors disabled:opacity-40"
                >
                  {vpnBusy ? 'Switching…' : '↻ Switch Server'}
                </button>
                <button
                  onClick={handleVpnDisconnect}
                  disabled={vpnBusy}
                  className="flex-1 text-[10px] font-mono text-muted border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors disabled:opacity-40"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={handleVpnConnect}
                disabled={vpnBusy}
                className="w-full text-[10px] font-mono text-text border border-saffron hover:bg-saffron hover:text-white py-1.5 transition-colors disabled:opacity-40"
              >
                {vpnBusy ? 'Connecting…' : 'Connect VPN'}
              </button>
            )}
          </div>
          <p className="text-[9px] text-muted font-mono italic">Free servers may be slower than paid VPNs. Takes effect on new requests.</p>
        </div>

        {/* Anti-Fingerprint */}
        <SecurityCard
          icon="🎭"
          title="Anti-Fingerprint Engine"
          desc="Adds noise to Canvas/Audio readings, spoofs WebGL GPU info and screen size so trackers can't profile your device."
          note="Takes effect on new tabs and after reload."
          value={settings.antiFingerprint}
          loading={loading === 'antiFingerprint'}
          onChange={(v) => handleToggle('antiFingerprint', v)}
        />

        {/* Block WebRTC */}
        <SecurityCard
          icon="🔇"
          title="Block WebRTC Leaks"
          desc="Disables WebRTC so websites can't discover your real IP even when using the VPN or a proxy."
          note="May break voice/video calls. Takes effect on new tabs."
          value={settings.blockWebRTC}
          loading={loading === 'blockWebRTC'}
          onChange={(v) => handleToggle('blockWebRTC', v)}
        />

        {/* Auto-Clean */}
        <SecurityCard
          icon="🧹"
          title="Auto-Clean Memory"
          desc="When you close a tab, all cookies, cache, and session data from it are instantly deleted."
          value={settings.autoClean}
          loading={loading === 'autoClean'}
          onChange={(v) => handleToggle('autoClean', v)}
        />

        {/* Ghost Mode explainer */}
        <div className="border-t border-border pt-3">
          <p className="text-[10px] font-mono text-saffron uppercase tracking-widest mb-2">Ghost Mode — Maximum Privacy</p>
          <div className="bg-obsidian border border-border p-2.5 space-y-1.5">
            <FeatureLine icon="🎭" label="Auto-Spoof" detail="Fingerprint + UA rotation every 5 min" />
            <FeatureLine icon="🔇" label="WebRTC Killed" detail="IP leaks impossible" />
            <FeatureLine icon="💾" label="Memory Only" detail="Zero data written to disk" />
            <FeatureLine icon="🧅" label="Real Tor Routing" detail="Bundled Tor binary — traffic + DNS exit via the Tor network" />
            <FeatureLine icon="🔀" label="Circuit Isolation" detail="Separate Tor circuit per site — cross-tab correlation blocked" />
            <FeatureLine icon="📐" label="Letterboxing" detail="Viewport rounded to standard size — dimension fingerprint blocked" />
            <FeatureLine icon="⏱️" label="Timer Clamped" detail="performance.now() at 1ms precision — timing attacks blocked" />
            <FeatureLine icon="🌐" label="FPI Active" detail="Storage partitioned per top-level site — cross-site tracking blocked" />
          </div>

          {/* Tor Exit Node Country */}
          <div className="mt-2.5 p-2.5 bg-obsidian border border-border">
            <p className="text-[10px] font-mono text-saffron mb-1.5">Tor Exit Node Country</p>
            <p className="text-[10px] text-muted font-mono mb-2 leading-relaxed">
              Pin Tor to exit via a specific country. Changes take effect immediately if Ghost Mode is active (Tor restarts).
            </p>
            <div className="flex gap-1.5">
              <select
                value={exitCountry}
                onChange={(e) => { setExitCountry(e.target.value); setExitStatus('') }}
                disabled={exitBusy}
                className="flex-1 bg-surface border border-border text-xs text-text font-mono px-2 py-1 outline-none focus:border-saffron disabled:opacity-50"
              >
                {TOR_EXIT_COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <button
                onClick={handleSetExitNode}
                disabled={exitBusy}
                className="text-[10px] font-mono text-text border border-border hover:border-saffron hover:text-saffron px-2.5 py-1 transition-colors disabled:opacity-40"
              >
                {exitBusy ? '…' : 'Apply'}
              </button>
            </div>
            {exitStatus && (
              <p className="text-[10px] font-mono text-text-dim mt-1.5 leading-relaxed">{exitStatus}</p>
            )}
          </div>

          <p className="text-[10px] text-muted font-mono mt-2 leading-relaxed">
            Toggle via the <span className="text-saffron">Trishula</span> icon in the sidebar.
          </p>
        </div>
      </div>
    </div>
  )
}

function SecurityCard({
  icon, title, desc, note, value, loading, onChange, children,
}: {
  icon: string; title: string; desc: string; note?: string
  value: boolean; loading: boolean; onChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className={['border p-2.5 transition-colors', value ? 'border-saffron bg-obsidian' : 'border-border bg-obsidian'].join(' ')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="text-sm mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <p className="text-xs text-text font-mono">{title}</p>
            <p className="text-[10px] text-muted font-mono mt-0.5 leading-relaxed">{desc}</p>
            {note && <p className="text-[10px] text-text-dim font-mono mt-1 italic">{note}</p>}
          </div>
        </div>
        <button
          onClick={() => onChange(!value)}
          disabled={loading}
          className={['shrink-0 w-8 h-4 border transition-colors mt-0.5 disabled:opacity-40', value ? 'bg-saffron border-saffron' : 'bg-obsidian border-border'].join(' ')}
        >
          <span className={['block w-3 h-3 bg-white transition-transform mx-0.5', value ? 'translate-x-4' : 'translate-x-0'].join(' ')} />
        </button>
      </div>
      {children}
    </div>
  )
}

function FeatureLine({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-xs shrink-0">{icon}</span>
      <span className="text-[10px] font-mono text-saffron shrink-0">{label}</span>
      <span className="text-[10px] font-mono text-muted">— {detail}</span>
    </div>
  )
}
