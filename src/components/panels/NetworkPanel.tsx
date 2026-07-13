import React, { useEffect, useState, useRef } from 'react'
import type { RequestEntry } from '../../types'

const api = () => window.dhurta

const METHOD_COLORS: Record<string, string> = {
  GET:     'text-green-400',
  POST:    'text-saffron',
  PUT:     'text-yellow-400',
  DELETE:  'text-red-400',
  PATCH:   'text-purple-400',
  OPTIONS: 'text-muted',
  HEAD:    'text-blue-400',
}

const TYPE_FILTER = ['all', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'media', 'other']

function statusColor(code?: number) {
  if (!code) return 'text-muted'
  if (code < 300) return 'text-green-400'
  if (code < 400) return 'text-yellow-400'
  return 'text-red-400'
}

function formatDomain(url: string) {
  try {
    const u = new URL(url)
    return u.hostname
  } catch { return url.slice(0, 24) }
}

function formatPath(url: string) {
  try {
    const u = new URL(url)
    const p = u.pathname + (u.search.length > 30 ? u.search.slice(0, 30) + '…' : u.search)
    return p.length > 48 ? p.slice(0, 48) + '…' : p
  } catch { return '' }
}

interface Props { activeTabId: number }

export default function NetworkPanel({ activeTabId }: Props) {
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [filter, setFilter]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [paused, setPaused]     = useState(false)
  const [selected, setSelected] = useState<RequestEntry | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load existing requests on mount / tab change
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    api().getRequests(activeTabId).then(setRequests)
    setSelected(null)
  }, [activeTabId])

  // Live updates
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const handler = (data: { tabId: number; entry: RequestEntry }) => {
      if (data.tabId !== activeTabId || paused) return
      setRequests(prev => [...prev, data.entry].slice(-1000))
    }
    api().on('interceptor:request', handler as never)
    return () => api().off('interceptor:request', handler as never)
  }, [activeTabId, paused])

  // Auto-scroll when not paused
  useEffect(() => {
    if (!paused && listRef.current && !selected) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [requests, paused, selected])

  const visible = requests.filter(r => {
    const matchesText = !filter || r.url.includes(filter) || r.method.includes(filter.toUpperCase()) || r.type.includes(filter)
    const matchesType = typeFilter === 'all' || r.type === typeFilter
    return matchesText && matchesType
  })

  // Stats
  const total   = visible.length
  const errors  = visible.filter(r => (r.status ?? 0) >= 400).length
  const pending = visible.filter(r => !r.status).length

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-96">
      {/* Header */}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Network Monitor</h2>
            <p className="text-[9px] text-muted font-mono mt-0.5">
              {total} req · <span className="text-red-400">{errors} err</span>
              {pending > 0 && <> · <span className="text-yellow-400">{pending} pending</span></>}
            </p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPaused(p => !p)}
              className={`text-[10px] border px-1.5 py-0.5 font-mono transition-colors ${
                paused ? 'border-saffron text-saffron' : 'border-border text-muted hover:border-saffron hover:text-saffron'
              }`}
            >
              {paused ? 'RESUME' : 'PAUSE'}
            </button>
            <button
              onClick={() => { setRequests([]); setSelected(null) }}
              className="text-[10px] border border-border text-muted px-1.5 py-0.5 font-mono hover:border-saffron hover:text-saffron transition-colors"
            >
              CLEAR
            </button>
          </div>
        </div>

        {/* Search */}
        <input
          className="w-full bg-obsidian border border-border text-xs text-text px-2 py-1 font-mono placeholder:text-muted outline-none focus:border-saffron transition-colors"
          placeholder="Filter by URL, method, type…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        {/* Type filter chips */}
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {TYPE_FILTER.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-[8px] font-mono px-1.5 py-0.5 border transition-colors ${
                typeFilter === t
                  ? 'border-saffron text-saffron bg-saffron/10'
                  : 'border-border text-muted hover:border-saffron/50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Request list */}
      <div ref={listRef} className="flex-1 overflow-y-auto font-mono min-h-0">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="mb-2 opacity-30">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-[10px]">Waiting for requests…</p>
          </div>
        ) : (
          visible.map(r => (
            <button
              key={r.id}
              onClick={() => setSelected(selected?.id === r.id ? null : r)}
              className={[
                'w-full text-left px-3 py-1.5 border-b border-border/40 hover:bg-surface-2 transition-colors',
                selected?.id === r.id ? 'bg-surface-2 border-l-2 border-l-saffron' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-1.5">
                {/* Method */}
                <span className={`text-[9px] font-bold shrink-0 w-10 ${METHOD_COLORS[r.method] ?? 'text-text-dim'}`}>
                  {r.method}
                </span>
                {/* Status */}
                <span className={`text-[9px] font-mono shrink-0 w-8 ${statusColor(r.status)}`}>
                  {r.status ?? '…'}
                </span>
                {/* Domain */}
                <span className="text-[9px] text-muted shrink-0 truncate max-w-[70px]" title={r.url}>
                  {formatDomain(r.url)}
                </span>
                {/* Type chip */}
                <span className="text-[8px] font-mono border border-border/40 text-muted/60 px-1 shrink-0">
                  {r.type.slice(0, 6)}
                </span>
                {/* Time */}
                <span className="text-[8px] text-muted/50 ml-auto shrink-0">
                  {new Date(r.timestamp).toLocaleTimeString('en', { hour12: false })}
                </span>
              </div>
              <p className="text-[8px] text-muted/70 truncate mt-0.5 pl-[4.5rem]">{formatPath(r.url)}</p>
            </button>
          ))
        )}
      </div>

      {/* Detail pane — shown when a request is selected */}
      {selected && (
        <div className="border-t border-border bg-obsidian p-3 shrink-0 max-h-44 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] font-mono font-bold ${METHOD_COLORS[selected.method] ?? 'text-text'}`}>
              {selected.method}
            </span>
            <span className={`text-[10px] font-mono ${statusColor(selected.status)}`}>
              {selected.status ? `HTTP ${selected.status}` : 'Pending'}
            </span>
            <button onClick={() => setSelected(null)} className="text-[9px] text-muted hover:text-saffron">✕</button>
          </div>
          <p className="text-[9px] font-mono text-text break-all leading-relaxed">{selected.url}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-[8px] text-muted font-mono">Type</span>
            <span className="text-[8px] text-text font-mono">{selected.type}</span>
            <span className="text-[8px] text-muted font-mono">Time</span>
            <span className="text-[8px] text-text font-mono">
              {new Date(selected.timestamp).toLocaleTimeString('en', { hour12: false })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
