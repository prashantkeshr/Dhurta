import React from 'react'
import type { MobilePanel } from '../App'

interface Props {
  active: MobilePanel
  onChange(p: MobilePanel): void
}

export default function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="flex items-center justify-around bg-surface border-t border-border h-16 safe-area-inset-bottom">
      <NavBtn icon={<HomeIcon />}      label="Browser"   id="browser"    active={active} onChange={onChange} />
      <NavBtn icon={<BookmarkIcon />}  label="Saved"     id="bookmarks"  active={active} onChange={onChange} />

      {/* Center Trishula button — prominent orange */}
      <button
        onClick={() => onChange('trishula')}
        className={[
          'w-14 h-14 rounded-full flex items-center justify-center -mt-6',
          'shadow-lg shadow-saffron/30 transition-all',
          active === 'trishula'
            ? 'bg-saffron scale-110'
            : 'bg-saffron/90 hover:bg-saffron hover:scale-105',
        ].join(' ')}
        aria-label="Trishula"
      >
        <TrishulaIcon />
      </button>

      <NavBtn icon={<HistoryIcon />}   label="History"   id="history"    active={active} onChange={onChange} />
      <NavBtn icon={<SettingsIcon />}  label="Settings"  id="settings"   active={active} onChange={onChange} />
    </nav>
  )
}

function NavBtn({ icon, label, id, active, onChange }: {
  icon: React.ReactNode
  label: string
  id: MobilePanel
  active: MobilePanel
  onChange(p: MobilePanel): void
}) {
  const isActive = active === id
  return (
    <button
      onClick={() => onChange(id)}
      className={[
        'flex flex-col items-center gap-0.5 px-3 py-1 transition-colors',
        isActive ? 'text-saffron' : 'text-muted hover:text-text',
      ].join(' ')}
    >
      <span className="w-6 h-6 flex items-center justify-center">{icon}</span>
      <span className="text-[9px] font-mono uppercase tracking-wider">{label}</span>
    </button>
  )
}

function TrishulaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
      <rect x="11" y="2" width="2" height="16" rx="1" />
      <path d="M10 2 L12 0 L14 2 L13 4 L11 4 Z" />
      <rect x="5" y="5" width="1.5" height="10" rx="0.75" transform="rotate(-15 5.75 10)" />
      <path d="M4.5 5 L6.5 3.5 L7.5 5.5 L6 6.5 Z" />
      <rect x="17.5" y="5" width="1.5" height="10" rx="0.75" transform="rotate(15 18.25 10)" />
      <path d="M19.5 5 L17.5 3.5 L16.5 5.5 L18 6.5 Z" />
      <rect x="11" y="18" width="2" height="5" rx="1" />
      <rect x="9" y="21" width="6" height="1.5" rx="0.75" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
      <path d="M9 21V12h6v9" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}
