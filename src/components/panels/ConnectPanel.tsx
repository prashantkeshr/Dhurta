import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { BridgePeerState } from '../../types'

const api = () => window.dhurta

type Mode = 'idle' | 'hosting' | 'connecting' | 'connected'

export default function ConnectPanel({
  activeUrl,
  activeTitle,
  onNavigate,
}: {
  activeUrl: string
  activeTitle: string
  onNavigate: (url: string) => void
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const [hostCode, setHostCode] = useState('')
  const [connectCode, setConnectCode] = useState('')
  const [peerState, setPeerState] = useState<BridgePeerState | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // When hosting, always push our current URL to connected peers who POST to us
  // (handled server-side in main process — nothing to do here)

  const startHosting = async () => {
    setError('')
    try {
      const { code } = await api().bridgeHost()
      setHostCode(code)
      setMode('hosting')
    } catch (e: any) {
      setError('Could not start server: ' + e?.message)
    }
  }

  const stopHosting = async () => {
    await api().bridgeStop()
    setMode('idle')
    setHostCode('')
  }

  const startConnecting = async () => {
    if (connectCode.length !== 6) { setError('Enter the 6-digit code from the host.'); return }
    setError('')
    setMode('connecting')
    const result = await api().bridgePeek(connectCode)
    if (!result) {
      setError('Could not reach that browser. Make sure both are on the same machine and the code is correct.')
      setMode('idle')
      return
    }
    setPeerState(result)
    setMode('connected')
    // Poll every 3 seconds for updates
    pollRef.current = setInterval(async () => {
      const s = await api().bridgePeek(connectCode)
      if (s) setPeerState(s)
    }, 3000)
  }

  const disconnect = () => {
    stopPoll()
    setMode('idle')
    setPeerState(null)
    setConnectCode('')
    setError('')
  }

  const pushMyUrl = useCallback(async () => {
    if (connectCode.length === 6 && activeUrl) {
      await api().bridgePush(connectCode, activeUrl, activeTitle)
    }
  }, [connectCode, activeUrl, activeTitle])

  useEffect(() => () => stopPoll(), [])

  return (
    <div className="panel-overlay flex flex-col h-full bg-surface border-r border-border w-72">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-mono text-saffron uppercase tracking-widest">Connect Browsers</h2>
        <p className="text-[10px] text-muted font-mono mt-0.5">Share tabs between two Dhurta windows</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* How it works */}
        <div className="text-[10px] font-mono text-muted space-y-1 border border-border p-2">
          <p className="text-saffron">How it works:</p>
          <p>1. One browser clicks <span className="text-text">Host</span> → gets a code.</p>
          <p>2. Other browser enters that code and clicks <span className="text-text">Connect</span>.</p>
          <p>3. Connected browsers can see and open each other's active tab.</p>
          <p className="text-text/40 mt-1">Works on the same machine or same local network (LAN).</p>
        </div>

        {/* Host section */}
        <div className="border border-border p-2.5">
          <p className="text-[10px] text-saffron font-mono uppercase tracking-widest mb-2">Host a session</p>
          {mode === 'hosting' ? (
            <div className="space-y-2">
              <p className="text-[10px] text-muted font-mono">Share this code with the other browser:</p>
              <p className="text-2xl font-mono text-saffron tracking-[0.4em] text-center py-2 border border-saffron bg-obsidian">
                {hostCode}
              </p>
              <p className="text-[10px] text-muted font-mono">Waiting for connections… Your current tab URL is shared automatically.</p>
              <button
                onClick={stopHosting}
                className="w-full text-[10px] font-mono text-muted border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors"
              >
                Stop Hosting
              </button>
            </div>
          ) : mode === 'idle' && (
            <button
              onClick={startHosting}
              className="w-full text-[10px] font-mono text-text border border-border hover:border-saffron hover:text-saffron py-2 transition-colors"
            >
              Start Hosting → Get Code
            </button>
          )}
        </div>

        {/* Connect section */}
        {(mode === 'idle' || mode === 'connected' || mode === 'connecting') && (
          <div className="border border-border p-2.5">
            <p className="text-[10px] text-saffron font-mono uppercase tracking-widest mb-2">Connect to a host</p>
            {mode === 'connected' && peerState ? (
              <div className="space-y-2">
                <p className="text-[10px] text-muted font-mono">Connected · polling every 3s</p>
                <div className="bg-obsidian border border-border p-2">
                  <p className="text-[10px] text-muted font-mono">Their current page:</p>
                  <p className="text-xs text-text font-mono mt-1 truncate">{peerState.title || 'Untitled'}</p>
                  <p className="text-[9px] text-muted font-mono truncate mt-0.5">{peerState.url}</p>
                  {peerState.url && !peerState.url.startsWith('dhurta://') && (
                    <button
                      onClick={() => onNavigate(peerState.url)}
                      className="mt-2 text-[10px] font-mono text-saffron hover:underline"
                    >
                      Open this page in my browser →
                    </button>
                  )}
                </div>
                <button
                  onClick={pushMyUrl}
                  className="w-full text-[10px] font-mono text-text border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors"
                >
                  Push my tab to host
                </button>
                <button
                  onClick={disconnect}
                  className="w-full text-[10px] font-mono text-muted border border-border hover:border-saffron hover:text-saffron py-1.5 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={connectCode}
                  onChange={(e) => setConnectCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-obsidian border border-border text-sm text-saffron font-mono px-2 py-1.5 text-center tracking-[0.5em] outline-none focus:border-saffron placeholder:text-muted placeholder:text-xs placeholder:tracking-normal"
                />
                <button
                  onClick={startConnecting}
                  disabled={mode === 'connecting'}
                  className="w-full text-[10px] font-mono text-text border border-border hover:border-saffron hover:text-saffron py-2 transition-colors disabled:opacity-40"
                >
                  {mode === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-[10px] font-mono text-red-400 border border-red-400/30 p-2">{error}</p>
        )}
      </div>
    </div>
  )
}
