import { useEffect, useRef, useState } from 'react'

const isElectron = typeof window !== 'undefined' && typeof (window as any).dhurta !== 'undefined'
const api = () => (window as any).dhurta

interface Props {
  activeTabId: number
  activeTabLoading: boolean
  ghostMode: boolean
  ipRotationActive: boolean
}

// How long a tab can sit "loading" before we suggest the connection itself
// (not just this one site) might be the problem. Free VPN proxies and Tor
// relays are the two rails this app can actually offer to swap out, so the
// suggestion only makes sense while one of those is actually in play.
const SLOW_LOAD_MS = 8000

// Per-symptom troubleshooting copy, keyed by Chromium's did-fail-load error
// code (same codes electron/offline.html's CODES map already recognizes).
// Covers the recurring complaints on a flaky free proxy/Tor relay: outright
// connection drops, timeouts, and the proxy itself being unreachable — each
// gets its own short, specific line instead of one generic "failed to load".
const ERROR_MESSAGES: Record<number, { title: string; hint: string }> = {
  [-2]:   { title: 'This page failed to load.',            hint: 'Connection failed partway through.' },
  [-6]:   { title: 'Page not found.',                       hint: 'The address itself may be wrong, but a flaky exit node can also cause this.' },
  [-7]:   { title: 'The request timed out.',                hint: 'The current server is too slow to respond.' },
  [-21]:  { title: 'Network changed mid-request.',          hint: 'Your connection switched — the current server may no longer be reachable.' },
  [-100]: { title: 'Connection closed.',                    hint: 'The server dropped the connection unexpectedly.' },
  [-101]: { title: 'Connection reset.',                     hint: 'The server or exit node reset the connection.' },
  [-102]: { title: 'Connection refused.',                   hint: 'The current server actively refused the request.' },
  [-103]: { title: 'Connection aborted.',                   hint: 'The connection dropped before finishing.' },
  [-104]: { title: 'Connection failed.',                    hint: 'Could not reach the destination through the current server.' },
  [-105]: { title: 'DNS lookup failed.',                    hint: "The current server couldn't resolve this address." },
  [-106]: { title: 'Connection out — no internet reachable via the current server.', hint: 'The exit node itself may be down.' },
  [-109]: { title: 'Address unreachable.',                  hint: 'The destination cannot be reached through the current route.' },
  [-110]: { title: 'Connection timed out.',                 hint: 'The current server took too long to respond.' },
  [-118]: { title: 'Empty response from server.',           hint: 'The current exit node returned nothing.' },
  [-130]: { title: 'Proxy unavailable.',                    hint: 'The current VPN/Tor endpoint cannot be reached right now.' },
  [-133]: { title: 'Tunnel connection failed.',              hint: 'Could not establish a tunnel through the current server.' },
  [-135]: { title: 'Proxy authentication required.',        hint: 'The current server rejected the connection.' },
  [-137]: { title: 'Name resolution failed.',                hint: "The current server couldn't resolve this address." },
}

const DEFAULT_ERROR_MESSAGE = { title: 'This site is not working right now.', hint: 'The current server may be flaky or overloaded.' }

