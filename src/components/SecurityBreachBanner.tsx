import React, { useState, useEffect, useCallback } from 'react'
import type { SecuritySettings } from '../types'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'
const api = () => (window as any).dhurta

interface Threat {
  id: keyof SecuritySettings
  label: string
  detail: string
  risk: string
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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixMsg, setFixMsg] = useState<string | null>(null)

  // Clear dismissed state when a previously-off feature turns ON (threat resolved)
  useEffect(() => {
    setDismissed(prev => {
      const next = new Set(prev)
      if (securityStatus.ipRotation) next.delete('ipRotation')
      if (securityStatus.blockWebRTC) next.delete('blockWebRTC')
      if (securityStatus.antiFingerprint) next.delete('antiFingerprint')
      return next
    })
  }, [securityStatus.ipRotation, securityStatus.blockWebRTC, securityStatus.antiFingerprint])

  const applyFix = useCallback(async (threat: Threat) => {
    if (!isElectron) return
    setFixing(threat.id)
    setFixMsg(null)
    try {
      await threat.fix()
      const updated = await api().getSecuritySettings()
      onStatusChange(updated)
      if (!updated[threat.id]) {
        setFixMsg(`Could not enable ${threat.label} — check settings.`)
      }
    } catch {
      setFixMsg(`Failed to enable ${threat.label}.`)
    } finally {
      setFixing(null)
    }
  }, [onStatusChange])

  // Ghost mode provides its own protection — suppress banner in ghost mode
  if (ghostMode) return null

  const threats: Threat[] = [
    {
      id: 'ipRotation',
      label: 'VPN',
      detail: 'IP address exposed',
      risk: 'Your real IP is visible to every website you visit — trackers, advertisers, and your ISP can log your activity.',
      fixLabel: 'Connect VPN',
      fix: async () => {
        const res = await api().vpnConnect()
        if (res?.success) {
          window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_ipRotation', value: 'true' } }))
        } else {
          throw new Error(res?.error ?? 'VPN connection failed')
        }
      },
    },
    {
      id: 'blockWebRTC',
      label: 'WebRTC Block',
      detail: 'WebRTC leak risk',
      risk: 'WebRTC can bypass VPNs and expose your real IP. Sites using WebRTC APIs see your true network address.',
      fixLabel: 'Block WebRTC',
      fix: async () => {
        await api().setBlockWebRTC(true)
        window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_blockWebRTC', value: 'true' } }))
      },
    },
    {
      id: 'antiFingerprint',
      label: 'Anti-Fingerprint',
      detail: 'Fingerprint exposed',
      risk: 'Your browser fingerprint (screen, fonts, GPU, plugins) uniquely identifies you across sites — even without cookies.',
      fixLabel: 'Enable Anti-FP',
      fix: async () => {
        await api().setAntiFingerprint(true)
        window.dispatchEvent(new CustomEvent('dhurta:settingChanged', { detail: { key: 'security_antiFingerprint', value: 'true' } }))
      },
    },
  ]

  const active = threats.filter(t => !securityStatus[t.id] && !dismissed.has(t.id))
  if (active.length === 0) return null

  return (
    <div className="shrink-0 border-b border-[#FF4500]/30 bg-[#0d0500]">
      {fixMsg && (
        <div className="px-3 py-1 text-[9px] font-mono text-[#FF4500] bg-[#1a0500] border-b border-[#FF4500]/20 flex items-center gap-2">
          <span>⚠</span><span>{fixMsg}</span>
          <button onClick={() => setFixMsg(null)} className="ml-auto text-[#FF4500]/60 hover:text-[#FF4500]">✕</button>
        </div>
      )}
      {active.map((t, i) => (
        <div key={t.id}
          className={`flex items-start gap-2 px-3 py-1.5 ${i < active.length - 1 ? 'border-b border-[#FF4500]/10' : ''}`}>
          {/* Breach icon */}
          <span className="text-[#FF4500] text-[11px] mt-0.5 shrink-0">⚠</span>

          {/* Message */}
          <div className="flex-1 min-w-0">
            <span className="text-[9px] font-mono text-[#FF4500] font-bold uppercase tracking-wider">
              Security Breach — {t.detail}
            </span>
            <span className="text-[9px] font-mono text-[#FF4500]/70 ml-2">{t.risk}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => applyFix(t)}
              disabled={fixing === t.id}
              className="text-[8px] font-mono px-2 py-0.5 bg-[#FF4500] text-black hover:bg-[#FF6020] disabled:opacity-50 disabled:cursor-wait transition-colors"
            >
              {fixing === t.id ? 'Fixing…' : t.fixLabel}
            </button>
            <button
              onClick={() => onOpenSecurity()}
              className="text-[8px] font-mono px-2 py-0.5 border border-[#FF4500]/40 text-[#FF4500]/70 hover:border-[#FF4500] hover:text-[#FF4500] transition-colors"
            >
              Details
            </button>
            <button
              onClick={() => setDismissed(prev => new Set([...prev, t.id]))}
              className="text-[8px] font-mono text-[#FF4500]/40 hover:text-[#FF4500]/70 transition-colors px-1"
              title="Dismiss this warning"
            >✕</button>
          </div>
        </div>
      ))}
    </div>
  )
}
