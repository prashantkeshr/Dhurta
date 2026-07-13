import React, { useState, useEffect, useRef, useCallback } from 'react'

type Mode = 'enter-pin' | 'setup-pin' | 'confirm-pin' | 'show-recovery' | 'recovery' | 'change-pin'

interface Props {
  hasPin: boolean
  onUnlocked: () => void
}

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'
const api = () => window.dhurta

export default function LockScreen({ hasPin, onUnlocked }: Props) {
  const [mode,      setMode]      = useState<Mode>(hasPin ? 'enter-pin' : 'setup-pin')
  const [pin,       setPin]       = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [oldPin,    setOldPin]    = useState('')
  const [newPin,    setNewPin]    = useState('')
  const [newPinC,   setNewPinC]   = useState('')
  const [recovery,  setRecovery]  = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error,     setError]     = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const pinRef     = useRef<HTMLInputElement>(null)
  const recRef     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => pinRef.current?.focus(), 80)
  }, [mode])

  const handleUnlock = useCallback(async () => {
    if (!pin.trim()) return
    const r = await api().appLockUnlock(pin)
    if (r.ok) { onUnlocked(); return }
    setError('Incorrect PIN. Try again.')
    setPin('')
    setTimeout(() => pinRef.current?.focus(), 50)
  }, [pin, onUnlocked])

  const handleSetup = useCallback(async () => {
    if (pin.length < 4) { setError('PIN must be at least 4 characters.'); return }
    if (mode === 'setup-pin') { setMode('confirm-pin'); setError(''); return }
    if (pin !== confirm) { setError('PINs do not match.'); setConfirm(''); return }
    const r = await api().appLockSetup(pin)
    setRecovery(r.recovery)
    setMode('show-recovery')
    setError('')
  }, [pin, confirm, mode])

  const handleRecover = useCallback(async () => {
    if (!recoveryInput.trim()) return
    const r = await api().appLockRecover(recoveryInput)
    if (r.ok) {
      setMode('setup-pin')
      setPin(''); setConfirm(''); setError('')
    } else {
      setError('Recovery phrase is incorrect.')
    }
  }, [recoveryInput])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'enter-pin')    handleUnlock()
      else if (mode === 'setup-pin')   handleSetup()
      else if (mode === 'confirm-pin') handleSetup()
      else if (mode === 'recovery')    handleRecover()
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#080808]"
      style={{ backdropFilter: 'none' }}>

      {/* Back button — only shown during lock setup when there's no existing PIN */}
      {!hasPin && (mode === 'setup-pin' || mode === 'confirm-pin') && (
        <button
          onClick={onUnlocked}
          className="absolute top-3 left-3 flex items-center gap-1.5 text-muted hover:text-text transition-colors text-xs font-mono"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
            <polyline points="9,2 4,7 9,12" />
          </svg>
          Back
        </button>
      )}

      {/* Decorative glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, #FF450008 0%, transparent 70%)' }} />

      <div className="relative flex flex-col items-center gap-6 px-8 py-10 w-80">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <img src="./dhurta-logo.png" alt="Dhurta" className="w-14 h-14 object-contain opacity-90"
            style={{ filter: 'drop-shadow(0 0 12px #FF450066)' }} />
          <p className="text-[10px] font-mono text-saffron uppercase tracking-[0.3em]">
            {mode === 'show-recovery' ? 'Save Recovery Phrase' :
             mode === 'recovery'      ? 'Account Recovery' :
             mode === 'setup-pin'     ? 'Create Browser Lock' :
             mode === 'confirm-pin'   ? 'Confirm Your PIN' :
             'Browser Locked'}
          </p>
        </div>

        {/* ── Enter PIN ── */}
        {mode === 'enter-pin' && (
          <>
            <PinDots value={pin} />
            <input
              ref={pinRef}
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              placeholder="Enter PIN"
              className="w-full bg-transparent border-b border-border focus:border-saffron text-center text-lg font-mono text-text outline-none py-2 transition-colors tracking-[0.5em]"
              autoComplete="off"
            />
            {error && <p className="text-[10px] font-mono text-red-400 text-center">{error}</p>}
            <button onClick={handleUnlock}
              className="w-full py-2.5 bg-saffron text-black font-mono text-xs uppercase tracking-widest hover:bg-orange-400 transition-colors">
              Unlock
            </button>
            <button onClick={() => { setMode('recovery'); setError('') }}
              className="text-[9px] font-mono text-muted hover:text-saffron transition-colors">
              Forgot PIN? Use recovery phrase
            </button>
          </>
        )}

        {/* ── Setup PIN ── */}
        {(mode === 'setup-pin' || mode === 'confirm-pin') && (
          <>
            <p className="text-[10px] font-mono text-muted text-center leading-relaxed">
              {mode === 'setup-pin'
                ? 'Create a PIN to lock Dhurta. You\'ll need it every time the browser starts.'
                : 'Enter your PIN again to confirm.'}
            </p>
            <PinDots value={mode === 'setup-pin' ? pin : confirm} />
            <input
              ref={pinRef}
              type="password"
              value={mode === 'setup-pin' ? pin : confirm}
              onChange={e => {
                setError('')
                if (mode === 'setup-pin') setPin(e.target.value)
                else setConfirm(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'setup-pin' ? 'Create PIN (min 4 chars)' : 'Confirm PIN'}
              className="w-full bg-transparent border-b border-border focus:border-saffron text-center text-lg font-mono text-text outline-none py-2 transition-colors tracking-[0.5em]"
              autoComplete="new-password"
            />
            {error && <p className="text-[10px] font-mono text-red-400 text-center">{error}</p>}
            <button onClick={handleSetup}
              className="w-full py-2.5 bg-saffron text-black font-mono text-xs uppercase tracking-widest hover:bg-orange-400 transition-colors">
              {mode === 'setup-pin' ? 'Next' : 'Create Lock'}
            </button>
            {mode === 'confirm-pin' && (
              <button onClick={() => { setMode('setup-pin'); setConfirm(''); setError('') }}
                className="text-[9px] font-mono text-muted hover:text-saffron transition-colors">
                ← Back
              </button>
            )}
          </>
        )}

        {/* ── Show recovery phrase ── */}
        {mode === 'show-recovery' && (
          <>
            <div className="w-full border border-saffron/40 bg-obsidian p-4 space-y-3">
              <p className="text-[9px] font-mono text-saffron uppercase tracking-widest">Your Recovery Phrase</p>
              <div className="grid grid-cols-3 gap-2">
                {recovery.split(' ').map((word, i) => (
                  <div key={i} className="border border-border px-2 py-1 text-center">
                    <span className="text-[8px] font-mono text-muted block">{i + 1}</span>
                    <span className="text-[11px] font-mono text-text">{word}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] font-mono text-muted leading-relaxed">
                Write this down and keep it safe. It is the only way to recover access if you forget your PIN.
                This phrase will never be shown again.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                className="w-3 h-3 accent-saffron" />
              <span className="text-[9px] font-mono text-muted">I have saved my recovery phrase</span>
            </label>
            <button
              onClick={() => { if (confirmed) onUnlocked() }}
              disabled={!confirmed}
              className="w-full py-2.5 bg-saffron text-black font-mono text-xs uppercase tracking-widest hover:bg-orange-400 transition-colors disabled:opacity-40">
              Enter Dhurta
            </button>
          </>
        )}

        {/* ── Recovery ── */}
        {mode === 'recovery' && (
          <>
            <p className="text-[10px] font-mono text-muted text-center leading-relaxed">
              Enter your 6-word recovery phrase exactly as written.
            </p>
            <textarea
              ref={recRef as any}
              value={recoveryInput}
              onChange={e => { setRecoveryInput(e.target.value); setError('') }}
              placeholder="word1 word2 word3 word4 word5 word6"
              rows={3}
              className="w-full bg-obsidian border border-border focus:border-saffron text-xs font-mono text-text outline-none px-3 py-2 resize-none transition-colors"
              autoComplete="off"
            />
            {error && <p className="text-[10px] font-mono text-red-400 text-center">{error}</p>}
            <button onClick={handleRecover}
              className="w-full py-2.5 bg-saffron text-black font-mono text-xs uppercase tracking-widest hover:bg-orange-400 transition-colors">
              Recover Access
            </button>
            <button onClick={() => { setMode('enter-pin'); setError('') }}
              className="text-[9px] font-mono text-muted hover:text-saffron transition-colors">
              ← Back to PIN entry
            </button>
            <div className="border-t border-border/40 pt-3 w-full space-y-1">
              <p className="text-[9px] font-mono text-muted/60 text-center leading-relaxed">
                Recovery works offline — no internet needed.
                Your recovery phrase was shown once when you set up the lock.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PinDots({ value }: { value: string }) {
  const dots = Math.min(value.length, 8)
  return (
    <div className="flex gap-2 h-3 items-center">
      {Array.from({ length: Math.max(dots, 4) }, (_, i) => (
        <div key={i}
          className={['w-2.5 h-2.5 rounded-full border transition-all duration-150',
            i < dots ? 'bg-saffron border-saffron scale-110' : 'bg-transparent border-border',
          ].join(' ')} />
      ))}
    </div>
  )
}
