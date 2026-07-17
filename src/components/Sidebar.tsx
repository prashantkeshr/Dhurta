import React, { useRef, useEffect } from 'react'
import type { Panel } from '../types'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface Props {
  ghostMode: boolean
  torActive?: boolean
  torConnecting?: boolean
  chakraActive?: boolean
  chakraBusy?: boolean
  chakraWarning?: string | null
  onDismissChakraWarning?: () => void
  activePanel: Panel
  onToggleGhost: () => void
  onToggleChakra?: () => void
  onSetPanel: (p: Panel) => void
  onNuclearWipe: () => void
  onNewTab: () => void
  onNavigate?: (url: string) => void
  onLock?: () => void
  hasLock?: boolean
  onSetupLock?: () => void
}

function Icon({ children, label, active, danger, ghost, onClick }: {
  children: React.ReactNode
  label: string
  active?: boolean
  danger?: boolean
  ghost?: boolean
  onClick: () => void
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={[
        'w-10 h-10 flex items-center justify-center transition-all duration-150',
        active
          ? 'text-saffron'
          : danger
            ? 'nuclear-btn border border-border text-text/60 hover:border-saffron hover:text-saffron'
            : 'text-text/50 hover:text-saffron',
        ghost ? 'ghost-active' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default function Sidebar({
  ghostMode,
  torActive,
  torConnecting,
  chakraActive,
  chakraBusy,
  chakraWarning,
  onDismissChakraWarning,
  activePanel,
  onToggleGhost,
  onToggleChakra,
  onSetPanel,
  onNuclearWipe,
  onNewTab,
  onNavigate,
  onLock,
  hasLock,
  onSetupLock,
}: Props) {
  const toggle = (p: Panel) => onSetPanel(activePanel === p ? null : p)
  const appsRef = useRef<HTMLButtonElement>(null)
  const toolsRef = useRef<HTMLButtonElement>(null)

  // Auto-dismiss Chakra warning after 5 seconds
  useEffect(() => {
    if (!chakraWarning) return
    const t = setTimeout(() => onDismissChakraWarning?.(), 5000)
    return () => clearTimeout(t)
  }, [chakraWarning, onDismissChakraWarning])

  const handleSidebarAppsClick = async () => {
    if (!isElectron || !appsRef.current) return
    const rect = appsRef.current.getBoundingClientRect()
    const [winX, winY] = await window.dhurta.getWindowPos()
    await window.dhurta.showAppsPopup({
      x: Math.round(winX + rect.right + 4),
      y: Math.round(winY + rect.top),
    })
  }

  const handleToolsClick = async () => {
    if (!isElectron || !toolsRef.current) return
    const rect = toolsRef.current.getBoundingClientRect()
    const [winX, winY] = await window.dhurta.getWindowPos()
    await (window as any).dhurta.showToolsPopup({
      x: Math.round(winX + rect.right + 4),
      y: Math.round(winY + rect.top),
    })
  }

  return (
    <aside className="glass border-r border-border flex flex-col items-center py-2 w-16 shrink-0 z-50">
      {/* Trishula logo / Ghost toggle */}
      <button
        title={ghostMode
          ? (torActive
              ? 'Ghost Mode ON — Tor active ✓\nIn-memory · Fingerprint spoofed · WebRTC blocked · Traffic via Tor'
              : 'Ghost Mode ON — securing via proxy, upgrading to Tor…\nIn-memory · Fingerprint spoofed · WebRTC blocked')
          : 'Enable Ghost Mode\nIn-memory session · Fingerprint spoofing · WebRTC blocked · Real Tor routing'}
        onClick={onToggleGhost}
        className="w-10 h-10 flex items-center justify-center mb-1 transition-all duration-300 shrink-0 relative disabled:opacity-60"
        style={ghostMode ? {
          borderRadius: '50%',
          boxShadow: '0 0 12px 4px #FF003388, 0 0 28px 8px #FF003344, inset 0 0 10px 2px #FF003322',
          background: 'radial-gradient(circle, #FF003318 0%, transparent 70%)',
        } : {}}
      >
        <img
          src="./dhurta-logo.png"
          alt="Dhurta"
          draggable={false}
          className="w-9 h-9 object-contain transition-all duration-300"
          style={ghostMode
            ? { filter: 'drop-shadow(0 0 8px #FF0033cc) drop-shadow(0 0 20px #FF003388)' }
            : { opacity: 0.7, filter: 'drop-shadow(0 0 4px #FFB30066)' }
          }
        />
        {torConnecting && (
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#FF4500] border border-[#0a0a0a] animate-pulse" />
        )}
      </button>

      {/* Chakra — one-click "enable all privacy features" */}
      <button
        title={chakraBusy
          ? 'Activating privacy shield…'
          : chakraActive
            ? 'Chakra Shield ON — click to disable\nVPN · Anti-Fingerprint · Block WebRTC · Cookie Guard · Ad Blocker · Auto-Clean'
            : 'Enable Chakra Shield\nRequires VPN + Anti-Fingerprint + WebRTC Block'}
        onClick={onToggleChakra}
        disabled={chakraBusy}
        className="w-10 h-10 flex items-center justify-center transition-all duration-300 shrink-0 disabled:opacity-50"
      >
        <img
          src="./chakra-icon.png"
          alt="Chakra"
          draggable={false}
          className={['w-8 h-8 object-contain', chakraActive ? 'chakra-active' : 'chakra-idle'].join(' ')}
        />
      </button>

      {/* Chakra warning — shown when VPN fails to connect */}
      {chakraWarning && (
        <div className="relative w-full px-1 mb-1">
          <div className="bg-[#1a0800] border border-[#FF4500]/60 rounded px-2 py-1.5 text-[7px] font-mono text-[#FF4500] leading-tight">
            <p className="font-bold mb-0.5">⚠ Security Risk</p>
            <p>{chakraWarning}</p>
            <button
              onClick={onDismissChakraWarning}
              className="mt-1 text-[#FF4500]/60 hover:text-[#FF4500] transition-colors"
            >✕ dismiss</button>
          </div>
        </div>
      )}

      <div className="w-6 h-px bg-border mb-2" />

      {/* Apps Grid — opens a native popup window like the download popup */}
      <button
        ref={appsRef}
        title="Dhurta Apps"
        onClick={handleSidebarAppsClick}
        className="w-10 h-10 flex items-center justify-center transition-all duration-150 text-text/50 hover:text-saffron"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="2.5" cy="2.5" r="1.4" /><circle cx="7" cy="2.5" r="1.4" /><circle cx="11.5" cy="2.5" r="1.4" />
          <circle cx="2.5" cy="7"   r="1.4" /><circle cx="7" cy="7"   r="1.4" /><circle cx="11.5" cy="7"   r="1.4" />
          <circle cx="2.5" cy="11.5" r="1.4" /><circle cx="7" cy="11.5" r="1.4" /><circle cx="11.5" cy="11.5" r="1.4" />
        </svg>
      </button>

      {/* Tools — Dhurta ecosystem tools popup */}
      <button
        ref={toolsRef}
        title="Dhurta Tools — Setu, Connect, Developer, Omni, Bridge"
        onClick={handleToolsClick}
        className="w-10 h-10 flex items-center justify-center transition-all duration-150 text-text/50 hover:text-saffron"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 2.5a3 3 0 0 0-3.3 4.8L3 11.5l1.5 1.5 4.2-4.2a3 3 0 0 0 4.8-3.3L11.5 7.5 10 6l2-2z" />
        </svg>
      </button>

      {/* New Tab */}
      <Icon label="New Tab (Ctrl+T)" onClick={onNewTab}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="12" height="12" />
          <line x1="8" y1="5" x2="8" y2="11" />
          <line x1="5" y1="8" x2="11" y2="8" />
        </svg>
      </Icon>

      <div className="w-6 h-px bg-border my-2" />

      {/* ── Your data: history, bookmarks, downloads grouped together ── */}
      <Icon label="My Data (History · Bookmarks · Downloads)" active={activePanel === 'data'} onClick={() => toggle('data')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v4c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
          <path d="M3 8v4c0 1.1 2.24 2 5 2s5-.9 5-2V8" />
        </svg>
      </Icon>

      <Icon label="History" onClick={() => onNavigate?.('dhurta://history')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="5.5" />
          <polyline points="8,4.5 8,8 10.5,10" />
          <path d="M2.5 8 A5.5 5.5 0 0 1 8 2.5" strokeLinecap="square" />
          <polyline points="2.5,5.5 2.5,8 5,8" />
        </svg>
      </Icon>

      <Icon label="Bookmarks" onClick={() => onNavigate?.('dhurta://bookmarks')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 2h10v12l-5-3-5 3V2z" />
        </svg>
      </Icon>

      <Icon label="Downloads" onClick={() => onNavigate?.('dhurta://downloads')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <line x1="8" y1="2" x2="8" y2="10" />
          <polyline points="5,7 8,10 11,7" />
          <line x1="2" y1="13" x2="14" y2="13" />
        </svg>
      </Icon>

      <div className="w-6 h-px bg-border my-2" />

      {/* ── Privacy control surfaces: Omni dashboard leads, Security + Transparency support it ── */}
      <Icon label="Dhurta Omni — Privacy Dashboard" onClick={() => onNavigate?.('dhurta://omni')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1.5L2.5 4v3.8c0 3.2 2.4 5.9 5.5 6.7 3.1-.8 5.5-3.5 5.5-6.7V4L8 1.5z" />
          <circle cx="8" cy="7.6" r="1.8" fill="currentColor" stroke="none" />
        </svg>
      </Icon>

      <Icon label="Security Shield" active={activePanel === 'security'} onClick={() => toggle('security')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1.5L2 4v4c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V4L8 1.5z" />
          <polyline points="5.5,8 7,10 11,6" />
        </svg>
      </Icon>

      <Icon label="Transparency Dashboard" active={activePanel === 'transparency'} onClick={() => toggle('transparency')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 3C4.5 3 1.5 8 1.5 8S4.5 13 8 13 14.5 8 14.5 8 11.5 3 8 3z"/>
          <circle cx="8" cy="8" r="2.5"/>
        </svg>
      </Icon>

      <div className="w-6 h-px bg-border my-2" />

      {/* ── Power-user / developer tools ── */}
      <Icon label="Network Traffic Monitor" active={activePanel === 'network'} onClick={() => toggle('network')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 11 L4 7 L6.5 9.5 L9.5 4 L12 7 L15 3" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="1" y1="13" x2="15" y2="13" strokeLinecap="square" />
        </svg>
      </Icon>

      <Icon label="API Interceptor" active={activePanel === 'interceptor'} onClick={() => toggle('interceptor')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="4" width="6" height="3" />
          <rect x="9" y="9" width="6" height="3" />
          <line x1="7" y1="5.5" x2="9" y2="5.5" />
          <line x1="9" y1="5.5" x2="9" y2="10.5" />
        </svg>
      </Icon>

      <Icon label="Extensions" active={activePanel === 'extensions'} onClick={() => toggle('extensions')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <rect x="1" y="5" width="8" height="8" />
          <path d="M9 9h3l3 3v-7h-6" />
          <circle cx="5" cy="9" r="2" />
        </svg>
      </Icon>

      <div className="w-6 h-px bg-border my-2" />

      {/* Settings */}
      <Icon label="Settings" active={activePanel === 'settings'} onClick={() => toggle('settings')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" strokeLinecap="square" />
        </svg>
      </Icon>

      <div className="flex-1" />

      {/* Lock browser */}
      <button
        title={hasLock ? 'Lock Browser' : 'Set up Browser Lock (PIN)'}
        onClick={hasLock ? onLock : onSetupLock}
        className="w-10 h-10 flex items-center justify-center text-text/40 hover:text-saffron transition-colors mb-1"
      >
        <svg width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <rect x="2" y="7" width="10" height="8" />
          <path d="M4 7V5a3 3 0 0 1 6 0v2" />
          <circle cx="7" cy="11" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {/* Nuclear Wipe */}
      <button
        title="Nuclear Wipe — Destroy all data and quit"
        onClick={onNuclearWipe}
        className="nuclear-btn w-10 h-10 flex items-center justify-center border border-border text-text/40 hover:border-saffron hover:text-saffron transition-all duration-200 mb-1"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="9" cy="9" r="7" />
          <line x1="9" y1="2" x2="9" y2="9" />
          <line x1="9" y1="9" x2="14.2" y2="12" />
          <line x1="9" y1="9" x2="3.8" y2="12" />
          <circle cx="9" cy="9" r="2" fill="currentColor" />
        </svg>
      </button>
    </aside>
  )
}

