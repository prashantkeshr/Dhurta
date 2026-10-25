import React, { useEffect, useState } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

// electron-updater's UpdateInfo subset we care about
interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | Array<{ version: string; note: string }> | null
}

interface ProgressInfo {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

type UpdateState = 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'idle'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatSpeed(bps: number) {
  if (bps < 1024) return `${bps} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

function parseNotes(raw: UpdateInfo['releaseNotes']): string {
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.map(r => `**v${r.version}:** ${r.note}`).join('\n\n')
  return ''
}

// Very minimal markdown → HTML: bold, bullets, newlines
function renderNotes(md: string) {
  const html = md
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] /gm, '• ')
    .replace(/\n/g, '<br/>')
  return { __html: html }
}

export default function UpdatePage() {
  const [state, setState] = useState<UpdateState>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [deferred, setDeferred] = useState(false)

  // Current installed version from package.json injected by Vite or from Electron
  const currentVersion: string = (window as any).__DHURTA_VERSION__ ?? 'unknown'

  useEffect(() => {
    if (!isElectron) return
    const api = (window as any).dhurta

    const onChecking  = ()                 => { setState('checking'); setError(null) }
    const onAvailable = (i: UpdateInfo)    => { setInfo(i); setState('available') }
    const onNotAvail  = ()                 => setState('up-to-date')
    const onProgress  = (p: ProgressInfo) => { setProgress(p); setState('downloading') }
    const onDownloaded= (i: UpdateInfo)    => { setInfo(i); setState('ready'); setProgress(null) }
    const onError     = (msg: string)      => { setError(msg); setState('error') }

    api.on('update:checking',    onChecking)
    api.on('update:available',   onAvailable)
    api.on('update:not-available', onNotAvail)
    api.on('update:progress',    onProgress)
    api.on('update:downloaded',  onDownloaded)
    api.on('update:error',       onError)

    return () => {
      api.off('update:checking',    onChecking)
      api.off('update:available',   onAvailable)
      api.off('update:not-available', onNotAvail)
      api.off('update:progress',    onProgress)
      api.off('update:downloaded',  onDownloaded)
      api.off('update:error',       onError)
    }
  }, [])

  const checkNow = () => {
    if (!isElectron) return
    setState('checking')
    setError(null)
    ;(window as any).dhurta.checkForUpdates?.().catch((e: Error) => {
      setState('error')
      setError(e.message)
    })
  }

  const install = () => {
    if (!isElectron) return
    setInstalling(true)
    ;(window as any).dhurta.installUpdate?.()
  }

  const notes = info ? parseNotes(info.releaseNotes) : ''

  return (
    <div className="h-full w-full overflow-auto bg-obsidian text-text font-sans">
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <img src="./dhurta-logo.png" alt="🔱" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              Dhurta Browser
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
              by Dhurta.inc · v{currentVersion}
            </p>
          </div>
        </div>

        {/* Status card */}
        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            padding: '28px 28px 24px',
            marginBottom: 28,
          }}
        >
          {/* ── Up to date ── */}
          {state === 'up-to-date' && (
            <div className="flex items-start gap-4">
              <span style={{ fontSize: 36 }}>✅</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 16, color: '#FF4500' }}>
                  Dhurta is up to date
                </p>
                <p style={{ margin: '6px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
                  You're running the latest version ({currentVersion}).
                </p>
              </div>
            </div>
          )}

          {/* ── Idle ── */}
          {state === 'idle' && (
            <div className="flex items-start gap-4">
              <span style={{ fontSize: 36 }}>🔱</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 16, color: 'var(--color-text)' }}>
                  Check for updates
                </p>
                <p style={{ margin: '6px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
                  Dhurta checks for updates automatically every 4 hours.
                  You can also check manually below.
                </p>
              </div>
            </div>
          )}

          {/* ── Checking ── */}
          {state === 'checking' && (
            <div className="flex items-center gap-4">
              <span style={{ fontSize: 28 }} className="animate-spin inline-block">⟳</span>
              <p style={{ margin: 0, color: '#aaa', fontSize: 14 }}>Checking for updates…</p>
            </div>
          )}

          {/* ── Available (downloading) ── */}
          {state === 'available' && (
            <div className="flex items-start gap-4">
              <span style={{ fontSize: 36 }}>⬇️</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 16, color: '#FF4500' }}>
                  Update available — v{info?.version}
                </p>
                <p style={{ margin: '6px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
                  Downloading in the background…
                </p>
              </div>
            </div>
          )}

          {/* ── Downloading ── */}
          {state === 'downloading' && progress && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span style={{ fontSize: 28 }}>⬇️</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#FF4500' }}>
                    Downloading Dhurta v{info?.version}
                  </p>
                  <p style={{ margin: '3px 0 0', color: 'var(--color-muted)', fontSize: 12 }}>
                    {formatBytes(progress.transferred)} of {formatBytes(progress.total)} · {formatSpeed(progress.bytesPerSecond)}
                  </p>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ background: 'var(--color-border)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress.percent}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #FF4500, #FF6B00)',
                    borderRadius: 6,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <p style={{ margin: '8px 0 0', textAlign: 'right', fontSize: 12, color: 'var(--color-muted)' }}>
                {progress.percent}%
              </p>
            </div>
          )}

          {/* ── Ready to install ── */}
          {state === 'ready' && (
            <div>
              <div className="flex items-start gap-4 mb-6">
                <span style={{ fontSize: 36 }}>🎉</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 17, color: '#FF4500' }}>
                    Dhurta v{info?.version} is ready to install
                  </p>
                  <p style={{ margin: '6px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
                    The update has been downloaded. Restart Dhurta to finish installing.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={install}
                  disabled={installing || deferred}
                  style={{
                    background: (installing || deferred) ? 'rgba(255,69,0,0.15)' : '#FF4500',
                    color: (installing || deferred) ? 'var(--color-muted)' : '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 22px',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: (installing || deferred) ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  {installing ? 'Restarting…' : 'Restart & Install Now'}
                </button>
                {!deferred ? (
                  <button
                    onClick={() => setDeferred(true)}
                    style={{
                      background: 'transparent',
                      color: 'var(--color-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      padding: '10px 18px',
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'border-color 0.2s, color 0.2s',
                    }}
                    title="The update will install automatically the next time you close Dhurta"
                  >
                    Install on next restart
                  </button>
                ) : (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#4ade80',
                    fontSize: 13,
                    padding: '10px 4px',
                  }}>
                    ✓ Queued — installs when you close Dhurta
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {state === 'error' && (
            <div className="flex items-start gap-4">
              <span style={{ fontSize: 32 }}>⚠️</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#f87171' }}>
                  Update check failed
                </p>
                {error && (
                  <p style={{ margin: '6px 0 0', color: 'var(--color-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                    {error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Manual check button */}
        {(state === 'idle' || state === 'up-to-date' || state === 'error') && (
          <button
            onClick={checkNow}
            style={{
              background: 'transparent',
              color: '#FF4500',
              border: '1px solid rgba(255,69,0,0.4)',
              borderRadius: 8,
              padding: '9px 20px',
              fontSize: 13,
              cursor: 'pointer',
              marginBottom: 36,
            }}
          >
            Check for updates now
          </button>
        )}

        {/* Release notes */}
        {notes && (
          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              padding: '22px 24px',
              marginBottom: 28,
            }}
          >
            <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--color-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              What's new in v{info?.version}
            </h3>
            <div
              style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-dim, var(--color-text))' }}
              dangerouslySetInnerHTML={renderNotes(notes)}
            />
          </div>
        )}

        {/* Info footer */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 22 }}>
          <table style={{ fontSize: 12, color: 'var(--color-muted)', borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', width: 160 }}>Current version</td>
                <td style={{ color: 'var(--color-text-dim, var(--color-text))' }}>v{currentVersion}</td>
              </tr>
              {info?.version && info.version !== currentVersion && (
                <tr>
                  <td style={{ padding: '4px 0' }}>Available version</td>
                  <td style={{ color: '#FF4500' }}>v{info.version}</td>
                </tr>
              )}
              {info?.releaseDate && (
                <tr>
                  <td style={{ padding: '4px 0' }}>Release date</td>
                  <td style={{ color: 'var(--color-text-dim, var(--color-text))' }}>
                    {new Date(info.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ padding: '4px 0' }}>Publisher</td>
                <td style={{ color: 'var(--color-text-dim, var(--color-text))' }}>Dhurta.inc</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0' }}>Update source</td>
                <td style={{ color: 'var(--color-text-dim, var(--color-text))' }}>GitHub Releases · prashantkeshr/Dhurta</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0' }}>Auto-update</td>
                <td style={{ color: 'var(--color-text-dim, var(--color-text))' }}>Enabled — checks every 4 hours</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
