import React, { useEffect, useState, useCallback } from 'react'
import type { Extension } from '../../types'

const api = () => window.dhurta

function bestIconUrl(ext: Extension): string | null {
  if (ext.icons) {
    const sizes = Object.keys(ext.icons).map(Number).sort((a, b) => b - a)
    if (sizes.length) {
      const raw = ext.icons[String(sizes[0])]
      if (raw && !raw.startsWith('http') && !raw.startsWith('file') && !raw.startsWith('chrome-extension')) {
        return `chrome-extension://${ext.id}/${raw.replace(/^\//, '')}`
      }
      return raw
    }
  }
  if (ext.path) return `file://${ext.path.replace(/\\/g, '/')}/icons/128.png`
  return null
}

export default function ExtensionsPanel() {
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState('')
  const [toast, setToast]           = useState<{ text: string; ok: boolean } | null>(null)

  const refresh = useCallback(async () => {
    if (typeof window.dhurta === 'undefined') return
    try { setExtensions(await api().getExtensions()) } catch (_) {}
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh when an extension is installed from the Web Store injected button
  useEffect(() => {
    if (typeof window.dhurta === 'undefined') return
    const handler = (payload: { id: string; name: string }) => {
      refresh()
      showToast(`Installed: ${payload.name || payload.id}`, true)
    }
    api().on('extension:installed', handler as never)
    return () => api().off('extension:installed', handler as never)
  }, [refresh])

  function showToast(text: string, ok = true) {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const withLoading = async (fn: () => Promise<void>) => {
    setLoading(true); setMsg('')
    try { await fn() } finally { setLoading(false) }
  }

  const handleLoad = () => withLoading(async () => {
    const r = await api().loadExtension()
    if (r.error && r.error !== 'Cancelled') setMsg(`Error: ${r.error}`)
    else if (r.id) { showToast(`Loaded: ${r.name}`); await refresh() }
  })

  const handleLoadCrx = () => withLoading(async () => {
    const r = await api().loadCrxExtension()
    if (r.error && r.error !== 'Cancelled') setMsg(`Error: ${r.error}`)
    else if (r.id) { showToast(`Installed: ${r.name} v${r.version}`); await refresh() }
  })

  const handleInstallBySlug = () => withLoading(async () => {
    const slug = prompt('Enter Firefox add-on slug (e.g. "ublock-origin"):')
    if (!slug) return
    const r = await api().installExtensionFromAMO(slug.trim())
    if (r.error) setMsg(`Error: ${r.error}`)
    else if (r.id) showToast(`Installed: ${r.name}`)
  })

  const handleRemove = async (ext: Extension) => {
    if (!confirm(`Remove "${ext.name || ext.id}"?\nThe extension files will be deleted from disk.`)) return
    const ok = await api().removeExtension(ext.id)
    if (ok) { showToast(`Removed: ${ext.name || ext.id}`); await refresh() }
    else showToast('Remove failed', false)
  }

  // Launch = open the extension popup window above the browser
  const handleLaunch = async (ext: Extension) => {
    const result = await api().openExtensionPopup(ext.id) as any
    if (result?.error) showToast(`Launch failed: ${result.error}`, false)
  }

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-80">

      {/* ── Header ── */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Extensions</h2>
          <div className="flex items-center gap-2">
            {extensions.length > 0 && (
              <span className="text-[10px] font-mono text-muted">{extensions.length} active</span>
            )}
            <button onClick={refresh} title="Refresh list"
              className="text-muted hover:text-saffron transition-colors text-[10px] font-mono">↺</button>
          </div>
        </div>
        <p className="text-[10px] text-muted font-mono mt-0.5">Chrome + Firefox extensions</p>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={[
          'mx-3 mt-2 px-3 py-2 border text-[10px] font-mono animate-fade-in',
          toast.ok
            ? 'bg-green-900/30 border-green-700/50 text-green-300'
            : 'bg-red-900/30 border-red-700/50 text-red-300',
        ].join(' ')}>
          {toast.text}
        </div>
      )}

      {/* ── Installed extensions ── */}
      <div className="flex-1 overflow-y-auto">
        {extensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted p-6">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" className="opacity-25">
              <rect x="2" y="10" width="22" height="22" /><path d="M24 16h8l6 6v10H24" /><circle cx="13" cy="21" r="4" />
            </svg>
            <p className="text-xs font-mono text-center">No extensions installed</p>
            <p className="text-[9px] text-muted/70 font-mono text-center leading-relaxed">
              Install an extension below — it will be remembered across browser restarts
            </p>
          </div>
        ) : (
          extensions.map(ext => (
            <ExtensionCard
              key={ext.id}
              ext={ext}
              onLaunch={() => handleLaunch(ext)}
              onRemove={() => handleRemove(ext)}
            />
          ))
        )}
      </div>

      {/* ── Install section ── */}
      <div className="border-t border-border p-3 space-y-2.5">
        <p className="text-[9px] text-muted/70 font-mono uppercase tracking-wider">Install Extensions</p>

        {/* Firefox AMO — primary */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('dhurta:navigate', { detail: 'https://addons.mozilla.org/en-US/firefox/' }))}
          className="w-full text-[11px] font-mono text-saffron border border-saffron hover:bg-saffron hover:text-black py-2 transition-colors font-semibold"
        >
          🦊  Firefox Add-ons (AMO)
        </button>
        <button onClick={handleInstallBySlug} disabled={loading}
          className="w-full text-[10px] font-mono text-text/80 border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors disabled:opacity-50">
          {loading ? '…installing' : '⬇  Install by slug / name'}
        </button>

        {/* Chrome Web Store */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('dhurta:navigate', { detail: 'https://chromewebstore.google.com' }))}
          className="w-full text-[10px] font-mono text-text/80 border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors">
          🌐  Chrome Web Store
        </button>

        {/* Manual install */}
        <div className="flex gap-2">
          <button onClick={handleLoad} disabled={loading}
            className="flex-1 text-[10px] font-mono text-muted border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors disabled:opacity-50">
            📁 Unpacked
          </button>
          <button onClick={handleLoadCrx} disabled={loading}
            className="flex-1 text-[10px] font-mono text-muted border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors disabled:opacity-50">
            📦 .crx File
          </button>
        </div>

        {msg && (
          <p className={['text-[10px] font-mono leading-relaxed', msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'].join(' ')}>
            {msg}
          </p>
        )}

        <p className="text-[9px] text-muted/50 font-mono leading-relaxed">
          Content-script extensions run automatically on every page. Ghost tabs are isolated — extensions don't run inside them.
        </p>
      </div>
    </div>
  )
}

