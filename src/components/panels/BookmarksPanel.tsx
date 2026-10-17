import React, { useEffect, useRef, useState } from 'react'
import type { Bookmark, BookmarkFolder } from '../../types'

const api = () => window.dhurta

interface Props {
  onNavigate: (url: string) => void
  currentUrl: string
  currentTitle: string
}

const ALL_ID = -1
const NONE_ID = 0

export default function BookmarksPanel({ onNavigate, currentUrl, currentTitle }: Props) {
  const [bookmarks, setBookmarks]   = useState<Bookmark[]>([])
  const [folders, setFolders]       = useState<BookmarkFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<number>(ALL_ID)
  const [editingFolder, setEditingFolder]   = useState<number | null>(null)
  const [editName, setEditName]             = useState('')
  const [movingBookmark, setMovingBookmark] = useState<number | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (typeof window.dhurta === 'undefined') return
    const [bms, flds] = await Promise.all([api().getBookmarks(), api().getBookmarkFolders()])
    setBookmarks(bms)
    setFolders(flds)
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener('dhurta:bookmarksChanged', handler)
    return () => window.removeEventListener('dhurta:bookmarksChanged', handler)
  }, [])

  useEffect(() => {
    if (editingFolder !== null) editRef.current?.focus()
  }, [editingFolder])

  const addCurrent = async () => {
    const folderId = selectedFolder > 0 ? selectedFolder : null
    await api().addBookmark({ url: currentUrl, title: currentTitle, folderId })
    load()
  }

  const remove = async (id: number) => {
    await api().deleteBookmark(id)
    load()
  }

  const createFolder = async () => {
    const result = await api().createBookmarkFolder('New Folder')
    await load()
    setSelectedFolder(result.id)
    setEditingFolder(result.id)
    setEditName('New Folder')
  }

  const commitRename = async (id: number) => {
    const name = editName.trim()
    if (name) await api().renameBookmarkFolder(id, name)
    setEditingFolder(null)
    load()
  }

  const deleteFolder = async (id: number) => {
    await api().deleteBookmarkFolder(id)
    if (selectedFolder === id) setSelectedFolder(ALL_ID)
    load()
  }

  const moveToFolder = async (bookmarkId: number, folderId: number | null) => {
    await api().moveBookmarkToFolder(bookmarkId, folderId)
    setMovingBookmark(null)
    load()
  }

  const visibleBookmarks = bookmarks.filter((b) => {
    if (selectedFolder === ALL_ID)  return true
    if (selectedFolder === NONE_ID) return !b.folder_id
    return b.folder_id === selectedFolder
  })

  const countFor = (folderId: number | null) =>
    bookmarks.filter(b => folderId === null ? !b.folder_id : b.folder_id === folderId).length

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-72">
      {/* Header */}
      <div className="p-3 border-b border-border shrink-0">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest mb-2">Bookmarks</h2>
        <div className="flex gap-1.5">
          <button
            onClick={addCurrent}
            className="flex-1 text-xs border border-saffron text-saffron px-2 py-1 hover:bg-saffron hover:text-obsidian transition-colors font-mono"
          >
            + Bookmark Page
          </button>
          <button
            onClick={createFolder}
            title="New folder"
            className="text-xs border border-border text-muted px-2 py-1 hover:border-saffron hover:text-saffron transition-colors font-mono"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M1 2.5h3.5l1 1.5H10a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" />
              <line x1="5.5" y1="5.5" x2="5.5" y2="8.5" />
              <line x1="4" y1="7" x2="7" y2="7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Folder tabs */}
      <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-border bg-obsidian shrink-0">
        <FolderChip
          label={`All (${bookmarks.length})`}
          active={selectedFolder === ALL_ID}
          onClick={() => setSelectedFolder(ALL_ID)}
        />
        <FolderChip
          label={`Unfiled (${countFor(null)})`}
          active={selectedFolder === NONE_ID}
          onClick={() => setSelectedFolder(NONE_ID)}
        />
        {folders.map((f) => (
          <div key={f.id} className="relative group/folder flex items-center">
            {editingFolder === f.id ? (
              <input
                ref={editRef}
                className="h-5 px-1.5 text-[10px] font-mono bg-surface border border-saffron text-text w-24 outline-none"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitRename(f.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(f.id)
                  if (e.key === 'Escape') setEditingFolder(null)
                }}
              />
            ) : (
              <button
                onDoubleClick={() => { setEditingFolder(f.id); setEditName(f.name) }}
                onClick={() => setSelectedFolder(f.id)}
                className={[
                  'h-5 px-1.5 text-[10px] font-mono rounded-sm transition-colors max-w-[90px] truncate',
                  selectedFolder === f.id
                    ? 'bg-saffron text-obsidian'
                    : 'bg-surface text-text-dim hover:bg-surface-2 hover:text-text',
                ].join(' ')}
              >
                {f.name} ({countFor(f.id)})
              </button>
            )}
            <button
              onClick={() => deleteFolder(f.id)}
              title="Delete folder"
              className="hidden group-hover/folder:flex absolute -top-1 -right-1 w-3 h-3 items-center justify-center bg-surface border border-border text-muted hover:text-saffron rounded-full z-10"
            >
              <svg width="5" height="5" viewBox="0 0 6 6" stroke="currentColor" strokeWidth="1.4">
                <line x1="0" y1="0" x2="6" y2="6" /><line x1="6" y1="0" x2="0" y2="6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Bookmark list */}
      <div className="flex-1 overflow-y-auto">
        {visibleBookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-12 gap-3 px-4">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="opacity-20">
              <path d="M8 4h20a2 2 0 012 2v26l-12-7-12 7V6a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <p className="text-muted text-[11px] text-center font-mono leading-relaxed">
              {selectedFolder === ALL_ID
                ? 'Bookmark a page with the + button above'
                : 'No bookmarks in this folder yet'}
            </p>
          </div>
        ) : (
          visibleBookmarks.map((b) => (
            <div
              key={b.id}
              className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer border-b border-border relative"
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

              {/* Move-to-folder button */}
              <button
                onClick={() => setMovingBookmark(movingBookmark === b.id ? null : b.id)}
                title="Move to folder"
                className="shrink-0 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted hover:text-saffron transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
                  <path d="M1 2h3l1 1.5H9a.5.5 0 01.5.5v4a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V2.5A.5.5 0 011 2z" />
                </svg>
              </button>

              {/* Delete button */}
              <button
                onClick={() => remove(b.id)}
                className="shrink-0 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted hover:text-saffron transition-colors"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
                  <line x1="0" y1="0" x2="8" y2="8" /><line x1="8" y1="0" x2="0" y2="8" />
                </svg>
              </button>

              {/* Move-to-folder dropdown */}
              {movingBookmark === b.id && (
                <div
                  className="absolute right-2 top-8 z-20 bg-surface border border-border shadow-lg min-w-[140px] py-1"
                  onMouseLeave={() => setMovingBookmark(null)}
                >
                  <button
                    className="w-full text-left px-3 py-1 text-[11px] font-mono text-text-dim hover:bg-surface-2 hover:text-text"
                    onClick={() => moveToFolder(b.id, null)}
                  >
                    Unfiled
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      className="w-full text-left px-3 py-1 text-[11px] font-mono text-text-dim hover:bg-surface-2 hover:text-text"
                      onClick={() => moveToFolder(b.id, f.id)}
                    >
                      {f.name}
                    </button>
                  ))}
                  {folders.length === 0 && (
                    <p className="px-3 py-1 text-[10px] text-muted font-mono">No folders yet</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function FolderChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-5 px-1.5 text-[10px] font-mono rounded-sm transition-colors shrink-0',
        active ? 'bg-saffron text-obsidian' : 'bg-surface text-text-dim hover:bg-surface-2 hover:text-text',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function formatUrl(url: string) {
  try { return new URL(url).hostname } catch { return url }
}
