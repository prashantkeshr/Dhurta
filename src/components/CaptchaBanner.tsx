import React, { useEffect, useState, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface CaptchaEvent { tabId: number; url: string; title: string; blockedUrl?: string }

interface Props {
  activeTabId: number
  ghostMode: boolean
  onNavigate: (url: string) => void
}

// Extract a Google search query from a google.com/search or google.com/sorry URL
function extractGoogleQuery(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('q')
  } catch (_) {
    return null
  }
}

function isGoogleCaptcha(url: string): boolean {
  return url.includes('google.com/sorry') || url.includes('google.com/recaptcha')
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
    try {
      const origin = new URL(event.url).origin
      setStatus(`Opening ${origin} without Ghost Mode…`)
      window.dhurta.createTab(event.url, false)
    } catch {}
    setEvent(null)
  }, [event])

  const searchOnBrave = useCallback(() => {
    if (!event) return
    // Try to find the query from the blocked URL (the continue= param) or from the CAPTCHA URL itself
    const sourceUrl = event.blockedUrl ?? event.url
    const q = extractGoogleQuery(sourceUrl)
    if (q) {
      const braveUrl = `https://search.brave.com/search?q=${encodeURIComponent(q)}`
      onNavigate(braveUrl)
    }
    setEvent(null)
  }, [event, onNavigate])

  const searchOnDDG = useCallback(() => {
    if (!event) return
    const sourceUrl = event.blockedUrl ?? event.url
    const q = extractGoogleQuery(sourceUrl)
    if (q) {
      onNavigate(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`)
    }
    setEvent(null)
  }, [event, onNavigate])

  if (!event) return null

  const isGoogle = isGoogleCaptcha(event.url)
  const blockedQuery = extractGoogleQuery(event.blockedUrl ?? event.url)

  return (
    <div className="shrink-0 border-b border-[#f8a000]/25 bg-[#100a00] animate-[security-slide-down_0.15s_ease-out]">
      {/* ── Main row ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
        {/* Warning icon */}
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#f8a000" strokeWidth="1.3" className="shrink-0">
          <path d="M6.5 1.5L1 11.5h11L6.5 1.5z" />
          <line x1="6.5" y1="5.5" x2="6.5" y2="8" strokeLinecap="round" />
          <circle cx="6.5" cy="9.5" r="0.6" fill="#f8a000" stroke="none" />
        </svg>

        <span className="text-text/70 flex-1 min-w-0 truncate">
          {isGoogle ? (
            <>
              <span className="text-[#f8a000] font-medium">Google blocked this IP</span>
              {ghostMode && <span className="text-muted"> — Google bans Tor/VPN IPs</span>}
              {blockedQuery && <span className="text-muted"> · query: <span className="text-text/60">"{blockedQuery}"</span></span>}
            </>
          ) : (
            <>
              <span className="text-[#f8a000] font-medium">CAPTCHA detected</span>
              {ghostMode && <span className="text-muted"> — Tor IP may be blocked</span>}
            </>
          )}
        </span>

        {status && <span className="text-muted italic shrink-0 max-w-[140px] truncate">{status}</span>}

        {/* Google-specific: search on Brave */}
        {isGoogle && blockedQuery && (
          <>
            <button
              onClick={searchOnBrave}
              title="Search the same query on Brave Search (no CAPTCHA)"
              className="px-2 py-0.5 border border-[#FF4500]/50 text-[#FF4500] text-[9px] font-mono hover:bg-[#FF4500]/10 transition-colors shrink-0"
            >
              Brave Search
            </button>
            <button
              onClick={searchOnDDG}
              title="Search on DuckDuckGo (Tor-friendly)"
              className="px-2 py-0.5 border border-[#f8a000]/40 text-[#f8a000] text-[9px] font-mono hover:bg-[#f8a000]/10 transition-colors shrink-0"
            >
              DuckDuckGo
            </button>
          </>
        )}

        {/* New Tor circuit — only for Ghost Mode non-Google, or Google when no query to redirect */}
        {ghostMode && (!isGoogle || !blockedQuery) && (
          <button
            onClick={newCircuit}
            disabled={busy}
            title="Get a fresh Tor exit node and reload"
            className="px-2 py-0.5 border border-[#f8a000]/40 text-[#f8a000] text-[9px] font-mono hover:bg-[#f8a000]/10 transition-colors shrink-0 disabled:opacity-40"
          >
            New circuit
          </button>
        )}

        <button
          onClick={bypass}
          title="Open this page in a regular tab (no Ghost Mode)"
          className="px-2 py-0.5 border border-border text-muted text-[9px] font-mono hover:text-text hover:border-border/80 transition-colors shrink-0"
        >
          Open normally
        </button>

        <button
          onClick={() => setEvent(null)}
          className="text-muted/50 hover:text-muted transition-colors shrink-0 ml-1"
          title="Dismiss"
        >✕</button>
      </div>

      {/* ── Google-specific tip ── */}
      {isGoogle && ghostMode && (
        <div className="px-3 pb-1.5 text-[9px] font-mono text-[#f8a000]/40 border-t border-[#f8a000]/8">
          Google bans Tor and VPN exit IPs. Use Brave Search or DuckDuckGo for private searches — they work without CAPTCHA.
        </div>
      )}
    </div>
  )
}
