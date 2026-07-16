import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Bookmark } from '../types'
import SmartFavicon from './SmartFavicon'
import { SEARCH_ENGINES } from './panels/SettingsPanel'

const isElectron = typeof window !== 'undefined' && typeof window.dhurta !== 'undefined'

// Ordered list of engine IDs for cycler — excludes 'custom'
const CYCLE_ENGINES = SEARCH_ENGINES.filter(e => e.value !== 'custom').map(e => e.value)

// ── Built-in themes ─────────────────────────────────────────────────────────
export interface ThemeDef {
  id: string
  label: string
  bg: string        // CSS background (used as fallback thumbnail for wallpaper themes)
  light: boolean
  src?: string      // optional: path to a built-in wallpaper image
}

export const THEMES: ThemeDef[] = [
  // ── Gradient themes ──
  { id: 'dark',     label: 'Dark',       bg: '#0A0A0A',                                                              light: false },
  { id: 'bw',       label: 'B&W',        bg: 'linear-gradient(135deg,#1a1a1a 0%,#3a3a3a 40%,#f5f5f5 100%)',         light: false },
  { id: 'midnight', label: 'Midnight',   bg: 'linear-gradient(135deg,#0a0a2e 0%,#1a1a4e 50%,#0d0d1f 100%)',         light: false },
  { id: 'ocean',    label: 'Ocean',      bg: 'linear-gradient(160deg,#0a1628 0%,#0d2847 40%,#1a3d6e 100%)',         light: false },
  { id: 'forest',   label: 'Forest',     bg: 'linear-gradient(135deg,#0a1a0a 0%,#0f2d0f 50%,#1a3d1a 100%)',         light: false },
  { id: 'sunset',   label: 'Sunset',     bg: 'linear-gradient(160deg,#1a0a00 0%,#3d1800 40%,#5a2800 100%)',         light: false },
  { id: 'rose',     label: 'Rose',       bg: 'linear-gradient(135deg,#1a0a0f 0%,#2d0f1a 50%,#3d1a24 100%)',         light: false },
  { id: 'slate',    label: 'Slate',      bg: 'linear-gradient(135deg,#0f1419 0%,#1e2a38 100%)',                     light: false },
  { id: 'carbon',   label: 'Carbon',     bg: 'linear-gradient(135deg,#111 0%,#1c1c1c 100%)',                        light: false },
  { id: 'pearl',    label: 'Pearl',      bg: 'linear-gradient(160deg,#F8F9FC 0%,#EEF0F8 100%)',                     light: true  },
  { id: 'paper',    label: 'Paper',      bg: 'linear-gradient(135deg,#FDFCF8 0%,#F5F2EB 100%)',                     light: true  },
  { id: 'mist',     label: 'Mist',       bg: 'linear-gradient(160deg,#EEF3FA 0%,#E4EAF5 50%,#EDF1FA 100%)',         light: true  },

  // ── Built-in wallpaper themes ──
  { id: 'wp-bali',   label: 'Bali',      bg: '#0d1a0d', light: false, src: './wallpaper/dhurta-bali.png'   },
  { id: 'wp-robo',   label: 'Robo',      bg: '#0a0a1a', light: false, src: './wallpaper/dhurta-robo.png'   },
  { id: 'wp-avatar', label: 'Avatar',    bg: '#1a0a0a', light: false, src: './wallpaper/dhurta-avatar.png' },
  { id: 'wp-flash',  label: 'Flash',     bg: '#1a1000', light: false, src: './wallpaper/dhurta-flash.png'  },
  { id: 'wp-scada',  label: 'Scada',     bg: '#0a1a1a', light: false, src: './wallpaper/dhurta-scada.png'  },
  { id: 'wp-nova',   label: 'Nova',      bg: '#0a0a2a', light: false, src: './wallpaper/dhurta-nova.png'   },
]

export const GRADIENT_THEMES = THEMES.filter(t => !t.src)
export const WALLPAPER_THEMES = THEMES.filter(t => !!t.src)

// ── Widget ordering ──────────────────────────────────────────────────────────
export type WidgetId = 'logo' | 'clock' | 'search' | 'favourites' | 'status'
export type WidgetAlign = 'left' | 'center' | 'right'

interface WidgetConfig { id: WidgetId; visible: boolean; align?: WidgetAlign }

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'logo',       visible: true, align: 'center' },
  { id: 'clock',      visible: true, align: 'center' },
  { id: 'search',     visible: true, align: 'center' },
  { id: 'favourites', visible: true, align: 'center' },
  { id: 'status',     visible: true, align: 'center' },
]

function parseLayout(raw: string | null | undefined): WidgetConfig[] {
  try {
    const arr = JSON.parse(raw || '')
    if (Array.isArray(arr) && arr.length > 0) return arr as WidgetConfig[]
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT
}

function useTime() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function pad(n: number) { return String(n).padStart(2, '0') }

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  onNavigate: (url: string) => void
  ghost: boolean
  /** Array of wallpaper data-URLs (up to 5). Cycles automatically. */
  wallpapers: string[]
  /** Current browser chrome theme ('light' | 'dark'). Auto-selects pearl when light and no saved theme. */
  browserTheme?: string
}

