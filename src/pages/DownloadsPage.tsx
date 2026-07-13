import React, { useEffect, useRef, useState } from 'react'
import type { Download } from '../types'

const api = () => window.dhurta

function fmtBytes(b: number) {
  if (!b || b <= 0) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`
}

function fmtDate(ts: number) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return `Today ${d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`
  const yest = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getExt(f: string) { return (f || '').split('.').pop()?.toLowerCase() ?? '' }

function extColor(ext: string) {
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return '#4CAF50'
  if (['mp4','webm','mkv','avi','mov'].includes(ext)) return '#2196F3'
  if (['mp3','wav','ogg','flac','aac'].includes(ext)) return '#9C27B0'
  if (ext === 'pdf') return '#F44336'
  if (['zip','rar','7z','tar','gz','xpi','crx'].includes(ext)) return '#FF9800'
  if (['exe','msi','apk'].includes(ext)) return '#F44336'
  if (['js','ts','py','go','rs','cpp','html','css','json'].includes(ext)) return '#00BCD4'
  return '#FF4500'
}

export default function DownloadsPage() {
  const [downloads, setDownloads]   = useState<Download[]>([])
  const [query, setQuery]           = useState('')
  const [savePath, setSavePath]     = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () =>
    api().getDownloads().then(list => setDownloads(list ?? [])).catch(() => {})

  useEffect(() => {
    refresh()
    api().getDownloadDefaultPath().then(setSavePath).catch(() => {})

    const onStart  = (d: Download) =>
      setDownloads(prev => [d, ...prev.filter(x => x.id !== d.id)].slice(0, 200))
    const onUpdate = (u: Partial<Download> & { id: string }) =>
      setDownloads(prev => prev.map(d => d.id === u.id ? { ...d, ...u } : d))
    const onDone   = (u: Partial<Download> & { id: string; state: string }) =>
      setDownloads(prev => prev.map(d =>
        d.id === u.id
          ? { ...d, ...u, percent: u.state === 'completed' ? 100 : (d.percent ?? 0) }
          : d
      ))

    api().on('download:start',  onStart as never)
    api().on('download:update', onUpdate as never)
    api().on('download:done',   onDone as never)

    return () => {
      api().off('download:start',  onStart as never)
      api().off('download:update', onUpdate as never)
      api().off('download:done',   onDone as never)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  useEffect(() => {
    const hasActive = downloads.some(d => d.state === 'progressing')
    if (hasActive && !pollRef.current) pollRef.current = setInterval(refresh, 600)
    else if (!hasActive && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [downloads])

  const clearDone = async () => {
    const remaining = await api().clearDownloads()
    setDownloads(remaining ?? [])
  }

  const changeSavePath = async () => {
    const chosen = await api().setDownloadDefaultPath()
    if (chosen) setSavePath(chosen)
  }

  const filtered = query
    ? downloads.filter(d => d.filename.toLowerCase().includes(query.toLowerCase()))
    : downloads

  const active    = filtered.filter(d => d.state === 'progressing' || d.state === 'paused')
  const completed = filtered.filter(d => d.state === 'completed')
  const failed    = filtered.filter(d => d.state === 'cancelled' || d.state === 'interrupted')

  const handleRemove = async (id: string) => {
    const remaining = await api().removeDownload(id)
    setDownloads(remaining ?? [])
  }

  const handleDeleteFile = async (id: string) => {
    if (!confirm('Delete the file from disk?')) return
    const remaining = await api().deleteDownloadFile(id)
    setDownloads(remaining ?? [])
  }

  return (
    <div className="flex flex-col h-full bg-obsidian text-text overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-surface/30 px-6 py-3.5 flex items-center gap-5 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <svg width="15" height="17" viewBox="0 0 15 17" fill="none" stroke="#FF4500" strokeWidth="1.4" strokeLinecap="round">
              <line x1="7.5" y1="1" x2="7.5" y2="12" />
              <polyline points="3,8 7.5,13 12,8" />
              <line x1="1" y1="15.5" x2="14" y2="15.5" />
            </svg>
            <h1 className="text-sm font-mono text-text tracking-widest uppercase">Downloads</h1>
          </div>
          <p className="text-[9px] text-muted font-mono mt-0.5 ml-[23px]">
            {active.length > 0 ? `${active.length} active · ` : ''}{downloads.length} total
          </p>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="4" cy="4" r="3" /><line x1="6.5" y1="6.5" x2="9" y2="9" />
            </svg>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search downloads…"
              className="w-full bg-surface border border-border focus:border-saffron pl-7 pr-3 py-1.5 text-[11px] font-mono text-text outline-none transition-colors" />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-saffron text-[10px]">✕</button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {active.some(d => d.state === 'progressing') && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-saffron">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute h-2 w-2 rounded-full bg-saffron opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-saffron" />
              </span>
              Downloading
            </span>
          )}
          {completed.length > 0 && (
            <button onClick={clearDone}
              className="text-[10px] font-mono border border-border text-muted hover:border-saffron hover:text-saffron px-2.5 py-1 transition-colors">
              Clear completed
            </button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {downloads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted">
            <svg width="44" height="48" viewBox="0 0 44 48" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="opacity-20">
              <line x1="22" y1="2" x2="22" y2="32" />
              <polyline points="9,22 22,35 35,22" />
              <line x1="2" y1="44" x2="42" y2="44" />
            </svg>
            <p className="text-xs font-mono">No downloads yet</p>
            <p className="text-[9px] font-mono text-center opacity-60 leading-relaxed">
              Files you download appear here with live progress
            </p>
          </div>
        )}

        {/* Active / Paused */}
        {active.length > 0 && (
          <section className="mb-5">
            <SectionHeader label="Active" count={active.length} />
            <div className="flex flex-col gap-2">
              {active.map(d => (
                <DownloadRow key={d.id} d={d} onRemove={handleRemove} onDeleteFile={handleDeleteFile}
                  onPause={() => api().pauseDownload(d.id)}
                  onResume={() => api().resumeDownload(d.id)}
                  onCancel={() => { api().cancelDownload(d.id); setDownloads(prev => prev.map(x => x.id === d.id ? {...x, state:'cancelled'} : x)) }} />
              ))}
            </div>
          </section>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <section className="mb-5">
            <SectionHeader label="Completed" count={completed.length} />
            <div className="flex flex-col gap-1">
              {completed.map(d => (
                <DownloadRow key={d.id} d={d} onRemove={handleRemove} onDeleteFile={handleDeleteFile} />
              ))}
            </div>
          </section>
        )}

        {/* Failed / Cancelled */}
        {failed.length > 0 && (
          <section>
            <SectionHeader label="Failed" count={failed.length} />
            <div className="flex flex-col gap-1">
              {failed.map(d => (
                <DownloadRow key={d.id} d={d} onRemove={handleRemove} onDeleteFile={handleDeleteFile} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Footer: save path ── */}
      <div className="shrink-0 border-t border-border bg-surface/20 px-6 py-2.5 flex items-center gap-3">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="#555" strokeWidth="1.2" strokeLinecap="round">
          <path d="M1 8.5V3h3L5.5 4.5H11V8.5H1z" />
        </svg>
        <span className="text-[10px] font-mono text-muted">Save location:</span>
        <span className="text-[10px] font-mono text-text/70 flex-1 truncate" title={savePath}>{savePath || '…'}</span>
        <button onClick={changeSavePath}
          className="shrink-0 text-[10px] font-mono border border-border text-muted hover:border-saffron hover:text-saffron px-2.5 py-1 transition-colors">
          Change…
        </button>
      </div>
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <p className="text-[9px] font-mono text-muted/60 uppercase tracking-widest mb-2 pb-1 border-b border-border/30">
      {label} · {count}
    </p>
  )
}

interface RowProps {
  d: Download
  onRemove(id: string): void
  onDeleteFile(id: string): void
  onPause?(): void
  onResume?(): void
  onCancel?(): void
}

function DownloadRow({ d, onRemove, onDeleteFile, onPause, onResume, onCancel }: RowProps) {
  const isActive   = d.state === 'progressing'
  const isPaused   = d.state === 'paused'
  const isDone     = d.state === 'completed'
  const isFailed   = d.state === 'cancelled' || d.state === 'interrupted'
  const isRunning  = isActive || isPaused

  const ext   = getExt(d.filename)
  const color = extColor(ext)
  const pct   = d.percent >= 0 ? d.percent : (d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : null)

  return (
    <div
      onClick={() => isDone && d.savePath && api().openDownloadItem(d.id)}
      className={[
        'group flex items-center gap-4 px-4 py-3 border border-border/30 transition-all',
        isDone  ? 'cursor-pointer hover:border-saffron/30 hover:bg-surface/50' : '',
        isActive ? 'border-saffron/15 bg-surface/15' : '',
        isPaused ? 'border-muted/20 bg-surface/10' : '',
      ].join(' ')}
    >
      {/* File icon */}
      <div className="shrink-0">
        <svg width="28" height="34" viewBox="0 0 28 34">
          <path d="M2 1h16l8 8v24H2z" stroke={isFailed ? '#444' : color} strokeWidth="1.3" fill="none" opacity={isPaused ? 0.5 : 1} />
          <polyline points="18,1 18,9 26,9" stroke={isFailed ? '#444' : color} strokeWidth="1.3" fill="none" opacity={isPaused ? 0.5 : 1} />
          {isActive && <path d="M14 13v8M10 18l4 4 4-4" stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none" />}
          {isPaused && <path d="M10 16h3v8h-3zM15 16h3v8h-3z" fill={color} opacity="0.6" />}
          {isDone   && <path d="M8 20l4 4 8-8" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />}
          {isFailed && <><line x1="9" y1="16" x2="19" y2="26" stroke="#555" strokeWidth="1.4" strokeLinecap="round" /><line x1="19" y1="16" x2="9" y2="26" stroke="#555" strokeWidth="1.4" strokeLinecap="round" /></>}
          {ext && <text x="14" y="32" fontSize="5.5" fill={isFailed ? '#555' : color} fontFamily="monospace" textAnchor="middle" fontWeight="bold" opacity={isPaused ? 0.5 : 1}>{ext.toUpperCase().slice(0,4)}</text>}
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-mono text-text truncate" title={d.filename}>
            {d.filename || 'Unnamed file'}
          </p>
          <span className={[
            'shrink-0 text-[10px] font-mono font-bold',
            isActive ? 'text-saffron' : isPaused ? 'text-muted' : isDone ? 'text-green-400' : 'text-red-400/70',
          ].join(' ')}>
            {isActive && pct !== null && `${pct}%`}
            {isActive && pct === null && '…'}
            {isPaused && 'Paused'}
            {isDone   && '✓'}
            {isFailed && (d.state === 'cancelled' ? 'Cancelled' : 'Failed')}
          </span>
        </div>

        {/* Size / path line */}
        <div className="flex items-center gap-2 mt-0.5">
          {isRunning && (
            <span className="text-[9px] font-mono text-muted">
              {fmtBytes(d.receivedBytes)}{d.totalBytes > 0 ? ` / ${fmtBytes(d.totalBytes)}` : ''}
            </span>
          )}
          {isActive && d.speed && d.speed > 0 && (
            <span className="text-[9px] font-mono text-saffron/80">{fmtBytes(d.speed)}/s</span>
          )}
          {isActive && d.speed && d.speed > 0 && d.totalBytes > 0 && (() => {
            const secs = Math.ceil((d.totalBytes - d.receivedBytes) / d.speed)
            const eta = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.ceil(secs/60)}m` : `${Math.ceil(secs/3600)}h`
            return <span className="text-[9px] font-mono text-muted/60">{eta} left</span>
          })()}
          {isDone && d.savePath && (
            <span className="text-[9px] font-mono text-muted/60 truncate flex-1" title={d.savePath}>
              {d.savePath}
            </span>
          )}
          {(isDone || isFailed) && (
            <span className="text-[9px] font-mono text-muted/40 shrink-0">{fmtDate(d.startTime)}</span>
          )}
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="mt-2 h-1.5 bg-border/50 rounded-full overflow-hidden">
            {pct !== null ? (
              <div className="h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${pct}%`,
                  background: isPaused
                    ? `linear-gradient(90deg, #666, #888)`
                    : `linear-gradient(90deg, ${color}cc, ${color})`,
                  opacity: isPaused ? 0.6 : 1,
                }} />
            ) : (
              <div className="h-full w-1/3 rounded-full"
                style={{ background: `linear-gradient(90deg, ${color}, ${color}88)`, animation: 'dl-slide 1.2s ease-in-out infinite' }} />
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex items-center gap-1">
        {/* Running: pause / resume / cancel */}
        {isActive && onPause && (
          <ActionBtn onClick={e => { e.stopPropagation(); onPause() }} title="Pause">
            <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
              <rect x="0" y="0" width="3.5" height="12" rx="1" />
              <rect x="6.5" y="0" width="3.5" height="12" rx="1" />
            </svg>
          </ActionBtn>
        )}
        {isPaused && onResume && (
          <ActionBtn onClick={e => { e.stopPropagation(); onResume() }} title="Resume" highlight>
            <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
              <path d="M0 0l10 6-10 6z" />
            </svg>
          </ActionBtn>
        )}
        {isRunning && onCancel && (
          <ActionBtn onClick={e => { e.stopPropagation(); onCancel() }} title="Cancel" danger>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8" /><line x1="8" y1="1" x2="1" y2="8" />
            </svg>
          </ActionBtn>
        )}

        {/* Done: open + show-in-folder */}
        {isDone && d.savePath && (
          <>
            <ActionBtn onClick={e => { e.stopPropagation(); api().openDownloadItem(d.id) }} title="Open file" highlight>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M1 10V2h5l2 2v6H1z" /><path d="M7 4h3v7H4" />
              </svg>
            </ActionBtn>
            <ActionBtn onClick={e => { e.stopPropagation(); api().showDownloadInFolder(d.id) }} title="Show in folder">
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                <path d="M1 9.5V3h3.5L6 4.5H12V9.5H1z" />
              </svg>
            </ActionBtn>
          </>
        )}

        {/* Failed: show in folder if path exists */}
        {isFailed && d.savePath && (
          <ActionBtn onClick={e => { e.stopPropagation(); api().showDownloadInFolder(d.id) }} title="Show in folder">
            <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M1 9.5V3h3.5L6 4.5H12V9.5H1z" />
            </svg>
          </ActionBtn>
        )}

        {/* Remove from list / delete file (always available on completed/failed) */}
        {(isDone || isFailed) && (
          <>
            <ActionBtn onClick={e => { e.stopPropagation(); onRemove(d.id) }} title="Remove from list">
              <svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <polyline points="1,2.5 8,2.5" /><rect x="2" y="2.5" width="5" height="7" /><line x1="3.5" y1="0.5" x2="5.5" y2="0.5" />
              </svg>
            </ActionBtn>
            {d.savePath && (
              <ActionBtn onClick={e => { e.stopPropagation(); onDeleteFile(d.id) }} title="Delete file from disk" danger>
                <svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <polyline points="1,2.5 8,2.5" />
                  <path d="M2 2.5V9.5h5V2.5" />
                  <line x1="3.5" y1="0.5" x2="5.5" y2="0.5" />
                  <line x1="3.5" y1="5" x2="3.5" y2="8" />
                  <line x1="5.5" y1="5" x2="5.5" y2="8" />
                </svg>
              </ActionBtn>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ActionBtn({ children, onClick, title, highlight, danger }: {
  children: React.ReactNode
  onClick(e: React.MouseEvent): void
  title: string
  highlight?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'w-6 h-6 flex items-center justify-center border transition-colors shrink-0',
        highlight ? 'border-saffron/60 text-saffron hover:bg-saffron hover:text-black'
          : danger ? 'border-transparent text-muted/50 hover:border-red-500/50 hover:text-red-400'
          : 'border-transparent text-muted/50 hover:border-border hover:text-muted',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
