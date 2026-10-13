import React, { useEffect, useState } from 'react'
import type { HistoryEntry } from '../../types'

const api = () => window.dhurta

interface Props {
  onNavigate: (url: string) => void
}

export default function HistoryPanel({ onNavigate }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [incinerateDays, setIncinerateDays] = useState(30)

  const load = async (q?: string) => {
    if (typeof window.dhurta === 'undefined') return
    setEntries(await api().getHistory(q || undefined, 200))
  }

  useEffect(() => {
    load()
    api().getSetting('incinerateDays').then((v) => setIncinerateDays(Number(v ?? 30)))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(query), 200)
    return () => clearTimeout(t)
  }, [query])

  const deleteEntry = async (id: number) => {
    await api().deleteHistory(id)
    load(query)
  }

  const updateIncinerate = async (days: number) => {
    setIncinerateDays(days)
    await api().setIncinerate(days)
  }

  const grouped = query ? null : groupByDate(entries)

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-72">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest mb-2">History</h2>
        <input
          className="w-full bg-obsidian border border-border text-xs text-text px-2 py-1 font-mono placeholder:text-muted"
          placeholder="Search history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-muted">Auto-incinerate after</span>
          <select
            className="bg-obsidian border border-border text-xs text-text-dim px-1 py-0.5 font-mono"
            value={incinerateDays}
            onChange={(e) => updateIncinerate(Number(e.target.value))}
          >
            <option value={0}>Never</option>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-muted text-xs text-center mt-8 font-mono">No history</p>
        ) : grouped ? (
          // Date-grouped view (no active search)
          grouped.map(({ label, items }) => (
            <div key={label}>
              <div className="sticky top-0 z-10 px-3 py-1 bg-obsidian/90 border-b border-border/50">
                <span className="text-[10px] font-mono text-saffron uppercase tracking-widest">{label}</span>
              </div>
              {items.map((e) => <HistoryRow key={e.id} entry={e} onNavigate={onNavigate} onDelete={deleteEntry} />)}
            </div>
          ))
        ) : (
          // Flat search results
          entries.map((e) => <HistoryRow key={e.id} entry={e} onNavigate={onNavigate} onDelete={deleteEntry} />)
        )}
      </div>
    </div>
  )
}

function HistoryRow({ entry: e, onNavigate, onDelete }: {
  entry: HistoryEntry
  onNavigate: (url: string) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer border-b border-border">
      {e.favicon ? (
        <img src={e.favicon} className="w-3 h-3 shrink-0" alt="" />
      ) : (
        <div className="w-3 h-3 border border-border shrink-0" />
      )}
      <div className="flex-1 min-w-0" onClick={() => onNavigate(e.url)}>
        <p className="text-xs text-text truncate">{e.title || e.url}</p>
        <p className="text-[10px] text-muted font-mono truncate">{formatUrl(e.url)}</p>
      </div>
      <button
        onClick={() => onDelete(e.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-saffron transition-opacity"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="8" y2="8" />
          <line x1="8" y1="0" x2="0" y2="8" />
        </svg>
      </button>
    </div>
  )
}

type Group = { label: string; items: HistoryEntry[] }

function groupByDate(entries: HistoryEntry[]): Group[] {
  const now = Date.now()
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()
  const yesterdayMs = todayMs - 86400000
  const weekMs = todayMs - 6 * 86400000

  const buckets: Record<string, HistoryEntry[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Older: [],
  }

  for (const e of entries) {
    const t = e.visited_at
    if (t >= todayMs) buckets['Today'].push(e)
    else if (t >= yesterdayMs) buckets['Yesterday'].push(e)
    else if (t >= weekMs) buckets['This Week'].push(e)
    else buckets['Older'].push(e)
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}

function formatUrl(url: string) {
  try { return new URL(url).hostname } catch { return url }
}
