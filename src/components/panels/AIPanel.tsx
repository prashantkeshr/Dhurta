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

function friendlyError(err: string): string {
  if (err.includes('ECONNREFUSED') || err.includes('Failed to fetch') || err.includes('NetworkError')) {
    return 'Cannot connect — is Ollama running? Start it with: ollama serve'
  }
  if (err.includes('503') || err.includes('Service Unavailable')) {
    return 'Model server unavailable — check that your local AI is running'
  }
  if (err.includes('404') || err.includes('Not Found')) {
    return 'Model not found — check the model name in settings'
  }
  if (err.includes('401') || err.includes('Unauthorized')) {
    return 'Authentication failed — check your API key in settings'
  }
  if (err.includes('timeout') || err.includes('Timeout')) {
    return 'Request timed out — the model may be loading, try again'
  }
  return err
}

export default function AIPanel({ activeTabId, activeTabUrl, activeTabTitle }: Props) {
  const stored = loadSettings()
  const [endpoint, setEndpoint] = useState<string>(stored.endpoint ?? 'http://localhost:11434')
  const [model, setModel] = useState<string>(stored.model ?? 'llama3')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fetchModels = useCallback(async (ep: string) => {
    setLoadingModels(true)
    try {
      const base = ep.replace(/\/$/, '')
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        const data = await res.json()
        const names: string[] = (data.models ?? []).map((m: { name: string }) => m.name)
        setAvailableModels(names)
      }
    } catch {}
    setLoadingModels(false)
  }, [])

  // Auto-detect available models when panel opens
  useEffect(() => {
    fetchModels(endpoint)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  const persistSettings = useCallback((ep: string, mod: string) => {
    saveSettings({ endpoint: ep, model: mod })
  }, [])

  const SYSTEM_PROMPT = `You are an AI assistant embedded in Dhurta Browser, a privacy-focused desktop browser. Help the user browse the web, understand page content, and answer questions. Be concise and helpful. When analyzing web page content, focus on the most useful information.`

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

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(m => ({ role: m.role, content: m.content })),
    ]

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
        }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText)
        throw new Error(friendlyError(`${res.status}: ${txt}`))
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
        setError(friendlyError(err.message ?? 'Request failed'))
      }
    } finally {
      setStreaming(false)
      setStreamBuffer('')
      abortRef.current = null
    }
  }, [endpoint, model, messages, streaming])

  const handleSummarizePage = useCallback(async () => {
    if (!isElectron || !activeTabId) return
    setPageLoading(true)
    try {
      const text = await window.dhurta.getPageTextForAI(activeTabId)
      if (!text) { setError('Could not extract page content.'); return }
      const title = activeTabTitle ?? activeTabUrl ?? 'this page'
      await send(
        `Please summarize the key information from this page clearly and concisely.`,
        `Page: "${title}"\n\nContent:\n${text}`
      )
    } catch (e: any) {
      setError(friendlyError(e.message ?? 'Failed to get page content'))
    } finally {
      setPageLoading(false)
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
          {loadingModels ? (
            <span className="text-[10px] text-muted bg-surface/60 border border-border px-1 py-0.5 rounded flex items-center gap-1">
              <span className="w-2 h-2 border border-saffron border-t-transparent rounded-full animate-spin inline-block" />
              detecting…
            </span>
          ) : availableModels.length > 0 ? (
            <span className="text-[10px] text-green-400 bg-green-900/20 border border-green-700/40 px-1 py-0.5 rounded">● connected</span>
          ) : (
            <span className="text-[10px] text-muted bg-surface/60 border border-border px-1 py-0.5 rounded">local</span>
          )}
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
            onBlur={e => fetchModels(e.target.value)}
            placeholder="http://localhost:11434"
            className="w-full bg-surface border border-border text-text text-[11px] px-2 py-1 rounded outline-none focus:border-saffron/60 font-mono"
          />
          <div className="flex items-center justify-between mt-1.5">
            <label className="block text-[11px] text-muted">Model</label>
            <button onClick={() => fetchModels(endpoint)} disabled={loadingModels}
              className="text-[10px] text-saffron hover:text-saffron/70 transition-colors disabled:opacity-40 font-mono">
              {loadingModels ? '…' : '↺ detect'}
            </button>
          </div>
          {availableModels.length > 0 ? (
            <select
              value={model}
              onChange={e => { setModel(e.target.value); persistSettings(endpoint, e.target.value) }}
              className="w-full bg-surface border border-border text-text text-[11px] px-2 py-1 rounded outline-none focus:border-saffron/60 font-mono"
            >
              {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              value={model}
              onChange={e => { setModel(e.target.value); persistSettings(endpoint, e.target.value) }}
              placeholder="llama3"
              className="w-full bg-surface border border-border text-text text-[11px] px-2 py-1 rounded outline-none focus:border-saffron/60 font-mono"
            />
          )}
          <p className="text-[10px] text-muted/60 mt-1">
            Ollama: <span className="font-mono">localhost:11434</span> · LM Studio: <span className="font-mono">localhost:1234</span>
          </p>
        </div>
      )}

      {/* Page-content loading indicator */}
      {pageLoading && (
        <div className="px-3 py-2 shrink-0 border-b border-border bg-obsidian/40">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="inline-block w-3 h-3 border border-saffron border-t-transparent rounded-full animate-spin" />
            Reading page content…
          </div>
        </div>
      )}

      {/* Quick actions */}
      {messages.length === 0 && !streaming && !pageLoading && (
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
        <p className="text-[10px] text-muted/40 mt-1">All processing is local — no data leaves your machine.</p>
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

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let inCode = false
  let codeLines: string[] = []
  let codeLang = ''
  let key = 0

  const inlineFormat = (s: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    let rem = s
    let k = 0
    while (rem.length > 0) {
      const boldIdx = rem.indexOf('**')
      const codeIdx = rem.indexOf('`')
      const italIdx = rem.indexOf('*')
      const candidates = [
        boldIdx >= 0 ? { idx: boldIdx, type: 'bold' as const } : null,
        codeIdx >= 0 ? { idx: codeIdx, type: 'code' as const } : null,
        italIdx >= 0 && italIdx !== boldIdx ? { idx: italIdx, type: 'italic' as const } : null,
      ].filter(Boolean) as { idx: number; type: 'bold' | 'code' | 'italic' }[]
      candidates.sort((a, b) => a.idx - b.idx)
      const first = candidates[0]
      if (!first) { parts.push(rem); break }
      if (first.idx > 0) parts.push(rem.slice(0, first.idx))
      if (first.type === 'bold') {
        const end = rem.indexOf('**', first.idx + 2)
        if (end < 0) { parts.push(rem); break }
        parts.push(<strong key={k++} className="font-semibold text-text">{rem.slice(first.idx + 2, end)}</strong>)
        rem = rem.slice(end + 2)
      } else if (first.type === 'code') {
        const end = rem.indexOf('`', first.idx + 1)
        if (end < 0) { parts.push(rem); break }
        parts.push(<code key={k++} className="font-mono text-[11px] bg-obsidian/60 text-saffron px-1 rounded">{rem.slice(first.idx + 1, end)}</code>)
        rem = rem.slice(end + 1)
      } else {
        const end = rem.indexOf('*', first.idx + 1)
        if (end < 0) { parts.push(rem); break }
        parts.push(<em key={k++} className="italic text-text/80">{rem.slice(first.idx + 1, end)}</em>)
        rem = rem.slice(end + 1)
      }
    }
    return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) { inCode = true; codeLang = line.slice(3).trim(); codeLines = [] }
      else {
        nodes.push(
          <pre key={key++} className="bg-obsidian border border-border rounded p-2 text-[10px] font-mono text-saffron/90 overflow-x-auto my-1 leading-relaxed">
            <code>{codeLines.join('\n')}</code>
          </pre>
        )
        inCode = false
      }
      continue
    }
    if (inCode) { codeLines.push(line); continue }
    if (line.startsWith('### ')) { nodes.push(<h3 key={key++} className="text-[12px] font-semibold text-text mt-2 mb-0.5">{inlineFormat(line.slice(4))}</h3>); continue }
    if (line.startsWith('## '))  { nodes.push(<h2 key={key++} className="text-[13px] font-semibold text-text mt-2 mb-1">{inlineFormat(line.slice(3))}</h2>); continue }
    if (line.startsWith('# '))   { nodes.push(<h1 key={key++} className="text-[14px] font-bold text-saffron mt-2 mb-1">{inlineFormat(line.slice(2))}</h1>); continue }
    if (line.match(/^[-*] /))    { nodes.push(<div key={key++} className="flex gap-1.5 leading-snug"><span className="text-saffron/60 shrink-0 mt-0.5">•</span><span>{inlineFormat(line.slice(2))}</span></div>); continue }
    if (line.match(/^\d+\. /))   { const m = line.match(/^(\d+)\. (.*)/)!; nodes.push(<div key={key++} className="flex gap-1.5 leading-snug"><span className="text-saffron/60 shrink-0 tabular-nums min-w-[1rem]">{m[1]}.</span><span>{inlineFormat(m[2])}</span></div>); continue }
    if (line.trim() === '') { nodes.push(<div key={key++} className="h-1.5" />); continue }
    nodes.push(<p key={key++} className="leading-relaxed">{inlineFormat(line)}</p>)
  }
  return nodes
}

function MessageBubble({ message, streaming }: { message: Message; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={['flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start'].join(' ')}>
      <span className="text-[10px] text-muted/60 px-1">{isUser ? 'you' : 'assistant'}</span>
      <div
        className={[
          'max-w-[92%] px-2.5 py-2 rounded text-[12px] break-words',
          isUser
            ? 'bg-saffron/10 border border-saffron/25 text-text whitespace-pre-wrap'
            : 'bg-surface border border-border text-text/90 space-y-0.5',
        ].join(' ')}
      >
        {isUser ? message.content : renderMarkdown(message.content)}
        {streaming && <span className="inline-block w-1.5 h-3 bg-saffron/70 ml-0.5 align-text-bottom animate-pulse" />}
      </div>
    </div>
  )
}
