import React from 'react'
import type { Bookmark } from '../types'

interface Props {
  bookmarks: Bookmark[]
  onNavigate: (url: string) => void
  onRemove: (id: number) => void
}

export default function BookmarksBar({ bookmarks, onNavigate, onRemove }: Props) {
  return (
    <div className="bookmarks-bar flex items-center h-7 bg-obsidian border-b border-border px-1 gap-0.5 overflow-x-auto shrink-0 no-drag">
      {bookmarks.length === 0 ? (
        <span className="text-[10px] text-muted font-mono px-2 select-none">
          No bookmarks — star a page to add it here
        </span>
      ) : (
        bookmarks.slice(0, 20).map((b) => (
          <BookmarkChip key={b.id} bookmark={b} onNavigate={onNavigate} onRemove={onRemove} />
        ))
      )}
    </div>
  )
}

function BookmarkChip({ bookmark: b, onNavigate, onRemove }: {
  bookmark: Bookmark
  onNavigate: (url: string) => void
  onRemove: (id: number) => void
}) {
  const [hovered, setHovered] = React.useState(false)

  return (
    <div
      className="group relative flex items-center gap-1 h-5 px-1.5 rounded cursor-pointer select-none shrink-0 hover:bg-surface-2 transition-colors max-w-[160px]"
      onClick={() => onNavigate(b.url)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={b.title || b.url}
    >
      {b.favicon ? (
        <img src={b.favicon} className="w-3 h-3 shrink-0" alt="" />
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
          <rect x="1" y="1" width="8" height="8" stroke="#444" strokeWidth="1" />
          <line x1="1" y1="3.5" x2="9" y2="3.5" stroke="#444" strokeWidth="0.8" />
        </svg>
      )}
      <span className="text-[11px] text-text-dim group-hover:text-text truncate leading-none font-sans">
        {b.title || hostname(b.url)}
      </span>
      {hovered && (
        <button
          className="absolute right-0.5 top-0.5 w-3.5 h-3.5 flex items-center justify-center text-muted hover:text-saffron bg-surface rounded-sm transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onRemove(b.id) }}
          title="Remove bookmark"
        >
          <svg width="6" height="6" viewBox="0 0 6 6" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="6" y2="6" />
            <line x1="6" y1="0" x2="0" y2="6" />
          </svg>
        </button>
      )}
    </div>
  )
}

function hostname(url: string) {
  try { return new URL(url).hostname } catch { return url }
}
