// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — orchestrator / single entry point
// ─────────────────────────────────────────────────────────────────────────────
// Ties the four specialist modules (tor, vpn, sessions, leakcheck) together,
// registers every network IPC handler, runs the Tor NEWNYM auto-rotation timer,
// and owns the three-mode composition (Normal / Chakra / Ghost).
//
// The net layer never reaches into tab state or the DB directly. The host app
// (ipc.ts) calls registerNetworkLayer(deps) once, passing the hooks the layer
// needs; from those we build a NetContext that the modules consume.
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain } from 'electron'
import type { BrowserWindow, Session } from 'electron'
import type { NetContext } from './types'
import {
  startTor, stopTor, isTorReady, sendNewnym, getCircuitCount,
  setExitNodeCountry, onTorReady, onTorExit, onBootstrapProgress, getBootstrapProgress,
} from './tor'
import {
  vpnConnect, vpnDisconnect, vpnRotate, applyKillSwitch, releaseKillSwitch,
  applyProxyToAllSessions, fetchFreeProxy, isProxyAlive,
} from './vpn'
import { checkPublicIp, checkRealIp } from './leakcheck'
import { applyGhostPermissionsAndHeaders, applyTorProxyRule } from './sessions'
import { SETTINGS } from './types'

// Re-export the session-hardening helpers and Tor status so the tab manager
// (createBrowserView) can pull them from one place.
export { hardenGhostSession, hardenNormalSession, webRTCPolicyFor } from './sessions'
export { isTorReady, getTorProxyRules } from './tor'
export type { NetContext } from './types'

// ── Host dependency surface ──────────────────────────────────────────────────
// Everything the net layer needs from the rest of the app. ipc.ts owns tab
// state and the DB, so it supplies these.
export interface NetHostDeps {
  /** default session + persist:default + every open non-ghost tab session. */
  getNonGhostSessions(): Session[]
  /** session for a tab id, or the primary normal session when omitted. */
  getTabSession(tabId?: number): Session | null
  /** the main window, or null before/after it exists. */
  getMainWindow(): BrowserWindow | null
  /** read a persisted setting (null if unset). */
  getSetting(key: string): string | null
  /** persist a setting. */
  setSetting(key: string, value: string): void
  /** enable the ad/tracker blocker on a session. */
  enableAdBlocker(sess: Session): void
  /** Called right after ghost sessions are upgraded from the fast proxy rail to
   *  real Tor. Swapping a session's proxy does NOT retroactively re-route
   *  content already rendered — without this hook the user keeps looking at a
   *  fast-rail page with no visible sign Tor took over. ipc.ts finds the tabs
   *  backed by these sessions and reloads them (skipping the internal new-tab
   *  page, where there's nothing to reload). */
  onGhostSessionsUpgraded(sessions: Session[]): void
}

let _deps: NetHostDeps | null = null
let _ctx: NetContext | null = null

// Ghost / circuit-rotation state
let ghostEnabled = false
let _newnymTimer: ReturnType<typeof setInterval> | null = null

// Ghost sessions currently riding the fast proxy rail, waiting to be upgraded to
// real Tor onion routing the moment Tor finishes bootstrapping. See openGhostSession.
const _pendingTorUpgrade = new Set<Session>()

