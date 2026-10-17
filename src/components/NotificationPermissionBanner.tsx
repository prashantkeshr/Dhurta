import React, { useEffect, useState } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface PermRequest {
  tabId: number
  origin: string
}

interface Props {
  activeTabId: number
}

export default function NotificationPermissionBanner({ activeTabId }: Props) {
  const [request, setRequest] = useState<PermRequest | null>(null)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (!isElectron) return
    const handler = (data: PermRequest) => {
      // Only show for the active tab
      if (data.tabId === activeTabId) setRequest(data)
    }
    window.dhurta.on('permission:notify', handler as never)
    return () => window.dhurta.off('permission:notify', handler as never)
  }, [activeTabId])

  if (!request) return null

  const respond = async (allow: boolean) => {
    if (!isElectron) return
    await window.dhurta.respondPermission(request.tabId, request.origin, allow, remember)
    setRequest(null)
    setRemember(false)
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1a1000] border-b border-[#f8a000]/30 text-[11px] shrink-0">
      {/* Bell icon */}
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#f8a000" strokeWidth="1.3" className="shrink-0">
        <path d="M6.5 1.5a4 4 0 0 1 4 4v2.5l1 1.5H1.5l1-1.5V5.5a4 4 0 0 1 4-4z" />
        <path d="M5.5 11a1 1 0 0 0 2 0" />
      </svg>

      <span className="text-text/80 flex-1 leading-tight truncate">
        <span className="text-[#f8a000] font-medium">{request.origin}</span>
        {' '}wants to send notifications
      </span>

      <label className="flex items-center gap-1 text-muted cursor-pointer shrink-0 select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={e => setRemember(e.target.checked)}
          className="w-3 h-3 accent-[#f8a000]"
        />
        Remember
      </label>

      <button
        onClick={() => respond(false)}
        className="px-2 py-0.5 border border-border text-muted hover:text-text hover:border-border/80 transition-colors shrink-0"
      >
        Block
      </button>
      <button
        onClick={() => respond(true)}
        className="px-2 py-0.5 border border-[#f8a000]/50 text-[#f8a000] hover:bg-[#f8a000]/10 transition-colors shrink-0"
      >
        Allow
      </button>
    </div>
  )
}
