import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { SecuritySettings, Extension, Download } from '../types'

interface Props {
  url: string
  loading: boolean
  ghost: boolean
  jsDisabled: boolean
  activeTabId: number
  zoomLevel: number
  securityStatus: SecuritySettings
  extensions?: Extension[]
  downloads?: Download[]
  theme?: 'dark' | 'light'
  warmthLevel?: number
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onToggleJS: () => void
  onBookmark: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onOpenFile: () => void
  onOpenExtensions?: () => void
  onOpenDownloads?: () => void
  onThemeToggle?: () => void
  onWarmthChange?: (level: number) => void
}

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

export default function URLBar({
  url,
  loading,
  ghost,
  jsDisabled,
  zoomLevel,
  securityStatus,
  extensions = [],
  downloads = [],
  onNavigate,
  onBack,
  onForward,
  onReload,
  onToggleJS,
  onBookmark,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpenFile,
  onOpenExtensions: _onOpenExtensions,  // kept in Props for callers; native menu handles it via IPC
  onOpenDownloads,
  theme = 'dark',
  warmthLevel = 0,
  onThemeToggle,
  onWarmthChange,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(url)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkFlash, setBookmarkFlash] = useState(false)
  const [findMode, setFindMode] = useState(false)
  const [findText, setFindText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const findRef = useRef<HTMLInputElement>(null)

  // Sync input when url changes from outside
  useEffect(() => {
    if (!editing) setInput(url)
  }, [url, editing])

  // Check bookmark state when URL changes
  useEffect(() => {
    if (!isElectron || !url || url.startsWith('dhurta://') || url === '') {
      setBookmarked(false)
      return
    }
    window.dhurta.isBookmarked(url).then(setBookmarked).catch(() => setBookmarked(false))
  }, [url])

  // Listen for "open find bar" from native three-dot menu
  useEffect(() => {
    const handler = () => setFindMode(true)
    window.addEventListener('dhurta:findInPage', handler)
    return () => window.removeEventListener('dhurta:findInPage', handler)
  }, [])

  useEffect(() => {
    if (findMode) setTimeout(() => findRef.current?.focus(), 50)
  }, [findMode])

  const handleFocus = () => {
    setEditing(true)
    setInput(url)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleBlur = () => setEditing(false)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { onNavigate(input); inputRef.current?.blur() }
    if (e.key === 'Escape') { setInput(url); inputRef.current?.blur() }
  }

  const handleBookmarkClick = useCallback(async () => {
    if (!isElectron || !url || url.startsWith('dhurta://')) return
    await onBookmark()
    setBookmarked(true)
    setBookmarkFlash(true)
    setTimeout(() => setBookmarkFlash(false), 1200)
  }, [onBookmark, url])

  const handleFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setFindMode(false)
      setFindText('')
      if (isElectron) window.dhurta.findInPageStop()
      return
    }
    if (e.key === 'Enter' && isElectron && findText.trim()) {
      window.dhurta.findInPageNext(findText.trim(), !e.shiftKey)
    }
  }

  const displayUrl = editing ? input : formatDisplay(url)
  const zoomPct = Math.round(zoomLevel * 100)
  const zoomedAway = zoomLevel < 0.95 || zoomLevel > 1.05
  const activeSecurityCount = Object.values(securityStatus).filter(Boolean).length
  const isRealPage = url && !url.startsWith('dhurta://') && url !== '' && url !== 'about:blank'

  return (
    <div
      className={[
        'url-bar flex items-center h-9 px-1 gap-0.5 border-b border-border bg-surface shrink-0 relative z-50',
        ghost ? 'border-b-saffron' : '',
      ].join(' ')}
    >
      {/* Nav */}
      <NavBtn onClick={onBack} title="Back (Alt+←)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <polyline points="9,2 4,7 9,12" />
        </svg>
      </NavBtn>
      <NavBtn onClick={onForward} title="Forward (Alt+→)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <polyline points="5,2 10,7 5,12" />
        </svg>
      </NavBtn>
      <NavBtn onClick={onReload} title={loading ? 'Stop' : 'Reload (F5)'}>
        {loading ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
            <line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
            <path d="M12 7A5 5 0 1 1 7 2" /><polyline points="7,1 10,2 7,4" />
          </svg>
        )}
      </NavBtn>

      {/* Ghost badge */}
      {ghost && (
        <span className="text-[9px] text-saffron font-mono border border-saffron px-1 shrink-0 leading-tight py-0.5">
          GHOST
        </span>
      )}

      {/* Security chips */}
      {!ghost && activeSecurityCount > 0 && (
        <div className="flex gap-0.5 shrink-0">
          {securityStatus.ipRotation && <Chip label="IP" title="IP Rotation active" />}
          {securityStatus.antiFingerprint && <Chip label="FP" title="Anti-Fingerprint active" />}
          {securityStatus.blockWebRTC && <Chip label="RTC" title="WebRTC blocked" />}
          {securityStatus.autoClean && <Chip label="🧹" title="Auto-Clean on tab close" />}
        </div>
      )}

      {/* URL input */}
      <div className="url-input-box flex-1 flex items-center bg-surface border border-border hover:border-surface-3 focus-within:border-saffron transition-colors px-2 h-6 min-w-0">
        <span className="mr-1.5 text-muted shrink-0">
          {url.startsWith('https://') ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#4CAF50" strokeWidth="1.2">
              <rect x="2" y="4" width="6" height="5" /><path d="M3 4V3a2 2 0 0 1 4 0v1" />
            </svg>
          ) : url.startsWith('file://') ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#4FC3F7" strokeWidth="1.2">
              <path d="M2 1h4l2 2v6H2z" /><polyline points="6,1 6,3 8,3" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#666" strokeWidth="1.2">
              <circle cx="5" cy="5" r="4" /><line x1="5" y1="3" x2="5" y2="5.5" />
              <circle cx="5" cy="7" r="0.5" fill="#666" />
            </svg>
          )}
        </span>
        <input
          ref={inputRef}
          className="url-font flex-1 text-text-dim focus:text-text bg-transparent text-xs h-full min-w-0"
          value={displayUrl}
          onChange={(e) => setInput(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {/* Find in page bar (inline, appears when active) */}
      {findMode && (
        <div className="flex items-center gap-1 bg-surface border border-saffron px-1 h-7 shrink-0">
          <input
            ref={findRef}
            value={findText}
            onChange={e => {
              setFindText(e.target.value)
              if (isElectron && e.target.value) window.dhurta.findInPage(e.target.value)
            }}
            onKeyDown={handleFindKey}
            placeholder="Find…"
            className="w-32 bg-transparent text-xs font-mono text-text outline-none placeholder:text-muted"
          />
          <button onClick={() => isElectron && findText && window.dhurta.findInPageNext(findText, false)} className="text-muted hover:text-saffron text-xs" title="Previous">↑</button>
          <button onClick={() => isElectron && findText && window.dhurta.findInPageNext(findText, true)}  className="text-muted hover:text-saffron text-xs" title="Next">↓</button>
          <button onClick={() => { setFindMode(false); setFindText(''); if (isElectron) window.dhurta.findInPageStop() }} className="text-muted hover:text-saffron text-xs px-0.5">✕</button>
        </div>
      )}

      {/* Open file */}
      <NavBtn onClick={onOpenFile} title="Open file (PDF, image, video…)">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square">
          <path d="M2 1h5l2 2v8H2z" /><polyline points="7,1 7,3 9,3" />
          <line x1="4" y1="6" x2="7" y2="6" /><line x1="4" y1="8" x2="7" y2="8" />
        </svg>
      </NavBtn>

      {/* Zoom */}
      <NavBtn onClick={onZoomOut} title="Zoom out (Ctrl+-)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
          <circle cx="5" cy="5" r="4" /><line x1="3" y1="5" x2="7" y2="5" /><line x1="9" y1="9" x2="11" y2="11" />
        </svg>
      </NavBtn>
      <button
        onClick={onZoomReset}
        title="Reset zoom (Ctrl+0)"
        className={['h-7 px-1 text-[10px] font-mono transition-colors shrink-0 tabular-nums', zoomedAway ? 'text-saffron hover:text-text' : 'text-muted hover:text-saffron'].join(' ')}
      >
        {zoomPct}%
      </button>
      <NavBtn onClick={onZoomIn} title="Zoom in (Ctrl++)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
          <circle cx="5" cy="5" r="4" /><line x1="3" y1="5" x2="7" y2="5" /><line x1="5" y1="3" x2="5" y2="7" /><line x1="9" y1="9" x2="11" y2="11" />
        </svg>
      </NavBtn>

      {/* JS toggle */}
      <NavBtn onClick={onToggleJS} title={jsDisabled ? 'JavaScript DISABLED — click to enable' : 'Disable JavaScript'} active={jsDisabled}>
        <span className="text-[10px] font-mono font-bold">JS</span>
        {jsDisabled && (
          <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2" className="ml-0.5">
            <line x1="0" y1="0" x2="8" y2="8" /><line x1="8" y1="0" x2="0" y2="8" />
          </svg>
        )}
      </NavBtn>

      {/* Bookmark — fills orange when page is already bookmarked */}
      {isRealPage && (
        <button
          onClick={handleBookmarkClick}
          title={bookmarked ? 'Bookmarked' : 'Bookmark this page'}
          className={[
            'w-7 h-7 flex items-center justify-center transition-all shrink-0',
            bookmarkFlash ? 'scale-125' : 'scale-100',
            bookmarked ? 'text-saffron' : 'text-muted hover:text-saffron',
          ].join(' ')}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" strokeWidth="1.5" strokeLinecap="square"
            fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor">
            <path d="M1 1h10v12l-5-3-5 3V1z" />
          </svg>
        </button>
      )}

      {/* PiP quick-launch */}
      {isRealPage && <PipButton url={url} />}

      {/* Extension tray — native OS menu, no React dropdown (avoids BrowserView z-index crash) */}
      <ExtensionTray extensions={extensions} />

      {/* Download tray */}
      <DownloadTray downloads={downloads} onOpenPanel={onOpenDownloads} />

      {/* Screen warmth / eye-protection slider */}
      <WarmthButton warmthLevel={warmthLevel} onWarmthChange={onWarmthChange} />

      {/* Theme toggle — UI only, never affects webpages */}
      <NavBtn onClick={() => onThemeToggle?.()} title={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}>
        {theme === 'dark' ? (
          /* Sun icon for light mode */
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="2.5" />
            <line x1="6.5" y1="0.5" x2="6.5" y2="2" />
            <line x1="6.5" y1="11" x2="6.5" y2="12.5" />
            <line x1="0.5" y1="6.5" x2="2" y2="6.5" />
            <line x1="11" y1="6.5" x2="12.5" y2="6.5" />
            <line x1="2.2" y1="2.2" x2="3.2" y2="3.2" />
            <line x1="9.8" y1="9.8" x2="10.8" y2="10.8" />
            <line x1="10.8" y1="2.2" x2="9.8" y2="3.2" />
            <line x1="3.2" y1="9.8" x2="2.2" y2="10.8" />
          </svg>
        ) : (
          /* Moon icon for dark mode */
          <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor">
            <path d="M10.5 8.5A6 6 0 0 1 3.5 2a5.5 5.5 0 1 0 7 6.5z" opacity="0.9" />
          </svg>
        )}
      </NavBtn>

      {/* Three-dot — native OS popup so it shows above BrowserViews on real pages */}
      <NavBtn onClick={() => isElectron && window.dhurta.showThreeDotMenu({ url })} title="More options">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="7" cy="2.5" r="1.1" />
          <circle cx="7" cy="7" r="1.1" />
          <circle cx="7" cy="11.5" r="1.1" />
        </svg>
      </NavBtn>
    </div>
  )
}

