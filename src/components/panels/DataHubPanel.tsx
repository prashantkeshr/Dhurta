import React, { useEffect, useState } from 'react'
import type { HistoryEntry, Bookmark, Download } from '../../types'

const api = () => window.dhurta

type Tab = 'history' | 'bookmarks' | 'downloads'

interface Props {
  onNavigate: (url: string) => void
}

// ── History tab ──────────────────────────────────────────────────────────────
function HistoryTab({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')

  const load = async (q?: string) => {
    if (typeof window.dhurta === 'undefined') return
    setEntries(await api().getHistory(q || undefined, 300))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setTimeout(() => load(query), 200)
    return () => clearTimeout(t)
  }, [query])

  const del = async (id: number) => {
    await api().deleteHistory(id)
    setEntries(e => e.filter(x => x.id !== id))
  }
  const clearAll = async () => {
    if (!confirm('Clear all browsing history?')) return
    for (const e of entries) await api().deleteHistory(e.id)
    setEntries([])
  }

  const fmt = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <input
          className="flex-1 bg-surface text-text text-[11px] font-mono px-2 py-1 rounded outline-none border border-border focus:border-accent"
          placeholder="Search history…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {entries.length > 0 && (
          <button onClick={clearAll} className="text-[10px] font-mono text-danger hover:text-red-400 px-1.5 py-1 rounded border border-danger/30 hover:border-danger/60 shrink-0">
            Clear All
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="text-muted text-[11px] font-mono text-center mt-10">No history</p>
        )}
        {entries.map(e => (
          <div key={e.id} className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-surface border-b border-border/40">
            {e.favicon
              ? <img src={e.favicon} className="w-3.5 h-3.5 shrink-0 object-contain" onError={ev => { (ev.target as HTMLImageElement).style.display='none' }} />
              : <div className="w-3.5 h-3.5 rounded-full bg-border shrink-0" />
            }
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onNavigate(e.url)}>
              <p className="text-[11px] font-mono text-text truncate">{e.title || e.url}</p>
              <p className="text-[9px] font-mono text-muted truncate">{fmt(e.visited_at)}</p>
            </div>
            <button onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger text-[10px] shrink-0">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Bookmarks tab ────────────────────────────────────────────────────────────
function BookmarksTab({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [query, setQuery] = useState('')

  const load = async () => {
    if (typeof window.dhurta === 'undefined') return
    setBookmarks(await api().getBookmarks())
  }
  useEffect(() => { load() }, [])

  const del = async (id: number) => {
    await api().deleteBookmark(id)
    setBookmarks(b => b.filter(x => x.id !== id))
  }

  const filtered = query
    ? bookmarks.filter(b => b.title.toLowerCase().includes(query.toLowerCase()) || b.url.toLowerCase().includes(query.toLowerCase()))
    : bookmarks

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b border-border">
        <input
          className="w-full bg-surface text-text text-[11px] font-mono px-2 py-1 rounded outline-none border border-border focus:border-accent"
          placeholder="Search bookmarks…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-muted text-[11px] font-mono text-center mt-10">No bookmarks</p>
        )}
        {filtered.map(b => (
          <div key={b.id} className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-surface border-b border-border/40">
            {b.favicon
              ? <img src={b.favicon} className="w-3.5 h-3.5 shrink-0 object-contain" onError={ev => { (ev.target as HTMLImageElement).style.display='none' }} />
              : <div className="w-3.5 h-3.5 rounded-sm bg-accent/30 shrink-0" />
            }
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onNavigate(b.url)}>
              <p className="text-[11px] font-mono text-text truncate">{b.title || b.url}</p>
              <p className="text-[9px] font-mono text-muted truncate">{b.url}</p>
            </div>
            <button onClick={() => del(b.id)} className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger text-[10px] shrink-0">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Downloads tab ────────────────────────────────────────────────────────────
function DownloadsTab() {
  const [downloads, setDownloads] = useState<Download[]>([])

  const load = async () => {
    if (typeof window.dhurta === 'undefined') return
    setDownloads(await api().getDownloads())
  }

  useEffect(() => {
    load()
    const onStart = (d: Download) => setDownloads(prev => [d, ...prev])
    const onUpdate = (d: Download) => setDownloads(prev => prev.map(x => x.id === d.id ? d : x))
    const onDone = (d: Download) => setDownloads(prev => prev.map(x => x.id === d.id ? d : x))
    api().on('download:start', onStart as never)
    api().on('download:update', onUpdate as never)
    api().on('download:done', onDone as never)
    return () => {
      api().off('download:start', onStart as never)
      api().off('download:update', onUpdate as never)
      api().off('download:done', onDone as never)
    }
  }, [])

  const clearDone = async () => {
    const remaining = await api().clearDownloads()
    setDownloads(remaining)
  }

  const fmtBytes = (n: number) => {
    if (!n) return '?'
    if (n < 1024) return n + ' B'
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1048576).toFixed(1) + ' MB'
  }

  const hasDone = downloads.some(d => d.state === 'completed')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] font-mono text-muted">{downloads.length} item{downloads.length !== 1 ? 's' : ''}</span>
        {hasDone && (
          <button onClick={clearDone} className="text-[10px] font-mono text-muted hover:text-accent">Clear done</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 && (
          <p className="text-muted text-[11px] font-mono text-center mt-10">No downloads</p>
        )}
        {downloads.map(d => {
          const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0
          const done = d.state === 'completed'
          return (
            <div key={d.id} className="group px-2 py-2 border-b border-border/40 hover:bg-surface">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[13px]">{done ? '✓' : d.state === 'progressing' ? '⬇' : '✕'}</span>
                <span className="flex-1 text-[11px] font-mono text-text truncate">{d.filename}</span>
                <span className="text-[9px] font-mono text-muted shrink-0">{fmtBytes(d.totalBytes)}</span>
              </div>
              {d.state === 'progressing' && (
                <div className="h-0.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: pct + '%' }} />
                </div>
              )}
              {done && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 mt-1">
                  <button onClick={() => api().openDownloadItem(d.id)} className="text-[9px] font-mono text-accent hover:underline">Open</button>
                  <button onClick={() => api().showDownloadInFolder(d.id)} className="text-[9px] font-mono text-muted hover:text-accent">Show in folder</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── DataHubPanel ─────────────────────────────────────────────────────────────
export default function DataHubPanel({ onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('history')

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'history',   label: 'History',   icon: '⌚' },
    { id: 'bookmarks', label: 'Bookmarks', icon: '★' },
    { id: 'downloads', label: 'Downloads', icon: '⬇' },
  ]

  return (
    <div className="flex flex-col h-full w-full bg-bg font-mono overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-border shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={[
              'flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-t border-b-2 transition-colors',
              activeTab === t.id
                ? 'border-accent text-accent bg-surface'
                : 'border-transparent text-muted hover:text-text',
            ].join(' ')}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'history'   && <HistoryTab   onNavigate={onNavigate} />}
        {activeTab === 'bookmarks' && <BookmarksTab onNavigate={onNavigate} />}
        {activeTab === 'downloads' && <DownloadsTab />}
      </div>
    </div>
  )
}
