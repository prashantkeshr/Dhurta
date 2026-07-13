import React, { useEffect, useState, useRef } from 'react'
import type { RequestEntry } from '../../types'

const api = () => window.dhurta

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-400',
  POST: 'text-saffron',
  PUT: 'text-yellow-400',
  DELETE: 'text-red-400',
  PATCH: 'text-purple-400',
  OPTIONS: 'text-muted',
}

interface Props {
  activeTabId: number
}

export default function InterceptorPanel({ activeTabId }: Props) {
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Load existing requests on mount
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    api().getRequests(activeTabId).then(setRequests)
  }, [activeTabId])

  // Live updates
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const handler = (data: { tabId: number; entry: RequestEntry }) => {
      if (data.tabId !== activeTabId || paused) return
      setRequests((prev) => {
        const next = [...prev, data.entry]
        return next.slice(-500)
      })
    }
    api().on('interceptor:request', handler as never)
    return () => api().off('interceptor:request', handler as never)
  }, [activeTabId, paused])

  // Auto-scroll
  useEffect(() => {
    if (!paused && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [requests, paused])

  const visible = filter
    ? requests.filter(
        (r) =>
          r.url.includes(filter) ||
          r.method.includes(filter.toUpperCase()) ||
          r.type.includes(filter)
      )
    : requests

  const clear = () => setRequests([])

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-96">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">API Interceptor</h2>
          <div className="flex gap-1">
            <button
              onClick={() => setPaused((p) => !p)}
              className={`text-[10px] border px-1.5 py-0.5 font-mono transition-colors ${
                paused ? 'border-saffron text-saffron' : 'border-border text-muted hover:border-saffron hover:text-saffron'
              }`}
            >
              {paused ? 'RESUME' : 'PAUSE'}
            </button>
            <button
              onClick={clear}
              className="text-[10px] border border-border text-muted px-1.5 py-0.5 font-mono hover:border-saffron hover:text-saffron transition-colors"
            >
              CLEAR
            </button>
          </div>
        </div>
        <input
          className="w-full bg-obsidian border border-border text-xs text-text px-2 py-1 font-mono placeholder:text-muted"
          placeholder="Filter by URL, method, type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex gap-3 mt-1">
          <span className="text-[10px] text-muted font-mono">{visible.length} requests</span>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto font-mono">
        {visible.length === 0 ? (
          <p className="text-muted text-[10px] text-center mt-8">Waiting for requests...</p>
        ) : (
          visible.map((r) => (
            <div key={r.id} className="px-3 py-1.5 border-b border-border hover:bg-surface-2 cursor-default">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold shrink-0 w-12 ${METHOD_COLORS[r.method] ?? 'text-text-dim'}`}>
                  {r.method}
                </span>
                <span className="text-[10px] text-muted shrink-0 w-16 truncate">{r.type}</span>
                <span className="text-[10px] text-text truncate flex-1">{formatUrl(r.url)}</span>
                <span className="text-[10px] text-muted shrink-0">
                  {new Date(r.timestamp).toLocaleTimeString('en', { hour12: false })}
                </span>
              </div>
              <p className="text-[9px] text-muted truncate mt-0.5 pl-14">{r.url}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatUrl(url: string) {
  try {
    const u = new URL(url)
    return u.hostname + u.pathname.slice(0, 40)
  } catch {
    return url.slice(0, 60)
  }
}
