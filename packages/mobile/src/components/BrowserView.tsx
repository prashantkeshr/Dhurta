import React, { useState, useRef } from 'react'
import { Browser } from '@capacitor/browser'

interface Props {
  url: string
  onUrlChange(url: string): void
}

export default function BrowserView({ url, onUrlChange }: Props) {
  const [inputVal, setInputVal] = useState(url)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function resolveUrl(raw: string): string {
    const s = raw.trim()
    if (!s) return 'dhurta://newtab'
    if (/^https?:\/\//i.test(s)) return s
    if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(s) && !s.includes(' ')) return `https://${s}`
    return `https://google.com/search?q=${encodeURIComponent(s)}`
  }

  async function navigate() {
    const dest = resolveUrl(inputVal)
    onUrlChange(dest)
    setIsLoading(true)
    try {
      await Browser.open({ url: dest, toolbarColor: '#0A0A0A' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* URL bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-border">
        <div className="w-2 h-2 rounded-full bg-saffron shrink-0" />
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onFocus={() => inputRef.current?.select()}
          onKeyDown={e => e.key === 'Enter' && navigate()}
          placeholder="Search or enter URL…"
          className="flex-1 bg-transparent text-xs font-mono text-text placeholder:text-muted outline-none"
        />
        {isLoading && (
          <div className="w-3 h-3 border border-saffron border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center bg-obsidian">
        <div className="text-center space-y-4 p-8">
          <div className="font-mono text-2xl text-saffron tracking-[0.3em] uppercase">DHURTA</div>
          <div className="font-mono text-xs text-muted">Mobile Edition — Phase 2</div>
          <div className="font-mono text-[10px] text-muted/60 leading-relaxed max-w-xs">
            In-app WebView is coming in Phase 2.{'\n'}
            Tap the URL bar to navigate — links open in Capacitor Browser.
          </div>
        </div>
      </div>
    </div>
  )
}
