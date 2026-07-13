import React, { useEffect, useState, useCallback } from 'react'
import type { TransparencyData } from '../../types'

const api = () => window.dhurta

type Status = 'idle' | 'loading' | 'done' | 'error'

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border p-3 space-y-1.5">
      <p className="text-[9px] font-mono text-saffron uppercase tracking-widest">{label}</p>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string | number | null }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[10px] font-mono text-muted">{k}</span>
      <span className="text-[10px] font-mono text-text/80 text-right">{v ?? '—'}</span>
    </div>
  )
}

export default function TransparencyPanel() {
  const [data,    setData]    = useState<TransparencyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [telemetry, setTelemetry] = useState(false)
  const [exportStatus,  setExportStatus]  = useState<Status>('idle')
  const [reportStatus,  setReportStatus]  = useState<Status>('idle')
  const [reportUrl,     setReportUrl]     = useState('')
  const [reportErr,     setReportErr]     = useState('')

  const load = useCallback(async () => {
    if (typeof window.dhurta === 'undefined') return
    setLoading(true)
    try {
      const [d, tel] = await Promise.all([
        api().getTransparencyData(),
        api().getSetting('telemetry_enabled'),
      ])
      setData(d)
      setTelemetry(tel === 'true')
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleExport = async () => {
    setExportStatus('loading')
    try {
      const json = await api().exportMyData()
      const blob = new Blob([json], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `dhurta-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('done')
      setTimeout(() => setExportStatus('idle'), 3000)
    } catch (_) {
      setExportStatus('error')
    }
  }

  const handleReport = async () => {
    setReportStatus('loading')
    setReportErr('')
    setReportUrl('')
    try {
      const r = await api().sendCrashReport()
      if (r.success) {
        setReportStatus('done')
        setReportUrl(r.url ?? '')
      } else {
        setReportStatus('error')
        setReportErr(r.error ?? 'Unknown error')
      }
    } catch (e) {
      setReportStatus('error')
      setReportErr(String(e))
    }
  }

  const toggleTelemetry = async (val: boolean) => {
    setTelemetry(val)
    await api().setSetting('telemetry_enabled', val ? 'true' : 'false')
  }

  const settingKeys = data ? Object.keys(data.settings).filter(k => k !== 'dhurtaApps') : []

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden" style={{ minWidth: 340 }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-saffron">
          <path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8S4.4 14.5 8 14.5 14.5 11.6 14.5 8 11.6 1.5 8 1.5z"/>
          <circle cx="8" cy="8" r="3"/>
          <line x1="8" y1="1.5" x2="8" y2="3"/>
          <line x1="8" y1="13" x2="8" y2="14.5"/>
          <line x1="1.5" y1="8" x2="3" y2="8"/>
          <line x1="13" y1="8" x2="14.5" y2="8"/>
        </svg>
        <p className="text-[11px] font-mono text-saffron uppercase tracking-widest">Transparency Dashboard</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <p className="text-[10px] font-mono text-muted text-center py-8">Loading your data…</p>
        ) : !data ? (
          <p className="text-[10px] font-mono text-red-400 text-center py-8">Could not load data.</p>
        ) : (
          <>
            {/* Storage overview */}
            <Card label="Storage">
              <Row k="Database size" v={`${data.dbSizeKb} KB`} />
              <Row k="Crash logs stored" v={data.crashLogs} />
            </Card>

            {/* History */}
            <Card label="Browsing History">
              <Row k="Entries" v={data.history.count} />
              <Row k="Oldest entry" v={data.history.oldestDate} />
              <Row k="Newest entry" v={data.history.newestDate} />
            </Card>

            {/* Bookmarks */}
            <Card label="Bookmarks">
              <Row k="Saved" v={data.bookmarks.count} />
            </Card>

            {/* Extensions */}
            <Card label="Extensions">
              <Row k="Loaded" v={data.extensions.count} />
              {data.extensions.names.map((n) => (
                <p key={n} className="text-[9px] font-mono text-muted pl-2">· {n}</p>
              ))}
              {data.extensions.count === 0 && (
                <p className="text-[9px] font-mono text-muted">None installed</p>
              )}
            </Card>

            {/* Settings */}
            {settingKeys.length > 0 && (
              <Card label="Stored Settings">
                {settingKeys.map((k) => (
                  <Row key={k} k={k} v={data.settings[k]} />
                ))}
              </Card>
            )}

            {/* Telemetry toggle */}
            <div className="border border-border p-3 space-y-2">
              <p className="text-[9px] font-mono text-saffron uppercase tracking-widest">Opt-in Telemetry</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-text/80">Send anonymous crash reports</p>
                  <p className="text-[9px] font-mono text-muted mt-0.5">No URLs, no history, no identity — only crash stack traces and Dhurta version.</p>
                </div>
                <button
                  onClick={() => toggleTelemetry(!telemetry)}
                  className={[
                    'w-9 h-5 rounded-full border transition-colors shrink-0 relative',
                    telemetry ? 'bg-saffron border-saffron' : 'bg-transparent border-border',
                  ].join(' ')}
                >
                  <span className={[
                    'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all',
                    telemetry ? 'left-4' : 'left-0.5',
                  ].join(' ')} />
                </button>
              </div>

              {/* Manual send crash report */}
              {data.crashLogs > 0 && (
                <div className="pt-1 border-t border-border/50 space-y-1">
                  <p className="text-[9px] font-mono text-muted">{data.crashLogs} crash log(s) queued.</p>
                  <button
                    onClick={handleReport}
                    disabled={reportStatus === 'loading'}
                    className="w-full text-[9px] font-mono border border-border hover:border-saffron text-muted hover:text-saffron py-1 transition-colors disabled:opacity-50"
                  >
                    {reportStatus === 'loading' ? 'Sending…' :
                     reportStatus === 'done'    ? 'Sent ✓' :
                     reportStatus === 'error'   ? 'Failed — retry' :
                     'Send Crash Report Now'}
                  </button>
                  {reportUrl  && <p className="text-[9px] font-mono text-green-400 break-all">Sent: {reportUrl}</p>}
                  {reportErr  && <p className="text-[9px] font-mono text-red-400 break-all">{reportErr}</p>}
                </div>
              )}
            </div>

            {/* What is NOT stored */}
            <div className="border border-border/40 p-3 space-y-1">
              <p className="text-[9px] font-mono text-saffron uppercase tracking-widest">What Dhurta does NOT store</p>
              {[
                'Your real IP address (Ghost Mode uses Tor)',
                'Passwords or payment data',
                'Device hardware identifiers',
                'Any data on remote servers (everything stays local)',
              ].map((line) => (
                <p key={line} className="text-[9px] font-mono text-muted">✓ {line}</p>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-border p-3 space-y-2 shrink-0">
        <button
          onClick={handleExport}
          disabled={exportStatus === 'loading' || loading}
          className="w-full text-[10px] font-mono border border-border hover:border-saffron text-muted hover:text-saffron py-2 transition-colors disabled:opacity-50"
        >
          {exportStatus === 'loading' ? 'Preparing…' :
           exportStatus === 'done'    ? 'Downloaded ✓' :
           'Export My Data (JSON)'}
        </button>
        <button
          onClick={load}
          className="w-full text-[9px] font-mono text-muted/50 hover:text-muted py-1 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
