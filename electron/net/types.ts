// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — shared contract
// ─────────────────────────────────────────────────────────────────────────────
// This is the single source of truth every net/ module builds against. The
// modules (tor, vpn, sessions, leakcheck) MUST NOT import from each other's
// implementation — they depend only on this file and on `electron`. The
// orchestrator (net/index.ts) wires them together and supplies a NetContext.
//
// Design rule: the net layer is decoupled from tab management and the database.
// It never reaches into the `tabs` map or `getDb()` directly. Instead every
// function that needs sessions/settings/renderer access takes a `NetContext`,
// which net/index.ts implements against the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────

import type { Session } from 'electron'

// ── Fixed, private ports (chosen to never collide with a real Tor Browser 9150) ──
export const PORTS = {
  /** Tor SOCKS5 listener — ghost tabs proxy through this via plain socks5://
   *  (NOT socks5h — Chromium doesn't recognize that scheme; its SOCKS5 client
   *  already resolves DNS through the proxy by default). */
  torSocks: 19050,
  /** Tor control port — NEWNYM circuit rotation, no auth, loopback only. */
  torControl: 19051,
  /** Tor DNS listener — resolution happens inside Tor, never at the ISP. */
  torDns: 19053,
} as const

/** Kill-switch target: a dead loopback port so every request fails closed
 *  (ERR_PROXY_CONNECTION_FAILED) instead of silently falling back to direct. */
export const KILLSWITCH_RULES = 'socks5://127.0.0.1:1'

/** Plain Chrome UA — strips "Electron/x.x" which makes sites render broken. */
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── Persisted settings keys (sqlite `settings` table; written by the UI) ──
export const SETTINGS = {
  ipRotation:      'security_ipRotation',
  antiFingerprint: 'security_antiFingerprint',
  blockWebRTC:     'security_blockWebRTC',
  autoClean:       'security_autoClean',
  cookieGuard:     'security_cookieGuard',
  adBlocker:       'security_adBlocker',
  activeProxy:     'activeProxy',
  vpnCountry:      'vpnCountry',
  exitNodeCountry: 'torExitNode',
} as const

// ── Shared data types ────────────────────────────────────────────────────────

/** Result of an IP / geo lookup (checkPublicIp, checkRealIp, lookupIp). */
export interface IpInfo {
  success: boolean
  ip?: string
  country?: string
  countryCode?: string
  city?: string
  region?: string
  lat?: number
  lon?: number
  org?: string
  error?: string
}

/** Result of a VPN connect / rotate. */
export interface ProxyResult {
  success: boolean
  proxy?: string
  country?: string
  error?: string
}

/** Result of enabling Ghost Mode (Tor). */
export interface GhostEnableResult {
  tor: boolean
  error?: string
}

/** Result of a manual NEWNYM request. */
export interface NewnymResult {
  success: boolean
  count?: number
  error?: string
}

/** Result of applying a Tor exit-node country. */
export interface ExitNodeResult {
  success: boolean
  restarted?: boolean
  error?: string
}

// ── NetContext — the dependency surface the orchestrator supplies ────────────
// Modules call these instead of importing tab state or the DB directly.
export interface NetContext {
  /** default session + persist:default + every OPEN non-ghost tab session.
   *  Used by proxy application and the kill-switch (never includes ghost tabs). */
  getNonGhostSessions(): Session[]
  /** Session for a given tab id, or the primary normal session when omitted.
   *  Used by checkPublicIp to see what a specific tab currently sees. */
  getTabSession(tabId?: number): Session | null
  /** Read a persisted setting (null if unset). */
  getSetting(key: string): string | null
  /** Persist a setting (INSERT OR REPLACE). */
  setSetting(key: string, value: string): void
  /** Fire an event to the renderer — MUST be crash-safe (isDestroyed guarded). */
  sendToRenderer(channel: string, ...args: unknown[]): void
  /** Enable the ad/tracker blocker on a session (ghost tabs need it per-session). */
  enableAdBlocker(sess: Session): void
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE EXPORT CONTRACTS  (index.ts imports exactly these; do not deviate)
// ─────────────────────────────────────────────────────────────────────────────
//
// net/tor.ts — Tor onion server lifecycle + circuits
//   startTor(exitCountry?: string | null): Promise<{ socksPort: number }>
//   stopTor(): void
//   isTorReady(): boolean
//   getTorProxyRules(): string            // 'socks5://127.0.0.1:19050'
//   sendNewnym(): Promise<void>           // increments circuit count on 250 OK
//   getCircuitCount(): number
//   setExitNodeCountry(cc: string | null): void
//   onTorReady(cb: () => void): void      // fires immediately if already ready
//   onTorExit(cb: () => void): void       // fires on crash after being ready
//
// net/vpn.ts — free-proxy VPN engine + proxy application + kill-switch
//   fetchFreeProxy(country?: string): Promise<string | null>
//   applyProxyToAllSessions(ctx: NetContext, rules: string): Promise<void>
//   applyKillSwitch(ctx: NetContext): Promise<void>
//   releaseKillSwitch(ctx: NetContext): Promise<void>   // -> direct://
//   vpnConnect(ctx: NetContext, country?: string): Promise<ProxyResult>
//   vpnDisconnect(ctx: NetContext): Promise<void>
//   vpnRotate(ctx: NetContext): Promise<ProxyResult>
//
// net/sessions.ts — per-session hardening (called by the tab manager)
//   hardenGhostSession(ctx: NetContext, sess: Session): Promise<void>
//   hardenNormalSession(ctx: NetContext, sess: Session): Promise<void>
//   webRTCPolicyFor(ghost: boolean, blockWebRTC: boolean):
//       'default' | 'disable_non_proxied_udp'
//
// net/leakcheck.ts — IP / DNS leak telemetry
//   lookupIp(sess: Session): Promise<IpInfo>
//   checkPublicIp(ctx: NetContext, tabId?: number): Promise<IpInfo>
//   checkRealIp(): Promise<IpInfo>        // forces a dedicated direct:// session
// ─────────────────────────────────────────────────────────────────────────────
