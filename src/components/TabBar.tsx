import React, { useState, useRef, useCallback } from 'react'
import type { Tab, TabGroup } from '../types'

const GROUP_COLOR_MAP: Record<string, string> = {
  red:    '#e55555',
  orange: '#f8a000',
  yellow: '#c8b800',
  green:  '#44aa44',
  teal:   '#44aaaa',
  blue:   '#4488ff',
  purple: '#aa44ff',
  pink:   '#ff44aa',
  gray:   '#778',
}

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
  onPin: (id: number) => void
  onMute: (id: number) => void
  groups: TabGroup[]
  onToggleGroup: (groupId: number) => void
  onRenameGroup: (groupId: number, name: string) => void
  onDeleteGroup: (groupId: number) => void
  pipActive?: boolean
  pipTitle?: string
}


const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

export default function TabBar({ tabs, activeTabId, onSwitch, onClose, onNew, onNewGhost, onDuplicate, onBookmark, onCloseOthers, onPin, onMute, groups, onToggleGroup, onRenameGroup, onDeleteGroup, pipActive, pipTitle }: Props) {
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

  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editGroupName, setEditGroupName]   = useState('')

  const isActiveLoading = tabs.find(t => t.id === activeTabId)?.loading ?? false

  // Pinned first, then grouped (by group id, preserving insertion order), then ungrouped
  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    const ag = a.groupId ?? Infinity
    const bg = b.groupId ?? Infinity
    return ag === bg ? 0 : ag < bg ? -1 : 1
  })

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

  const ghostTabs = tabs.filter(t => t.ghost)
  const hasGhostActive = ghostTabs.some(t => t.id === activeTabId)

  return (
    <div className={[
      'tab-bar flex items-end h-9 overflow-x-auto shrink-0 no-drag relative border-b',
      hasGhostActive
        ? 'bg-[#0d0018] border-[#FF003344]'
        : 'bg-obsidian border-border',
    ].join(' ')}>
      {/* Loading progress bar — thin animated stripe at very top of the tab strip */}
      {isActiveLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden pointer-events-none z-50">
          <div className="tab-loading-bar" />
        </div>
      )}
      {(() => {
        const els: React.ReactNode[] = []
        let lastGroupId: number | null | undefined = undefined

        for (const tab of sortedTabs) {
          const group = tab.groupId != null ? groups.find(g => g.id === tab.groupId) : null
          const groupColor = group ? (GROUP_COLOR_MAP[group.color] ?? '#888') : null

          // Inject group chip before first tab of each group
          if (group && tab.groupId !== lastGroupId) {
            const isEditing = editingGroupId === group.id
            els.push(
              <div
                key={`group-chip-${group.id}`}
                className="flex items-center h-full shrink-0 pl-1 pr-0.5"
                style={{ borderTop: `2px solid ${groupColor}` }}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    className="h-5 px-1.5 text-[10px] font-mono bg-obsidian border text-white w-20 outline-none rounded-sm"
                    style={{ borderColor: groupColor ?? '#888' }}
                    value={editGroupName}
                    onChange={e => setEditGroupName(e.target.value)}
                    onBlur={() => { onRenameGroup(group.id, editGroupName.trim() || group.name); setEditingGroupId(null) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onRenameGroup(group.id, editGroupName.trim() || group.name); setEditingGroupId(null) }
                      if (e.key === 'Escape') setEditingGroupId(null)
                    }}
                  />
                ) : (
                  <button
                    title={group.collapsed ? `Expand group "${group.name}"` : `Collapse group "${group.name}"`}
                    onDoubleClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name) }}
                    onClick={() => onToggleGroup(group.id)}
                    className="h-5 px-1.5 text-[10px] font-mono rounded-sm select-none flex items-center gap-1 hover:opacity-80 transition-opacity"
                    style={{ background: groupColor + '33', color: groupColor ?? '#888', border: `1px solid ${groupColor}55` }}
                  >
                    <span>{group.collapsed ? '▶' : '▼'}</span>
                    <span>{group.name}</span>
                    <span
                      className="ml-0.5 opacity-60 hover:opacity-100"
                      title="Delete group"
                      onClick={e => { e.stopPropagation(); onDeleteGroup(group.id) }}
                    >×</span>
                  </button>
                )}
              </div>
            )
          }
          lastGroupId = tab.groupId

          // Skip collapsed group tabs (show only the chip above)
          if (group?.collapsed) continue

          if (tab.pinned) {
            els.push(
              <div
                key={tab.id}
                onClick={() => onSwitch(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                title={tab.title || 'New Tab'}
                style={groupColor ? { borderTop: `2px solid ${groupColor}` } : undefined}
                className={[
                  'tab-sharp flex items-center justify-center h-full w-10 cursor-pointer border-r border-border shrink-0 relative group select-none',
                  tab.id === activeTabId ? 'tab-active bg-surface text-text' : 'bg-obsidian text-text-dim hover:bg-surface-2 hover:text-text',
                ].join(' ')}
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center relative">
                  {tab.loading ? <LoadingSpinner /> : tab.favicon ? <img src={tab.favicon} className="w-3.5 h-3.5" alt="" /> : <DefaultFavicon ghost={tab.ghost} />}
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-saffron" />
                </span>
              </div>
            )
          } else {
            els.push(
              <div
                key={tab.id}
                onClick={() => onSwitch(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                style={groupColor ? { borderTop: `2px solid ${groupColor}` } : undefined}
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
                {(tab.playing || tab.muted) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMute(tab.id) }}
                    title={tab.muted ? 'Unmute tab' : 'Mute tab'}
                    className="shrink-0 w-4 h-4 flex items-center justify-center text-muted hover:text-saffron transition-colors"
                  >
                    {tab.muted ? (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                        <path d="M1 4h2l3-3v9L3 7H1V4z" />
                        <line x1="7" y1="4" x2="10" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <line x1="10" y1="4" x2="7" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                        <path d="M1 4h2l3-3v9L3 7H1V4z" />
                        <path d="M7.5 3.5c1 0.8 1 3.2 0 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
                  className="shrink-0 w-4 h-4 flex items-center justify-center text-muted opacity-0 group-hover:opacity-100 hover:text-saffron transition-opacity"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
                    <line x1="0" y1="0" x2="8" y2="8" /><line x1="8" y1="0" x2="0" y2="8" />
                  </svg>
                </button>
              </div>
            )
          }
        }
        return els
      })()}

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
