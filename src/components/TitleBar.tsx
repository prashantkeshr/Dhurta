import React, { useState, useEffect } from 'react'

interface Props {
  title: string
  onOpenOmni?: () => void
}

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

function useClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return time
}

function useOnlineStatus() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    let active = true
    const check = async () => {
      if (!active) return
      try {
        const result = await (window as any).dhurta?.checkOnline?.()
        if (active) setOnline(result !== false)
      } catch {
        if (active) setOnline(navigator.onLine)
      }
    }
    check()
    const interval = setInterval(check, 10000)
    const goOnline = () => { check() }
    const goOffline = () => { setOnline(false) }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function pad(n: number) { return String(n).padStart(2, '0') }

export default function TitleBar({ title, onOpenOmni }: Props) {
  const minimize = () => isElectron && window.dhurta.minimize()
  const maximize = () => isElectron && window.dhurta.maximize()
  const close = () => isElectron && window.dhurta.close()
  const now = useClock()
  const online = useOnlineStatus()
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`

  return (
    <div className="drag-region flex items-center h-10 bg-obsidian border-b border-border select-none shrink-0 relative z-[9999]"
      style={{ borderBottomColor: 'rgba(42,46,82,0.6)' }}>
      {/* Logo + brand — sits inside the sidebar width block */}
      <div className="w-16 shrink-0 flex items-center justify-center">
        <img
          src="./dhurta-logo.png"
          alt="Dhurta Developer Browser"
          className="w-8 h-8 object-contain"
          style={{ filter: 'drop-shadow(0 0 5px rgba(255,87,34,0.5)) drop-shadow(0 0 12px rgba(245,158,11,0.2))' }}
          draggable={false}
        />
      </div>

      {/* Title — show page title or branded app name */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
        {title && title !== 'Dhurta' && title !== 'Dhurta Developer Browser' ? (
          <span className="text-xs text-muted font-mono tracking-widest uppercase truncate max-w-[400px]">
            {title}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono tracking-[0.3em] uppercase"
              style={{ color: '#FF5722', textShadow: '0 0 8px rgba(255,87,34,0.4)' }}>
              DHURTA
            </span>
            <span className="text-[10px] font-mono text-muted/40 tracking-widest">·</span>
            <span className="text-[10px] font-mono tracking-[0.22em] uppercase"
              style={{ color: 'rgba(218,222,248,0.45)', letterSpacing: '0.22em' }}>
              DEVELOPER BROWSER
            </span>
          </span>
        )}
      </div>

      {/* Network status */}
      <div
        title={online ? 'Online' : 'Offline — no network connection'}
        className={[
          'no-drag flex items-center gap-1.5 h-6 px-2.5 mr-1 border rounded-full shrink-0',
          online
            ? 'border-emerald-500/25 text-emerald-400/70'
            : 'border-red-500/40 text-red-400',
        ].join(' ')}
      >
        <span className={['w-1.5 h-1.5 rounded-full shrink-0', online ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'].join(' ')} />
        <span className="text-[10px] font-mono uppercase tracking-widest">{online ? 'Online' : 'Offline'}</span>
      </div>

      {/* Dhurta Omni shortcut */}
      {onOpenOmni && (
        <button
          onClick={onOpenOmni}
          title="Dhurta Omni — Privacy Dashboard"
          className="no-drag flex items-center gap-1.5 h-6 px-2.5 mr-1 border border-saffron/25 text-saffron/70 hover:text-saffron hover:border-saffron hover:bg-saffron/8 transition-colors shrink-0 rounded-full"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1.5L2.5 4v3.8c0 3.2 2.4 5.9 5.5 6.7 3.1-.8 5.5-3.5 5.5-6.7V4L8 1.5z" />
            <circle cx="8" cy="7.6" r="1.6" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-[10px] font-mono uppercase tracking-widest">Omni</span>
        </button>
      )}

      {/* Live clock + date */}
      <div className="no-drag flex flex-col items-end justify-center px-3 shrink-0 leading-none gap-px">
        <span className="text-[11px] font-mono tabular-nums tracking-wider" style={{ color: 'rgba(218,222,248,0.72)' }}>{timeStr}</span>
        <span className="text-[10px] font-mono tracking-wider" style={{ color: 'rgba(88,96,148,0.9)' }}>{dateStr}</span>
      </div>

      {/* Windows-style controls — premium subtle */}
      {(typeof window.dhurta === 'undefined' || window.dhurta.platform !== 'darwin') && (
        <div className="no-drag flex items-center shrink-0">
          <button
            onClick={minimize}
            className="h-10 w-10 flex items-center justify-center transition-colors"
            style={{ color: 'rgba(88,96,148,0.7)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(42,46,82,0.4)'; e.currentTarget.style.color = 'rgba(218,222,248,0.9)' }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'rgba(88,96,148,0.7)' }}
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
          </button>
          <button
            onClick={maximize}
            className="h-10 w-10 flex items-center justify-center transition-colors"
            style={{ color: 'rgba(88,96,148,0.7)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(42,46,82,0.4)'; e.currentTarget.style.color = 'rgba(218,222,248,0.9)' }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'rgba(88,96,148,0.7)' }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
          </button>
          <button
            onClick={close}
            className="h-10 w-10 flex items-center justify-center transition-all"
            style={{ color: 'rgba(88,96,148,0.7)' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FF5722'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'rgba(88,96,148,0.7)' }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.3"><line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
