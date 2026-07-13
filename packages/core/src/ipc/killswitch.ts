import { DhurtaErrorCode } from './schema'

/**
 * Fail-closed network kill-switch protocol.
 *
 * Anonymity guarantee: if a Tor circuit, local proxy node, or mobile VPN drops
 * its heartbeat, the host must immediately sever all network egress and
 * broadcast a standardised event. The React chrome intercepts it globally and
 * locks the screen with an un-bypassable banner until protection is restored.
 *
 * This module defines the shared *contract* — the event name, payload shape,
 * heartbeat cadence, and a platform-neutral watchdog. Each host wires the
 * watchdog to its own egress-cutoff mechanism:
 *   - Electron: session.setProxy to a dead proxy + webRequest cancel
 *   - Android:  VpnService.Builder blocking mode / tearing the tun interface
 *   - iOS:      WKWebsiteDataStore proxy invalidation + NWPathMonitor
 */

/** Broadcast on this event name across every host's frontend bridge. */
export const KILLSWITCH_EVENT = 'dhurta:killswitch' as const

/** Heartbeats faster than this (ms) are required to keep egress open. */
export const HEARTBEAT_INTERVAL_MS = 1_000

/** Missing a heartbeat by more than this (ms) engages the kill-switch. */
export const HEARTBEAT_GRACE_MS = 1_500

export type ProtectedChannel = 'tor' | 'vpn' | 'proxy'

export interface KillSwitchEvent {
  readonly engaged: boolean
  readonly channel: ProtectedChannel
  readonly code: DhurtaErrorCode
  readonly at: number
  readonly reason: string
}

export interface WatchdogHooks {
  /** Called once when protection is lost — hosts cut egress here. */
  readonly onEngage: (event: KillSwitchEvent) => void
  /** Called when heartbeats resume after an engagement — hosts restore egress. */
  readonly onRelease: (event: KillSwitchEvent) => void
  /** Monotonic clock in ms. Injected for testability; defaults to Date.now. */
  readonly now?: () => number
  /** Timer scheduler. Injected so native hosts can use their own loop. */
  readonly setInterval?: (fn: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
}

const codeForChannel: Readonly<Record<ProtectedChannel, DhurtaErrorCode>> = {
  tor: DhurtaErrorCode.TorCircuitDown,
  vpn: DhurtaErrorCode.VpnDropped,
  proxy: DhurtaErrorCode.ProxyUnavailable,
}

/**
 * A heartbeat watchdog. The protected background service (Tor thread, VPN
 * service, proxy node) calls {@link beat} at least every
 * {@link HEARTBEAT_INTERVAL_MS}. If a beat is missed beyond the grace window the
 * watchdog engages, invoking `onEngage`; when beats resume it releases.
 *
 * Never throws from the timer callback — a watchdog that crashes is worse than
 * one that trips, so all hook invocations are guarded.
 */
export class HeartbeatWatchdog {
  private lastBeat: number
  private engaged = false
  private handle: unknown = null
  private readonly now: () => number
  private readonly _setInterval: (fn: () => void, ms: number) => unknown
  private readonly _clearInterval: (handle: unknown) => void

  constructor(
    private readonly channel: ProtectedChannel,
    private readonly hooks: WatchdogHooks,
  ) {
    this.now = hooks.now ?? (() => Date.now())
    this._setInterval =
      hooks.setInterval ??
      ((fn, ms) => (globalThis.setInterval as typeof setInterval)(fn, ms))
    this._clearInterval =
      hooks.clearInterval ??
      ((h) => (globalThis.clearInterval as typeof clearInterval)(h as never))
    this.lastBeat = this.now()
  }

  /** Begin monitoring. Idempotent. */
  start(): void {
    if (this.handle !== null) return
    this.lastBeat = this.now()
    this.handle = this._setInterval(() => {
      try {
        this.tick()
      } catch {
        // A watchdog must survive a bad tick; swallow and retry next interval.
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  /** Stop monitoring and release any timer. */
  stop(): void {
    if (this.handle !== null) {
      try {
        this._clearInterval(this.handle)
      } finally {
        this.handle = null
      }
    }
  }

  /** The protected service calls this to signal it is alive. */
  beat(): void {
    this.lastBeat = this.now()
    if (this.engaged) this.release()
  }

  get isEngaged(): boolean {
    return this.engaged
  }

  private tick(): void {
    if (this.engaged) return
    const elapsed = this.now() - this.lastBeat
    if (elapsed > HEARTBEAT_GRACE_MS) {
      this.engage(`No ${this.channel} heartbeat for ${elapsed}ms`)
    }
  }

  private engage(reason: string): void {
    this.engaged = true
    const event: KillSwitchEvent = {
      engaged: true,
      channel: this.channel,
      code: codeForChannel[this.channel],
      at: this.now(),
      reason,
    }
    try {
      this.hooks.onEngage(event)
    } catch {
      // Host hook failure cannot un-engage the switch; state stays fail-closed.
    }
  }

  private release(): void {
    this.engaged = false
    const event: KillSwitchEvent = {
      engaged: false,
      channel: this.channel,
      code: codeForChannel[this.channel],
      at: this.now(),
      reason: `${this.channel} heartbeat restored`,
    }
    try {
      this.hooks.onRelease(event)
    } catch {
      // Ignore — egress restoration is best-effort; worst case stays safe.
    }
  }
}
