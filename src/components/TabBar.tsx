import React, { useState, useRef, useCallback } from 'react'
import type { Tab } from '../types'

interface Props {
  tabs: Tab[]
  activeTabId: number
  onSwitch: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  onNewGhost: () => void
  onDuplicate: (id: number) => void
  onBookmark: (id: number) => void
  onCloseOthers: (id: number) => void
  pipActive?: boolean
  pipTitle?: string
}


const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

export default function TabBar({ tabs, activeTabId, onSwitch, onClose, onNew, onNewGhost, onDuplicate, onBookmark, onCloseOthers, pipActive, pipTitle }: Props) {
  const appsRef = useRef<HTMLButtonElement>(null)

  // PiP chip drag state — position in viewport coords
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null)
  const pipDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const handlePipMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button[data-close]')) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    pipDragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
    const onMove = (ev: MouseEvent) => {
      if (!pipDragRef.current) return
      const dx = ev.clientX - pipDragRef.current.startX
      const dy = ev.clientY - pipDragRef.current.startY
      setPipPos({ x: pipDragRef.current.origX + dx, y: pipDragRef.current.origY + dy })
    }
    const onUp = () => {
      pipDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const isActiveLoading = tabs.find(t => t.id === activeTabId)?.loading ?? false

  // Tab right-click: use native OS menu (rendered above BrowserView) in Electron
  const handleTabContextMenu = async (e: React.MouseEvent, tabId: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isElectron) return
    await window.dhurta.showTabContextMenu({ tabId, tabCount: tabs.length, x: e.clientX, y: e.clientY })
  }

  // Apps grid: native popup window (same as sidebar) — no HTML dropdown, no BrowserView conceal
  const handleAppsClick = async () => {
    if (!isElectron || !appsRef.current) return
    const rect = appsRef.current.getBoundingClientRect()
    const [winX, winY] = await window.dhurta.getWindowPos()
    await window.dhurta.showAppsPopup({
      x: Math.round(winX + rect.right - 248),
      y: Math.round(winY + rect.bottom + 4),
    })
  }

  return (
    <div className="tab-bar flex items-end h-9 bg-obsidian border-b border-border overflow-x-auto shrink-0 no-drag relative">
      {/* Loading progress bar — thin animated stripe at very top of the tab strip */}
      {isActiveLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none z-50">
          <div className="tab-loading-bar" />
        </div>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSwitch(tab.id)}
          onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
          className={[
            'tab-sharp flex items-center gap-1.5 h-full px-3 min-w-[120px] max-w-[200px] cursor-pointer border-r border-border shrink-0 relative group select-none',
            tab.id === activeTabId ? 'tab-active bg-surface text-text' : 'bg-obsidian text-text-dim hover:bg-surface-2 hover:text-text',
          ].join(' ')}
        >
          <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
            {tab.loading ? <LoadingSpinner /> : tab.favicon ? <img src={tab.favicon} className="w-3.5 h-3.5" alt="" /> : <DefaultFavicon ghost={tab.ghost} />}
          </span>
          <span className="text-xs truncate flex-1 font-sans">
            {tab.ghost && <span className="text-saffron mr-1 text-[10px]">👻</span>}
            {tab.title || 'New Tab'}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
            className="shrink-0 w-4 h-4 flex items-center justify-center text-muted opacity-0 group-hover:opacity-100 hover:text-saffron transition-opacity"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="8" y2="8" /><line x1="8" y1="0" x2="0" y2="8" />
            </svg>
          </button>
        </div>
      ))}

      <button
        onClick={onNew}
        className="tab-sharp h-full px-3 text-muted hover:text-saffron hover:bg-surface-2 transition-colors shrink-0"
        title="New tab (Ctrl+T)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      </button>

      {/* Apps grid button — opens a native popup window (same as sidebar) */}
      <button
        ref={appsRef}
        onClick={handleAppsClick}
        title="Dhurta Apps"
        className="tab-sharp h-9 px-3 ml-auto shrink-0 text-muted hover:text-saffron hover:bg-surface-2 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="2.5" cy="2.5" r="1.5" />
          <circle cx="7"   cy="2.5" r="1.5" />
          <circle cx="11.5" cy="2.5" r="1.5" />
          <circle cx="2.5" cy="7"   r="1.5" />
          <circle cx="7"   cy="7"   r="1.5" />
          <circle cx="11.5" cy="7"   r="1.5" />
          <circle cx="2.5" cy="11.5" r="1.5" />
          <circle cx="7"   cy="11.5" r="1.5" />
          <circle cx="11.5" cy="11.5" r="1.5" />
        </svg>
      </button>

      {/* PiP active chip — draggable indicator that floats in the tab bar area */}
      {pipActive && (
        <div
          onMouseDown={handlePipMouseDown}
          style={pipPos
            ? { position: 'fixed', left: pipPos.x, top: pipPos.y, zIndex: 9999 }
            : { position: 'fixed', right: 56, top: 4, zIndex: 9999 }}
          className="flex items-center gap-1.5 h-7 px-2 bg-[#1a1a1a] border border-[#FF4500]/60 rounded-full text-[10px] font-mono text-[#FF4500] cursor-grab select-none shadow-lg"
          title="Video PiP active — drag to move"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1" y="3" width="9" height="7" rx="1.5" />
            <rect x="5.5" y="5" width="4" height="3" rx="1" fill="currentColor" stroke="none" />
          </svg>
          <span className="max-w-[80px] truncate">{pipTitle || 'PiP'}</span>
          <button
            data-close
            onClick={() => isElectron && window.dhurta.closePip()}
            className="ml-0.5 hover:text-white transition-colors cursor-pointer"
            title="Close PiP"
          >✕</button>
        </div>
      )}
    </div>
  )
}


function LoadingSpinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#2A2A2A" strokeWidth="2" />
      <path d="M6 1 A5 5 0 0 1 11 6" stroke="#FF4500" strokeWidth="2" strokeLinecap="square" />
    </svg>
  )
}

function DefaultFavicon({ ghost }: { ghost: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" stroke={ghost ? '#FF4500' : '#444'} strokeWidth="1" />
      <line x1="1" y1="4" x2="11" y2="4" stroke={ghost ? '#FF4500' : '#444'} strokeWidth="0.8" />
    </svg>
  )
}