function NavBtn({ children, onClick, title, active }: {
  children: React.ReactNode; onClick: () => void; title: string; active?: boolean
}) {
  return (
    <button onClick={onClick} title={title}
      className={['w-7 h-7 flex items-center justify-center transition-colors shrink-0',
        active ? 'text-saffron' : 'text-muted hover:text-saffron'].join(' ')}>
      {children}
    </button>
  )
}

function Chip({ label, title }: { label: string; title: string }) {
  return (
    <span title={title} className="text-[8px] font-mono text-saffron border border-saffron px-0.5 leading-tight py-px shrink-0">
      {label}
    </span>
  )
}

function formatDisplay(url: string) {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch { return url }
}

// ExtensionTray — uses a native OS popup menu so it renders above BrowserViews.
// Previous implementation used a React dropdown which:
//   1. Called useState() inside .map() — illegal React hook → crashes/freezes
//   2. Rendered behind Electron's BrowserView native layer → blackout
// Now: single button → ipcMain shows native Menu → extension popup opens as child BrowserWindow.
// ExtensionTray — always visible puzzle-piece button in the URL bar.
// Clicking opens a native OS menu listing every installed extension; clicking
// an extension in that menu opens its popup as a child BrowserWindow.
// The button is always rendered (even with 0 extensions) so users can access
// the Extensions panel to install their first extension.
function ExtensionTray({ extensions }: { extensions: Extension[] }) {
  const handleClick = () => {
    if (!isElectron) return
    if (extensions.length === 0) {
      // No extensions installed — open the Extensions panel directly
      window.dispatchEvent(new CustomEvent('dhurta:navigate', { detail: 'dhurta://extensions' }))
      window.dhurta.showExtensionTrayMenu()
    } else {
      window.dhurta.showExtensionTrayMenu()
    }
  }

  const hasExt = extensions.length > 0

  return (
    <button
      onClick={handleClick}
      title={hasExt
        ? `${extensions.length} extension${extensions.length !== 1 ? 's' : ''} — click to open`
        : 'Extensions — click to install'}
      className={[
        'w-7 h-7 flex items-center justify-center transition-colors relative shrink-0',
        hasExt ? 'text-muted hover:text-saffron' : 'text-muted/40 hover:text-muted',
      ].join(' ')}
    >
      {/* Puzzle-piece icon */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square">
        <rect x="1" y="4" width="7" height="7" />
        <path d="M8 7h2.5l2.5 2.5v-5.5h-5" />
        <circle cx="4.5" cy="7.5" r="1.5" />
      </svg>
      {/* Count badge — only shown when extensions exist */}
      {hasExt && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-saffron text-black text-[7px] font-mono font-bold flex items-center justify-center leading-none pointer-events-none">
          {extensions.length > 9 ? '9+' : extensions.length}
        </span>
      )}
    </button>
  )
}

