import React from 'react'

interface ShortcutEntry {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  items: ShortcutEntry[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['Ctrl', 'L'],        label: 'Focus address bar' },
      { keys: ['Ctrl', 'T'],        label: 'New tab' },
      { keys: ['Ctrl', 'W'],        label: 'Close current tab' },
      { keys: ['Alt', '←'],         label: 'Go back' },
      { keys: ['Alt', '→'],         label: 'Go forward' },
      { keys: ['Ctrl', 'R'],        label: 'Reload page' },
      { keys: ['Ctrl', 'Shift', 'R'], label: 'Hard reload (bypass cache)' },
      { keys: ['Escape'],           label: 'Stop loading' },
    ],
  },
  {
    title: 'Tabs',
    items: [
      { keys: ['Ctrl', '1–8'],      label: 'Switch to tab 1–8' },
      { keys: ['Ctrl', '9'],        label: 'Switch to last tab' },
      { keys: ['Ctrl', 'Tab'],      label: 'Next tab' },
      { keys: ['Ctrl', 'Shift', 'Tab'], label: 'Previous tab' },
    ],
  },
  {
    title: 'Page',
    items: [
      { keys: ['Ctrl', 'F'],        label: 'Find in page' },
      { keys: ['Ctrl', 'P'],        label: 'Print page' },
      { keys: ['Ctrl', '+'],        label: 'Zoom in' },
      { keys: ['Ctrl', '-'],        label: 'Zoom out' },
      { keys: ['Ctrl', '0'],        label: 'Reset zoom' },
      { keys: ['F11'],              label: 'Toggle fullscreen' },
      { keys: ['Space'],            label: 'Scroll down' },
      { keys: ['Shift', 'Space'],   label: 'Scroll up' },
    ],
  },
  {
    title: 'Panels & UI',
    items: [
      { keys: ['Ctrl', 'H'],        label: 'History panel' },
      { keys: ['Ctrl', 'B'],        label: 'Bookmarks panel' },
      { keys: ['Ctrl', 'J'],        label: 'Downloads panel' },
      { keys: ['Ctrl', 'Shift', 'A'], label: 'AI Assistant panel' },
      { keys: ['Ctrl', 'Shift', 'K'], label: 'Tab search / switcher' },
      { keys: ['Ctrl', 'F'],        label: 'Find in page' },
      { keys: ['Ctrl', 'Shift', 'T'], label: 'Reopen closed tab' },
      { keys: ['Escape'],           label: 'Close panel / overlay' },
      { keys: ['?'],                label: 'This shortcuts panel' },
    ],
  },
  {
    title: 'Developer',
    items: [
      { keys: ['F12'],              label: 'DevTools (detached)' },
      { keys: ['Ctrl', 'U'],        label: 'View page source' },
    ],
  },
  {
    title: 'Privacy & Security',
    items: [
      { keys: ['Ctrl', 'Shift', 'N'], label: 'New Ghost tab (Tor)' },
      { keys: ['Ctrl', 'Shift', 'Delete'], label: 'Clear cookies now' },
    ],
  },
]

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 border border-border bg-obsidian text-[9px] font-mono text-muted rounded-none">
      {label}
    </kbd>
  )
}

export default function ShortcutsPanel() {
  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-72">

      {/* Header */}
      <div className="p-3 border-b border-border shrink-0">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Keyboard Shortcuts</h2>
        <p className="text-[10px] text-muted font-mono mt-0.5">Press ? to toggle this panel</p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {GROUPS.map(group => (
          <section key={group.title} className="border-b border-border">
            <p className="text-[9px] font-mono text-muted uppercase tracking-widest px-3 pt-2.5 pb-1 bg-obsidian/40">
              {group.title}
            </p>
            {group.items.map(item => (
              <div key={item.label} className="flex items-center justify-between px-3 py-1.5 hover:bg-obsidian/50 gap-3">
                <span className="text-[10px] font-mono text-text/80 leading-tight min-w-0">{item.label}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  {item.keys.map((k, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-[8px] text-muted/50 font-mono mx-0.5">+</span>}
                      <Key label={k} />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <p className="text-[9px] font-mono text-muted/60">
          Shortcuts apply when focus is in the browser chrome, not inside a web page.
        </p>
      </div>
    </div>
  )
}