// ── Component ────────────────────────────────────────────────────────────────
export default function NewTabPage({ onNavigate, ghost, wallpapers, browserTheme }: Props) {
  const [search,          setSearch]          = useState('')
  const [searchEngine,    setSearchEngine]    = useState('brave')
  const [customSearchUrl, setCustomSearchUrl] = useState('')
  const [bookmarks,       setBookmarks]       = useState<Bookmark[]>([])
  const [themeBg,     setThemeBg]     = useState('#0A0A0A')
  const [themeId,     setThemeId]     = useState('dark')
  const [editBm,      setEditBm]      = useState<Bookmark | null>(null)
  const [editUrl,     setEditUrl]     = useState('')
  const [editTitle,   setEditTitle]   = useState('')
  const [layout,      setLayout]      = useState<WidgetConfig[]>(DEFAULT_LAYOUT)
  const [customizing, setCustomizing] = useState(false)
  const [wpIdx,       setWpIdx]       = useState(0)
  const [wpVisible,   setWpVisible]   = useState(true)
  const wpTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const now = useTime()

  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showToolPicker, setShowToolPicker] = useState(false)

  // Search suggestions
  const [suggestions,  setSuggestions]  = useState<string[]>([])
  const [suggIdx,      setSuggIdx]      = useState(-1)
  const [showSugg,     setShowSugg]     = useState(false)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Engine switcher animation
  const [engineFlip, setEngineFlip] = useState(false)

  const reload = useCallback(async () => {
    if (!isElectron || ghost) return
    const [bms, order] = await Promise.all([
      window.dhurta.getBookmarks().catch(() => [] as Bookmark[]),
      window.dhurta.getBookmarkOrder().catch(() => [] as number[]),
    ])
    if (order.length > 0) {
      const byId = new Map(bms.map(b => [b.id, b]))
      const sorted: Bookmark[] = []
      for (const id of order) { const b = byId.get(id); if (b) { sorted.push(b); byId.delete(id) } }
      for (const b of byId.values()) sorted.push(b)
      setBookmarks(sorted)
    } else {
      setBookmarks(bms)
    }
  }, [ghost])

  const loadSettings = useCallback(() => {
    if (!isElectron) return
    window.dhurta.getSetting('newTabTheme').then(id => {
      const t = THEMES.find(x => x.id === id)
      if (t) {
        setThemeBg(t.bg); setThemeId(t.id)
      } else if (browserTheme === 'light') {
        // No saved theme + browser is light mode → default new tab to Pearl
        const pearl = THEMES.find(x => x.id === 'pearl')!
        setThemeBg(pearl.bg); setThemeId('pearl')
      }
    }).catch(() => {})
    window.dhurta.getSetting('homeLayout').then(raw => setLayout(parseLayout(raw))).catch(() => {})
    Promise.all([
      window.dhurta.getSetting('searchEngine'),
      window.dhurta.getSetting('searchEngineCustomUrl'),
    ]).then(([se, cu]) => {
      setSearchEngine(se ?? 'brave')
      setCustomSearchUrl(cu ?? '')
    }).catch(() => {})
  }, [browserTheme])

  useEffect(() => {
    reload()
    loadSettings()
  }, [ghost, reload, loadSettings])

  // Real-time reload when SettingsPanel changes theme or layout
  useEffect(() => {
    const handler = (e: Event) => {
      const { key } = (e as CustomEvent<{ key: string; value: string }>).detail
      if (key === 'newTabTheme' || key === 'homeLayout' || key === 'searchEngine' || key === 'searchEngineCustomUrl') loadSettings()
    }
    window.addEventListener('dhurta:settingChanged', handler)
    return () => window.removeEventListener('dhurta:settingChanged', handler)
  }, [loadSettings])

  // Wallpaper slideshow — crossfade every 18 s when multiple wallpapers exist
  useEffect(() => {
    if (wpTimer.current) clearInterval(wpTimer.current)
    if (wallpapers.length <= 1) { setWpIdx(0); return }
    wpTimer.current = setInterval(() => {
      setWpVisible(false)
      setTimeout(() => {
        setWpIdx(i => (i + 1) % wallpapers.length)
        setWpVisible(true)
      }, 400)
    }, 18000)
    return () => { if (wpTimer.current) clearInterval(wpTimer.current) }
  }, [wallpapers])

  useEffect(() => {
    setWpIdx(i => Math.min(i, Math.max(0, wallpapers.length - 1)))
  }, [wallpapers.length])

  const cycleEngine = useCallback(() => {
    const cur = CYCLE_ENGINES.indexOf(searchEngine)
    const next = CYCLE_ENGINES[(cur + 1) % CYCLE_ENGINES.length]
    setSearchEngine(next)
    setSuggestions([]); setShowSugg(false)
    if (isElectron) window.dhurta.setSetting('searchEngine', next)
    window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'searchEngine', value: next } }))
    setEngineFlip(true)
    setTimeout(() => setEngineFlip(false), 300)
  }, [searchEngine])

  const doSearch = useCallback((s: string) => {
    setSuggestions([]); setShowSugg(false); setSuggIdx(-1)
    const trimmed = s.trim()
    if (!trimmed) return
    const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ||
      (trimmed.includes('.') && !trimmed.includes(' '))
    if (isUrl) {
      onNavigate(trimmed.startsWith('http') ? trimmed : 'https://' + trimmed)
      return
    }
    const q = encodeURIComponent(trimmed)
    let url: string
    switch (searchEngine) {
      case 'google':     url = `https://www.google.com/search?q=${q}`; break
      case 'bing':       url = `https://www.bing.com/search?q=${q}`; break
      case 'duckduckgo': url = `https://duckduckgo.com/?q=${q}`; break
      case 'startpage':  url = `https://www.startpage.com/search?q=${q}`; break
      case 'qwant':      url = `https://www.qwant.com/?q=${q}`; break
      case 'ecosia':     url = `https://www.ecosia.org/search?q=${q}`; break
      case 'yahoo':      url = `https://search.yahoo.com/search?p=${q}`; break
      case 'custom':     url = customSearchUrl ? customSearchUrl.replace('%s', trimmed) : `https://search.brave.com/search?q=${q}`; break
      default:           url = `https://search.brave.com/search?q=${q}`
    }
    onNavigate(url)
  }, [onNavigate, searchEngine, customSearchUrl])

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    doSearch(suggIdx >= 0 && suggestions[suggIdx] ? suggestions[suggIdx] : search)
  }, [search, doSearch, suggIdx, suggestions])

  const fetchSuggestions = useCallback((q: string) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!q.trim() || q.startsWith('http') || (q.includes('.') && !q.includes(' '))) {
      setSuggestions([]); setShowSugg(false); return
    }
    suggestTimer.current = setTimeout(async () => {
      if (!isElectron) return
      try {
        const results = await (window.dhurta as any).fetchSuggestions(searchEngine, q)
        setSuggestions(results ?? [])
        setShowSugg((results ?? []).length > 0)
      } catch { setSuggestions([]); setShowSugg(false) }
    }, 220)
  }, [searchEngine])

  const handleDelete = useCallback(async (id: number) => {
    if (!isElectron) return
    await window.dhurta.deleteBookmark(id)
    reload()
  }, [reload])

  const openEdit = (bm: Bookmark) => { setEditBm(bm); setEditUrl(bm.url); setEditTitle(bm.title || '') }
  const openAdd  = () => { setEditBm({ id: -1, url: '', title: '', favicon: '', created_at: 0 }); setEditUrl(''); setEditTitle('') }

  const handleSave = async () => {
    if (!isElectron || !editBm) return
    const rawUrl = editUrl.trim()
    if (!rawUrl) return
    const url = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl
    const title = editTitle.trim() || url
    if (editBm.id === -1) {
      await window.dhurta.addBookmark({ url, title, favicon: '' })
    } else {
      await window.dhurta.updateBookmark(editBm.id, { url, title })
    }
    setEditBm(null)
    reload()
  }

  // Layout mutators — update state immediately, persist in background
  const moveWidget = (id: WidgetId, dir: -1 | 1) => {
    setLayout(prev => {
      const idx = prev.findIndex(w => w.id === id)
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      const json = JSON.stringify(arr)
      if (isElectron) window.dhurta.setSetting('homeLayout', json)
      return arr
    })
  }

  const toggleWidget = (id: WidgetId) => {
    setLayout(prev => {
      const arr = prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w)
      const json = JSON.stringify(arr)
      if (isElectron) window.dhurta.setSetting('homeLayout', json)
      return arr
    })
  }

  const cycleAlign = (id: WidgetId) => {
    const order: WidgetAlign[] = ['left', 'center', 'right']
    setLayout(prev => {
      const arr = prev.map(w => {
        if (w.id !== id) return w
        const cur = w.align || 'center'
        const next = order[(order.indexOf(cur) + 1) % 3]
        return { ...w, align: next }
      })
      const json = JSON.stringify(arr)
      if (isElectron) window.dhurta.setSetting('homeLayout', json)
      return arr
    })
  }

  const timeStr = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
  const dateStr = `${DAY[now.getUTCDay()]}, ${MON[now.getUTCMonth()]} ${now.getUTCDate()}`
  const pinned  = bookmarks.slice(0, 8)
  const activeThemeObj   = THEMES.find(t => t.id === themeId)
  const activeWallpaper  = wallpapers[wpIdx] ?? ''           // user-uploaded
  const themeWallpaper   = activeThemeObj?.src ?? ''         // built-in wallpaper theme
  // User-uploaded wallpapers take priority over built-in theme wallpapers
  const displayWallpaper = activeWallpaper || themeWallpaper
  const hasWallpaper     = !!displayWallpaper
  // Light-mode: only for gradient light themes, not for wallpaper-based themes
  const isLight = !hasWallpaper && (activeThemeObj?.light ?? false)

  // Theme-aware tokens — avoids repeating ternaries everywhere
  const tt = {
    text:        isLight ? 'text-gray-800'         : 'text-white',
    textDim:     isLight ? 'text-gray-500'         : 'text-white/60',
    textMuted:   isLight ? 'text-gray-400'         : 'text-white/40',
    textFaint:   isLight ? 'text-gray-400/70'      : 'text-white/25',
    textPlaceholder: isLight ? 'placeholder:text-gray-400' : 'placeholder:text-white/35',
    bgGlass:     isLight ? 'bg-white/80'           : 'bg-black/35',
    borderGlass: isLight ? 'border-gray-300/60'    : 'border-white/25',
    bgTile:      isLight ? 'bg-white/70'           : 'bg-black/20',
    borderTile:  isLight ? 'border-gray-200'       : 'border-white/15',
    ctrlBg:      isLight ? 'bg-white/60'           : 'bg-black/50',
    ctrlBorder:  isLight ? 'border-gray-300/70'    : 'border-white/20',
    ctrlText:    isLight ? 'text-gray-500'         : 'text-white/60',
  }

  // ── Widget render map ──
  const widgetMap: Partial<Record<WidgetId, React.ReactNode>> = {
    logo: (
      <div className="flex flex-col items-center">
        <img
          src="./dhurta-logo.png"
          alt="Dhurta"
          draggable={false}
          className={[
            'w-28 h-28 object-contain select-none transition-all duration-500',
            ghost
              ? 'drop-shadow-[0_0_20px_#FF003388] drop-shadow-[0_0_50px_#FF003355] drop-shadow-[0_0_80px_#FF003333]'
              : 'drop-shadow-[0_0_16px_#FFB30077]',
          ].join(' ')}
          style={ghost ? { filter: 'drop-shadow(0 0 18px #FF0033cc) drop-shadow(0 0 40px #FF003388)' } : {}}
        />
        <h1
          className="text-base font-mono font-light tracking-[0.45em] uppercase mt-1"
          style={{
            color: ghost ? '#FF0033' : '#FF1133',
            textShadow: ghost
              ? '0 0 6px #FF0033, 0 0 18px #FF003399, 0 0 36px #FF003355'
              : '0 0 8px #FF113388, 0 0 20px #FF113344',
          }}
        >
          {ghost ? 'GHOST MODE' : 'DHURTA'}
        </h1>
        {ghost && (
          <p className="text-[10px] font-mono tracking-wider mt-0.5" style={{ color: '#FF0033', textShadow: '0 0 6px #FF003388' }}>
            No WebRTC · Spoofed Fingerprint · Zero Disk
          </p>
        )}
      </div>
    ),

    clock: (
      <div className="flex flex-col items-center">
        <div className="flex items-baseline gap-2">
          <p className={`text-5xl font-mono font-light tracking-[0.15em] tabular-nums ${isLight ? '' : 'drop-shadow-lg'} ${tt.text}`}>
            {timeStr}
          </p>
          <span className={`text-[8px] font-mono px-1.5 py-0.5 border ${tt.borderGlass} ${tt.textDim} tracking-widest`}>UTC</span>
        </div>
        <p className={`text-[11px] font-mono mt-1 tracking-widest uppercase ${tt.textDim}`}>
          {dateStr}
        </p>
      </div>
    ),

    search: (() => {
      const eng = SEARCH_ENGINES.find(e => e.value === searchEngine) ?? SEARCH_ENGINES[0]
      return (
      <form onSubmit={handleSearch} className="w-full max-w-xl relative">
        {/* Focus glow ring */}
        <div className={[
          'flex border rounded-lg overflow-hidden transition-all duration-200',
          tt.borderGlass,
          tt.bgGlass,
          'backdrop-blur-md',
          'focus-within:border-[#FF4500]/70',
          isLight
            ? 'shadow-md focus-within:shadow-[0_0_0_3px_rgba(255,69,0,0.12)]'
            : 'shadow-lg shadow-black/30 focus-within:shadow-[0_0_0_3px_rgba(255,69,0,0.18)]',
          'relative z-20',
        ].join(' ')}>
          {/* Engine switcher button */}
          <button
            type="button"
            onClick={cycleEngine}
            title={`Search engine: ${eng.label} — click to switch`}
            className={[
              'flex items-center gap-2 pl-3 pr-2.5 py-2.5 border-r shrink-0 transition-all duration-150',
              tt.borderGlass,
              engineFlip ? 'scale-90 opacity-50' : 'opacity-100',
              isLight ? 'hover:bg-black/6' : 'hover:bg-white/8',
            ].join(' ')}
          >
            <span className="w-[22px] h-[22px] flex items-center justify-center relative shrink-0">
              <img
                src={eng.logo}
                alt={eng.label}
                className="w-[22px] h-[22px] object-contain"
                onError={(ev) => {
                  const t = ev.currentTarget
                  t.style.display = 'none'
                  const fb = t.nextElementSibling as HTMLElement | null
                  if (fb) fb.style.display = 'flex'
                }}
              />
              <span
                className="w-[22px] h-[22px] hidden absolute inset-0 items-center justify-center text-[9px] font-mono font-bold border leading-none"
                style={{ color: eng.letterColor, borderColor: eng.letterColor + '55', background: eng.letterColor + '18' }}
              >{eng.letter}</span>
            </span>
            {/* chevrons icon */}
            <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
              className={`${tt.textMuted} shrink-0`}>
              <polyline points="2.5,1 0.5,3 2.5,5" />
              <polyline points="5.5,5 7.5,7 5.5,9" />
            </svg>
          </button>

          <input
            className={`flex-1 bg-transparent px-3.5 py-3 text-[15px] font-mono outline-none tracking-wide ${tt.text} ${tt.textPlaceholder}`}
            placeholder={ghost ? `Search anonymously via ${eng.label}…` : `Search with ${eng.label}…`}
            value={search}
            onChange={e => { setSearch(e.target.value); setSuggIdx(-1); fetchSuggestions(e.target.value) }}
            onKeyDown={e => {
              if (!showSugg || suggestions.length === 0) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, suggestions.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, -1)) }
              else if (e.key === 'Escape') { setShowSugg(false); setSuggIdx(-1) }
            }}
            onFocus={() => { if (suggestions.length > 0) setShowSugg(true) }}
            onBlur={() => setTimeout(() => { setShowSugg(false); setSuggIdx(-1) }, 150)}
            autoFocus={!customizing}
            autoComplete="off"
          />
          <button
            type="submit"
            className="bg-[#FF4500] hover:bg-[#e03d00] active:scale-95 text-white px-5 py-3 text-[11px] font-mono tracking-[0.18em] font-semibold transition-all shrink-0"
          >GO</button>
        </div>
        {/* Suggestions dropdown */}
        {showSugg && suggestions.length > 0 && (
          <div className={`absolute left-0 right-0 top-[calc(100%+4px)] z-10 border rounded-lg ${tt.borderGlass} ${tt.bgGlass} backdrop-blur-md shadow-xl overflow-hidden`}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onMouseDown={() => { setSearch(s); doSearch(s) }}
                className={[
                  'w-full text-left px-4 py-2.5 text-sm font-mono transition-colors flex items-center gap-2.5',
                  i === suggIdx
                    ? 'bg-[#FF4500]/15 text-[#FF4500]'
                    : `${tt.text} hover:bg-[#FF4500]/8 hover:text-[#FF4500]`,
                ].join(' ')}
              >
                <svg className={`w-3 h-3 shrink-0 ${i === suggIdx ? 'text-[#FF4500]' : tt.textMuted}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
                  <circle cx="5" cy="5" r="3.5"/><line x1="7.5" y1="7.5" x2="11" y2="11"/>
                </svg>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>
      )
    })(),

    favourites: !ghost ? (
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-2">
          <p className={`text-[9px] font-mono uppercase tracking-widest ${tt.textMuted}`}>Favourites</p>
          <div className="flex gap-1">
            <button onClick={() => setShowToolPicker(true)} title="Add Dhurta Tool"
              className={`text-[8px] font-mono px-1.5 py-0.5 border ${tt.ctrlBorder} ${tt.ctrlText} hover:border-[#FF4500] hover:text-[#FF4500] transition-colors`}>
              + Tool
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {pinned.map((b, i) => (
            <SpeedDialTile
              key={b.id}
              bookmark={b}
              onNavigate={onNavigate}
              onEdit={openEdit}
              onDelete={handleDelete}
              isLight={isLight}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragIdx === null || dragIdx === i) return
                const arr = [...pinned]
                const [moved] = arr.splice(dragIdx, 1)
                arr.splice(i, 0, moved)
                const full = [...arr, ...bookmarks.slice(8)]
                setBookmarks(full)
                setDragIdx(null)
                if (isElectron) window.dhurta.reorderBookmarks(full.map(x => x.id))
              }}
              onDragEnd={() => setDragIdx(null)}
              isDragging={dragIdx === i}
            />
          ))}
          {pinned.length < 8 && (
            <button
              onClick={openAdd}
              className={`flex flex-col items-center justify-center gap-1 h-[84px] border ${tt.borderTile} ${tt.bgTile} backdrop-blur-sm hover:border-[#FF4500] transition-colors`}
            >
              <span className={`text-xl leading-none ${tt.textFaint}`}>+</span>
              <span className={`text-[8px] font-mono ${tt.textFaint}`}>Add</span>
            </button>
          )}
        </div>
        {showToolPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowToolPicker(false)}>
            <div className={`${isLight ? 'bg-white border-gray-200 shadow-xl' : 'bg-[#111] border-[#2a2a2a]'} border p-4 w-72 shadow-2xl`}
              onClick={e => e.stopPropagation()}>
              <h3 className="text-[10px] font-mono text-[#FF4500] uppercase tracking-widest mb-3">Add Dhurta Tool</h3>
              <p className={`text-[8px] font-mono uppercase tracking-wider mb-1 ${tt.textMuted}`}>Ecosystem</p>
              {[
                { id: 'setu', name: 'Dhurta Setu', desc: 'Bridge & web index', url: 'dhurta-tool://setu' },
                { id: 'connect', name: 'Dhurta Connect', desc: 'P2P chat & file share', url: 'dhurta-tool://connect' },
              ].map(t => {
                const exists = bookmarks.some(b => b.url === t.url)
                return (
                  <button key={t.id} disabled={exists}
                    onClick={async () => {
                      if (!isElectron) return
                      await window.dhurta.addBookmark({ url: t.url, title: t.name })
                      setShowToolPicker(false)
                      reload()
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 mb-1 border transition-colors ${
                      exists
                        ? `${isLight ? 'border-gray-100 text-gray-300' : 'border-[#1a1a1a] text-[#333]'} cursor-not-allowed`
                        : `${isLight ? 'border-gray-200 hover:border-[#FF4500]' : 'border-[#2a2a2a] hover:border-[#FF4500]'} ${tt.text}`
                    }`}>
                    <SmartFavicon url={`dhurta-tool://${t.id}`} name={t.name} size={16} />
                    <div className="text-left">
                      <p className="text-[10px] font-mono">{t.name}</p>
                      <p className={`text-[8px] font-mono ${tt.textMuted}`}>{exists ? 'Already added' : t.desc}</p>
                    </div>
                  </button>
                )
              })}
              <p className={`text-[8px] font-mono uppercase tracking-wider mt-2 mb-1 ${tt.textMuted}`}>Built-in</p>
              {[
                { id: 'omni', name: 'Dhurta Omni', desc: 'Privacy dashboard', url: 'dhurta://omni' },
                { id: 'developer', name: 'Developer Tools', desc: 'Inspect & debug pages', url: 'dhurta-tool://developer' },
                { id: 'bridge', name: 'Browser Connect', desc: 'Cross-device sync', url: 'dhurta-tool://bridge' },
              ].map(t => {
                const exists = bookmarks.some(b => b.url === t.url)
                return (
                  <button key={t.id} disabled={exists}
                    onClick={async () => {
                      if (!isElectron) return
                      await window.dhurta.addBookmark({ url: t.url, title: t.name })
                      setShowToolPicker(false)
                      reload()
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 mb-1 border transition-colors ${
                      exists
                        ? `${isLight ? 'border-gray-100 text-gray-300' : 'border-[#1a1a1a] text-[#333]'} cursor-not-allowed`
                        : `${isLight ? 'border-gray-200 hover:border-[#FF4500]' : 'border-[#2a2a2a] hover:border-[#FF4500]'} ${tt.text}`
                    }`}>
                    <SmartFavicon url={`dhurta-tool://${t.id}`} name={t.name} size={16} />
                    <div className="text-left">
                      <p className="text-[10px] font-mono">{t.name}</p>
                      <p className={`text-[8px] font-mono ${tt.textMuted}`}>{exists ? 'Already added' : t.desc}</p>
                    </div>
                  </button>
                )
              })}
              <button onClick={() => setShowToolPicker(false)}
                className={`mt-2 w-full text-[9px] font-mono py-1.5 border ${tt.ctrlBorder} ${tt.ctrlText} hover:border-[#FF4500] hover:text-[#FF4500] transition-colors`}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    ) : undefined,

    status: ghost ? (
      <div className="flex flex-col items-center gap-3">
        <p className="text-[9px] font-mono tracking-widest text-white/25">
          🔒 In-memory session · wiped on close
        </p>

        {/* Tor status check — Ghost Mode only */}
        <button
          onClick={() => onNavigate('https://check.torproject.org')}
          className="group flex items-center gap-2.5 px-4 py-2 border border-[#FF0033]/30 hover:border-[#FF0033] bg-[#FF0033]/5 hover:bg-[#FF0033]/12 transition-all duration-200"
          title="Opens check.torproject.org to verify your Tor connection"
        >
          {/* Onion icon */}
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" className="shrink-0 transition-all group-hover:drop-shadow-[0_0_6px_#FF0033]">
            <ellipse cx="7" cy="8" rx="6.5" ry="7.5" stroke="#FF0033" strokeWidth="1" opacity="0.5" />
            <ellipse cx="7" cy="8" rx="4.5" ry="5.5" stroke="#FF0033" strokeWidth="1" opacity="0.7" />
            <ellipse cx="7" cy="8" rx="2.5" ry="3.5" stroke="#FF0033" strokeWidth="1" />
            <line x1="7" y1="0.5" x2="7" y2="2.5" stroke="#FF0033" strokeWidth="1" strokeLinecap="round" />
          </svg>

          <span
            className="text-[10px] font-mono tracking-widest uppercase transition-all"
            style={{ color: '#FF0033', textShadow: '0 0 8px #FF003355' }}
          >
            Verify Tor Circuit
          </span>

          {/* Arrow */}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#FF0033" strokeWidth="1.2" strokeLinecap="round" className="shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
            <path d="M1 4h6M4 1l3 3-3 3" />
          </svg>
        </button>

        <p className="text-[8px] font-mono text-white/15 tracking-wide">
          via check.torproject.org
        </p>
      </div>
    ) : (
      <p className={`text-[9px] font-mono tracking-widest ${tt.textFaint}`}>
        Sovereign Browser · Zero telemetry
      </p>
    ),
  }

  return (
    <div
      className="relative flex flex-col items-center justify-center w-full h-full select-none overflow-y-auto py-8"
      style={hasWallpaper ? {} : { background: themeBg }}
    >
      {/* Wallpaper — built-in theme wallpaper (static) */}
      {themeWallpaper && !activeWallpaper && (
        <img
          src={themeWallpaper}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          alt=""
          aria-hidden
        />
      )}

      {/* Wallpaper — user-uploaded (with crossfade slideshow support) */}
      {activeWallpaper && (
        <img
          src={activeWallpaper}
          className={[
            'absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500',
            wpVisible ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          alt=""
          aria-hidden
        />
      )}
      {hasWallpaper && <div className="absolute inset-0 bg-black/45 pointer-events-none" />}

      {/* Slideshow indicator dots — only for user-uploaded multi-wallpaper */}
      {wallpapers.length > 1 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
          {wallpapers.map((_, i) => (
            <button
              key={i}
              onClick={() => { setWpIdx(i); setWpVisible(true) }}
              className={[
                'w-1.5 h-1.5 rounded-full transition-all',
                i === wpIdx ? 'bg-[#FF4500] scale-125' : 'bg-white/30 hover:bg-white/60',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Ordered widgets */}
      <div className="relative z-10 flex flex-col items-center gap-5 w-full px-4">
        {layout.map((w, idx) => {
          if (!w.visible && !customizing) return null
          const node = widgetMap[w.id]
          if (!node && !customizing) return null
          const align = w.align || 'center'
          const justifyClass = align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center'
          const alignIcon = align === 'left' ? '◧' : align === 'right' ? '◨' : '▣'

          return (
            <div key={w.id} className={['flex items-center gap-2 w-full justify-center', !w.visible ? 'opacity-30' : ''].join(' ')}>
              {/* Up/Down controls */}
              {customizing && (
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => moveWidget(w.id, -1)}
                    disabled={idx === 0}
                    className={`w-5 h-5 text-[10px] ${tt.ctrlBg} border ${tt.ctrlBorder} hover:border-[#FF4500] ${tt.ctrlText} hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors`}
                  >▲</button>
                  <button
                    onClick={() => moveWidget(w.id, 1)}
                    disabled={idx === layout.length - 1}
                    className={`w-5 h-5 text-[10px] ${tt.ctrlBg} border ${tt.ctrlBorder} hover:border-[#FF4500] ${tt.ctrlText} hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors`}
                  >▼</button>
                </div>
              )}

              <div className={`flex-1 flex ${justifyClass}`}>
                {node ?? <span className={`text-[9px] font-mono italic ${tt.textFaint}`}>{w.id}</span>}
              </div>

              {/* Alignment cycle + show/hide toggle */}
              {customizing && (
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => cycleAlign(w.id)}
                    title={`Align: ${align} → click to cycle`}
                    className={`w-5 h-5 text-[10px] ${tt.ctrlBg} border ${tt.ctrlBorder} hover:border-[#FF4500] ${tt.ctrlText} hover:text-white transition-colors`}
                  >{alignIcon}</button>
                  <button
                    onClick={() => toggleWidget(w.id)}
                    title={w.visible ? 'Hide widget' : 'Show widget'}
                    className={[
                      `w-5 h-5 text-[10px] ${tt.ctrlBg} border transition-colors`,
                      w.visible
                        ? `${tt.ctrlBorder} hover:border-red-500 ${tt.ctrlText} hover:text-red-400`
                        : 'border-[#FF4500]/50 text-[#FF4500]/80 hover:border-[#FF4500] hover:text-[#FF4500]',
                    ].join(' ')}
                  >
                    {w.visible ? '✕' : '+'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Customize toggle */}
      {!ghost && (
        <button
          onClick={() => setCustomizing(c => !c)}
          className={[
            'absolute bottom-3 right-3 z-20 text-[9px] font-mono px-2.5 py-1 border transition-colors',
            customizing
              ? 'border-[#FF4500] text-[#FF4500] ' + (isLight ? 'bg-white/80' : 'bg-black/60')
              : isLight
                ? 'border-gray-300/50 text-gray-400 hover:border-gray-400 hover:text-gray-600 bg-white/50'
                : 'border-white/15 text-white/25 hover:border-white/40 hover:text-white/50 bg-black/20',
          ].join(' ')}
        >
          {customizing ? '✓ Done' : '⊞ Customize'}
        </button>
      )}

      {/* Edit / Add favourite modal */}
      {editBm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`${isLight ? 'bg-white border-gray-200 shadow-xl' : 'bg-[#111] border-[#2a2a2a]'} border p-5 w-80 shadow-2xl`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-mono text-[#FF4500] uppercase tracking-widest">
                {editBm.id === -1 ? 'Add Favourite' : 'Edit Favourite'}
              </h3>
              <button onClick={() => setEditBm(null)} className={`text-sm leading-none ${isLight ? 'text-gray-400 hover:text-gray-700' : 'text-[#555] hover:text-white'}`}>✕</button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={`text-[9px] font-mono uppercase tracking-wider ${isLight ? 'text-gray-400' : 'text-[#555]'}`}>Name</span>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="My Site"
                  className={`mt-1 w-full border text-xs font-mono px-2 py-1.5 outline-none focus:border-[#FF4500] ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-[#1a1a1a] border-[#2a2a2a] text-white'}`}
                />
              </label>
              <label className="block">
                <span className={`text-[9px] font-mono uppercase tracking-wider ${isLight ? 'text-gray-400' : 'text-[#555]'}`}>URL</span>
                <input
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder="https://example.com"
                  className={`mt-1 w-full border text-xs font-mono px-2 py-1.5 outline-none focus:border-[#FF4500] ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : 'bg-[#1a1a1a] border-[#2a2a2a] text-white'}`}
                  autoFocus={editBm.id === -1}
                />
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSave}
                className="flex-1 text-xs font-mono text-white bg-[#FF4500] hover:bg-orange-500 py-2 transition-colors"
              >Save</button>
              <button
                onClick={() => setEditBm(null)}
                className={`flex-1 text-xs font-mono border hover:border-[#FF4500] py-2 transition-colors ${isLight ? 'text-gray-500 border-gray-200 hover:text-gray-800' : 'text-[#666] border-[#2a2a2a] hover:text-white'}`}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// FaviconImg kept for backward compat but now delegates to SmartFavicon
function FaviconImg({ src: _src, fallback }: { src: string; fallback: string }) {
  // SpeedDialTile passes the full bookmark object directly now; this shim
  // exists for any call-sites that still pass a raw src string.
  return (
    <div className="w-5 h-5 shrink-0 flex items-center justify-center text-[10px] font-mono text-[#FF4500] border border-[#FF4500]/50">
      {fallback}
    </div>
  )
}

// ── Speed Dial Tile ──────────────────────────────────────────────────────────
function SpeedDialTile({ bookmark, onNavigate, onEdit, onDelete, isLight = false,
  draggable, onDragStart, onDragOver, onDrop, onDragEnd, isDragging,
}: {
  bookmark: Bookmark
  onNavigate: (url: string) => void
  onEdit: (bm: Bookmark) => void
  onDelete: (id: number) => void
  isLight?: boolean
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
  isDragging?: boolean
}) {
  const domain = (() => {
    try { return new URL(bookmark.url).hostname.replace(/^www\./, '') }
    catch { return bookmark.title || bookmark.url }
  })()

  const tileBg      = isLight ? 'bg-white/75 border-gray-200 hover:border-[#FF4500] hover:bg-white/90' : 'bg-black/25 border-white/15 hover:border-[#FF4500] hover:bg-black/40'
  const tileLabel   = isLight ? 'text-gray-500 group-hover:text-gray-800' : 'text-white/60 group-hover:text-white/90'
  const ctrlBg      = isLight ? 'bg-white/90 border border-gray-200' : 'bg-black/80'

  return (
    <div className={`group relative ${isDragging ? 'opacity-40' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button
        onClick={() => onNavigate(bookmark.url)}
        title={bookmark.url}
        className={`w-full h-[84px] flex flex-col items-center justify-center gap-1.5 p-2 border backdrop-blur-sm transition-colors cursor-pointer ${tileBg}`}
      >
        <SmartFavicon
          url={bookmark.url}
          name={bookmark.title || domain}
          size={20}
          className="w-5 h-5 object-contain shrink-0"
          letterClassName="w-5 h-5 flex items-center justify-center text-[10px] font-mono text-[#FF4500] border border-[#FF4500]/50 shrink-0"
        />
        <span className={`text-[8px] font-mono w-full text-center leading-tight transition-colors line-clamp-2 px-1 ${tileLabel}`}>
          {bookmark.title || domain}
        </span>
      </button>

      {/* Edit + delete on hover */}
      <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none group-hover:pointer-events-auto">
        <button
          onClick={e => { e.stopPropagation(); onEdit(bookmark) }}
          title="Edit"
          className={`w-[18px] h-[18px] flex items-center justify-center ${ctrlBg} hover:bg-[#FF4500] text-gray-500 hover:text-white text-[9px] transition-colors`}
        >✎</button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(bookmark.id) }}
          title="Remove"
          className={`w-[18px] h-[18px] flex items-center justify-center ${ctrlBg} hover:bg-red-600 text-gray-500 hover:text-white text-[9px] transition-colors`}
        >✕</button>
      </div>
    </div>
  )
}
