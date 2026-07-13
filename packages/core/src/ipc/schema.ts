/**
 * Unified cross-platform IPC schema.
 *
 * Every message that crosses the boundary between the React UI chrome and its
 * native host — Electron (desktop), GeckoView (Android), WKWebView (iOS) — uses
 * this exact envelope and these exact payloads. The TypeScript types here are
 * the source of truth; the Kotlin and Swift mirrors (packages/android,
 * packages/ios) are generated to match field-for-field so a proxy change or a
 * P2P-chat launch carries an identical payload on every platform.
 *
 * Design rules:
 *  - Discriminated union on `action`, so exhaustiveness is compiler-checked.
 *  - All payloads are plain JSON (no functions, no Dates) so they serialise
 *    identically through postMessage, Electron IPC, the GeckoView port, and the
 *    WKScriptMessageHandler bridge.
 *  - Every request has a `requestId`; every response echoes it.
 */

export const DHURTA_IPC_PROTOCOL_VERSION = '1.0.8' as const

/** Direction-agnostic envelope wrapping every message. */
export interface IpcEnvelope<TAction extends string, TPayload> {
  readonly protocol: typeof DHURTA_IPC_PROTOCOL_VERSION
  readonly requestId: string
  readonly action: TAction
  readonly payload: TPayload
}

// ── Request payloads ────────────────────────────────────────────────────────

export interface NavigatePayload {
  readonly url: string
  readonly tabId: number
}

export interface SetProxyPayload {
  /** 'vpn' routes through the VPN proxy; 'tor' through the local SOCKS5 Tor. */
  readonly mode: 'vpn' | 'tor' | 'direct'
  /** ISO country code for exit-node selection, or null for automatic. */
  readonly country: string | null
}

export interface SetSecurityPayload {
  readonly antiFingerprint: boolean
  readonly blockWebRTC: boolean
  readonly ipRotation: boolean
}

export interface StartP2PChatPayload {
  /** Numeric session code (host) or the code to join (peer). */
  readonly sessionCode: string
  readonly role: 'host' | 'peer'
  /** Optional deep-link that opened the chat (dhurta-connect://…). */
  readonly link: string | null
}

export interface OpenToolTrayPayload {
  readonly anchorX: number
  readonly anchorY: number
}

// ── Request union ───────────────────────────────────────────────────────────

export type IpcRequest =
  | IpcEnvelope<'nav.navigate', NavigatePayload>
  | IpcEnvelope<'proxy.set', SetProxyPayload>
  | IpcEnvelope<'security.set', SetSecurityPayload>
  | IpcEnvelope<'p2p.startChat', StartP2PChatPayload>
  | IpcEnvelope<'ui.openToolTray', OpenToolTrayPayload>

export type IpcAction = IpcRequest['action']

// ── Response payloads ───────────────────────────────────────────────────────

export interface IpcOk<T> {
  readonly ok: true
  readonly requestId: string
  readonly data: T
}

export interface IpcErr {
  readonly ok: false
  readonly requestId: string
  readonly code: DhurtaErrorCode
  readonly message: string
}

export type IpcResponse<T> = IpcOk<T> | IpcErr

// ── Standardised error codes (shared across all hosts) ──────────────────────

export enum DhurtaErrorCode {
  Unknown = 'DHURTA_ERR_UNKNOWN',
  InvalidPayload = 'DHURTA_ERR_INVALID_PAYLOAD',
  ProxyUnavailable = 'DHURTA_ERR_PROXY_UNAVAILABLE',
  TorCircuitDown = 'DHURTA_ERR_TOR_CIRCUIT_DOWN',
  VpnDropped = 'DHURTA_ERR_VPN_DROPPED',
  DnsLeakBlocked = 'DHURTA_ERR_DNS_LEAK_BLOCKED',
  KillSwitchEngaged = 'DHURTA_ERR_KILLSWITCH_ENGAGED',
  ToolUnavailable = 'DHURTA_ERR_TOOL_UNAVAILABLE',
}

// ── Type-safe constructors + guards ─────────────────────────────────────────

let _counter = 0

/** Generates a collision-resistant request id without any platform crypto dep. */
export function newRequestId(): string {
  _counter = (_counter + 1) % Number.MAX_SAFE_INTEGER
  return `${Date.now().toString(36)}-${_counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function makeRequest<A extends IpcAction, P>(
  action: A,
  payload: P,
): IpcEnvelope<A, P> {
  return {
    protocol: DHURTA_IPC_PROTOCOL_VERSION,
    requestId: newRequestId(),
    action,
    payload,
  }
}

export function ok<T>(requestId: string, data: T): IpcOk<T> {
  return { ok: true, requestId, data }
}

export function err(
  requestId: string,
  code: DhurtaErrorCode,
  message: string,
): IpcErr {
  return { ok: false, requestId, code, message }
}

/** Runtime validation — hosts must never trust an incoming envelope blindly. */
export function isValidEnvelope(value: unknown): value is IpcRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v['protocol'] === DHURTA_IPC_PROTOCOL_VERSION &&
    typeof v['requestId'] === 'string' &&
    typeof v['action'] === 'string' &&
    typeof v['payload'] === 'object' &&
    v['payload'] !== null
  )
}