// ── Extension card ────────────────────────────────────────────────────────────
function ExtensionCard({ ext, onLaunch, onRemove }: {
  ext: Extension
  onLaunch(): void
  onRemove(): void
}) {
  const [iconFailed, setIconFailed] = useState(false)
  const icon     = bestIconUrl(ext)
  const hasPage  = !!ext.popupPage || !!ext.optionsPage
  const isContentOnly = !hasPage && !ext.popupPage

  return (
    <div className="border-b border-border/40 hover:bg-obsidian/40 transition-colors">

      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Icon */}
        <div className="w-9 h-9 flex items-center justify-center border border-border bg-obsidian shrink-0 overflow-hidden">
          {icon && !iconFailed
            ? <img src={icon} alt="" className="w-7 h-7 object-contain" onError={() => setIconFailed(true)} />
            : <span className="text-lg">🧩</span>
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <p className="text-[11px] font-mono text-text font-medium truncate">{ext.name || ext.id}</p>
            {ext.version && <span className="text-[9px] font-mono text-muted/60 shrink-0">v{ext.version}</span>}
          </div>
          {ext.description && (
            <p className="text-[9px] text-muted/70 font-mono mt-0.5 line-clamp-1 leading-relaxed">
              {ext.description}
            </p>
          )}
          {/* Status badge */}
          <div className="flex gap-1 mt-1">
            {hasPage ? (
              <span className="text-[8px] font-mono border border-saffron/50 text-saffron px-1.5 py-px">POPUP</span>
            ) : (
              <span className="text-[8px] font-mono border border-green-700/50 text-green-400/80 px-1.5 py-px">● RUNNING</span>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex gap-0 border-t border-border/20">
        {/* Launch — always shown; dimmed when extension is content-script only with no UI page */}
        <button
          onClick={onLaunch}
          title={isContentOnly ? 'No popup page — will try to open extension UI' : 'Open extension'}
          className={[
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono border-r border-border/30 transition-colors',
            hasPage
              ? 'text-saffron bg-saffron/5 hover:bg-saffron hover:text-black'
              : 'text-muted/60 hover:text-saffron hover:bg-saffron/5',
          ].join(' ')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1l7 4-7 4V1z" />
          </svg>
          {hasPage ? 'Launch' : 'Open'}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          title="Remove extension"
          className="w-8 flex items-center justify-center py-2 text-muted/50 hover:text-red-400 hover:bg-red-900/10 transition-colors"
        >
          <svg width="10" height="11" viewBox="0 0 10 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <polyline points="1,2.5 9,2.5" />
            <path d="M2.5 2.5V9.5h5V2.5" />
            <line x1="4" y1="0.5" x2="6" y2="0.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
