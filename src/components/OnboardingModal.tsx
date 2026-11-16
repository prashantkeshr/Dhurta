import React, { useState, useEffect } from 'react'

const STORAGE_KEY = 'dhurta_onboarded_v1'

interface Step {
  icon: React.ReactNode
  title: string
  subtitle: string
  body: string
  accent?: string
}

const STEPS: Step[] = [
  {
    icon: (
      <img src="./dhurta-logo.png" alt="Dhurta Developer Browser" draggable={false}
        className="w-16 h-16 object-contain"
        style={{ filter: 'drop-shadow(0 0 18px rgba(250,45,72,0.55)) drop-shadow(0 0 36px rgba(255,120,73,0.22))' }} />
    ),
    title: 'Welcome to Dhurta Developer Browser',
    subtitle: 'The browser that puts privacy first — always.',
    body: 'Dhurta Developer Browser is built around one principle: what you browse is your business. No telemetry, no cloud sync, no fingerprinting. Everything runs locally on your machine.',
    accent: '#FA2D48',
  },
  {
    icon: (
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ filter: 'drop-shadow(0 0 14px #FF003388)' }}>
        <circle cx="28" cy="28" r="26" stroke="#FF003366" strokeWidth="1.5" />
        <circle cx="28" cy="28" r="18" stroke="#FF003344" strokeWidth="1" strokeDasharray="3 3" />
        <text x="28" y="36" textAnchor="middle" fontSize="22" fill="#FA2D48">👻</text>
      </svg>
    ),
    title: 'Ghost Mode',
    subtitle: 'Invisible browsing via Tor onion routing.',
    body: 'One click activates Tor routing, randomises your fingerprint, and isolates the tab from your real identity. Your IP, canvas, fonts, and audio context are all spoofed.',
    accent: '#FF0033',
  },
  {
    icon: (
      <img src="./chakra-icon.png" alt="Chakra" draggable={false}
        className="w-14 h-14 object-contain chakra-active" />
    ),
    title: 'Chakra Shield',
    subtitle: 'Full protection in one tap.',
    body: 'Chakra activates VPN routing, blocks WebRTC leaks, enables anti-fingerprinting, and turns on auto-clean — all at once. Your personal privacy preset.',
    accent: '#FFB300',
  },
  {
    icon: (
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ filter: 'drop-shadow(0 0 12px rgba(250,45,72,0.4))' }}>
        <circle cx="28" cy="22" r="11" stroke="#FA2D48" strokeWidth="1.5" />
        <path d="M12 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="#FA2D48" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="23" cy="21" r="2" fill="#FA2D48" />
        <circle cx="33" cy="21" r="2" fill="#FA2D48" />
        <path d="M22 27c1.5 2 8.5 2 10 0" stroke="#FA2D48" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    title: 'AI Assistant',
    subtitle: 'Local LLM — no data leaves your machine.',
    body: 'Connect Ollama or LM Studio running on localhost and get AI help — summarise pages, ask questions, extract key points — with zero cloud dependency.',
    accent: '#FA2D48',
  },
  {
    icon: (
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ filter: 'drop-shadow(0 0 14px #4CAF5088)' }}>
        <path d="M28 4L6 14v14c0 12 9.6 22.4 22 25.2C40.4 50.4 50 40 50 28V14L28 4z" stroke="#4CAF50" strokeWidth="1.5" />
        <polyline points="18,28 25,36 40,20" stroke="#4CAF50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: "You're protected",
    subtitle: 'Privacy is now your default.',
    body: 'Explore the sidebar to configure your privacy setup, manage history, bookmarks, and network monitoring. Press ? at any time to see all keyboard shortcuts.',
    accent: '#4CAF50',
  },
]

export default function OnboardingModal() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch { /* localStorage unavailable */ }
  }, [])

  const dismiss = () => {
    setClosing(true)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setTimeout(() => setVisible(false), 200)
  }

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div
      className={['fixed inset-0 z-[9998] flex items-center justify-center transition-opacity duration-200', closing ? 'opacity-0' : 'opacity-100'].join(' ')}
      style={{ background: 'rgba(18,18,22,0.92)', backdropFilter: 'blur(8px) saturate(1.4)' }}
    >
      <div
        className="relative flex flex-col border border-border w-[420px] max-w-[90vw] shadow-2xl"
        style={{
          background: 'rgb(18,18,22)',
          boxShadow: `0 0 0 1px rgba(250,45,72,0.14), 0 24px 80px rgba(18,18,22,0.92), 0 8px 32px rgba(58,60,72,0.3)`,
          borderColor: 'rgba(58,60,72,0.7)',
        }}
      >
        {/* Top accent bar — premium gradient */}
        <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent 0%, ${current.accent ?? '#FA2D48'} 35%, rgba(255,120,73,0.6) 65%, transparent 100%)` }} />

        {/* Skip */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-[10px] font-mono text-muted/50 hover:text-muted transition-colors"
        >
          skip
        </button>

        {/* Content */}
        <div className="flex flex-col items-center text-center px-10 pt-10 pb-8 gap-5">
          {/* Icon */}
          <div className="h-16 flex items-center justify-center">
            {current.icon}
          </div>

          {/* Text */}
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: current.accent ?? '#FA2D48' }}>
              {current.title}
            </h2>
            <p className="text-[12px] font-mono text-muted">{current.subtitle}</p>
          </div>

          <p className="text-[12px] text-text/70 leading-relaxed max-w-[320px]">
            {current.body}
          </p>

          {/* Step dots */}
          <div className="flex items-center gap-1.5 mt-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className="transition-all duration-150"
                style={{
                  width: i === step ? 20 : 6,
                  height: 4,
                  borderRadius: 2,
                  background: i === step ? (current.accent ?? '#FA2D48') : 'rgba(58,60,72,0.6)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center border-t border-border px-6 py-3 gap-3">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="text-[11px] font-mono text-muted/60 hover:text-muted disabled:opacity-0 transition-colors"
          >
            ← back
          </button>
          <div className="flex-1" />
          {isLast ? (
            <button
              onClick={dismiss}
              className="text-[11px] font-mono px-5 py-1.5 font-semibold text-black transition-all duration-100 active:scale-[0.95]"
              style={{ background: current.accent ?? '#FA2D48' }}
            >
              Start browsing →
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="text-[11px] font-mono px-5 py-1.5 border text-text hover:text-saffron hover:border-saffron transition-all duration-100 active:scale-[0.95]"
              style={{ borderColor: 'rgba(58,60,72,0.8)' }}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
