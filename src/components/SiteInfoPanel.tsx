import React, { useEffect, useRef, useState } from 'react'

interface SiteInfo {
  url: string
  domain: string
  isHttps: boolean
  origin: string
  cookieCount: number
}

interface Props {
  activeTabId: number
  url: string
  theme?: 'dark' | 'light'
  onClose: () => void
}

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

export default function SiteInfoPanel({ activeTabId, url, theme = 'dark', onClose }: Props) {
  const [info, setInfo]       = useState<SiteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [cleared, setCleared] = useState(false)
  const [histDone, setHistDone] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isDhurta = url.startsWith('dhurta://')
  const isLight  = theme === 'light'

  const bg     = isLight ? 'bg-white'           : 'bg-[#0d0d0d]'
  const border = isLight ? 'border-gray-200'    : 'border-[#2a2a2a]'
  const text   = isLight ? 'text-gray-800'      : 'text-white'
  const textDim= isLight ? 'text-gray-500'      : 'text-white/60'
  const textMut= isLight ? 'text-gray-400'      : 'text-white/35'
  const rowBg  = isLight ? 'bg-gray-50'         : 'bg-white/4'

  useEffect(() => {
    if (!isElectron || isDhurta) { setLoading(false); return }
    ;(window as any).dhurta.siteGetInfo(activeTabId).then((d: SiteInfo | null) => {
      setInfo(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [activeTabId, isDhurta])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 50)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleClearData = async () => {
    if (!isElectron || !info) return
    await (window as any).dhurta.siteClearData(activeTabId)
    setCleared(true)
    // Re-fetch cookie count
    const updated = await (window as any).dhurta.siteGetInfo(activeTabId).catch(() => null)
    if (updated) setInfo(updated)
  }

  const handleClearHistory = async () => {
    if (!isElectron || !info) return
    await (window as any).dhurta.siteClearHistory(info.domain)
    setHistDone(true)
  }

  return (
    <div
      ref={panelRef}
      className={`absolute top-full left-0 mt-0.5 z-[200] w-72 shadow-2xl border ${border} ${bg} overflow-hidden`}
      style={{ fontFamily: 'monospace' }}
    >
      {/* Header */}
      <div className={`px-3 py-2.5 border-b ${border} flex items-start justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Lock / globe icon */}
          {isDhurta ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#FF4500" strokeWidth="1.3">
              <polygon points="6.5,1 12,11.5 1,11.5" />
              <line x1="6.5" y1="5" x2="6.5" y2="8.5" />
              <circle cx="6.5" cy="10" r="0.5" fill="#FF4500" stroke="none" />
            </svg>
          ) : info?.isHttps ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="#22c55e" strokeWidth="1.3">
              <rect x="2" y="5.5" width="8" height="6.5" strokeLinecap="square" />
              <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
            </svg>
          ) : (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="#ef4444" strokeWidth="1.3">
              <rect x="2" y="5.5" width="8" height="6.5" strokeLinecap="square" />
              <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" strokeDasharray="2 1" />
            </svg>
          )}
          <div className="min-w-0">
            <p className={`text-[11px] font-mono font-semibold truncate ${text}`}>
              {isDhurta ? 'Dhurta Internal Page' : (info?.domain ?? (loading ? 'Loading…' : 'Unknown'))}
            </p>
            <p className={`text-[9px] font-mono truncate ${textDim}`}>
              {isDhurta
                ? url.replace('dhurta://', '')
                : info?.isHttps
                  ? 'Connection is secure (HTTPS)'
                  : info
                    ? 'Connection is NOT secure (HTTP)'
                    : ''}
            </p>
          </div>
        </div>
        <button onClick={onClose} className={`text-[12px] ${textMut} hover:text-[#FF4500] shrink-0 transition-colors`}>✕</button>
      </div>

      {/* Dhurta page — minimal info */}
      {isDhurta && (
        <div className={`px-3 py-3 text-[10px] font-mono ${textDim}`}>
          This is a built-in Dhurta page. No external connections are made from this page.
        </div>
      )}

      {/* Real page — full info */}
      {!isDhurta && !loading && info && (
        <>
          {/* Connection */}
          <Section title="Connection" border={border} bg={rowBg} text={text} textDim={textDim}>
            <Row label="Protocol" value={info.isHttps ? 'HTTPS' : 'HTTP'} valueColor={info.isHttps ? '#22c55e' : '#ef4444'} textDim={textDim} />
            <Row label="Domain"   value={info.domain} textDim={textDim} />
            <Row label="Origin"   value={info.origin} textDim={textDim} mono />
          </Section>

          {/* Cookies & Storage */}
          <Section title="Cookies & Storage" border={border} bg={rowBg} text={text} textDim={textDim}>
            <Row
              label="Cookies"
              value={cleared ? '0 (cleared)' : String(info.cookieCount)}
              valueColor={info.cookieCount > 0 && !cleared ? '#f59e0b' : '#22c55e'}
              textDim={textDim}
            />
            <div className="mt-2 flex gap-1.5">
              <ActionBtn
                label={cleared ? '✓ Data Cleared' : 'Clear All Site Data'}
                onClick={handleClearData}
                disabled={cleared}
                color="#ef4444"
              />
            </div>
            <p className={`text-[8px] font-mono mt-1.5 ${textDim}`}>
              Clears cookies, localStorage, IndexedDB, cache for {info.domain}
            </p>
          </Section>

          {/* Permissions — Dhurta blocks all by default */}
          <Section title="Permissions" border={border} bg={rowBg} text={text} textDim={textDim}>
            <div className="flex flex-col gap-1">
              {[
                { label: 'Camera',      icon: '📷' },
                { label: 'Microphone',  icon: '🎙' },
                { label: 'Location',    icon: '📍' },
                { label: 'Notifications', icon: '🔔' },
              ].map(p => (
                <div key={p.label} className={`flex items-center justify-between px-2 py-1 ${rowBg}`}>
                  <span className={`text-[10px] font-mono ${textDim}`}>{p.icon} {p.label}</span>
                  <span className="text-[8px] font-mono text-[#ef4444] border border-[#ef4444]/40 px-1">BLOCKED</span>
                </div>
              ))}
            </div>
            <p className={`text-[8px] font-mono mt-1.5 ${textDim}`}>
              Dhurta blocks all sensitive permissions by default (Chakra Shield).
            </p>
          </Section>

          {/* History */}
          <Section title="History" border={border} bg={rowBg} text={text} textDim={textDim}>
            <ActionBtn
              label={histDone ? '✓ History Removed' : `Remove ${info.domain} from History`}
              onClick={handleClearHistory}
              disabled={histDone}
              color="#f59e0b"
            />
          </Section>
        </>
      )}

      {/* Loading */}
      {!isDhurta && loading && (
        <div className={`px-3 py-4 text-[10px] font-mono text-center ${textDim}`}>
          Loading…
        </div>
      )}

      {/* Footer */}
      <div className={`px-3 py-2 border-t ${border} flex items-center gap-1.5`}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#FF4500" strokeWidth="1.1">
          <polygon points="5,1 9,9 1,9" />
        </svg>
        <span className={`text-[8px] font-mono ${textDim}`}>Dhurta · Zero Telemetry · Sovereign Browser</span>
      </div>
    </div>
  )
}

function Section({ title, border, bg, text, textDim, children }: {
  title: string; border: string; bg: string; text: string; textDim: string; children: React.ReactNode
}) {
  return (
    <div className={`border-b ${border} px-3 py-2`}>
      <p className={`text-[8px] font-mono uppercase tracking-widest mb-1.5 ${textDim}`}>{title}</p>
      {children}
    </div>
  )
}

function Row({ label, value, valueColor, textDim, mono }: {
  label: string; value: string; valueColor?: string; textDim: string; mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-2 mb-0.5">
      <span className={`text-[9px] font-mono shrink-0 ${textDim}`}>{label}</span>
      <span
        className={`text-[9px] font-mono text-right break-all ${mono ? 'font-mono' : ''}`}
        style={{ color: valueColor ?? 'inherit' }}
      >
        {value}
      </span>
    </div>
  )
}

function ActionBtn({ label, onClick, disabled, color }: {
  label: string; onClick: () => void; disabled?: boolean; color: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[9px] font-mono px-2 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        color: disabled ? '#666' : color,
        borderColor: disabled ? '#444' : color + '60',
        background: disabled ? 'transparent' : color + '10',
      }}
    >
      {label}
    </button>
  )
}
