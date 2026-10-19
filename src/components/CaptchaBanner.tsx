import React, { useEffect, useState, useCallback, useRef } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface CaptchaEvent { tabId: number; url: string; title: string; blockedUrl?: string }

interface Props {
  activeTabId: number
  ghostMode: boolean
  onNavigate: (url: string) => void
}

function extractGoogleQuery(url: string): string | null {
  try { return new URL(url).searchParams.get('q') } catch { return null }
}

function isGoogleCaptcha(url: string): boolean {
  return url.includes('google.com/sorry') || url.includes('google.com/recaptcha')
}

function buildBraveUrl(q: string) {
  return `https://search.brave.com/search?q=${encodeURIComponent(q)}`
}

export default function CaptchaBanner({ activeTabId, ghostMode, onNavigate }: Props) {
  const [event, setEvent]       = useState<CaptchaEvent | null>(null)
  const [busy,  setBusy]        = useState(false)
  const [status, setStatus]     = useState('')
  const [autoMsg, setAutoMsg]   = useState('')   // shown after auto-redirect
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isElectron) return
    const handler = (data: CaptchaEvent) => {
      if (data.tabId === activeTabId) { setEvent(data); setStatus(''); setAutoMsg('') }
    }
    window.dhurta.on('captcha:detected', handler as never)
    return () => window.dhurta.off('captcha:detected', handler as never)
  }, [activeTabId])

  // Auto-dismiss when active tab changes
  useEffect(() => {
    if (event && event.tabId !== activeTabId) setEvent(null)
  }, [activeTabId, event])

  // ── Auto-redirect: Google CAPTCHA + Ghost Mode → Brave Search instantly ──
  useEffect(() => {
    if (!event) return
    if (!isGoogleCaptcha(event.url) || !ghostMode) return
    const q = extractGoogleQuery(event.blockedUrl ?? event.url)
    if (!q) return

    // Redirect immediately, show a brief auto-dismiss notice
    onNavigate(buildBraveUrl(q))
    setEvent(null)
    setAutoMsg(`Google blocked · Redirected to Brave Search for "${q}"`)

    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => setAutoMsg(''), 5000)
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.url, event?.blockedUrl, ghostMode])

  const newCircuit = useCallback(async () => {
    if (!isElectron || busy) return
    setBusy(true); setStatus('Rotating Tor circuit…')
    try {
      const res = await window.dhurta.torNewCircuit()
      if (res.success) {
        setStatus('New circuit · reloading…')
        setTimeout(() => { window.dhurta.reload(activeTabId); setEvent(null); setStatus('') }, 800)
      } else {
        setStatus(res.error ?? 'Circuit rotation failed')
      }
    } catch (e: any) { setStatus(e.message ?? 'Error') }
    finally { setBusy(false) }
  }, [activeTabId, busy])

  const bypass = useCallback(() => {
    if (!event) return
    try { window.dhurta.createTab(event.url, false) } catch {}
    setEvent(null)
  }, [event])

  const switchToBrave = useCallback(() => {
    if (!event) return
    const q = extractGoogleQuery(event.blockedUrl ?? event.url)
    if (q) onNavigate(buildBraveUrl(q))
    setEvent(null)
  }, [event, onNavigate])

  const switchToDDG = useCallback(() => {
    if (!event) return
    const q = extractGoogleQuery(event.blockedUrl ?? event.url)
    if (q) onNavigate(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`)
    setEvent(null)
  }, [event, onNavigate])

  // Auto-redirect notice (shown after auto-redirect, no event)
  if (!event && autoMsg) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-[#0a1a0a] border-b border-[#22c55e]/20 text-[10px] font-mono animate-[security-slide-down_0.15s_ease-out]">
        <span className="text-[#22c55e]">✓</span>
        <span className="text-[#22c55e]/70 flex-1">{autoMsg}</span>
        <button onClick={() => setAutoMsg('')} className="text-[#22c55e]/30 hover:text-[#22c55e]/60 transition-colors">✕</button>
      </div>
    )
  }

  if (!event) return null

  const isGoogle  = isGoogleCaptcha(event.url)
  const query     = extractGoogleQuery(event.blockedUrl ?? event.url)

  return (
    <div className="shrink-0 border-b border-[#f8a000]/25 bg-[#100a00] animate-[security-slide-down_0.15s_ease-out]">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">

        {/* Warning icon */}
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#f8a000" strokeWidth="1.3" className="shrink-0">
          <path d="M6.5 1.5L1 11.5h11L6.5 1.5z"/>
          <line x1="6.5" y1="5.5" x2="6.5" y2="8" strokeLinecap="round"/>
          <circle cx="6.5" cy="9.5" r="0.6" fill="#f8a000" stroke="none"/>
        </svg>

        <span className="text-text/70 flex-1 min-w-0 truncate">
          {isGoogle ? (
            <>
              <span className="text-[#f8a000] font-medium">Google blocked this IP</span>
              {query && <span className="text-muted"> · "{query}"</span>}
            </>
          ) : (
            <span className="text-[#f8a000] font-medium">CAPTCHA detected</span>
          )}
          {ghostMode && !isGoogle && <span className="text-muted"> — Tor IP may be blocked</span>}
        </span>

        {status && <span className="text-muted italic shrink-0 max-w-[140px] truncate">{status}</span>}

        {/* Non-ghost Google: one-click switch buttons */}
        {isGoogle && !ghostMode && query && (
          <>
            <button onClick={switchToBrave}
              className="px-2.5 py-0.5 bg-[#FF4500] text-black text-[9px] font-mono hover:bg-[#FF5a1a] transition-colors shrink-0">
              → Brave Search
            </button>
            <button onClick={switchToDDG}
              className="px-2 py-0.5 border border-[#f8a000]/40 text-[#f8a000] text-[9px] font-mono hover:bg-[#f8a000]/10 transition-colors shrink-0">
              DuckDuckGo
            </button>
          </>
        )}

        {/* Non-Google CAPTCHA: new circuit if in Ghost Mode */}
        {!isGoogle && ghostMode && (
          <button onClick={newCircuit} disabled={busy}
            className="px-2 py-0.5 border border-[#f8a000]/40 text-[#f8a000] text-[9px] font-mono hover:bg-[#f8a000]/10 disabled:opacity-40 transition-colors shrink-0">
            New circuit
          </button>
        )}

        <button onClick={bypass}
          className="px-2 py-0.5 border border-border text-muted text-[9px] font-mono hover:text-text transition-colors shrink-0">
          Open normally
        </button>

        <button onClick={() => setEvent(null)}
          className="text-muted/50 hover:text-muted transition-colors shrink-0 ml-1">✕</button>
      </div>

      {/* Tip for non-ghost Google CAPTCHA */}
      {isGoogle && !ghostMode && (
        <div className="px-3 pb-1.5 text-[9px] font-mono text-[#f8a000]/40 border-t border-[#f8a000]/8">
          Google flagged your IP. Switch to Brave Search or DuckDuckGo — they work without CAPTCHA.
        </div>
      )}
    </div>
  )
}
