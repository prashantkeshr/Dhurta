import React, { useEffect, useRef, useState } from 'react'
import type { Download } from '../../types'

const api = () => window.dhurta

function fmtBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function fmtSpeed(bps: number) {
  if (!bps || bps <= 0) return ''
  return `${fmtBytes(bps)}/s`
}

function fmtEta(receivedBytes: number, totalBytes: number, speed: number) {
  if (!speed || speed <= 0 || totalBytes <= 0) return ''
  const remaining = totalBytes - receivedBytes
  if (remaining <= 0) return ''
  const secs = Math.ceil(remaining / speed)
  if (secs < 60)   return `${secs}s left`
  if (secs < 3600) return `${Math.ceil(secs / 60)}m left`
  return `${Math.ceil(secs / 3600)}h left`
}

export default function DownloadsPanel() {
  const [downloads, setDownloads] = useState<Download[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () => {
    if (typeof window.dhurta === 'undefined') return
    api().getDownloads().then(list => setDownloads(list ?? [])).catch(() => {})
  }

  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    refresh()

    const onStart = (d: Download) =>
      setDownloads(prev => [d, ...prev.filter(x => x.id !== d.id)].slice(0, 50))

    const onUpdate = (u: Partial<Download> & { id: string }) =>
      setDownloads(prev => prev.map(d => d.id === u.id ? { ...d, ...u } : d))

    const onDone = (u: Partial<Download> & { id: string; state: string }) =>
      setDownloads(prev => prev.map(d =>
        d.id === u.id
          ? { ...d, ...u, percent: u.state === 'completed' ? 100 : (d.percent ?? 0), speed: 0 }
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const hasActive = downloads.some(d => d.state === 'progressing')
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(refresh, 800)
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [downloads])

  const handleClear = async () => {
    const remaining = await api().clearDownloads()
    setDownloads(remaining ?? [])
  }

  const handleRemove = async (id: string) => {
    const remaining = await api().removeDownload(id)
    setDownloads(remaining ?? [])
  }

  const handleDeleteFile = async (id: string) => {
    if (!confirm('Delete the file from disk?')) return
    const remaining = await api().deleteDownloadFile(id)
    setDownloads(remaining ?? [])
  }

  const handlePause  = (id: string) => api().pauseDownload(id)
  const handleResume = (id: string) => api().resumeDownload(id)
  const handleCancel = (id: string) => {
    api().cancelDownload(id)
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, state: 'cancelled' as const } : d))
  }

  const active    = downloads.filter(d => d.state === 'progressing' || d.state === 'paused')
  const completed = downloads.filter(d => d.state === 'completed')
  const failed    = downloads.filter(d => d.state === 'cancelled' || d.state === 'interrupted')

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-80">

      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Downloads</h2>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {active.length > 0
              ? `${active.length} downloading · ${downloads.length} total`
              : `${downloads.length} item${downloads.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {active.some(d => d.state === 'progressing') && (
            <span className="flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-saffron opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-saffron" />
            </span>
          )}
          {(completed.length > 0 || failed.length > 0) && (
            <button onClick={handleClear}
              className="text-[10px] font-mono text-muted hover:text-saffron border border-border hover:border-saffron px-2 py-1 transition-colors">
              Clear done
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted px-6">
            <DownloadEmptyIcon />
            <p className="text-xs font-mono text-center">No downloads yet</p>
            <p className="text-[10px] font-mono text-muted text-center leading-relaxed">
              Files will auto-save to your Downloads folder and appear here with live progress.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <section className="border-b border-border">
            <p className="text-[9px] font-mono text-muted uppercase tracking-widest px-3 pt-2.5 pb-1 bg-obsidian/40">
              Active
            </p>
            {active.map(d => (
              <DownloadRow key={d.id} d={d}
                onPause={() => handlePause(d.id)}
                onResume={() => handleResume(d.id)}
                onCancel={() => handleCancel(d.id)}
                onRemove={() => handleRemove(d.id)}
                onDeleteFile={() => handleDeleteFile(d.id)}
              />
            ))}
          </section>
        )}

        {completed.length > 0 && (
          <section className="border-b border-border">
            <p className="text-[9px] font-mono text-muted uppercase tracking-widest px-3 pt-2.5 pb-1 bg-obsidian/40">
              Completed
            </p>
            {completed.map(d => (
              <DownloadRow key={d.id} d={d}
                onRemove={() => handleRemove(d.id)}
                onDeleteFile={() => handleDeleteFile(d.id)}
              />
            ))}
          </section>
        )}

        {failed.length > 0 && (
          <section>
            <p className="text-[9px] font-mono text-muted uppercase tracking-widest px-3 pt-2.5 pb-1 bg-obsidian/40">
              Failed / Cancelled
            </p>
            {failed.map(d => (
              <DownloadRow key={d.id} d={d}
                onRemove={() => handleRemove(d.id)}
                onDeleteFile={() => handleDeleteFile(d.id)}
              />
            ))}
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <p className="text-[9px] font-mono text-muted">
          Saved to <span className="text-text">~/Downloads</span> automatically
        </p>
      </div>
    </div>
  )
}

interface RowProps {
  d: Download
  onRemove(): void
  onDeleteFile(): void
  onPause?(): void
  onResume?(): void
  onCancel?(): void
}

function DownloadRow({ d, onRemove, onDeleteFile, onPause, onResume, onCancel }: RowProps) {
  const isActive  = d.state === 'progressing'
  const isPaused  = d.state === 'paused'
  const isDone    = d.state === 'completed'
  const isFailed  = d.state === 'cancelled' || d.state === 'interrupted'
  const isRunning = isActive || isPaused

  const pct = (d.percent != null && d.percent >= 0)
    ? d.percent
    : (d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : null)

  const speed    = isActive ? (d.speed ?? 0) : 0
  const speedStr = fmtSpeed(speed)
  const etaStr   = isActive ? fmtEta(d.receivedBytes, d.totalBytes, speed) : ''

  const openFile   = () => { if (isDone && d.savePath) api().openDownloadItem(d.id) }
  const openFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (d.savePath) api().showDownloadInFolder(d.id)
  }

  return (
    <div
      onClick={openFile}
      className={[
        'group px-3 py-2.5 border-b border-border/50 transition-colors',
        isDone   ? 'hover:bg-obsidian cursor-pointer' : 'hover:bg-obsidian/50',
        isActive ? 'bg-saffron/[0.03]' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <FileTypeIcon filename={d.filename} state={d.state} />

        <div className="flex-1 min-w-0">
          {/* Filename */}
          <p className="text-[11px] font-mono text-text leading-tight truncate" title={d.filename}>
            {d.filename || 'Unnamed file'}
          </p>

          {/* Size line */}
          <div className="flex items-center justify-between mt-0.5 gap-2">
            <span className="text-[9px] font-mono text-muted truncate">
              {isRunning && d.totalBytes > 0 && `${fmtBytes(d.receivedBytes)} / ${fmtBytes(d.totalBytes)}`}
              {isRunning && d.totalBytes <= 0 && `${fmtBytes(d.receivedBytes)} downloaded`}
              {isDone    && (d.totalBytes > 0 ? fmtBytes(d.totalBytes) : 'Done')}
              {isFailed  && (d.state === 'cancelled' ? 'Cancelled' : 'Failed')}
            </span>
            <span className={[
              'text-[10px] font-mono font-bold shrink-0',
              isActive ? 'text-saffron' : isPaused ? 'text-muted' : isDone ? 'text-green-400' : 'text-red-400',
            ].join(' ')}>
              {isActive && pct !== null && `${pct}%`}
              {isActive && pct === null && '…'}
              {isPaused && 'Paused'}
              {isDone   && '✓'}
              {isFailed && '✕'}
            </span>
          </div>

          {/* Speed + ETA */}
          {isActive && (speedStr || etaStr) && (
            <div className="flex items-center gap-2 mt-0.5">
              {speedStr && <span className="text-[9px] font-mono text-saffron/80">{speedStr}</span>}
              {etaStr   && <span className="text-[9px] font-mono text-muted">{etaStr}</span>}
            </div>
          )}

          {/* Progress bar */}
          {isRunning && (
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden bg-border">
              {pct !== null ? (
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: isPaused
                      ? 'linear-gradient(90deg,#666,#888)'
                      : 'linear-gradient(90deg,#FF4500 0%,#FF6A33 100%)',
                    boxShadow: isPaused ? 'none' : '0 0 8px #FF450066',
                  }}
                />
              ) : (
                <div
                  className="h-full w-1/3 rounded-full"
                  style={{
                    background: 'linear-gradient(90deg,#FF4500,#FF6A33)',
                    animation: 'dl-slide 1.2s ease-in-out infinite',
                  }}
                />
              )}
            </div>
          )}

          {/* Completed: save path */}
          {isDone && d.savePath && (
            <p className="text-[9px] font-mono text-muted/70 truncate mt-0.5" title={d.savePath}>
              {d.savePath}
            </p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className={[
        'flex items-center gap-1 mt-2',
        isRunning ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity',
      ].join(' ')}>
        {isActive && onPause && (
          <PanelBtn onClick={e => { e.stopPropagation(); onPause() }} title="Pause" highlight>
            <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor">
              <rect x="0" y="0" width="3" height="10" rx="0.5" />
              <rect x="5" y="0" width="3" height="10" rx="0.5" />
            </svg>
          </PanelBtn>
        )}
        {isPaused && onResume && (
          <PanelBtn onClick={e => { e.stopPropagation(); onResume() }} title="Resume" highlight>
            <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor">
              <path d="M0 0l8 5-8 5z" />
            </svg>
          </PanelBtn>
        )}
        {isRunning && onCancel && (
          <PanelBtn onClick={e => { e.stopPropagation(); onCancel() }} title="Cancel" danger>
            <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="0.5" y1="0.5" x2="6.5" y2="6.5" />
              <line x1="6.5" y1="0.5" x2="0.5" y2="6.5" />
            </svg>
          </PanelBtn>
        )}

        {isDone && d.savePath && (
          <PanelBtn onClick={e => { e.stopPropagation(); api().openDownloadItem(d.id) }} title="Open file" highlight>
            Open
          </PanelBtn>
        )}
        {(isDone || isFailed) && d.savePath && (
          <PanelBtn onClick={openFolder} title="Show in folder">
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M1 8V2.5h2.5L5 4h5V8H1z" />
            </svg>
          </PanelBtn>
        )}
        {(isDone || isFailed) && (
          <PanelBtn onClick={e => { e.stopPropagation(); onRemove() }} title="Remove from list">
            <svg width="7" height="9" viewBox="0 0 7 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <polyline points="0.5,2 6.5,2" /><rect x="1" y="2" width="5" height="6" /><line x1="2.5" y1="0.5" x2="4.5" y2="0.5" />
            </svg>
          </PanelBtn>
        )}
        {(isDone || isFailed) && d.savePath && (
          <PanelBtn onClick={e => { e.stopPropagation(); onDeleteFile() }} title="Delete file from disk" danger>
            <svg width="8" height="9" viewBox="0 0 8 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <polyline points="0.5,2 7.5,2" />
              <path d="M1.5 2v6h5V2" />
              <line x1="2.5" y1="0.5" x2="5.5" y2="0.5" />
              <line x1="3" y1="4" x2="3" y2="7" />
              <line x1="5" y1="4" x2="5" y2="7" />
            </svg>
          </PanelBtn>
        )}
      </div>
    </div>
  )
}

function PanelBtn({ children, onClick, title, highlight, danger }: {
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
        'flex items-center justify-center gap-1 px-1.5 py-0.5 text-[9px] font-mono border transition-colors shrink-0',
        highlight ? 'border-saffron/60 text-saffron hover:bg-saffron hover:text-black'
          : danger ? 'border-transparent text-muted/50 hover:border-red-500/50 hover:text-red-400'
          : 'border-transparent text-muted/50 hover:border-border hover:text-muted',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function FileTypeIcon({ filename, state }: { filename: string; state: Download['state'] }) {
  const ext     = (filename || '').split('.').pop()?.toLowerCase() ?? ''
  const isImage = ['png','jpg','jpeg','gif','webp','svg','bmp','ico'].includes(ext)
  const isVideo = ['mp4','webm','mkv','avi','mov','flv','m4v'].includes(ext)
  const isAudio = ['mp3','wav','ogg','flac','aac','m4a','opus'].includes(ext)
  const isPdf   = ext === 'pdf'
  const isZip   = ['zip','rar','7z','tar','gz','xz','xpi','crx','deb','dmg'].includes(ext)
  const isCode  = ['js','ts','py','java','go','rs','cpp','c','html','css','json'].includes(ext)
  const isExe   = ['exe','msi','appimage','apk'].includes(ext)

  const color = state === 'interrupted' || state === 'cancelled' ? '#555'
    : isPdf   ? '#F44336'
    : isImage ? '#4CAF50'
    : isVideo ? '#2196F3'
    : isAudio ? '#9C27B0'
    : isZip   ? '#FF9800'
    : isExe   ? '#F44336'
    : isCode  ? '#00BCD4'
    : '#FF4500'

  const label = ext ? ext.toUpperCase().slice(0, 3) : 'BIN'

  return (
    <div className="shrink-0 mt-0.5 w-8 flex items-start justify-center">
      <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
        <path d="M2 1h13l7 7v19H2z" stroke={color} strokeWidth="1.2" fill="none" />
        <polyline points="15,1 15,8 22,8" stroke={color} strokeWidth="1.2" fill="none" />
        <text
          x="12" y="21"
          fontSize="5.5"
          fill={color}
          fontFamily="monospace"
          textAnchor="middle"
          fontWeight="bold"
        >
          {label}
        </text>
      </svg>
    </div>
  )
}

function DownloadEmptyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-muted/40">
      <rect x="5" y="5" width="30" height="30" rx="2" />
      <line x1="20" y1="12" x2="20" y2="24" />
      <polyline points="14,19 20,25 26,19" />
      <line x1="12" y1="31" x2="28" y2="31" />
    </svg>
  )
}
