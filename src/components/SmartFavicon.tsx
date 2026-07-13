import React, { useState, useMemo } from 'react'

interface Props {
  url: string
  name: string
  size?: number
  className?: string
  letterClassName?: string
}

const TOOL_ICONS: Record<string, string> = {
  setu: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 24 Q16 8 28 24" fill="none" stroke="#FF4500" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="18" r="3" fill="#FF4500"/><line x1="16" y1="15" x2="16" y2="8" stroke="#FF4500" stroke-width="2" stroke-linecap="round"/></svg>`,
  connect: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="10" cy="16" r="4" fill="none" stroke="#FF4500" stroke-width="2"/><circle cx="22" cy="16" r="4" fill="none" stroke="#FF4500" stroke-width="2"/><line x1="14" y1="16" x2="18" y2="16" stroke="#FF4500" stroke-width="2" stroke-linecap="round"/></svg>`,
  developer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><polyline points="10,10 4,16 10,22" fill="none" stroke="#FF4500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="22,10 28,16 22,22" fill="none" stroke="#FF4500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="8" x2="14" y2="24" stroke="#FF4500" stroke-width="2" stroke-linecap="round"/></svg>`,
  omni: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 4L6 9v7c0 5.5 4.2 10.5 10 12 5.8-1.5 10-6.5 10-12V9L16 4z" fill="none" stroke="#FF4500" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="15" r="3" fill="#FF4500"/></svg>`,
  bridge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="10" width="10" height="12" rx="1" fill="none" stroke="#FF4500" stroke-width="2"/><rect x="18" y="10" width="10" height="12" rx="1" fill="none" stroke="#FF4500" stroke-width="2"/><path d="M14 16h4" stroke="#FF4500" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 2"/></svg>`,
}

export default function SmartFavicon({ url, name, size = 20, className = '', letterClassName = '' }: Props) {
  const [srcIdx, setSrcIdx] = useState(0)

  const toolIcon = useMemo(() => {
    if (!url.startsWith('dhurta-tool://')) return null
    const id = url.replace('dhurta-tool://', '')
    const svg = TOOL_ICONS[id]
    if (!svg) return null
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }, [url])

  const domain = useMemo(() => {
    if (url.startsWith('dhurta-tool://')) return ''
    try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname }
    catch { return '' }
  }, [url])

  const sources = useMemo(() => {
    if (!domain) return []
    return [
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      `https://${domain}/favicon.ico`,
    ]
  }, [domain])

  const letter = (name || domain || '?')[0]?.toUpperCase() ?? '?'

  if (toolIcon) {
    return (
      <img src={toolIcon} alt="" width={size} height={size}
        className={className || 'object-contain'} style={{ flexShrink: 0 }} />
    )
  }

  if (!domain || srcIdx >= sources.length) {
    return (
      <div
        className={letterClassName || 'flex items-center justify-center text-[10px] font-mono text-saffron border border-saffron/40'}
        style={{ width: size, height: size, flexShrink: 0 }}
      >
        {letter}
      </div>
    )
  }

  return (
    <img
      key={sources[srcIdx]}          // key change forces re-mount on src change
      src={sources[srcIdx]}
      alt=""
      width={size}
      height={size}
      className={className || 'object-contain'}
      style={{ flexShrink: 0 }}
      onError={() => setSrcIdx(i => i + 1)}
    />
  )
}
