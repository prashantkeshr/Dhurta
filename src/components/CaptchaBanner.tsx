import React, { useEffect, useState, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface CaptchaEvent { tabId: number; url: string; title: string }

interface Props {
  activeTabId: number
  ghostMode: boolean
  onNavigate: (url: string) => void
}

export default function CaptchaBanner({ activeTabId, ghostMode, onNavigate }: Props) {
  const [event, setEvent] = useState<CaptchaEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!isElectron) return
    const handler = (data: CaptchaEvent) => {
      if (data.tabId === activeTabId) {
        setEvent(data)
        setStatus('')
      }
    }
    window.dhurta.on('captcha:detected', handler as never)
    return () => window.dhurta.off('captcha:detected', handler as never)
  }, [activeTabId])

  // Auto-dismiss when the active tab changes away
  useEffect(() => {
    if (event && event.tabId !== activeTabId) setEvent(null)
  }, [activeTabId, event])

  const newCircuit = useCallback(async () => {
    if (!isElectron || busy) return
    setBusy(true)
    setStatus('Rotating Tor circuit…')
    try {
      const res = await window.dhurta.torNewCircuit()
      if (res.success) {
        setStatus('New circuit active — reloading…')
        setTimeout(() => {
          window.dhurta.reload(activeTabId)
          setEvent(null)
          setStatus('')
        }, 800)
      } else {
        setStatus(res.error ?? 'Circuit rotation failed')
      }
    } catch (e: any) {
      setStatus(e.message ?? 'Error')
    } finally {
      setBusy(false)
    }
  }, [activeTabId, busy])

  const bypass = useCallback(() => {
    if (!event) return
    // Navigate without Tor by opening in a normal tab
    try {
      const origin = new URL(event.url).origin
      setStatus(`Opening ${origin} without Ghost Mode…`)
      // Create a regular (non-ghost) tab and navigate there
      window.dhurta.createTab(event.url, false)
    } catch {}
    setEvent(null)
  }, [event])

  if (!event) return null

  const isGhost = ghostMode

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#100a00] border-b border-[#f8a000]/25 text-[11px] shrink-0">
      {/* Warning icon */}
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#f8a000" strokeWidth="1.3" className="shrink-0">
        <path d="M6.5 1.5L1 11.5h11L6.5 1.5z" />
        <line x1="6.5" y1="5.5" x2="6.5" y2="8" strokeLinecap="round" />
        <circle cx="6.5" cy="9.5" r="0.6" fill="#f8a000" stroke="none" />
      </svg>

      <span className="text-text/70 flex-1 min-w-0 truncate">
        <span className="text-[#f8a000] font-medium">CAPTCHA detected</span>
        {isGhost && <span className="text-muted"> — Tor IP may be blocked</span>}
      </span>

      {status && <span className="text-muted italic shrink-0 max-w-[120px] truncate">{status}</span>}

      {isGhost && (
        <button
          onClick={newCircuit}
          disabled={busy}
          title="Get a fresh Tor exit node and reload"
          className="px-2 py-0.5 border border-[#f8a000]/40 text-[#f8a000] hover:bg-[#f8a000]/10 transition-colors shrink-0 disabled:opacity-40"
        >
          New circuit
        </button>
      )}

      <button
        onClick={bypass}
        title="Open this page in a regular tab (no Ghost Mode)"
        className="px-2 py-0.5 border border-border text-muted hover:text-text hover:border-border/80 transition-colors shrink-0"
      >
        Open normally
      </button>

      <button
        onClick={() => setEvent(null)}
        className="text-muted/50 hover:text-muted transition-colors shrink-0 ml-1"
        title="Dismiss"
      >✕</button>
    </div>
  )
}
