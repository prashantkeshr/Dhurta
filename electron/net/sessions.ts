// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — per-session hardening
// ─────────────────────────────────────────────────────────────────────────────
// Every browser tab is backed by an Electron Session. Before that session is
// allowed to carry a single request, it must be hardened: routed through the
// right proxy, stripped of leaky permissions, and normalized so the HTTP headers
// don't contradict the JS-side fingerprint spoof. The tab manager creates the
// session and calls the matching harden* function here; this module owns nothing
// but the hardening steps, and (per the net-layer design rule) imports only from
// `./types` and from `electron` — never from tor.ts / vpn.ts / leakcheck.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Session } from 'electron'
import { PORTS, CHROME_UA, SETTINGS, NetContext } from './types'

// Privacy-relevant request-header normalization shared by ghost tabs and
// anti-fingerprint normal tabs. Applied on EVERY outbound request:
//   DNT / Sec-GPC     — assert "do not track" / "global privacy control" so
//                       compliant sites (and the law, in some regions) must honor it.
//   Accept-Language   — pinned to en-US to MATCH the JS-side navigator.language
//                       spoof. Without this the header still carries the real OS
//                       locale, which is both a standalone leak AND a contradiction
//                       with the spoofed navigator.language — the mismatch itself
//                       fingerprints the session as "a spoofed browser".
function normalizePrivacyHeaders(sess: Session): void {
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['DNT'] = '1'
    details.requestHeaders['Sec-GPC'] = '1'
    details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9'
    callback({ requestHeaders: details.requestHeaders })
  })
}

// ── Ghost (Tor) session hardening ────────────────────────────────────────────
// A ghost tab lives in its own in-memory partition and must exit exclusively via
// Tor. Everything here is fail-closed: if any step can't be satisfied the tab
// should get an error, never a direct-to-ISP connection.
export async function hardenGhostSession(ctx: NetContext, sess: Session): Promise<void> {
  // Deny the two permissions that defeat network-level anonymity outright:
  //   media       — camera/mic can expose the real user; also device enumeration.
  //   geolocation — reveals a precise real-world position regardless of proxying.
  // Everything else is allowed so ordinary sites still function.
  sess.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === 'media' || permission === 'geolocation') cb(false)
    else cb(true)
  })

  // Route the whole session through the bundled Tor SOCKS listener.
  //   socks5h  — the 'h' makes Chromium resolve DNS *through* the proxy (inside
  //              Tor), so hostname lookups never leak to the local ISP resolver.
  //   proxyBypassRules: '' — empty bypass list means even local-looking hostnames
  //              (localhost, *.local, RFC1918 IPs) are still tunneled, closing the
  //              usual "bypass local addresses" hole.
  // The URL is built from PORTS so this module stays decoupled from tor.ts.
  // MUST be awaited: setProxy() genuinely hands off to the network service async;
  // if the BrowserView returns before the proxy is wired, a caller that navigates
  // immediately (e.g. tab duplicate) fires the first request unproxied and leaks
  // the real IP/DNS. Awaiting also gives us the fail-closed guarantee: if Tor
  // isn't up yet Chromium gets ECONNREFUSED, never a direct connection.
  await sess.setProxy({ proxyRules: 'socks5h://127.0.0.1:' + PORTS.torSocks, proxyBypassRules: '' })

  // Each ghost tab gets its own unique memory: partition, so the ad/tracker
  // blocker (registered once for persist:default) must be enabled per-session
  // here. Wrapped in try/catch: a blocker failure must not abort hardening and
  // leave the tab in a half-configured state.
  try { ctx.enableAdBlocker(sess) } catch (_) {}

  // Pin privacy headers so they match the JS-side spoof (see helper comment).
  normalizePrivacyHeaders(sess)

  // Strip "Electron/x.x" from the UA — sites that detect Electron render broken,
  // and a unique Electron UA is itself a fingerprint. Present as plain Chrome.
  sess.setUserAgent(CHROME_UA)
}

// ── Normal session hardening ─────────────────────────────────────────────────
// A normal tab persists to disk and exits directly unless the user has turned on
// IP rotation (a VPN/free-proxy). Hardening is opt-in via the security settings,
// but proxy handling always runs so we never clobber an active VPN.
export async function hardenNormalSession(ctx: NetContext, sess: Session): Promise<void> {
  const antiFingerprint = ctx.getSetting(SETTINGS.antiFingerprint) === 'true'
  const ipRotation = ctx.getSetting(SETTINGS.ipRotation) === 'true'

  if (antiFingerprint) {
    // Deny only geolocation here (media stays available for normal browsing —
    // video calls, etc.). Geolocation is the one permission that leaks a precise
    // real-world position no proxy can hide, so it goes regardless of IP spoofing.
    sess.setPermissionRequestHandler((_wc, permission, cb) => {
      if (permission === 'geolocation') cb(false)
      else cb(true)
    })
    // Same header normalization as ghost mode — without it the anti-fingerprint
    // JS spoof of navigator.language is contradicted by the real-locale
    // Accept-Language header, and that contradiction fingerprints the session.
    normalizePrivacyHeaders(sess)
  }

  // Proxy application always runs. If IP rotation is on and we have an active
  // proxy, route through it; otherwise go direct. We must NEVER blindly clobber
  // an active VPN proxy with direct:// — that would silently drop the user back
  // onto their real IP.
  const activeProxy = ctx.getSetting(SETTINGS.activeProxy)
  if (ipRotation && activeProxy) {
    // socks5 (NOT socks5h) for the VPN/free-proxy path: DNS resolves locally.
    // These are general-purpose free proxies, not an anonymity network, so remote
    // DNS buys nothing and local resolution is faster and more reliable.
    await sess.setProxy({ proxyRules: 'socks5://' + activeProxy })
  } else {
    await sess.setProxy({ proxyRules: 'direct://' })
  }

  // Plain Chrome UA for the same reason as ghost mode.
  sess.setUserAgent(CHROME_UA)
}

// ── WebRTC IP-handling policy (pure) ─────────────────────────────────────────
// Computes the Chromium WebRTC policy the tab manager applies to the webContents.
// 'disable_non_proxied_udp' stops the internal ICE agent from gathering STUN/TURN
// candidates over the real IP — a leak that happens at the network layer before
// any page JS runs, so the JS-side RTCPeerConnection block alone can't cover it.
// Enforce it whenever the tab is a ghost tab (always Tor) OR the user has asked
// to block WebRTC on normal tabs; otherwise leave Chromium's default behavior.
export function webRTCPolicyFor(ghost: boolean, blockWebRTC: boolean): 'default' | 'disable_non_proxied_udp' {
  return (ghost || blockWebRTC) ? 'disable_non_proxied_udp' : 'default'
}