// ── Download Tray ─────────────────────────────────────────────────────────────
// Clicking opens a native child BrowserWindow popup (like Chrome/Opera).
// BrowserView is a native OS layer above all React HTML — only a child
// BrowserWindow can appear above it, so we can't use React dropdowns here.
function DownloadTray({ downloads, onOpenPanel }: { downloads: Download[]; onOpenPanel?: () => void }) {
  const btnRef  = useRef<HTMLButtonElement>(null)
  const active  = downloads.filter(d => d.state === 'progressing')
  const hasActive = active.length > 0
  const hasAny    = downloads.length > 0

  const openPopup = useCallback(async () => {
    if (!isElectron || !btnRef.current) { onOpenPanel?.(); return }
    const rect = btnRef.current.getBoundingClientRect()
    const [wx, wy] = await (window as any).dhurta.getWindowPos() as [number, number]
    // Position popup below-left of the button so it aligns to the right edge
    const popupW = 320
    await (window as any).dhurta.showDownloadPopup({
      x: Math.round(wx + rect.right - popupW),
      y: Math.round(wy + rect.bottom + 2),
    })
  }, [onOpenPanel])

  return (
    <button
      ref={btnRef}
      onClick={openPopup}
      title={hasActive ? `${active.length} download${active.length !== 1 ? 's' : ''} in progress` : 'Downloads'}
      className={[
        'w-7 h-7 flex items-center justify-center transition-colors relative shrink-0',
        hasActive ? 'text-saffron' : 'text-muted hover:text-saffron',
      ].join(' ')}
    >
      <span className="relative flex items-center justify-center">
        {hasActive && <span className="absolute inset-0 rounded-full border border-saffron/60 animate-ping" />}
        <svg width="13" height="14" viewBox="0 0 13 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <line x1="6.5" y1="1" x2="6.5" y2="9" />
          <polyline points="3,6.5 6.5,10 10,6.5" />
          <line x1="1" y1="12.5" x2="12" y2="12.5" />
        </svg>
      </span>
      {hasActive && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-saffron text-black text-[7px] font-mono font-bold flex items-center justify-center leading-none pointer-events-none">
          {active.length > 9 ? '9+' : active.length}
        </span>
      )}
      {!hasActive && hasAny && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-surface border border-border/60 text-muted text-[6px] font-mono font-bold flex items-center justify-center leading-none pointer-events-none">
          {downloads.length > 9 ? '9+' : downloads.length}
        </span>
      )}
    </button>
  )
}


