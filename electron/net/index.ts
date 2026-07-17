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
  setExitNodeCountry, onTorExit,
} from './tor'
import {
  vpnConnect, vpnDisconnect, vpnRotate, applyKillSwitch, releaseKillSwitch,
  applyProxyToAllSessions,
} from './vpn'
import { checkPublicIp, checkRealIp } from './leakcheck'
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
}

let _deps: NetHostDeps | null = null
let _ctx: NetContext | null = null

// Ghost / circuit-rotation state
let ghostEnabled = false
let _newnymTimer: ReturnType<typeof setInterval> | null = null

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

// ─────────────────────────────────────────────────────────────────────────────
// Registration — call ONCE from ipc.ts's registerIpcHandlers().
// ─────────────────────────────────────────────────────────────────────────────
export function registerNetworkLayer(deps: NetHostDeps): void {
  _deps = deps
  _ctx = buildContext(deps)
  const ctx = _ctx

  // Tor crashed after being ready → warn the renderer so Ghost UI can react.
  onTorExit(() => safeSend('ghost:tor-crashed'))

  // ── Ghost Mode ─────────────────────────────────────────────────────────────
  ipcMain.handle('ghost:enable', async () => {
    ghostEnabled = true
    try {
      const exit = ctx.getSetting(SETTINGS.exitNodeCountry)
      await startTor(exit && exit !== 'any' ? exit : null)
      startNewnymTimer()
      return { tor: true }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      console.error('[Net] Tor failed to start:', msg)
      return { tor: false, error: msg }
    }
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
  if (proxy) {
    // Re-apply the previously active proxy so VPN survives restarts.
    await applyProxyToAllSessions(_ctx, `socks5://${proxy}`)
  } else {
    // VPN was on but no proxy saved (e.g. Chakra just flipped it on first run) —
    // fetch a fresh one. vpnConnect seals + persists activeProxy itself.
    await vpnConnect(_ctx, _ctx.getSetting(SETTINGS.vpnCountry) ?? undefined)
  }
}
