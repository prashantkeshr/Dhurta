import React, { useEffect, useState } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface BootstrapProgress {
  percent: number
  tag: string
  summary: string
  elapsedMs: number
  etaMs: number | null
}

interface Props {
  ghostMode: boolean
  torActive: boolean
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}

// Shown for the whole time Ghost Mode is on but Tor hasn't finished bootstrapping
// yet — a one-time cost per session (subsequent Ghost tabs reuse the same Tor
// process once it's up). Deliberately has NO dismiss button: the user explicitly
// wants this to stay visible until bootstrap genuinely completes, since ghost
// tabs are riding the (weaker, single-hop) fast proxy rail the whole time this
// banner is up, and silently letting them forget that would be the wrong default.
export default function GhostBootstrapBanner({ ghostMode, torActive }: Props) {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null)

  const visible = ghostMode && !torActive

  // Fetch a snapshot whenever the banner becomes relevant (covers the case
  // where bootstrap was already in progress before this component re-mounted
  // interest in it — e.g. Ghost Mode was enabled just before a re-render).
  useEffect(() => {
    if (!isElectron || !visible) return
    ;(window as any).dhurta.getTorBootstrapProgress().then(setProgress).catch(() => {})
  }, [visible])

  // Live push updates — always listening, regardless of current visibility, so
  // there's no gap between "Ghost Mode turns on" and "first progress update".
  useEffect(() => {
    if (!isElectron) return
    const onProgress = (p: BootstrapProgress) => setProgress(p)
    ;(window as any).dhurta.on('tor:bootstrapProgress', onProgress)
    return () => (window as any).dhurta.off('tor:bootstrapProgress', onProgress)
  }, [])

  // Reset once Ghost Mode goes off, so the next enable doesn't flash stale numbers.
  useEffect(() => {
    if (!ghostMode) setProgress(null)
  }, [ghostMode])

  if (!visible) return null

  const percent = progress?.percent ?? 0
  const summary = progress?.summary || 'Starting Tor…'
  const etaText = percent >= 100
    ? 'finishing up…'
    : progress?.etaMs != null
      ? `~${fmtDuration(progress.etaMs)} remaining`
      : percent > 0 ? 'estimating time…' : 'just started…'

  return (
    <div
      className="flex items-center gap-3 px-4 py-[7px] text-xs border-b shrink-0"
      style={{
        background: 'linear-gradient(90deg, #1a0d05 0%, #120a04 100%)',
        borderBottom: '1px solid #3a2410',
      }}
    >
      <span className="text-base shrink-0" style={{ color: '#FF4500' }}>🧅</span>

      <span className="flex-1 min-w-0">
        <span className="font-semibold" style={{ color: '#FF4500' }}>
          Connecting to Tor onion routing…
        </span>
        <span className="text-[#a08060]">
          {' '}one-time setup for this session — your Ghost tab is already open and protected by a temporary proxy while this finishes.
        </span>
        <span
          className="inline-block ml-2 rounded-full overflow-hidden align-middle"
          style={{ width: 90, height: 4, background: '#3a2410' }}
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.max(3, percent)}%`,
              background: 'linear-gradient(90deg, #FF4500, #ff8a50)',
              transition: 'width 0.4s ease',
            }}
          />
        </span>
        <span className="ml-2 text-[#ff8a50] font-mono">{percent}%</span>
        <span className="text-[#806050]"> · {etaText}</span>
        {progress?.summary && (
          <span className="text-[#705848] italic"> — {summary}</span>
        )}
      </span>
    </div>
  )
}
