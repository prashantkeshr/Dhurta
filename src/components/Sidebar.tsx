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

// ── Tier 1: primary privacy actions (full brightness, larger touch area)
function PrimaryBtn({ children, label, active, onClick }: {
  children: React.ReactNode; label: string; active?: boolean; onClick: () => void
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={[
        'w-10 h-10 flex items-center justify-center transition-all duration-100 active:scale-[0.92]',
        active
          ? 'text-saffron bg-saffron/10 shadow-[inset_2px_0_0_#FF4500]'
          : 'text-text/70 hover:text-saffron hover:bg-white/5',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Tier 2: secondary actions (standard brightness)
function SecBtn({ children, label, active, danger, onClick }: {
  children: React.ReactNode; label: string; active?: boolean; danger?: boolean; onClick: () => void
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={[
        'w-9 h-9 flex items-center justify-center transition-all duration-100 active:scale-[0.92]',
        active  ? 'text-saffron bg-saffron/10 shadow-[inset_2px_0_0_#FF4500]'
        : danger ? 'text-text/35 hover:text-[#FF4500] hover:bg-white/5'
        : 'text-text/40 hover:text-saffron hover:bg-white/5',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Tier 3: utility/peripheral actions (subdued, small)
function UtilBtn({ children, label, active, onClick }: {
  children: React.ReactNode; label: string; active?: boolean; onClick: () => void
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={[
        'w-8 h-8 flex items-center justify-center transition-all duration-100 active:scale-[0.92]',
        active ? 'text-saffron bg-saffron/10 shadow-[inset_2px_0_0_#FF4500]' : 'text-text/30 hover:text-text/70 hover:bg-white/5',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-5 h-px bg-border/50 my-1 mx-auto" />
}

export default function Sidebar({
  ghostMode, torActive, torConnecting, chakraActive, chakraBusy, chakraWarning,
  onDismissChakraWarning, activePanel, onToggleGhost, onToggleChakra, onSetPanel,
  onNuclearWipe, onNewTab, onNavigate, onLock, hasLock, onSetupLock,
}: Props) {
  const toggle = (p: Panel) => onSetPanel(activePanel === p ? null : p)
  const appsRef  = useRef<HTMLButtonElement>(null)
  const toolsRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!chakraWarning) return
    const t = setTimeout(() => onDismissChakraWarning?.(), 5000)
    return () => clearTimeout(t)
  }, [chakraWarning, onDismissChakraWarning])

  const handleAppsClick = async () => {
    if (!isElectron || !appsRef.current) return
    const rect = appsRef.current.getBoundingClientRect()
    const [wx, wy] = await window.dhurta.getWindowPos()
    await window.dhurta.showAppsPopup({ x: Math.round(wx + rect.right + 4), y: Math.round(wy + rect.top) })
  }

  const handleToolsClick = async () => {
    if (!isElectron || !toolsRef.current) return
    const rect = toolsRef.current.getBoundingClientRect()
    const [wx, wy] = await window.dhurta.getWindowPos()
    await (window as any).dhurta.showToolsPopup({ x: Math.round(wx + rect.right + 4), y: Math.round(wy + rect.top) })
  }

  return (
    <aside className="glass border-r border-border flex flex-col items-center py-2 w-14 shrink-0 z-50">

      {/* ━━━ TIER 1 — Identity & Privacy Shield ━━━ */}
      {/* Ghost toggle — primary action, always prominent */}
      <button
        title={ghostMode
          ? (torActive ? 'Ghost ON · Tor active ✓' : 'Ghost ON · upgrading to Tor…')
          : 'Enable Ghost Mode — Tor routing + fingerprint spoofing'}
        onClick={onToggleGhost}
        className="w-10 h-10 flex items-center justify-center mb-0.5 transition-all duration-300 active:scale-[0.92] relative"
        style={ghostMode ? {
          borderRadius: '50%',
          boxShadow: '0 0 14px 5px #FF003344, 0 0 30px 8px #FF003322',
          background: 'radial-gradient(circle, #FF003318 0%, transparent 70%)',
        } : {}}
      >
        <img src="./dhurta-logo.png" alt="Dhurta" draggable={false}
          className="w-9 h-9 object-contain transition-all duration-300"
          style={ghostMode
            ? { filter: 'drop-shadow(0 0 8px #FF0033cc) drop-shadow(0 0 20px #FF003388)' }
            : { opacity: 0.75, filter: 'drop-shadow(0 0 4px #FFB30055)' }} />
        {torConnecting && (
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#FF4500] border border-[#0a0a0a] animate-pulse" />
        )}
      </button>

      {/* Chakra — one-click full shield */}
      <button
        title={chakraBusy ? 'Activating…' : chakraActive ? 'Chakra Shield ON — click to disable' : 'Chakra Shield — enable all privacy features'}
        onClick={onToggleChakra}
        disabled={chakraBusy}
        className="w-10 h-10 flex items-center justify-center transition-all duration-300 active:scale-[0.92] disabled:opacity-50"
      >
        <img src="./chakra-icon.png" alt="Chakra" draggable={false}
          className={['w-8 h-8 object-contain', chakraActive ? 'chakra-active' : 'chakra-idle'].join(' ')} />
      </button>

      {/* Chakra warning toast */}
      {chakraWarning && (
        <div className="relative w-full px-1 mb-1">
          <div className="bg-[#1a0800] border border-[#FF4500]/60 rounded px-2 py-1.5 text-[7px] font-mono text-[#FF4500] leading-tight">
            <p className="font-bold mb-0.5">⚠ Security Risk</p>
            <p>{chakraWarning}</p>
            <button onClick={onDismissChakraWarning} className="mt-1 text-[#FF4500]/60 hover:text-[#FF4500]">✕ dismiss</button>
          </div>
        </div>
      )}

      <Divider />

      {/* ━━━ TIER 2 — Navigation & Page Actions ━━━ */}
      {/* Apps */}
      <button ref={appsRef} title="Dhurta Apps" onClick={handleAppsClick}
        className="w-9 h-9 flex items-center justify-center text-text/45 hover:text-saffron hover:bg-white/5 transition-all duration-100 active:scale-[0.92]">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
          <circle cx="2.5" cy="2.5" r="1.3" /><circle cx="6.5" cy="2.5" r="1.3" /><circle cx="10.5" cy="2.5" r="1.3" />
          <circle cx="2.5" cy="6.5" r="1.3" /><circle cx="6.5" cy="6.5" r="1.3" /><circle cx="10.5" cy="6.5" r="1.3" />
          <circle cx="2.5" cy="10.5" r="1.3" /><circle cx="6.5" cy="10.5" r="1.3" /><circle cx="10.5" cy="10.5" r="1.3" />
        </svg>
      </button>

      {/* Tools */}
      <button ref={toolsRef} title="Dhurta Tools — Setu, Connect, Developer, Omni, Bridge" onClick={handleToolsClick}
        className="w-9 h-9 flex items-center justify-center text-text/45 hover:text-saffron hover:bg-white/5 transition-all duration-100 active:scale-[0.92]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 2.5a3 3 0 0 0-3.3 4.8L3 11.5l1.5 1.5 4.2-4.2a3 3 0 0 0 4.8-3.3L11.5 7.5 10 6l2-2z" />
        </svg>
      </button>

      {/* New Tab */}
      <PrimaryBtn label="New Tab (Ctrl+T)" onClick={onNewTab}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2" width="12" height="12" />
          <line x1="8" y1="5" x2="8" y2="11" /><line x1="5" y1="8" x2="11" y2="8" />
        </svg>
      </PrimaryBtn>

      <Divider />

      {/* ━━━ TIER 2 — Your Data ━━━ */}
      <SecBtn label="My Data Hub" active={activePanel === 'data'} onClick={() => toggle('data')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v4c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
          <path d="M3 8v4c0 1.1 2.24 2 5 2s5-.9 5-2V8" />
        </svg>
      </SecBtn>

      <SecBtn label="History (Ctrl+H)" onClick={() => onNavigate?.('dhurta://history')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="5.5" />
          <polyline points="8,4.5 8,8 10.5,10" />
          <path d="M2.5 8 A5.5 5.5 0 0 1 8 2.5" strokeLinecap="square" />
          <polyline points="2.5,5.5 2.5,8 5,8" />
        </svg>
      </SecBtn>

      <SecBtn label="Bookmarks (Ctrl+B)" onClick={() => onNavigate?.('dhurta://bookmarks')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 2h10v12l-5-3-5 3V2z" />
        </svg>
      </SecBtn>

      <SecBtn label="Downloads" onClick={() => onNavigate?.('dhurta://downloads')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
          <line x1="8" y1="2" x2="8" y2="10" />
          <polyline points="5,7 8,10 11,7" />
          <line x1="2" y1="13" x2="14" y2="13" />
        </svg>
      </SecBtn>

      <Divider />

      {/* ━━━ TIER 1 — Privacy (highlighted) ━━━ */}
      <PrimaryBtn label="Dhurta Omni — Privacy Dashboard" active={false} onClick={() => onNavigate?.('dhurta://omni')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 1.5L2.5 4v3.8c0 3.2 2.4 5.9 5.5 6.7 3.1-.8 5.5-3.5 5.5-6.7V4L8 1.5z" />
          <circle cx="8" cy="7.6" r="1.8" fill="currentColor" stroke="none" />
        </svg>
      </PrimaryBtn>

      <PrimaryBtn label="Security Shield" active={activePanel === 'security'} onClick={() => toggle('security')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 1.5L2 4v4c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V4L8 1.5z" />
          <polyline points="5.5,8 7,10 11,6" />
        </svg>
      </PrimaryBtn>

      <SecBtn label="Transparency Dashboard" active={activePanel === 'transparency'} onClick={() => toggle('transparency')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 3C4.5 3 1.5 8 1.5 8S4.5 13 8 13 14.5 8 14.5 8 11.5 3 8 3z"/>
          <circle cx="8" cy="8" r="2.5"/>
        </svg>
      </SecBtn>

      <Divider />

      {/* ━━━ TIER 2 — Developer Tools ━━━ */}
      <SecBtn label="Network Traffic Monitor" active={activePanel === 'network'} onClick={() => toggle('network')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M1 11 L4 7 L6.5 9.5 L9.5 4 L12 7 L15 3" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="1" y1="13" x2="15" y2="13" strokeLinecap="square" />
        </svg>
      </SecBtn>

      <SecBtn label="API Interceptor" active={activePanel === 'interceptor'} onClick={() => toggle('interceptor')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1" y="4" width="6" height="3" />
          <rect x="9" y="9" width="6" height="3" />
          <line x1="7" y1="5.5" x2="9" y2="5.5" />
          <line x1="9" y1="5.5" x2="9" y2="10.5" />
        </svg>
      </SecBtn>

      <SecBtn label="Extensions" active={activePanel === 'extensions'} onClick={() => toggle('extensions')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
          <rect x="1" y="5" width="8" height="8" />
          <path d="M9 9h3l3 3v-7h-6" />
          <circle cx="5" cy="9" r="2" />
        </svg>
      </SecBtn>

      {/* AI Assistant */}
      <SecBtn label="AI Assistant (local LLM)" active={activePanel === 'ai'} onClick={() => toggle('ai')}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="6" r="3" />
          <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
          <circle cx="6.5" cy="5.8" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="9.5" cy="5.8" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </SecBtn>

      <Divider />

      {/* ━━━ TIER 3 — Settings (utility) ━━━ */}
      <UtilBtn label="Privacy Policy" onClick={() => onNavigate?.('dhurta://privacy')}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.5"/>
          <line x1="8" y1="5" x2="8" y2="9" strokeLinecap="round"/>
          <circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none"/>
        </svg>
      </UtilBtn>

      <UtilBtn label="Settings" active={activePanel === 'settings'} onClick={() => toggle('settings')}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" strokeLinecap="square" />
        </svg>
      </UtilBtn>

      <div className="flex-1" />

      {/* ━━━ Bottom — Lock + Danger ━━━ */}
      <UtilBtn label={hasLock ? 'Lock Browser' : 'Set up Browser Lock'} onClick={hasLock ? (onLock ?? (() => {})) : (onSetupLock ?? (() => {}))}>
        <svg width="12" height="14" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square">
          <rect x="2" y="7" width="10" height="8" />
          <path d="M4 7V5a3 3 0 0 1 6 0v2" />
          <circle cx="7" cy="11" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </UtilBtn>

      <button
        title="Nuclear Wipe — Destroy all data and quit"
        onClick={onNuclearWipe}
        className="nuclear-btn w-9 h-9 flex items-center justify-center border border-border/40 text-text/25 hover:border-[#FF4500]/60 hover:text-[#FF4500] transition-all duration-200 active:scale-[0.90] mb-1 mt-0.5"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
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