/** Crash-safe renderer send — never touches a destroyed window. */
function safeSend(channel: string, ...args: unknown[]): void {
  const win = _deps?.getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/** Start the 5-minute NEWNYM auto-rotation loop (idempotent). */
function startNewnymTimer(): void {
  if (_newnymTimer) return
  _newnymTimer = setInterval(async () => {
    if (!isTorReady()) return
    try {
      await sendNewnym()
      safeSend('tor:circuitRotated', getCircuitCount())
    } catch (e) {
      console.warn('[Net] Auto-NEWNYM failed:', e)
    }
  }, 5 * 60 * 1000)
}

function stopNewnymTimer(): void {
  if (_newnymTimer) { clearInterval(_newnymTimer); _newnymTimer = null }
}

/** Build the NetContext the modules consume from the host deps. */
function buildContext(deps: NetHostDeps): NetContext {
  return {
    getNonGhostSessions: () => deps.getNonGhostSessions(),
    getTabSession: (tabId?: number) => deps.getTabSession(tabId),
    getSetting: (key: string) => deps.getSetting(key),
    setSetting: (key: string, value: string) => deps.setSetting(key, value),
    sendToRenderer: (channel: string, ...args: unknown[]) => safeSend(channel, ...args),
    enableAdBlocker: (sess: Session) => deps.enableAdBlocker(sess),
  }
}

/** True once registerNetworkLayer has run — createBrowserView guards on this. */
export function netReady(): boolean {
  return _ctx !== null
}

/** The shared NetContext, for the tab manager's session-hardening calls. */
export function netContext(): NetContext {
  if (!_ctx) throw new Error('Network layer not registered yet')
  return _ctx
}

// ── Progressive Ghost session — instant open, silent upgrade to Tor ──────────
// A cold Tor bootstrap takes ~15-25s. Blocking ghost-tab creation on that (the
// original design) meant every "enable Ghost Mode" click either sat on a spinner
// for that long or failed outright if Tor couldn't start at all — and any orphan/
// port issue turned into "Ghost Mode is broken" from the user's perspective.
//
// Instead: open the tab immediately on whichever proxy is fastest to get (an
// already-active VPN proxy, instantly; otherwise a fresh free-proxy fetch, a few
// seconds), and register the session to be silently re-pointed at the real Tor
// SOCKS listener the instant Tor finishes bootstrapping in the background. If
// NEITHER a cached nor a fresh proxy is available, fall back to the original
// fail-closed behavior (apply the Tor rule anyway — Chromium blocks with
// ECONNREFUSED rather than ever leaking direct). The real IP is never exposed on
// any path; the only thing that varies is how many hops protect it while Tor
// finishes coming up.
export async function openGhostSession(
  ctx: NetContext, sess: Session
): Promise<{ rail: 'tor' | 'proxy' | 'pending'; proxy?: string }> {
  applyGhostPermissionsAndHeaders(ctx, sess)

  if (isTorReady()) {
    await applyTorProxyRule(sess)
    return { rail: 'tor' }
  }

  // Tor isn't up yet. Prefer an already-active VPN proxy — instant, no network
  // round-trip. Otherwise fetch a fresh one in parallel with Tor's own bootstrap
  // (which ghost:enable already kicked off). Never touch the DB directly — go
  // through ctx, per the net-layer contract.
  const cachedProxy = ctx.getSetting(SETTINGS.activeProxy)
  const fastProxy = cachedProxy || await fetchFreeProxy().catch(() => null)

  if (fastProxy) {
    await sess.setProxy({ proxyRules: `socks5://${fastProxy}`, proxyBypassRules: '' })
    _pendingTorUpgrade.add(sess)
    onTorReady(() => upgradePendingGhostSessions())
    return { rail: 'proxy', proxy: fastProxy }
  }

  // No fast proxy available either — fail closed exactly as before: the Tor rule
  // blocks (ECONNREFUSED) until Tor bootstraps, never a direct/unprotected leak.
  await applyTorProxyRule(sess)
  _pendingTorUpgrade.add(sess)
  onTorReady(() => upgradePendingGhostSessions())
  return { rail: 'pending' }
}

/** Re-point every ghost session still on the fast rail at the real Tor listener,
 *  reload the tabs backed by them (a proxy swap doesn't retroactively re-route
 *  already-rendered content), then notify the renderer so the UI can drop its
 *  "single-hop" indicator. */
function upgradePendingGhostSessions(): void {
  if (_pendingTorUpgrade.size === 0) return
  const sessions = [..._pendingTorUpgrade]
  _pendingTorUpgrade.clear()
  Promise.all(sessions.map(s => applyTorProxyRule(s).catch(() => {})))
    .then(() => {
      try { _deps?.onGhostSessionsUpgraded(sessions) } catch (_) {}
      safeSend('ghost:upgradedToTor', sessions.length)
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration — call ONCE from ipc.ts's registerIpcHandlers().
// ─────────────────────────────────────────────────────────────────────────────
export function registerNetworkLayer(deps: NetHostDeps): void {
  _deps = deps
  _ctx = buildContext(deps)
  const ctx = _ctx

  // Tor crashed after being ready → warn the renderer so Ghost UI can react.
  onTorExit(() => safeSend('ghost:tor-crashed'))

  // Push every bootstrap progress update to the renderer so the Ghost Mode
  // banner can show a live percentage + ETA instead of a silent wait.
  onBootstrapProgress((p) => safeSend('tor:bootstrapProgress', p))

  // ── Ghost Mode ─────────────────────────────────────────────────────────────
  // Returns IMMEDIATELY — never blocks on Tor's ~15-25s bootstrap. `tor: true`
  // only reflects whether Tor happens to already be ready (e.g. re-enabling
  // Ghost Mode after a prior session left it running). Tor boots in the
  // background; ghost tabs open right away on the fast proxy rail and silently
  // upgrade via 'ghost:upgradedToTor' the moment bootstrap completes. A hard
  // failure to start Tor at all is reported asynchronously via 'ghost:tor-failed'
  // rather than blocking the caller waiting to find out.
  ipcMain.handle('ghost:enable', () => {
    ghostEnabled = true
    const exit = ctx.getSetting(SETTINGS.exitNodeCountry)
    startTor(exit && exit !== 'any' ? exit : null)
      .then(() => startNewnymTimer())
      .catch((e: any) => {
        const msg = e?.message ?? String(e)
        console.error('[Net] Tor failed to start:', msg)
        safeSend('ghost:tor-failed', msg)
      })
    return { tor: isTorReady() }
  })

  ipcMain.handle('ghost:disable', () => {
    ghostEnabled = false
    stopNewnymTimer()
    // Tor is left running so re-enabling Ghost is instant; it's force-killed on
    // app quit (tor.stopTor via before-quit). Ghost tabs close with their
    // in-memory sessions, so nothing persists regardless.
  })

  ipcMain.handle('ghost:state', () => ghostEnabled)
  ipcMain.handle('ghost:torStatus', () => isTorReady())

  // Exit-node country: persist + apply. If Tor is live, restart it so the new
  // ExitNodes torrc line takes effect, then re-seal proxies on open ghost tabs.
  ipcMain.handle('ghost:setExitNode', async (_e, country: string | null) => {
    const cc = country && country !== 'any' ? country : null
    ctx.setSetting(SETTINGS.exitNodeCountry, cc ?? 'any')
    setExitNodeCountry(cc)
    if (!isTorReady()) return { success: true, restarted: false }
    stopTor()
    try {
      await startTor(cc)
      return { success: true, restarted: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) }
    }
  })

  // ── Tor circuits (NEWNYM) ────────────────────────────────────────────────────
  ipcMain.handle('tor:newnym', async () => {
    try {
      await sendNewnym()
      return { success: true, count: getCircuitCount() }
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) }
    }
  })
  ipcMain.handle('tor:circuitCount', () => getCircuitCount())

  // Current bootstrap progress snapshot — for a banner that mounts after
  // bootstrap already started (e.g. re-render, or app restart mid-boot).
  ipcMain.handle('tor:getBootstrapProgress', () => getBootstrapProgress())

  // ── VPN / free proxy ─────────────────────────────────────────────────────────
  ipcMain.handle('vpn:connect', (_e, country?: string) => vpnConnect(ctx, country))
  ipcMain.handle('vpn:disconnect', () => vpnDisconnect(ctx))
  ipcMain.handle('vpn:rotate', () => vpnRotate(ctx))

  // Security-panel aliases (same engine, older channel names the panel calls).
  ipcMain.handle('security:setIPRotation', async (_e, enabled: boolean) => {
    if (enabled) return vpnConnect(ctx)
    await vpnDisconnect(ctx)
    return { success: true }
  })
  ipcMain.handle('security:rotateProxy', () => vpnRotate(ctx))

  // ── Kill-switch — seals traffic during mode transitions (fail closed) ────────
  ipcMain.handle('net:killSwitch', () => applyKillSwitch(ctx))
  ipcMain.handle('net:release', () => releaseKillSwitch(ctx))

  // ── Leak checks ──────────────────────────────────────────────────────────────
  ipcMain.handle('omni:checkIp', (_e, tabId?: number) => checkPublicIp(ctx, tabId))
  ipcMain.handle('omni:checkRealIp', () => checkRealIp())
}

/** Restore the VPN proxy on startup if it was active last session (called from
 *  ipc.ts after createWindow, once tab sessions can receive it). */
export async function restoreVpnOnStartup(): Promise<void> {
  if (!_ctx) return
  if (_ctx.getSetting(SETTINGS.ipRotation) !== 'true') return
  const proxy = _ctx.getSetting(SETTINGS.activeProxy)
  // Free proxies routinely die between restarts (short-lived by nature) — blindly
  // re-applying a saved-but-dead proxy would silently perpetuate broken browsing
  // across every subsequent launch, since nothing would ever try a fresh one
  // again. Verify it's still alive first; only reuse it if it genuinely still
  // works, otherwise fall through to fetching a fresh proxy exactly like the
  // "no proxy saved yet" case below.
  if (proxy && await isProxyAlive(proxy)) {
    await applyProxyToAllSessions(_ctx, `socks5://${proxy}`)
  } else {
    // Either no proxy was saved (e.g. Chakra just flipped it on first run), or
    // the saved one is dead — fetch a fresh one. vpnConnect seals + persists
    // activeProxy itself, and its own fetchFreeProxy already verifies liveness.
    await vpnConnect(_ctx, _ctx.getSetting(SETTINGS.vpnCountry) ?? undefined)
  }
}
