import React, { useEffect, useState } from 'react'
import type { Bookmark } from '../types'

interface Props { onNavigate: (url: string) => void }

const api = () => window.dhurta

function getDomain(url: string) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

export default function BookmarksPage({ onNavigate }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [query, setQuery]         = useState('')
  const [editing, setEditing]     = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl]     = useState('')
  const [view, setView]           = useState<'grid' | 'list'>('grid')

  const load = () => api().getBookmarks().then(setBookmarks).catch(() => {})
  useEffect(() => { load() }, [])

  const filtered = query
    ? bookmarks.filter(b =>
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.url.toLowerCase().includes(query.toLowerCase()))
    : bookmarks

  const startEdit = (b: Bookmark, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(b.id)
    setEditTitle(b.title)
    setEditUrl(b.url)
  }

  const saveEdit = async (id: number) => {
    await api().updateBookmark(id, { title: editTitle, url: editUrl }).catch(() => {})
    setBookmarks(prev => prev.map(b => b.id === id ? { ...b, title: editTitle, url: editUrl } : b))
    setEditing(null)
  }

  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api().deleteBookmark(id).catch(() => {})
    setBookmarks(prev => prev.filter(b => b.id !== id))
  }

  return (
    <div className="flex flex-col h-full bg-obsidian text-text overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-surface/30 px-8 py-4 flex items-center gap-5">
        <div>
          <div className="flex items-center gap-2">
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="#FF4500" strokeWidth="1.4" strokeLinecap="round">
              <path d="M1 1h14v16l-7-4-7 4V1z" />
            </svg>
            <h1 className="text-sm font-mono text-text tracking-widest uppercase">Bookmarks</h1>
          </div>
          <p className="text-[9px] text-muted font-mono mt-0.5 ml-6">{bookmarks.length} saved</p>
        </div>

        <div className="flex-1 max-w-lg">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="4.5" cy="4.5" r="3.5" /><line x1="7.5" y1="7.5" x2="10" y2="10" />
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search bookmarks…"
              className="w-full bg-surface border border-border focus:border-saffron pl-7 pr-3 py-1.5 text-[11px] font-mono text-text outline-none transition-colors"
            />
            {query && (
              <button onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-saffron text-xs">✕</button>
            )}
          </div>
        </div>

        {/* View toggle */}
        <div className="flex border border-border shrink-0">
          <button onClick={() => setView('grid')}
            className={['px-2.5 py-1.5 transition-colors', view === 'grid' ? 'bg-saffron text-black' : 'text-muted hover:text-text'].join(' ')}
            title="Grid view">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="0" y="0" width="5" height="5" rx="0.5" />
              <rect x="7" y="0" width="5" height="5" rx="0.5" />
              <rect x="0" y="7" width="5" height="5" rx="0.5" />
              <rect x="7" y="7" width="5" height="5" rx="0.5" />
            </svg>
          </button>
          <button onClick={() => setView('list')}
            className={['px-2.5 py-1.5 border-l border-border transition-colors', view === 'list' ? 'bg-saffron text-black' : 'text-muted hover:text-text'].join(' ')}
            title="List view">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="0" y1="2" x2="12" y2="2" />
              <line x1="0" y1="6" x2="12" y2="6" />
              <line x1="0" y1="10" x2="12" y2="10" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5 max-w-5xl mx-auto w-full">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted">
            <svg width="36" height="40" viewBox="0 0 36 40" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-25">
              <path d="M2 2h32v36l-16-9-16 9V2z" />
            </svg>
            <p className="text-xs font-mono">{query ? 'No bookmarks match' : 'No bookmarks saved yet'}</p>
            <p className="text-[9px] font-mono text-center leading-relaxed opacity-60">
              Click the bookmark icon in the URL bar to save pages
            </p>
          </div>
        )}

        {view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map(b => (
              <BookmarkCard key={b.id} b={b} editing={editing} editTitle={editTitle} editUrl={editUrl}
                onNavigate={onNavigate} onEdit={startEdit} onSave={saveEdit} onDelete={del}
                onEditTitle={setEditTitle} onEditUrl={setEditUrl} onCancel={() => setEditing(null)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-px">
            {filtered.map(b => (
              <BookmarkRow key={b.id} b={b} editing={editing} editTitle={editTitle} editUrl={editUrl}
                onNavigate={onNavigate} onEdit={startEdit} onSave={saveEdit} onDelete={del}
                onEditTitle={setEditTitle} onEditUrl={setEditUrl} onCancel={() => setEditing(null)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface CardProps {
  b: Bookmark
  editing: number | null
  editTitle: string
  editUrl: string
  onNavigate(url: string): void
  onEdit(b: Bookmark, e: React.MouseEvent): void
  onSave(id: number): void
  onDelete(id: number, e: React.MouseEvent): void
  onEditTitle(v: string): void
  onEditUrl(v: string): void
  onCancel(): void
}

function BookmarkCard({ b, editing, editTitle, editUrl, onNavigate, onEdit, onSave, onDelete, onEditTitle, onEditUrl, onCancel }: CardProps) {
  const isEditing = editing === b.id
  return (
    <div onClick={() => !isEditing && onNavigate(b.url)}
      className="group relative bg-surface border border-border hover:border-saffron/50 p-3 cursor-pointer transition-colors flex flex-col gap-2 min-h-[88px]">
      {isEditing ? (
        <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
          <input value={editTitle} onChange={e => onEditTitle(e.target.value)}
            placeholder="Title" className="bg-obsidian border border-saffron text-xs font-mono text-text px-2 py-1 w-full outline-none" />
          <input value={editUrl} onChange={e => onEditUrl(e.target.value)}
            placeholder="URL" className="bg-obsidian border border-border text-[9px] font-mono text-muted px-2 py-1 w-full outline-none" />
          <div className="flex gap-1">
            <button onClick={() => onSave(b.id)} className="flex-1 text-[9px] font-mono bg-saffron text-black py-0.5 hover:bg-orange-400 transition-colors">Save</button>
            <button onClick={onCancel} className="flex-1 text-[9px] font-mono border border-border text-muted py-0.5 hover:text-text transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {b.favicon
              ? <img src={b.favicon} alt="" className="w-5 h-5 shrink-0 object-contain"
                  onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }} />
              : <div className="w-5 h-5 shrink-0 bg-border/30 flex items-center justify-center text-[8px] font-mono text-muted uppercase">
                  {getDomain(b.url)[0] ?? '?'}
                </div>
            }
            <span className="text-[9px] font-mono text-muted/60 truncate">{getDomain(b.url)}</span>
          </div>
          <p className="text-[11px] font-mono text-text leading-tight line-clamp-2 flex-1">{b.title || getDomain(b.url)}</p>
          {/* Hover actions */}
          <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={e => onEdit(b, e)} title="Edit"
              className="w-5 h-5 bg-surface border border-border text-muted hover:text-saffron hover:border-saffron flex items-center justify-center transition-colors">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M5.5 1L7 2.5 2.5 7H1V5.5L5.5 1z" />
              </svg>
            </button>
            <button onClick={e => onDelete(b.id, e)} title="Delete"
              className="w-5 h-5 bg-surface border border-border text-muted hover:text-red-400 hover:border-red-500/50 flex items-center justify-center transition-colors">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function BookmarkRow({ b, editing, editTitle, editUrl, onNavigate, onEdit, onSave, onDelete, onEditTitle, onEditUrl, onCancel }: CardProps) {
  const isEditing = editing === b.id
  return (
    <div onClick={() => !isEditing && onNavigate(b.url)}
      className="group flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-surface/50 transition-colors rounded">
      {b.favicon
        ? <img src={b.favicon} alt="" className="shrink-0 w-4 h-4 object-contain"
            onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }} />
        : <div className="shrink-0 w-4 h-4 bg-border/30 flex items-center justify-center text-[7px] font-mono text-muted uppercase">
            {getDomain(b.url)[0] ?? '?'}
          </div>
      }
      {isEditing ? (
        <div className="flex flex-1 gap-2 items-center" onClick={e => e.stopPropagation()}>
          <input value={editTitle} onChange={e => onEditTitle(e.target.value)} placeholder="Title"
            className="flex-1 bg-surface border border-saffron text-[11px] font-mono text-text px-2 py-0.5 outline-none" />
          <input value={editUrl} onChange={e => onEditUrl(e.target.value)} placeholder="URL"
            className="flex-1 bg-surface border border-border text-[9px] font-mono text-muted px-2 py-0.5 outline-none" />
          <button onClick={() => onSave(b.id)} className="text-[9px] font-mono bg-saffron text-black px-2 py-0.5 hover:bg-orange-400">Save</button>
          <button onClick={onCancel} className="text-[9px] font-mono text-muted hover:text-text">Cancel</button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-text truncate">{b.title || getDomain(b.url)}</p>
            <p className="text-[9px] font-mono text-muted/60 truncate">{b.url}</p>
          </div>
          <span className="shrink-0 text-[9px] font-mono text-muted/40">{getDomain(b.url)}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={e => onEdit(b, e)} title="Edit"
              className="w-5 h-5 text-muted hover:text-saffron flex items-center justify-center transition-colors">
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M6 1L8 3 3 8H1V6L6 1z" />
              </svg>
            </button>
            <button onClick={e => onDelete(b.id, e)} title="Delete"
              className="w-5 h-5 text-muted hover:text-red-400 flex items-center justify-center transition-colors">
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="8" y2="8" /><line x1="8" y1="1" x2="1" y2="8" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
