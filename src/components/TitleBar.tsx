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
    <div className="drag-region flex items-center h-10 bg-obsidian border-b border-border select-none shrink-0 relative z-[9999]">
      {/* Logo — sits inside the sidebar width block */}
      <div className="w-16 shrink-0 flex items-center justify-center">
        <img
          src="/dhurta-logo.png"
          alt="Dhurta"
          className="w-8 h-8 object-contain drop-shadow-[0_0_6px_#FFB30066]"
          draggable={false}
        />
      </div>

      {/* Title */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs text-muted font-mono tracking-widest uppercase">
          {title || 'Dhurta'}
        </span>
      </div>

      {/* Network status — online/offline */}
      <div
        title={online ? 'Online' : 'Offline — no network connection'}
        className={[
          'no-drag flex items-center gap-1.5 h-6 px-2 mr-1 border shrink-0',
          online ? 'border-green-500/30 text-green-500/80' : 'border-red-500/40 text-red-400',
        ].join(' ')}
      >
        <span className={['w-1.5 h-1.5 rounded-full shrink-0', online ? 'bg-green-500' : 'bg-red-500 animate-pulse'].join(' ')} />
        <span className="text-[9px] font-mono uppercase tracking-widest">{online ? 'Online' : 'Offline'}</span>
      </div>

      {/* Dhurta Omni shortcut — privacy control dashboard */}
      {onOpenOmni && (
        <button
          onClick={onOpenOmni}
          title="Dhurta Omni — Privacy Dashboard"
          className="no-drag flex items-center gap-1.5 h-6 px-2 mr-1 border border-saffron/30 text-saffron/80 hover:text-saffron hover:border-saffron hover:bg-saffron/10 transition-colors shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1.5L2.5 4v3.8c0 3.2 2.4 5.9 5.5 6.7 3.1-.8 5.5-3.5 5.5-6.7V4L8 1.5z" />
            <circle cx="8" cy="7.6" r="1.6" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-[9px] font-mono uppercase tracking-widest">Omni</span>
        </button>
      )}

      {/* Live clock + date — top-right corner */}
      <div className="no-drag flex flex-col items-end justify-center px-3 shrink-0 leading-none gap-px">
        <span className="text-[11px] font-mono text-text/80 tabular-nums tracking-wider">{timeStr}</span>
        <span className="text-[9px] font-mono text-muted tracking-wider">{dateStr}</span>
      </div>

      {/* Windows-style controls */}
      {(typeof window.dhurta === 'undefined' || window.dhurta.platform !== 'darwin') && (
        <div className="no-drag flex items-center shrink-0">
          <button
            onClick={minimize}
            className="h-10 w-12 flex items-center justify-center text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>
          <button
            onClick={maximize}
            className="h-10 w-12 flex items-center justify-center text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
          <button
            onClick={close}
            className="h-10 w-12 flex items-center justify-center text-muted hover:bg-saffron hover:text-white transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="10" y2="10" />
              <line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
