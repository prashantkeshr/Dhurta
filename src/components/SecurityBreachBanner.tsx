import React, { useState, useEffect, useCallback } from 'react'
import type { SecuritySettings } from '../types'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'
const api = () => (window as any).dhurta

interface Threat {
  id: keyof SecuritySettings
  short: string
  detail: string
  fixLabel: string
  fix: () => Promise<void>
}

interface Props {
  securityStatus: SecuritySettings
  ghostMode: boolean
  onOpenSecurity: () => void
  onStatusChange: (s: SecuritySettings) => void
}

export default function SecurityBreachBanner({ securityStatus, ghostMode, onOpenSecurity, onStatusChange }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)

  // Re-show banner when a threat reappears after being fixed
  useEffect(() => {
    const hasThreats = !securityStatus.ipRotation || !securityStatus.blockWebRTC || !securityStatus.antiFingerprint
    if (hasThreats) setDismissed(false)
  }, [securityStatus.ipRotation, securityStatus.blockWebRTC, securityStatus.antiFingerprint])

  const threats: Threat[] = [
    {
      id: 'ipRotation',
      short: 'IP exposed',
      detail: 'Your real IP is visible to every website. Enable VPN to mask it.',
      fixLabel: 'Connect VPN',
      fix: async () => {
        const res = await api().vpnConnect()
        if (!res?.success) throw new Error(res?.error ?? 'VPN failed')
        window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_ipRotation', value: 'true' } }))
      },
    },
    {
      id: 'blockWebRTC',
      short: 'WebRTC leak',
      detail: 'WebRTC can bypass VPNs and reveal your real IP to sites.',
      fixLabel: 'Block WebRTC',
      fix: async () => {
        await api().setBlockWebRTC(true)
        window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_blockWebRTC', value: 'true' } }))
      },
    },
    {
      id: 'antiFingerprint',
      short: 'Fingerprint exposed',
      detail: 'Your browser fingerprint identifies you across sites without cookies.',
      fixLabel: 'Enable Anti-FP',
      fix: async () => {
        await api().setAntiFingerprint(true)
        window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_antiFingerprint', value: 'true' } }))
      },
    },
  ]

  const applyFix = useCallback(async (t: Threat) => {
    if (!isElectron) return
    setFixing(t.id)
    try {
      await t.fix()
      const updated = await api().getSecuritySettings()
      onStatusChange(updated)
    } catch {}
    finally { setFixing(null) }
  }, [onStatusChange])

  const fixAll = useCallback(async () => {
    if (!isElectron) return
    setFixing('all')
    try {
      for (const t of active) await t.fix()
      const updated = await api().getSecuritySettings()
      onStatusChange(updated)
    } catch {}
    finally { setFixing(null) }
  }, []) // eslint-disable-line

  if (ghostMode || dismissed) return null

  const active = threats.filter(t => !securityStatus[t.id])
  if (active.length === 0) return null

  return (
    <div className="shrink-0 border-b border-[#FF4500]/25 bg-[#0c0400] animate-[security-slide-down_0.15s_ease-out]">
      {/* ── Collapsed single-line summary ── */}
      <div className="flex items-center gap-2 px-3 h-8">
        {/* Warning dot */}
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF4500] shrink-0 animate-pulse" />

        {/* Threat pills */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
          {active.map(t => (
            <span key={t.id}
              className="text-[9px] font-mono text-[#FF4500]/90 bg-[#FF4500]/10 border border-[#FF4500]/25 px-1.5 py-0.5 rounded-sm shrink-0 whitespace-nowrap"
            >
              {t.short}
            </span>
          ))}
        </div>

        {/* Fix all */}
        <button
          onClick={fixAll}
          disabled={fixing !== null}
          className="text-[9px] font-mono px-2.5 py-0.5 bg-[#FF4500] text-black hover:bg-[#FF5a1a] disabled:opacity-50 transition-all duration-100 active:scale-[0.93] shrink-0"
        >
          {fixing === 'all' ? 'Fixing…' : 'Fix All'}
        </button>

        {/* Expand details */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[#FF4500]/50 hover:text-[#FF4500] transition-colors text-[10px] px-1"
          title={expanded ? 'Collapse' : 'Show details'}
        >
          {expanded ? '▲' : '▼'}
        </button>

        {/* Dismiss */}
        <button
          onClick={() => setDismissed(true)}
          className="text-[#FF4500]/30 hover:text-[#FF4500]/60 transition-colors text-[11px] w-5 flex items-center justify-center"
          title="Dismiss warnings"
        >✕</button>
      </div>

      {/* ── Expanded detail rows ── */}
      {expanded && (
        <div className="border-t border-[#FF4500]/10 animate-[security-slide-down_0.12s_ease-out]">
          {active.map((t, i) => (
            <div key={t.id}
              className={`flex items-center gap-3 px-4 py-1.5 ${i < active.length - 1 ? 'border-b border-[#FF4500]/8' : ''}`}
            >
              <p className="flex-1 text-[10px] font-mono text-[#FF4500]/70 leading-snug">{t.detail}</p>
              <button
                onClick={() => applyFix(t)}
                disabled={fixing !== null}
                className="text-[9px] font-mono px-2 py-0.5 border border-[#FF4500]/40 text-[#FF4500] hover:bg-[#FF4500]/10 disabled:opacity-40 transition-colors shrink-0"
              >
                {fixing === t.id ? '…' : t.fixLabel}
              </button>
              <button
                onClick={onOpenSecurity}
                className="text-[9px] font-mono text-[#FF4500]/40 hover:text-[#FF4500]/70 transition-colors shrink-0"
              >
                details
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
