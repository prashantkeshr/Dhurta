import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { Tab } from '../types'
import type { ClosedTab } from '../store/useBrowser'

interface Props {
  tabs: Tab[]
  activeTabId: number
  closedTabs: ClosedTab[]
  onSwitch: (id: number) => void
  onOpenClosed: (url: string) => void
  onClose: () => void
}

function formatHost(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

export default function TabSearchOverlay({ tabs, activeTabId, closedTabs, onSwitch, onOpenClosed, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const lc = query.toLowerCase()

  const matchedTabs = tabs.filter(t =>
    !query ||
    t.title?.toLowerCase().includes(lc) ||
    t.url?.toLowerCase().includes(lc)
  )

  const matchedClosed = query
    ? closedTabs.filter(t =>
        t.title?.toLowerCase().includes(lc) ||
        t.url?.toLowerCase().includes(lc)
      )
    : closedTabs.slice(0, 5)

  type ResultItem =
    | { kind: 'tab'; tab: Tab }
    | { kind: 'closed'; ct: ClosedTab; idx: number }

  const results: ResultItem[] = [
    ...matchedTabs.map(t => ({ kind: 'tab' as const, tab: t })),
    ...matchedClosed.map((ct, idx) => ({ kind: 'closed' as const, ct, idx })),
  ]

  const total = results.length

  const activate = useCallback((item: ResultItem) => {
    if (item.kind === 'tab') onSwitch(item.tab.id)
    else onOpenClosed(item.ct.url)
    onClose()
  }, [onSwitch, onOpenClosed, onClose])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => (s + 1) % Math.max(1, total)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => (s - 1 + Math.max(1, total)) % Math.max(1, total)) }
    if (e.key === 'Enter' && results[selected]) { activate(results[selected]) }
  }

  return (
    <div
      className="fixed inset-0 z-[9997]"
      onClick={onClose}
    >
      {/* Palette card — fixed to top of chrome, safe from BrowserView */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[74px] w-[480px] max-w-[90vw] bg-[#111] border border-border shadow-2xl"
        style={{ boxShadow: '0 0 0 1px #FF450020, 0 16px 48px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted shrink-0">
            <circle cx="5" cy="5" r="4" /><line x1="9" y1="9" x2="11" y2="11" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKey}
            placeholder="Search tabs…"
            className="flex-1 bg-transparent text-[12px] font-mono text-text outline-none placeholder:text-muted"
          />
          <span className="text-[9px] font-mono text-muted/50 shrink-0">ESC to close</span>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto">
          {results.length === 0 && (
            <p className="px-4 py-4 text-[11px] font-mono text-muted text-center">No matching tabs</p>
          )}

          {/* Open tabs section */}
          {matchedTabs.length > 0 && (
            <>
              {(matchedClosed.length > 0 || !query) && (
                <p className="px-3 pt-2 pb-0.5 text-[9px] font-mono text-muted/50 uppercase tracking-widest">Open Tabs</p>
              )}
              {matchedTabs.map((tab, i) => {
                const isSelected = results[selected]?.kind === 'tab' && results[selected].tab.id === tab.id
                const isActive = tab.id === activeTabId
                return (
                  <div
                    key={tab.id}
                    onClick={() => activate({ kind: 'tab', tab })}
                    className={[
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                      isSelected ? 'bg-saffron/10' : 'hover:bg-white/5',
                    ].join(' ')}
                  >
                    {tab.favicon ? (
                      <img src={tab.favicon} className="w-3.5 h-3.5 shrink-0" alt="" />
                    ) : (
                      <div className="w-3.5 h-3.5 shrink-0 border border-border/50" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={['text-[11px] truncate', isActive ? 'text-saffron' : 'text-text'].join(' ')}>
                        {tab.ghost && <span className="mr-1 text-[9px]">👻</span>}
                        {tab.title || 'New Tab'}
                      </p>
                      {tab.url && tab.url !== 'about:blank' && (
                        <p className="text-[10px] text-muted font-mono truncate">{formatHost(tab.url)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {tab.playing && !tab.muted && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-saffron">
                          <path d="M1 3.5h2l2.5-2.5v8L3 6.5H1V3.5z" />
                          <path d="M6.5 3c.8.7.8 3.3 0 4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                        </svg>
                      )}
                      {tab.muted && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-muted">
                          <path d="M1 3.5h2l2.5-2.5v8L3 6.5H1V3.5z" />
                          <line x1="6.5" y1="3" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                          <line x1="9.5" y1="3" x2="6.5" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                        </svg>
                      )}
                      {isActive && <span className="text-[9px] font-mono text-saffron/70">active</span>}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {/* Recently closed section */}
          {matchedClosed.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-0.5 text-[9px] font-mono text-muted/50 uppercase tracking-widest">
                {query ? 'Closed Tabs' : 'Recently Closed'}
              </p>
              {matchedClosed.map((ct, i) => {
                const resultIdx = matchedTabs.length + i
                const isSelected = selected === resultIdx
                return (
                  <div
                    key={i}
                    onClick={() => activate({ kind: 'closed', ct, idx: i })}
                    className={[
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors opacity-70',
                      isSelected ? 'bg-saffron/10 opacity-100' : 'hover:bg-white/5 hover:opacity-90',
                    ].join(' ')}
                  >
                    {ct.favicon ? (
                      <img src={ct.favicon} className="w-3.5 h-3.5 shrink-0" alt="" />
                    ) : (
                      <div className="w-3.5 h-3.5 shrink-0 border border-border/40" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-text truncate">{ct.title}</p>
                      <p className="text-[10px] text-muted font-mono truncate">{formatHost(ct.url)}</p>
                    </div>
                    <span className="text-[9px] font-mono text-muted/40 shrink-0">↩</span>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border/50 flex items-center gap-3">
          <span className="text-[9px] font-mono text-muted/40">↑↓ navigate</span>
          <span className="text-[9px] font-mono text-muted/40">Enter to switch</span>
          <div className="flex-1" />
          <span className="text-[9px] font-mono text-muted/30">{tabs.length} open · {closedTabs.length} closed</span>
        </div>
      </div>
    </div>
  )
}