// Warmth button — opens a native child BrowserWindow popup with a slider.
// Same reason as DownloadTray: BrowserView covers React dropdowns, so we must
// use a child BrowserWindow to appear above the web page content.
function WarmthButton({ warmthLevel, onWarmthChange: _onWarmthChange }: { warmthLevel: number; onWarmthChange?: (n: number) => void }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const active = warmthLevel > 0

  const openPopup = useCallback(async () => {
    if (!isElectron || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const [wx, wy] = await (window as any).dhurta.getWindowPos() as [number, number]
    const popupW = 260
    await (window as any).dhurta.showWarmthPopup({
      x: Math.round(wx + rect.right - popupW),
      y: Math.round(wy + rect.bottom + 2),
    })
  }, [])

  return (
    <button
      ref={btnRef}
      onClick={openPopup}
      title={active ? `Eye protection ${warmthLevel}% — click to adjust` : 'Eye protection / screen warmth'}
      className={[
        'w-7 h-7 flex items-center justify-center transition-colors relative shrink-0',
        active ? 'text-saffron' : 'text-muted hover:text-saffron',
      ].join(' ')}
    >
      <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5.5C2.5 2.5 5 1 6.5 1S10.5 2.5 12 5.5C10.5 8.5 8 10 6.5 10S2.5 8.5 1 5.5z" />
        <circle cx="6.5" cy="5.5" r="2" />
        <circle cx="6.5" cy="5.5" r="0.7" fill="currentColor" stroke="none" />
      </svg>
      {active && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-saffron/80 border border-obsidian text-black text-[6px] font-mono font-bold flex items-center justify-center leading-none pointer-events-none">
          {Math.round(warmthLevel / 10)}
        </span>
      )}
    </button>
  )
}

function PipButton({ url }: { url: string }) {
  const [busy, setBusy] = useState(false)

  const handlePip = async () => {
    if (!isElectron || busy) return
    setBusy(true)
    const res = await window.dhurta.pipVideoMode()
    if (res.error && res.error.includes('No video')) {
      await window.dhurta.pipOpenPage(url)
    }
    setBusy(false)
  }

  return (
    <button onClick={handlePip} disabled={busy} title="Picture-in-Picture (video) or Pop Out Page"
      className="w-7 h-7 flex items-center justify-center text-muted hover:text-saffron transition-colors shrink-0 disabled:opacity-40">
      <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square">
        <rect x="1" y="1" width="12" height="10" />
        <rect x="7" y="5" width="5" height="4" fill="currentColor" stroke="none" opacity="0.5" />
        <rect x="7" y="5" width="5" height="4" />
      </svg>
    </button>
  )
}
