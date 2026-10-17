import React, { useEffect, useState } from 'react'
import type { HistoryEntry } from '../../types'
import type { ClosedTab } from '../../store/useBrowser'

const api = () => window.dhurta

interface Props {
  onNavigate: (url: string) => void
  closedTabs?: ClosedTab[]
  onReopenTab?: () => void
}

export default function HistoryPanel({ onNavigate, closedTabs = [], onReopenTab }: Props) {
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
        {/* Recently closed tabs — shown only when no search is active */}
        {closedTabs.length > 0 && !query && (
          <div className="border-b border-border">
            <div className="sticky top-0 z-10 px-3 py-1.5 bg-obsidian/90 border-b border-border/50 flex items-center justify-between">
              <span className="text-[9px] font-mono text-saffron uppercase tracking-widest">Recently Closed</span>
              <button
                onClick={onReopenTab}
                title="Reopen last closed tab (Ctrl+Shift+T)"
                className="text-[9px] font-mono text-muted/60 hover:text-saffron transition-colors"
              >↩ reopen</button>
            </div>
            {closedTabs.map((t, i) => (
              <div
                key={i}
                onClick={() => onNavigate(t.url)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer border-b border-border/40"
              >
                {t.favicon ? (
                  <img src={t.favicon} className="w-3 h-3 shrink-0 opacity-60" alt="" />
                ) : (
                  <div className="w-3 h-3 border border-border/40 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text/60 truncate">{t.title}</p>
                  <p className="text-[10px] text-muted/70 font-mono truncate">{formatUrl(t.url)}</p>
                </div>
                <span className="text-[9px] text-muted/30 shrink-0 font-mono">↩</span>
              </div>
            ))}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-12 gap-3 px-4">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="opacity-20">
              <circle cx="18" cy="18" r="15" stroke="currentColor" strokeWidth="1.5" />
              <polyline points="18,10 18,18 24,18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-muted text-[11px] text-center font-mono leading-relaxed">
              {query ? 'No results for that search' : 'Your browsing history will appear here'}
            </p>
          </div>
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
