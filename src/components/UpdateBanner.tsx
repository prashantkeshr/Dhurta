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
    <div className="flex items-center gap-3 px-4 py-[7px] text-xs border-b border-border bg-surface shrink-0">
      {/* Icon */}
      <span className="text-base shrink-0 text-saffron">
        {isReady ? '🔱' : '⬇'}
      </span>

      {/* Message */}
      <span className="flex-1 text-text">
        {isReady && (
          <>
            <span className="font-semibold text-saffron">
              Dhurta {info?.version} is ready
            </span>
            {' — restart to install the update'}
          </>
        )}
        {state === 'downloading' && (
          <>
            <span className="font-semibold text-saffron">
              Downloading update…
            </span>
            {' '}
            <span className="text-muted">{percent}%</span>
            <span
              className="inline-block ml-2 rounded-full overflow-hidden align-middle"
              style={{ width: 80, height: 4, background: 'var(--color-border)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  background: 'linear-gradient(90deg, #FF4500, #FF6B00)',
                  transition: 'width 0.3s ease',
                }}
              />
            </span>
          </>
        )}
        {state === 'available' && !isReady && (
          <>
            <span className="font-semibold text-saffron">
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
              className="px-3 py-1 text-[11px] font-semibold bg-saffron hover:bg-saffron/90 text-black transition-colors"
            >
              Restart &amp; Update
            </button>
            <button
              onClick={onOpenUpdatePage}
              className="px-2 py-1 text-[11px] text-saffron hover:text-saffron/80 transition-colors"
            >
              Details
            </button>
          </>
        )}
        {!isReady && (
          <button
            onClick={onOpenUpdatePage}
            className="px-2 py-1 text-[11px] text-saffron hover:text-saffron/80 transition-colors"
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
