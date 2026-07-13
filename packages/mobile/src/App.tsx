import React, { useState } from 'react'
import BottomNav from './components/BottomNav'
import BrowserView from './components/BrowserView'

export type MobilePanel = 'browser' | 'bookmarks' | 'history' | 'settings' | 'trishula'

export default function App() {
  const [activePanel, setActivePanel] = useState<MobilePanel>('browser')
  const [url, setUrl] = useState('dhurta://newtab')

  return (
    <div className="flex flex-col h-screen bg-obsidian text-text overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {activePanel === 'browser' && (
          <BrowserView url={url} onUrlChange={setUrl} />
        )}
        {activePanel === 'bookmarks' && (
          <div className="flex items-center justify-center h-full text-muted font-mono text-sm">
            Bookmarks coming soon
          </div>
        )}
        {activePanel === 'history' && (
          <div className="flex items-center justify-center h-full text-muted font-mono text-sm">
            History coming soon
          </div>
        )}
        {activePanel === 'settings' && (
          <div className="flex items-center justify-center h-full text-muted font-mono text-sm">
            Settings coming soon
          </div>
        )}
        {activePanel === 'trishula' && (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <TrishulaIcon size={64} className="text-saffron" />
            <h1 className="font-mono text-xl text-saffron tracking-widest uppercase">Trishula</h1>
            <p className="font-mono text-xs text-muted text-center leading-relaxed">
              Your privacy command center.{'\n'}
              Ghost Mode, Chakra, and more — coming soon.
            </p>
          </div>
        )}
      </div>

      <BottomNav active={activePanel} onChange={setActivePanel} />
    </div>
  )
}

function TrishulaIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      {/* Center prong */}
      <rect x="11" y="2" width="2" height="16" rx="1" />
      <path d="M10 2 L12 0 L14 2 L13 4 L11 4 Z" />
      {/* Left prong */}
      <rect x="5" y="5" width="1.5" height="10" rx="0.75" transform="rotate(-15 5.75 10)" />
      <path d="M4.5 5 L6.5 3.5 L7.5 5.5 L6 6.5 Z" />
      {/* Right prong */}
      <rect x="17.5" y="5" width="1.5" height="10" rx="0.75" transform="rotate(15 18.25 10)" />
      <path d="M19.5 5 L17.5 3.5 L16.5 5.5 L18 6.5 Z" />
      {/* Handle */}
      <rect x="11" y="18" width="2" height="5" rx="1" />
      <rect x="9" y="21" width="6" height="1.5" rx="0.75" />
    </svg>
  )
}
