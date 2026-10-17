import React, { useState, useRef, useEffect, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STORAGE_KEY = 'dhurta_ai_settings'

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveSettings(s: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

interface Props {
  activeTabId: number
  activeTabUrl?: string
  activeTabTitle?: string
}

export default function AIPanel({ activeTabId, activeTabUrl, activeTabTitle }: Props) {
  const stored = loadSettings()
  const [endpoint, setEndpoint] = useState<string>(stored.endpoint ?? 'http://localhost:11434')
  const [model, setModel] = useState<string>(stored.model ?? 'llama3')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  const persistSettings = useCallback((ep: string, mod: string) => {
    saveSettings({ endpoint: ep, model: mod })
  }, [])

  const send = useCallback(async (userText: string, contextPrefix?: string) => {
    if (!userText.trim() || streaming) return
    setError(null)

    const userMsg: Message = { role: 'user', content: contextPrefix ? `${contextPrefix}\n\n${userText}` : userText }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setStreaming(true)
    setStreamBuffer('')

    abortRef.current = new AbortController()

    const base = endpoint.replace(/\/$/, '')
    const url = `${base}/v1/chat/completions`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model,
          messages: history.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText)
        throw new Error(`${res.status}: ${txt}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistant = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              assistant += delta
              setStreamBuffer(assistant)
            }
          } catch {}
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: assistant }])
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message ?? 'Request failed')
      }
    } finally {
      setStreaming(false)
      setStreamBuffer('')
      abortRef.current = null
    }
  }, [endpoint, model, messages, streaming])

  const handleSummarizePage = useCallback(async () => {
    if (!isElectron || !activeTabId) return
    try {
      const text = await window.dhurta.getPageTextForAI(activeTabId)
      if (!text) { setError('Could not extract page content.'); return }
      const title = activeTabTitle ?? activeTabUrl ?? 'this page'
      await send(
        `Please summarize the key information from this page clearly and concisely.`,
        `Page: "${title}"\n\nContent:\n${text}`
      )
    } catch (e: any) {
      setError(e.message ?? 'Failed to get page content')
    }
  }, [activeTabId, activeTabTitle, activeTabUrl, send])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleClear = () => {
    setMessages([])
    setStreamBuffer('')
    setError(null)
  }

  return (
    <div className="flex flex-col h-full bg-surface text-text text-[13px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-saffron">
            <circle cx="6.5" cy="4.5" r="2.5" />
            <path d="M2 11c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
          </svg>
          <span className="font-medium text-[12px] tracking-wide">AI Assistant</span>
          <span className="text-[9px] text-muted bg-surface/60 border border-border px-1 py-0.5 rounded">local</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear conversation"
              className="text-muted hover:text-saffron transition-colors text-[10px] px-1.5 py-0.5 border border-border/50 hover:border-saffron/50 rounded"
            >
              clear
            </button>
          )}
          <button
            onClick={() => setShowSettings(v => !v)}
            title="Settings"
            className={['w-6 h-6 flex items-center justify-center transition-colors', showSettings ? 'text-saffron' : 'text-muted hover:text-saffron'].join(' ')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="6" cy="6" r="2" />
              <path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.64 2.64l1.06 1.06M8.3 8.3l1.06 1.06M2.64 9.36l1.06-1.06M8.3 3.7l1.06-1.06" strokeLinecap="square" />
            </svg>
          </button>
        </div>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="px-3 py-2.5 border-b border-border bg-obsidian/40 shrink-0 space-y-2">
          <p className="text-[10px] text-muted mb-1.5">Works with Ollama, LM Studio, or any OpenAI-compatible local server.</p>
          <label className="block text-[11px] text-muted mb-0.5">Endpoint</label>
          <input
            value={endpoint}
            onChange={e => { setEndpoint(e.target.value); persistSettings(e.target.value, model) }}
            placeholder="http://localhost:11434"
            className="w-full bg-surface border border-border text-text text-[11px] px-2 py-1 rounded outline-none focus:border-saffron/60 font-mono"
          />
          <label className="block text-[11px] text-muted mb-0.5 mt-1.5">Model</label>
          <input
            value={model}
            onChange={e => { setModel(e.target.value); persistSettings(endpoint, e.target.value) }}
            placeholder="llama3"
            className="w-full bg-surface border border-border text-text text-[11px] px-2 py-1 rounded outline-none focus:border-saffron/60 font-mono"
          />
          <p className="text-[9px] text-muted/60 mt-1">
            Ollama default: <span className="font-mono">localhost:11434</span> · LM Studio: <span className="font-mono">localhost:1234</span>
          </p>
        </div>
      )}

      {/* Quick actions */}
      {messages.length === 0 && !streaming && (
        <div className="px-3 pt-4 pb-2 shrink-0">
          <p className="text-[11px] text-muted mb-2">Quick actions</p>
          <div className="flex flex-col gap-1.5">
            <QuickBtn
              label="Summarize this page"
              icon={
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <rect x="1" y="1" width="9" height="9" rx="1" />
                  <line x1="3" y1="3.5" x2="8" y2="3.5" />
                  <line x1="3" y1="5.5" x2="8" y2="5.5" />
                  <line x1="3" y1="7.5" x2="5.5" y2="7.5" />
                </svg>
              }
              onClick={handleSummarizePage}
              disabled={streaming}
            />
            <QuickBtn
              label="What is this page about?"
              icon={
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <circle cx="5.5" cy="5.5" r="4.5" />
                  <path d="M5.5 5.5V5a1.2 1.2 0 1 1 1.2-1.2" />
                  <circle cx="5.5" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
                </svg>
              }
              onClick={async () => {
                if (!isElectron) return
                const text = await window.dhurta.getPageTextForAI(activeTabId).catch(() => '')
                const title = activeTabTitle ?? activeTabUrl ?? 'this page'
                await send(
                  'What is this page about? Give a brief 2-3 sentence overview.',
                  text ? `Page: "${title}"\n\nContent:\n${text}` : `Page: "${title}"`
                )
              }}
              disabled={streaming}
            />
            <QuickBtn
              label="Extract key points"
              icon={
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <line x1="2" y1="2.5" x2="9" y2="2.5" />
                  <circle cx="2" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
                  <line x1="3.5" y1="5.5" x2="9" y2="5.5" />
                  <circle cx="2" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
                  <line x1="3.5" y1="8.5" x2="9" y2="8.5" />
                </svg>
              }
              onClick={async () => {
                if (!isElectron) return
                const text = await window.dhurta.getPageTextForAI(activeTabId).catch(() => '')
                const title = activeTabTitle ?? activeTabUrl ?? 'this page'
                await send(
                  'Extract the key points from this page as a bullet list.',
                  text ? `Page: "${title}"\n\nContent:\n${text}` : `Page: "${title}"`
                )
              }}
              disabled={streaming}
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {streaming && streamBuffer && (
          <MessageBubble message={{ role: 'assistant', content: streamBuffer }} streaming />
        )}
        {error && (
          <div className="bg-red-950/40 border border-red-700/40 rounded px-2.5 py-2 text-[11px] text-red-400">
            <span className="font-medium">Error: </span>{error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 bg-obsidian/60 border border-border text-text text-[12px] px-2.5 py-1.5 rounded resize-none outline-none focus:border-saffron/60 placeholder:text-muted/50 leading-snug"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              title="Stop"
              className="w-8 h-8 flex items-center justify-center bg-red-900/40 border border-red-700/60 text-red-400 hover:text-red-300 rounded transition-colors shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <rect x="1" y="1" width="8" height="8" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              title="Send (Enter)"
              className="w-8 h-8 flex items-center justify-center bg-saffron/10 border border-saffron/40 text-saffron hover:bg-saffron/20 rounded transition-colors disabled:opacity-30 disabled:cursor-default shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                <line x1="2" y1="6" x2="10" y2="6" />
                <polyline points="7,3 10,6 7,9" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-[9px] text-muted/40 mt-1">All processing is local — no data leaves your machine.</p>
      </div>
    </div>
  )
}

function QuickBtn({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 bg-obsidian/40 border border-border hover:border-saffron/50 hover:text-saffron text-muted rounded text-[11px] transition-colors disabled:opacity-40 disabled:cursor-default"
    >
      <span className="shrink-0 text-saffron/70">{icon}</span>
      {label}
    </button>
  )
}

function MessageBubble({ message, streaming }: { message: Message; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={['flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start'].join(' ')}>
      <span className="text-[9px] text-muted/60 px-1">{isUser ? 'you' : 'assistant'}</span>
      <div
        className={[
          'max-w-[92%] px-2.5 py-2 rounded text-[12px] leading-relaxed whitespace-pre-wrap break-words',
          isUser
            ? 'bg-saffron/10 border border-saffron/25 text-text'
            : 'bg-surface border border-border text-text/90',
        ].join(' ')}
      >
        {message.content}
        {streaming && <span className="inline-block w-1.5 h-3 bg-saffron/70 ml-0.5 align-text-bottom animate-pulse" />}
      </div>
    </div>
  )
}
