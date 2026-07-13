import React, { useEffect, useState } from 'react'
import type { Bookmark } from '../../types'

const api = () => window.dhurta

interface Props {
  onNavigate: (url: string) => void
  currentUrl: string
  currentTitle: string
}

export default function BookmarksPanel({ onNavigate, currentUrl, currentTitle }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  const load = async () => {
    if (typeof window.dhurta === 'undefined') return
    setBookmarks(await api().getBookmarks())
  }

  useEffect(() => { load() }, [])

  const addCurrent = async () => {
    await api().addBookmark({ url: currentUrl, title: currentTitle })
    load()
  }

  const remove = async (id: number) => {
    await api().deleteBookmark(id)
    load()
  }

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-72">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest mb-2">Bookmarks</h2>
        <button
          onClick={addCurrent}
          className="w-full text-xs border border-saffron text-saffron px-2 py-1 hover:bg-saffron hover:text-white transition-colors font-mono"
        >
          + Bookmark Current Page
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {bookmarks.length === 0 ? (
          <p className="text-muted text-xs text-center mt-8 font-mono">No bookmarks</p>
        ) : (
          bookmarks.map((b) => (
            <div
              key={b.id}
              className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer border-b border-border"
            >
              {b.favicon ? (
                <img src={b.favicon} className="w-3 h-3 shrink-0" alt="" />
              ) : (
                <div className="w-3 h-3 border border-border shrink-0" />
              )}
              <div className="flex-1 min-w-0" onClick={() => onNavigate(b.url)}>
                <p className="text-xs text-text truncate">{b.title || b.url}</p>
                <p className="text-[10px] text-muted font-mono truncate">{formatUrl(b.url)}</p>
              </div>
              <button
                onClick={() => remove(b.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-saffron transition-opacity"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
                  <line x1="0" y1="0" x2="8" y2="8" />
                  <line x1="8" y1="0" x2="0" y2="8" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatUrl(url: string) {
  try { return new URL(url).hostname } catch { return url }
}
