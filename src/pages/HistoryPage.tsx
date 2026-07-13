import React, { useEffect, useRef, useState } from 'react'
import type { HistoryEntry } from '../types'

interface Props { onNavigate: (url: string) => void }

const api = () => window.dhurta

function fmtDate(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yest = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function groupByDate(entries: HistoryEntry[]) {
  const groups = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const label = fmtDate(e.visited_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(e)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

export default function HistoryPage({ onNavigate }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery]     = useState('')
  const [selected, setSelected] = useState(new Set<number>())
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = (q = '') =>
    api().getHistory(q || undefined, 500).then(setEntries).catch(() => {})

  useEffect(() => { load() }, [])

  const handleSearch = (v: string) => {
    setQuery(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(v), 220)
  }

  const deleteEntry = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api().deleteHistory(id).catch(() => {})
    setEntries(prev => prev.filter(x => x.id !== id))
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const deleteSelected = async () => {
    await Promise.all([...selected].map(id => api().deleteHistory(id).catch(() => {})))
    setEntries(prev => prev.filter(x => !selected.has(x.id)))
    setSelected(new Set())
  }

  const toggleSelect = (id: number) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const groups = groupByDate(entries)

  return (
    <div className="flex flex-col h-full bg-obsidian text-text overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-surface/30 px-8 py-4 flex items-center gap-6">
        <div>
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#FF4500" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="9" cy="9" r="7" /><path d="M9 5v4l3 2" />
            </svg>
            <h1 className="text-sm font-mono text-text tracking-widest uppercase">History</h1>
          </div>
          <p className="text-[9px] text-muted font-mono mt-0.5 ml-6">{entries.length} items</p>
        </div>

        <div className="flex-1 max-w-lg">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="4.5" cy="4.5" r="3.5" /><line x1="7.5" y1="7.5" x2="10" y2="10" />
            </svg>
            <input
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search history…"
              className="w-full bg-surface border border-border focus:border-saffron pl-7 pr-3 py-1.5 text-[11px] font-mono text-text outline-none transition-colors"
            />
            {query && (
              <button onClick={() => handleSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-saffron text-xs">✕</button>
            )}
          </div>
        </div>

        {selected.size > 0 && (
          <button onClick={deleteSelected}
            className="text-[11px] font-mono border border-red-500/60 text-red-400 hover:bg-red-500/10 px-3 py-1.5 transition-colors shrink-0">
            Delete {selected.size}
          </button>
        )}
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-25">
              <circle cx="18" cy="18" r="14" /><path d="M18 9v9l5 3" strokeLinecap="round" />
            </svg>
            <p className="text-xs font-mono">{query ? 'No results for "' + query + '"' : 'No browsing history yet'}</p>
          </div>
        )}

        <div className="px-4 md:px-8 py-4 max-w-4xl mx-auto w-full">
          {groups.map(({ label, items }) => (
            <section key={label} className="mb-6">
              <p className="text-[9px] font-mono text-muted/70 uppercase tracking-widest mb-1.5 pb-1 border-b border-border/30">
                {label} · {items.length}
              </p>
              <div className="flex flex-col">
                {items.map(e => (
                  <div key={e.id}
                    onClick={() => onNavigate(e.url)}
                    className="group flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-surface/50 transition-colors rounded">
                    {/* Checkbox */}
                    <button
                      onClick={ev => { ev.stopPropagation(); toggleSelect(e.id) }}
                      className={[
                        'shrink-0 w-3.5 h-3.5 border transition-colors flex items-center justify-center',
                        selected.has(e.id) ? 'bg-saffron border-saffron' : 'border-border group-hover:border-muted',
                      ].join(' ')}>
                      {selected.has(e.id) && (
                        <svg viewBox="0 0 8 8" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" className="w-2 h-2">
                          <path d="M1 4l2 2.5 4-4.5" />
                        </svg>
                      )}
                    </button>

                    {/* Favicon */}
                    <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                      {e.favicon
                        ? <img src={e.favicon} alt="" className="w-4 h-4 object-contain"
                            onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }} />
                        : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#555" strokeWidth="1.2">
                            <circle cx="6" cy="6" r="5" /><line x1="4" y1="6" x2="8" y2="6" /><line x1="6" y1="4" x2="6" y2="8" />
                          </svg>
                      }
                    </div>

                    {/* Title + URL */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-mono text-text leading-tight truncate">{e.title || e.url}</p>
                      <p className="text-[9px] font-mono text-muted/60 truncate">{e.url}</p>
                    </div>

                    <span className="shrink-0 text-[9px] font-mono text-muted/50 tabular-nums">{fmtTime(e.visited_at)}</span>

                    <button
                      onClick={ev => deleteEntry(e.id, ev)}
                      title="Remove from history"
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all w-5 h-5 flex items-center justify-center ml-1">
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="1" y1="1" x2="8" y2="8" /><line x1="8" y1="1" x2="1" y2="8" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
