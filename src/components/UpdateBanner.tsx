import React, { useEffect, useState } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface UpdateInfo {
  version: string
  releaseNotes?: string | null
}

interface Props {
  onOpenUpdatePage: () => void
}

export default function UpdateBanner({ onOpenUpdatePage }: Props) {
  const [state, setState] = useState<'idle' | 'available' | 'downloading' | 'ready'>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [percent, setPercent] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isElectron) return
    const api = (window as any).dhurta

    const onAvailable = (i: UpdateInfo) => {
      setInfo(i)
      setState('available')
      setDismissed(false)
    }
    const onProgress = (p: { percent: number }) => {
      setPercent(p.percent)
      setState('downloading')
    }
    const onDownloaded = (i: UpdateInfo) => {
      setInfo(i)
      setState('ready')
      setDismissed(false)
    }

    api.on('update:available',  onAvailable)
    api.on('update:progress',   onProgress)
    api.on('update:downloaded', onDownloaded)
    return () => {
      api.off('update:available',  onAvailable)
      api.off('update:progress',   onProgress)
      api.off('update:downloaded', onDownloaded)
    }
  }, [])

  if (dismissed || state === 'idle') return null

  const isReady = state === 'ready'

  return (
    <div
      className="flex items-center gap-3 px-4 py-[7px] text-xs border-b border-[#2a2a2a] shrink-0"
      style={{
        background: isReady
          ? 'linear-gradient(90deg, #0d1f0d 0%, #0a1a0a 100%)'
          : 'linear-gradient(90deg, #0d1520 0%, #0a1018 100%)',
        borderBottom: isReady ? '1px solid #1a3a1a' : '1px solid #1a2a3a',
      }}
    >
      {/* Icon */}
      <span className="text-base shrink-0" style={{ color: isReady ? '#4ade80' : '#60a5fa' }}>
        {isReady ? '🔱' : '⬇'}
      </span>

      {/* Message */}
      <span className="flex-1 text-[#ccc]">
        {isReady && (
          <>
            <span className="font-semibold" style={{ color: '#4ade80' }}>
              Dhurta {info?.version} is ready
            </span>
            {' — restart to install the update'}
          </>
        )}
        {state === 'downloading' && (
          <>
            <span className="font-semibold" style={{ color: '#60a5fa' }}>
              Downloading update…
            </span>
            {' '}
            <span className="text-[#888]">{percent}%</span>
            <span
              className="inline-block ml-2 rounded-full overflow-hidden align-middle"
              style={{ width: 80, height: 4, background: '#1a2a3a' }}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                  transition: 'width 0.3s ease',
                }}
              />
            </span>
          </>
        )}
        {state === 'available' && !isReady && (
          <>
            <span className="font-semibold" style={{ color: '#60a5fa' }}>
              Dhurta {info?.version} available
            </span>
            {' — downloading in the background…'}
          </>
        )}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isReady && (
          <>
            <button
              onClick={() => (window as any).dhurta.installUpdate?.()}
              className="px-3 py-1 rounded text-[11px] font-semibold transition-colors"
              style={{ background: '#16a34a', color: '#fff' }}
            >
              Restart &amp; Update
            </button>
            <button
              onClick={onOpenUpdatePage}
              className="px-2 py-1 rounded text-[11px] transition-colors"
              style={{ color: '#60a5fa' }}
            >
              Details
            </button>
          </>
        )}
        {!isReady && (
          <button
            onClick={onOpenUpdatePage}
            className="px-2 py-1 rounded text-[11px] transition-colors"
            style={{ color: '#60a5fa' }}
          >
            Details
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="w-5 h-5 flex items-center justify-center rounded text-[#666] hover:text-[#aaa] transition-colors text-[10px]"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
