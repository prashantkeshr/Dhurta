import React, { useEffect, useState } from 'react'
import { THEMES, GRADIENT_THEMES, WALLPAPER_THEMES } from '../NewTabPage'
import { useTheme } from '../../store/useTheme'

const api = () => window.dhurta

const SEARCH_ENGINES = [
  { value: 'brave',      label: 'Brave Search', url: 'search.brave.com' },
  { value: 'google',     label: 'Google',       url: 'google.com' },
  { value: 'duckduckgo', label: 'DuckDuckGo',   url: 'duckduckgo.com' },
  { value: 'bing',       label: 'Bing',         url: 'bing.com' },
  { value: 'custom',     label: 'Custom URL',   url: '' },
]

const MAX_WALLPAPERS = 5

type Section = 'general' | 'appearance' | 'privacy' | 'lock' | 'about'

/** Notify the rest of the app that a setting changed so the home page can update in real time. */
function notifyChange(key: string, value: string) {
  window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key, value } }))
}

function saveAndNotify(key: string, val: string) {
  api().setSetting(key, val)
  notifyChange(key, val)
}

export default function SettingsPanel() {
  const { theme: uiTheme, toggle: toggleUiTheme } = useTheme()
  const [section,         setSection]         = useState<Section>('general')
  const [cookieGuard,     setCookieGuard]     = useState(true)
  const [adBlocker,       setAdBlocker]       = useState(true)
  const [incinerateDays,  setIncinerateDays]  = useState(30)
  const [searchEngine,    setSearchEngine]    = useState('brave')
  const [customSearchUrl, setCustomSearchUrl] = useState('')
  const [sessionRestore,  setSessionRestore]  = useState(false)
  const [gesturePinch,    setGesturePinch]    = useState(true)
  const [gestureSwipe,    setGestureSwipe]    = useState(true)
  const [wallpapers,      setWallpapers]      = useState<string[]>([])
  const [activeTheme,     setActiveTheme]     = useState('dark')
  const [downloadPath,    setDownloadPath]    = useState('')
  const [lockStatus,      setLockStatus]      = useState({ hasPin: false })
  const [lockRemoveMode,  setLockRemoveMode]  = useState<'none' | 'pin' | 'recovery'>('none')
  const [lockRemoveInput, setLockRemoveInput] = useState('')
  const [lockRemoveErr,   setLockRemoveErr]   = useState('')
  const [lockRemoveOk,    setLockRemoveOk]    = useState(false)

  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    Promise.all([
      api().getSetting('cookieGuard'),
      api().getSetting('adBlocker'),
      api().getSetting('incinerateDays'),
      api().getSetting('searchEngine'),
      api().getSetting('searchEngineCustomUrl'),
      api().getSetting('sessionRestore'),
      api().getSetting('wallpapers'),
      api().getSetting('newTabTheme'),
      api().getSetting('gesturePinchZoom'),
      api().getSetting('gestureSwipe'),
    ] as const).then(([cg, ab, id, se, cu, sr, wps, nt, gp, gs]) => {
      setCookieGuard(cg !== 'false')
      setAdBlocker(ab !== 'false')
      setIncinerateDays(Number(id ?? 30))
      const validEngines = SEARCH_ENGINES.map(e => e.value)
      setSearchEngine(validEngines.includes(se ?? '') ? (se ?? 'brave') : 'brave')
      setCustomSearchUrl(cu ?? '')
      setSessionRestore(sr === 'true')
      try { setWallpapers(JSON.parse(wps || '[]')) } catch { setWallpapers([]) }
      setActiveTheme(nt ?? 'dark')
      setGesturePinch(gp !== 'false')
      setGestureSwipe(gs !== 'false')
    })
    api().getDownloadDefaultPath().then(setDownloadPath).catch(() => {})
    api().appLockStatus().then(s => setLockStatus({ hasPin: s.hasPin })).catch(() => {})
  }, [])

  // Sync Privacy toggles when Chakra fires setting-changed events
  useEffect(() => {
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail
      if (key === 'cookieGuard') setCookieGuard(value === 'true')
      if (key === 'adBlocker')   setAdBlocker(value === 'true')
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [])

  const saveWallpapers = (list: string[]) => {
    const json = JSON.stringify(list)
    api().setSetting('wallpapers', json)
    notifyChange('wallpapers', json)
  }

  const addWallpaper = async () => {
    if (wallpapers.length >= MAX_WALLPAPERS) return
    const url = await api().pickImage()
    if (!url) return
    const next = [...wallpapers, url]
    setWallpapers(next)
    saveWallpapers(next)
    setActiveTheme('')
    api().setSetting('newTabTheme', '')
  }

  const removeWallpaper = (idx: number) => {
    const next = wallpapers.filter((_, i) => i !== idx)
    setWallpapers(next)
    saveWallpapers(next)
    if (next.length === 0) {
      setActiveTheme('dark')
      saveAndNotify('newTabTheme', 'dark')
    }
  }

  const navItems: { id: Section; icon: string; label: string }[] = [
    { id: 'general',    icon: '⚙',  label: 'General' },
    { id: 'appearance', icon: '🎨', label: 'Appearance' },
    { id: 'privacy',    icon: '🔒', label: 'Privacy' },
    { id: 'lock',       icon: '🔑', label: 'Lock' },
    { id: 'about',      icon: 'ℹ',  label: 'About' },
  ]

  const changeDownloadPath = async () => {
    const chosen = await api().setDownloadDefaultPath()
    if (chosen) setDownloadPath(chosen)
  }

  const handleRemoveLock = async () => {
    setLockRemoveErr('')
    if (!lockRemoveInput.trim()) { setLockRemoveErr('Enter your PIN or recovery phrase.'); return }
    try {
      if (lockRemoveMode === 'pin') {
        const r = await api().appLockClear(lockRemoveInput)
        if (r.ok) {
          setLockStatus({ hasPin: false })
          setLockRemoveOk(true)
          setLockRemoveMode('none')
          setLockRemoveInput('')
        } else {
          setLockRemoveErr('Incorrect PIN. Try again.')
        }
      } else {
        // Recovery phrase — appLockRecover also calls clearPin() internally
        const r = await api().appLockRecover(lockRemoveInput)
        if (r.ok) {
          setLockStatus({ hasPin: false })
          setLockRemoveOk(true)
          setLockRemoveMode('none')
          setLockRemoveInput('')
        } else {
          setLockRemoveErr('Recovery phrase is incorrect.')
        }
      }
    } catch {
      setLockRemoveErr('An error occurred. Please try again.')
    }
  }

  return (
    <div className="panel-overlay flex h-full w-full bg-surface border-r border-border overflow-hidden">
      {/* Left nav */}
      <div className="w-44 shrink-0 border-r border-border bg-obsidian flex flex-col">
        <div className="p-3 border-b border-border">
          <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Settings</h2>
        </div>
        <nav className="flex-1 py-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={[
                'w-full flex items-center gap-2.5 px-3 py-2 text-xs font-mono transition-colors text-left',
                section === item.id
                  ? 'bg-surface text-saffron border-r-2 border-saffron'
                  : 'text-muted hover:text-text hover:bg-surface/50',
              ].join(' ')}
            >
              <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <p className="text-[9px] text-muted font-mono">Dhurta v1.0</p>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* ── General ── */}
        {section === 'general' && (
          <>
            <PageTitle>General</PageTitle>

            <SettingGroup title="Search Engine">
              <p className="text-[9px] text-muted font-mono mb-2">
                Used when typing a query in the home page or address bar.
              </p>
              <div className="grid grid-cols-1 gap-1">
                {SEARCH_ENGINES.map(e => (
                  <label key={e.value} className="flex items-center gap-3 p-2 border border-transparent hover:border-border cursor-pointer group transition-colors">
                    <input
                      type="radio"
                      name="searchEngine"
                      value={e.value}
                      checked={searchEngine === e.value}
                      onChange={() => { setSearchEngine(e.value); saveAndNotify('searchEngine', e.value) }}
                      className="accent-saffron shrink-0"
                    />
                    <div>
                      <p className="text-xs font-mono text-text group-hover:text-saffron transition-colors">{e.label}</p>
                      {e.url && <p className="text-[10px] text-muted font-mono">{e.url}</p>}
                    </div>
                  </label>
                ))}
              </div>
              {searchEngine === 'custom' && (
                <div className="mt-2 space-y-1">
                  <label className="text-[10px] text-muted font-mono">
                    URL — use <span className="text-saffron font-bold">%s</span> for the query
                  </label>
                  <input
                    type="text"
                    placeholder="https://example.com/search?q=%s"
                    value={customSearchUrl}
                    onChange={e => setCustomSearchUrl(e.target.value)}
                    onBlur={() => saveAndNotify('searchEngineCustomUrl', customSearchUrl)}
                    className="w-full bg-obsidian border border-border text-xs text-text font-mono px-2 py-1.5 outline-none focus:border-saffron"
                  />
                </div>
              )}
            </SettingGroup>

            <SettingGroup title="Gestures">
              <SettingRow
                label="Pinch to zoom in"
                desc="Spread two fingers on the trackpad to zoom in. Pinch-in (zoom out) is intentionally disabled to prevent responsive layout issues."
              >
                <Toggle value={gesturePinch} onChange={v => { setGesturePinch(v); saveAndNotify('gesturePinchZoom', String(v)) }} />
              </SettingRow>
              <SettingRow
                label="Swipe to navigate"
                desc="Two-finger horizontal swipe on the trackpad goes back or forward. Only triggers at the page edge — won't interfere with horizontal scroll."
              >
                <Toggle value={gestureSwipe} onChange={v => { setGestureSwipe(v); saveAndNotify('gestureSwipe', String(v)) }} />
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="Startup">
              <SettingRow
                label="Restore last session"
                desc="Reopen every tab that was open when Dhurta was last closed."
              >
                <Toggle value={sessionRestore} onChange={v => { setSessionRestore(v); api().setSetting('sessionRestore', String(v)) }} />
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="History Auto-Delete">
              <div className="flex items-center gap-3">
                <p className="text-xs text-text flex-1">Automatically delete history older than</p>
                <select
                  className="bg-obsidian border border-border text-xs text-text px-2 py-1.5 font-mono"
                  value={incinerateDays}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setIncinerateDays(v)
                    api().setSetting('incinerateDays', String(v))
                    api().setIncinerate(v)
                  }}
                >
                  <option value={0}>Never</option>
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
            </SettingGroup>

            <SettingGroup title="Downloads">
              <SettingRow
                label="Save location"
                desc="Where downloaded files are saved on your computer."
              >
                <button
                  onClick={changeDownloadPath}
                  className="text-[10px] font-mono border border-border text-muted hover:border-saffron hover:text-saffron px-2.5 py-1 transition-colors shrink-0"
                >
                  Change…
                </button>
              </SettingRow>
              {downloadPath && (
                <div className="flex items-center gap-2 mt-1">
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" className="text-muted shrink-0">
                    <path d="M0.5 7.5V2.5h3L5 4h5.5v3.5H0.5z" />
                  </svg>
                  <span className="text-[10px] font-mono text-muted/70 truncate" title={downloadPath}>{downloadPath}</span>
                </div>
              )}
            </SettingGroup>
          </>
        )}

        {/* ── Appearance ── */}
        {section === 'appearance' && (
          <>
            <PageTitle>Appearance</PageTitle>

            {/* ── Browser UI theme ── */}
            <SettingGroup title="Browser Theme">
              <SettingRow label="Night Mode" desc="Switch the browser interface between dark and light themes.">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted">{uiTheme === 'dark' ? 'Dark' : 'Light'}</span>
                  <Toggle value={uiTheme === 'light'} onChange={() => toggleUiTheme()} />
                </div>
              </SettingRow>
            </SettingGroup>

            {/* ── Gradient themes ── */}
            <SettingGroup title="Gradient Themes">
              <div className="grid grid-cols-4 gap-2">
                {GRADIENT_THEMES.map(t => (
                  <button
                    key={t.id}
                    title={t.label}
                    onClick={() => {
                      setActiveTheme(t.id)
                      saveAndNotify('newTabTheme', t.id)
                      setWallpapers([])
                      saveWallpapers([])
                    }}
                    className={[
                      'flex flex-col items-center gap-1 p-1.5 border transition-colors',
                      activeTheme === t.id && wallpapers.length === 0
                        ? 'border-saffron'
                        : 'border-border hover:border-saffron/50',
                    ].join(' ')}
                  >
                    <div className="w-full h-8 rounded-sm" style={{ background: t.bg }} />
                    <span className="text-[8px] font-mono text-muted truncate w-full text-center">{t.label}</span>
                  </button>
                ))}
              </div>
            </SettingGroup>

            {/* ── Built-in wallpaper themes ── */}
            <SettingGroup title="Wallpaper Themes">
              <div className="grid grid-cols-3 gap-2">
                {WALLPAPER_THEMES.map(t => (
                  <button
                    key={t.id}
                    title={t.label}
                    onClick={() => {
                      setActiveTheme(t.id)
                      saveAndNotify('newTabTheme', t.id)
                      setWallpapers([])
                      saveWallpapers([])
                    }}
                    className={[
                      'flex flex-col items-center gap-1 p-1.5 border transition-colors',
                      activeTheme === t.id && wallpapers.length === 0
                        ? 'border-saffron'
                        : 'border-border hover:border-saffron/50',
                    ].join(' ')}
                  >
                    <div className="relative w-full overflow-hidden rounded-sm" style={{ aspectRatio: '16/9' }}>
                      <img
                        src={t.src}
                        alt={t.label}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {activeTheme === t.id && wallpapers.length === 0 && (
                        <div className="absolute inset-0 border-2 border-saffron rounded-sm pointer-events-none" />
                      )}
                    </div>
                    <span className="text-[8px] font-mono text-muted truncate w-full text-center">{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted font-mono mt-2">
                Built-in wallpapers. Selecting any theme clears custom wallpapers.
              </p>
            </SettingGroup>

            {/* ── Custom wallpapers ── */}
            <SettingGroup title={`Custom Wallpapers (${wallpapers.length} / ${MAX_WALLPAPERS})`}>
              <div className="grid grid-cols-5 gap-2">
                {wallpapers.map((wp, i) => (
                  <div key={i} className="relative border border-border overflow-hidden group" style={{ aspectRatio: '1' }}>
                    <img src={wp} alt={`Wallpaper ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors" />
                    <button
                      onClick={() => removeWallpaper(i)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 text-[9px] bg-black/80 hover:bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                    >✕</button>
                    {i === 0 && wallpapers.length > 1 && (
                      <span className="absolute bottom-0.5 left-0.5 text-[7px] font-mono bg-black/70 text-saffron px-1">1st</span>
                    )}
                  </div>
                ))}

                {wallpapers.length < MAX_WALLPAPERS && (
                  <button
                    onClick={addWallpaper}
                    className="border border-dashed border-white/20 hover:border-saffron/60 flex flex-col items-center justify-center gap-1 transition-colors group"
                    style={{ aspectRatio: '1' }}
                  >
                    <span className="text-white/30 group-hover:text-saffron/60 text-lg leading-none transition-colors">+</span>
                    <span className="text-[7px] font-mono text-white/25 group-hover:text-saffron/50 transition-colors">Add</span>
                  </button>
                )}
              </div>
              <p className="text-[9px] text-muted font-mono mt-2">
                Up to 5 images · Multiple wallpapers cycle every 18 s · Overrides theme wallpapers
              </p>
            </SettingGroup>
          </>
        )}

        {/* ── Privacy ── */}
        {section === 'privacy' && (
          <>
            <PageTitle>Privacy</PageTitle>
            <SettingGroup title="Tracking Protection">
              <SettingRow label="Cookie Guard" desc="Block third-party cookies and auto-delete first-party every 60 min.">
                <Toggle value={cookieGuard} onChange={v => { setCookieGuard(v); api().setSetting('cookieGuard', String(v)) }} />
              </SettingRow>
              <SettingRow label="Ad & Tracker Blocker" desc="Native EasyList-based ad and tracker blocking.">
                <Toggle value={adBlocker} onChange={v => { setAdBlocker(v); api().setSetting('adBlocker', String(v)) }} />
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="Ghost Mode">
              <div className="bg-obsidian border border-border p-3 space-y-2">
                <p className="text-xs text-saffron font-mono">In-memory session · Zero disk writes</p>
                <ul className="space-y-1">
                  {['Routed through bundled Tor binary (traffic + DNS)', 'Canvas/WebGL/Audio fingerprint spoofing', 'WebRTC IP leak blocked', 'User-Agent rotation every 5 min', 'All data wiped on tab close'].map(f => (
                    <li key={f} className="text-[11px] text-muted font-mono flex gap-2">
                      <span className="text-saffron shrink-0">✓</span>{f}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted font-mono mt-1">
                  Toggle via the <span className="text-saffron">⚡</span> icon in the sidebar.
                </p>
              </div>
            </SettingGroup>

            <SettingGroup title="Data Management">
              <div className="flex gap-2">
                <button
                  onClick={() => api().clearCookies()}
                  className="text-xs font-mono text-muted border border-border hover:border-saffron hover:text-saffron px-3 py-2 transition-colors"
                >
                  Clear Cookies
                </button>
              </div>
            </SettingGroup>
          </>
        )}

        {/* ── Lock ── */}
        {section === 'lock' && (
          <>
            <PageTitle>Browser Lock</PageTitle>

            {/* Status */}
            <SettingGroup title="Lock Status">
              <div className="flex items-center gap-3 p-3 border border-border bg-obsidian">
                <div className={['w-2 h-2 rounded-full', lockStatus.hasPin ? 'bg-saffron' : 'bg-muted/40'].join(' ')} />
                <div>
                  <p className="text-xs font-mono text-text">
                    {lockStatus.hasPin ? 'Lock is active' : 'No lock configured'}
                  </p>
                  <p className="text-[9px] font-mono text-muted mt-0.5">
                    {lockStatus.hasPin
                      ? 'Browser requires PIN on startup. Remove it below.'
                      : 'Set up a lock from the sidebar lock icon.'}
                  </p>
                </div>
              </div>
              {lockRemoveOk && (
                <div className="flex items-center gap-2 p-2 border border-green-600/30 bg-green-900/10 text-green-400 text-[11px] font-mono">
                  <span>✓</span> Lock removed successfully.
                </div>
              )}
            </SettingGroup>

            {/* Remove lock */}
            {lockStatus.hasPin && !lockRemoveOk && (
              <SettingGroup title="Remove Lock">
                <p className="text-[10px] font-mono text-muted leading-relaxed">
                  Permanently disable the browser lock. Verify your identity using your PIN or your recovery phrase.
                </p>

                {lockRemoveMode === 'none' && (
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => { setLockRemoveMode('pin'); setLockRemoveInput(''); setLockRemoveErr('') }}
                      className="flex-1 py-2 border border-border text-[11px] font-mono text-muted hover:border-saffron hover:text-saffron transition-colors"
                    >
                      Remove via PIN
                    </button>
                    <button
                      onClick={() => { setLockRemoveMode('recovery'); setLockRemoveInput(''); setLockRemoveErr('') }}
                      className="flex-1 py-2 border border-border text-[11px] font-mono text-muted hover:border-saffron hover:text-saffron transition-colors"
                    >
                      Remove via Recovery
                    </button>
                  </div>
                )}

                {lockRemoveMode !== 'none' && (
                  <div className="space-y-2 mt-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-saffron uppercase tracking-wider">
                        {lockRemoveMode === 'pin' ? 'Enter your PIN' : 'Enter recovery phrase'}
                      </span>
                      <button onClick={() => { setLockRemoveMode('none'); setLockRemoveErr('') }}
                        className="ml-auto text-[9px] font-mono text-muted hover:text-saffron transition-colors">
                        Cancel
                      </button>
                    </div>

                    {lockRemoveMode === 'pin' ? (
                      <input
                        type="password"
                        value={lockRemoveInput}
                        onChange={e => { setLockRemoveInput(e.target.value); setLockRemoveErr('') }}
                        onKeyDown={e => e.key === 'Enter' && handleRemoveLock()}
                        placeholder="Your current PIN"
                        autoFocus
                        className="w-full bg-obsidian border border-border focus:border-saffron px-3 py-2 text-xs font-mono text-text outline-none transition-colors tracking-widest"
                      />
                    ) : (
                      <textarea
                        value={lockRemoveInput}
                        onChange={e => { setLockRemoveInput(e.target.value); setLockRemoveErr('') }}
                        placeholder="word1 word2 word3 word4 word5 word6"
                        rows={2}
                        autoFocus
                        className="w-full bg-obsidian border border-border focus:border-saffron px-3 py-2 text-xs font-mono text-text outline-none resize-none transition-colors"
                      />
                    )}

                    {lockRemoveErr && (
                      <p className="text-[10px] font-mono text-red-400">{lockRemoveErr}</p>
                    )}

                    <button
                      onClick={handleRemoveLock}
                      className="w-full py-2 border border-red-500/50 text-red-400 text-[11px] font-mono hover:bg-red-500/10 transition-colors"
                    >
                      Remove Lock Permanently
                    </button>
                  </div>
                )}
              </SettingGroup>
            )}

            {/* Change PIN */}
            {lockStatus.hasPin && !lockRemoveOk && (
              <SettingGroup title="Change PIN">
                <ChangePinForm onChanged={() => {}} />
              </SettingGroup>
            )}
          </>
        )}

        {/* ── About ── */}
        {section === 'about' && (
          <>
            <PageTitle>About Dhurta</PageTitle>
            <div className="bg-obsidian border border-border p-5 space-y-3">
              <div className="flex items-center gap-3">
                <img src="./dhurta-logo.png" alt="Dhurta" className="w-10 h-10 object-contain" />
                <div>
                  <p className="text-sm font-mono text-text">Dhurta</p>
                  <p className="text-xs text-muted font-mono">Sovereign Browser · v1.0.0</p>
                </div>
              </div>
              <div className="border-t border-border pt-3 space-y-1">
                {[
                  ['Engine',   'Chromium via Electron'],
                  ['Renderer', 'React 19 + Vite 5'],
                  ['Privacy',  'Zero telemetry · Zero cloud'],
                  ['Storage',  'SQLite (local only)'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-4">
                    <span className="text-[10px] text-muted font-mono w-20 shrink-0">{k}</span>
                    <span className="text-[10px] text-text font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <SettingGroup title="Feature Guide">
              <div className="space-y-3">
                {[
                  {
                    icon: '👻', title: 'Ghost Mode',
                    lines: [
                      'Click the Trishula logo in the sidebar to enable.',
                      'Opens a new tab in a fully isolated, memory-only session.',
                      'Traffic and DNS are routed through the bundled Tor network — no VPN account needed.',
                      'Canvas, WebGL, Audio fingerprints are spoofed. WebRTC is blocked. UA rotates every 5 min.',
                      'All data is wiped the moment you close the ghost tab. Nothing is ever written to disk.',
                    ],
                  },
                  {
                    icon: '⚡', title: 'Chakra Shield',
                    lines: [
                      'Click the spinning-wheel icon below Ghost Mode.',
                      'One tap enables: Free VPN + Anti-Fingerprint + WebRTC Block + Cookie Guard + Ad Blocker + Auto-Clean.',
                      'Tap again to disable all six features at once.',
                      'Use this for everyday private browsing without Tor overhead.',
                    ],
                  },
                  {
                    icon: '🛡️', title: 'Free VPN',
                    lines: [
                      'Open Security panel → Free VPN → choose a country → Connect.',
                      'Routes all non-Ghost traffic through a free SOCKS5 server, hiding your real IP.',
                      'DNS is resolved remotely through the proxy, so your ISP cannot see which sites you visit.',
                      'Note: free proxy servers may be slower than paid VPNs. Reconnect to switch servers.',
                    ],
                  },
                  {
                    icon: '🎭', title: 'Anti-Fingerprint',
                    lines: [
                      'Enable via Security panel or Chakra Shield.',
                      'Adds invisible noise to Canvas and AudioContext to defeat fingerprint trackers.',
                      'Spoofs: WebGL GPU info, screen resolution (1920×1080), hardware concurrency (8), device memory (8 GB), platform (Win32), languages (en-US), and timezone.',
                      'Removes Battery API and Network Info API — both common leak vectors.',
                      'Takes effect on new tabs and after page reload.',
                    ],
                  },
                  {
                    icon: '🔇', title: 'Block WebRTC Leaks',
                    lines: [
                      'Enable via Security panel or Chakra Shield.',
                      'Removes RTCPeerConnection from all pages so your real IP cannot be discovered via STUN.',
                      'Chromium-level flag also blocks non-proxied UDP to prevent bypass.',
                      'Note: disables in-browser voice/video calls (Google Meet, Jitsi). Disable temporarily if needed.',
                    ],
                  },
                  {
                    icon: '🧩', title: 'Chrome Extensions',
                    lines: [
                      'Go to Settings → Extensions panel, or visit the Chrome Web Store (chromewebstore.google.com).',
                      'On any extension detail page, an "⚡ Install in Dhurta" button appears in the bottom-right corner.',
                      'Click it — the CRX is downloaded from Google\'s servers and installed automatically.',
                      'You can also drag-and-drop a .crx file onto the Extensions panel.',
                    ],
                  },
                  {
                    icon: '⠿', title: 'Apps Grid',
                    lines: [
                      'Click the 9-dot icon in the tab bar (top-right) or the 9-dot icon in the sidebar.',
                      'Shows your pinned productivity apps — YouTube, Google, Gmail, Drive, Docs, AI Studio by default.',
                      'Click any app to navigate to it in the current tab.',
                      'Add custom apps via the + slot; hover non-default apps to edit or remove them.',
                    ],
                  },
                  {
                    icon: '🧹', title: 'Auto-Clean Memory',
                    lines: [
                      'Enable via Security panel or Chakra Shield.',
                      'When you close a tab, all cookies, cache, session tokens, and IndexedDB from that tab are instantly wiped.',
                      'Useful to prevent sites from tracking sessions across browser restarts.',
                    ],
                  },
                  {
                    icon: '📋', title: 'Copy / Print Unlock',
                    lines: [
                      'Automatically active on every page.',
                      'Removes JS-based right-click blocks, text-selection blocks, and copy/paste restrictions.',
                      'Does NOT bypass DRM or Widevine-protected content — only annoyance JS used by news/blogs.',
                    ],
                  },
                  {
                    icon: '🍿', title: 'Picture-in-Picture',
                    lines: [
                      'Hover over any video on a page — a ⧉ button appears in the top-right corner of the video.',
                      'Click it to pop the video into a floating overlay window that stays on top of all apps.',
                      'The overlay has its own back/forward buttons and an "open in main window" control.',
                    ],
                  },
                ].map(({ icon, title, lines }) => (
                  <details key={title} className="group border border-border">
                    <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none text-xs font-mono text-text hover:text-saffron transition-colors select-none">
                      <span className="text-sm shrink-0">{icon}</span>
                      <span className="flex-1">{title}</span>
                      <span className="text-muted text-[10px] group-open:rotate-90 transition-transform">▶</span>
                    </summary>
                    <div className="px-3 pb-3 pt-1 space-y-1 border-t border-border">
                      {lines.map((l, i) => (
                        <p key={i} className="text-[10px] text-muted font-mono flex gap-2">
                          <span className="text-saffron shrink-0">—</span>{l}
                        </p>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </SettingGroup>

            <SettingGroup title="Publisher & Contact">
              <div className="bg-obsidian border border-border p-5 space-y-1">
                {[
                  ['Publisher', 'Dhurta'],
                  ['Address',   'Main Road, Ranchi, Jharkhand, India'],
                  ['Support',   'Support@dhurta.com'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-4">
                    <span className="text-[10px] text-muted font-mono w-20 shrink-0">{k}</span>
                    <span className="text-[10px] text-text font-mono">{v}</span>
                  </div>
                ))}
                <p className="text-[10px] text-muted font-mono pt-2 border-t border-border mt-2">
                  Dhurta is provided "as is" for general-purpose private browsing. Privacy features
                  (Ghost Mode, fingerprint spoofing, ad/tracker blocking) reduce identifiability but
                  do not guarantee anonymity against a determined adversary, and do not authorize
                  any unlawful use, including bypassing DRM or accessing services in violation of
                  their terms. You remain responsible for complying with applicable local laws.
                </p>
              </div>
            </SettingGroup>
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function PageTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-mono text-text border-b border-border pb-2">{children}</h2>
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-mono text-saffron uppercase tracking-widest mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-xs text-text font-mono">{label}</p>
        <p className="text-[10px] text-muted font-mono mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <div className="shrink-0 mt-0.5">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={['w-8 h-4 border transition-colors shrink-0', value ? 'bg-saffron border-saffron' : 'bg-obsidian border-border'].join(' ')}
    >
      <span className={['block w-3 h-3 bg-white transition-transform mx-0.5', value ? 'translate-x-4' : 'translate-x-0'].join(' ')} />
    </button>
  )
}

function ChangePinForm({ onChanged }: { onChanged: () => void }) {
  const [oldPin,  setOldPin]  = useState('')
  const [newPin,  setNewPin]  = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [err,     setErr]     = useState('')
  const [ok,      setOk]      = useState(false)

  const handleChange = async () => {
    setErr('')
    if (!oldPin.trim()) { setErr('Enter your current PIN.'); return }
    if (newPin.length < 4) { setErr('New PIN must be at least 4 characters.'); return }
    if (newPin !== newPin2) { setErr('New PINs do not match.'); return }
    const r = await api().appLockChangePin(oldPin, newPin)
    if (r.ok) {
      setOk(true)
      setOldPin(''); setNewPin(''); setNewPin2('')
      onChanged()
    } else {
      setErr('Incorrect current PIN.')
    }
  }

  if (ok) return (
    <div className="flex items-center gap-2 p-2 border border-green-600/30 bg-green-900/10 text-green-400 text-[11px] font-mono">
      <span>✓</span> PIN changed successfully.
    </div>
  )

  return (
    <div className="space-y-2">
      {(['Current PIN', 'New PIN (min 4)', 'Confirm new PIN'] as const).map((label, i) => (
        <div key={i}>
          <p className="text-[9px] font-mono text-muted mb-1">{label}</p>
          <input
            type="password"
            value={[oldPin, newPin, newPin2][i]}
            onChange={e => {
              const v = e.target.value
              if (i === 0) { setOldPin(v); setErr('') }
              else if (i === 1) { setNewPin(v); setErr('') }
              else { setNewPin2(v); setErr('') }
            }}
            onKeyDown={e => e.key === 'Enter' && i === 2 && handleChange()}
            className="w-full bg-obsidian border border-border focus:border-saffron px-3 py-1.5 text-xs font-mono text-text outline-none transition-colors tracking-widest"
          />
        </div>
      ))}
      {err && <p className="text-[10px] font-mono text-red-400">{err}</p>}
      <button onClick={handleChange}
        className="w-full py-2 border border-saffron/50 text-saffron text-[11px] font-mono hover:bg-saffron/10 transition-colors">
        Change PIN
      </button>
    </div>
  )
}