// Surfaces the same "try another server" idea for two different symptoms a
// user hits on a flaky free proxy or a slow Tor relay: an outright load
// failure, or a page that's just sitting there loading. Both get the same
// one-click fix (rotate + reload) so the user isn't left guessing why a site
// won't come up, or stuck waiting indefinitely with no obvious next step.
//
// This component owns all the STATE (error/slow detection, dismissal, retry)
// but renders no DOM of its own — the actual card is a separate native
// BrowserWindow (electron/connectionTroublePopup.html) managed by main
// process. BrowserView (the tab's real content) is a native layer that always
// paints above regular HTML, so an inline banner here would either get
// covered by it or force the header taller to carve out room; a sibling
// always-on-top window floats above both without touching layout, the same
// technique already used for the download/warmth popups.
export default function ConnectionTroubleBanner({
  activeTabId, activeTabLoading, ghostMode, ipRotationActive,
}: Props) {
  const [errorInfo, setErrorInfo] = useState<{ code: number; desc: string; url: string } | null>(null)
  const [isSlow, setIsSlow] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  // The main process reacts to a failed load by immediately loading the local
  // offline.html fallback page ON THE SAME webContents (see electron/ipc.ts's
  // did-fail-load handler) — which fires its own did-start-loading a moment
  // later. That loading-start would otherwise hit the effect below and wipe
  // the error state we just set, before the popup ever shows it (confirmed
  // live). This ref lets onLoadError tell that effect "the next loading-start
  // you see is just the fallback page, not a new navigation — ignore it."
  const suppressNextReset = useRef(false)

  // Only Ghost (Tor) and Chakra/VPN (ipRotation) tabs ride a rail this popup
  // can actually rotate. A failure/slowdown in plain Normal browsing is just
  // the real internet being slow — "switch server" wouldn't do anything.
  const behindProtection = ghostMode || ipRotationActive

  // A failed load on the active tab. -3 (ERR_ABORTED) is the user navigating
  // away mid-load, not a real failure, so it's excluded.
  useEffect(() => {
    if (!isElectron) return
    const onLoadError = (data: { id: number; code: number; desc: string; url: string }) => {
      if (data.id !== activeTabId || data.code === -3) return
      suppressNextReset.current = true
      setErrorInfo({ code: data.code, desc: data.desc, url: data.url })
      setDismissed(false)
      setActionMsg('')
    }
    api().on('tab:loadError', onLoadError)
    return () => api().off('tab:loadError', onLoadError)
  }, [activeTabId])

  // Switching tabs always starts fresh, regardless of the newly-active tab's
  // loading state — otherwise a stale error/popup from the PREVIOUS tab could
  // linger onto a different one.
  useEffect(() => {
    setErrorInfo(null)
    setIsSlow(false)
    setDismissed(false)
    setActionMsg('')
  }, [activeTabId])

  // A NEW load starting (on the same or a newly-switched-to tab) resets state
  // and arms the slow-load timer. Deliberately does NOT fire on the loading-
  // to-false transition: Chromium fires did-stop-loading immediately after
  // did-fail-load, so a naive "reset on any loading change" would wipe the
  // error state the instant onLoadError had just set it.
  useEffect(() => {
    if (!activeTabLoading) return
    if (suppressNextReset.current) {
      // This loading-start is the offline.html fallback the main process just
      // triggered in response to the error we're currently showing — not a
      // real new navigation. Consume the flag and leave the state alone.
      suppressNextReset.current = false
      return
    }
    setErrorInfo(null)
    setIsSlow(false)
    setDismissed(false)
    setActionMsg('')
    const t = setTimeout(() => setIsSlow(true), SLOW_LOAD_MS)
    return () => clearTimeout(t)
  }, [activeTabId, activeTabLoading])

  const visible = behindProtection && !dismissed && (!!errorInfo || isSlow)

  const handleSwitch = async () => {
    setBusy(true)
    setActionMsg(ghostMode ? 'Requesting a new Tor circuit…' : 'Switching VPN server…')
    try {
      if (ghostMode) {
        const res = await api().torNewnym()
        setActionMsg(res.success ? 'New circuit ready — reloading…' : (res.error ?? 'Could not rotate circuit right now.'))
      } else {
        const res = await api().vpnRotate()
        setActionMsg(res.success ? `Now via ${res.proxy} — reloading…` : (res.error ?? 'Could not switch server right now.'))
      }
      // A failed load means the active tab is currently showing the local
      // offline.html fallback, not the original site — reload() would just
      // refresh that harmless local page instead of retrying the real URL.
      // Only a genuinely still-loading (slow) tab is safe to plain-reload.
      if (errorInfo) {
        await api().loadURL(errorInfo.url)
      } else {
        await api().reload(activeTabId)
      }
      setErrorInfo(null)
      setIsSlow(false)
    } finally {
      setBusy(false)
    }
  }

  // Listen for button clicks forwarded from the native popup window.
  useEffect(() => {
    if (!isElectron) return
    const onAction = (action: string) => {
      if (action === 'dismiss') setDismissed(true)
      else if (action === 'switch') handleSwitch()
    }
    api().on('connTrouble:action', onAction)
    return () => api().off('connTrouble:action', onAction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorInfo, ghostMode, activeTabId])

  // Show/update/hide the native popup whenever the computed state changes.
  useEffect(() => {
    if (!isElectron) return
    if (!visible) {
      api().hideConnTroublePopup()
      return
    }
    const { title, hint } = errorInfo
      ? (ERROR_MESSAGES[errorInfo.code] ?? DEFAULT_ERROR_MESSAGE)
      : { title: 'This page is taking a while to load.', hint: 'The current server may be slow or overloaded.' }
    const fixHint = ghostMode ? 'Try requesting a fresh Tor circuit.' : 'Try switching the VPN server.'
    api().showConnTroublePopup({
      title,
      hint: `${hint} ${fixHint}`,
      actionMsg,
      busy,
      buttonLabel: ghostMode ? '🧅 New Circuit' : '🔄 Switch VPN Server',
    })
  }, [visible, errorInfo, isSlow, ghostMode, actionMsg, busy])

  // Hide the popup on unmount (e.g. app closing down mid-error).
  useEffect(() => {
    if (!isElectron) return
    return () => { api().hideConnTroublePopup() }
  }, [])

  return null
}
