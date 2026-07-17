// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — VPN engine (free-proxy) + proxy application + kill-switch
// ─────────────────────────────────────────────────────────────────────────────
// This module owns everything about routing NORMAL (non-ghost) tab traffic through
// a free public SOCKS5 proxy: sourcing a live proxy, pushing proxy rules onto every
// non-ghost session, and the fail-closed kill-switch used to seal mode transitions.
//
// It never touches tab state or the DB directly — session/settings/renderer access
// all arrives through the NetContext supplied by net/index.ts (see ./types).
// ─────────────────────────────────────────────────────────────────────────────

import type { NetContext, ProxyResult } from './types'
import { SETTINGS, KILLSWITCH_RULES } from './types'

// ── Free-proxy sourcing ───────────────────────────────────────────────────────
// ProxyScrape publishes a rolling list of public SOCKS5 proxies. We ask for elite
// (high-anonymity) SOCKS5 servers and pick a random one from the freshest slice, so
// repeated connects/rotations spread across servers instead of hammering one.
export async function fetchFreeProxy(country = 'all'): Promise<string | null> {
  // 'all' is ProxyScrape's wildcard; a real country must be the 2-letter code uppercased.
  const cc = country === 'all' ? 'all' : country.toUpperCase()
  // v3 is the current endpoint; v2 is kept as a fallback because v3 occasionally
  // returns empty/500 during their deploys while v2 stays up (and vice versa).
  const urls = [
    `https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5&timeout=10000&country=${cc}&ssl=all&anonymity=elite`,
    `https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=${cc}&ssl=all&anonymity=elite`,
  ]
  for (const src of urls) {
    try {
      // AbortSignal.timeout caps each attempt — a hung endpoint must not stall the
      // connect flow (the sessions are sealed by the kill-switch while we wait).
      const resp = await fetch(src, { signal: AbortSignal.timeout(8000) })
      const text = await resp.text()
      const proxies = text.split('\n')
        .map(l => l.trim())
        .filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
      if (proxies.length > 0) {
        // Randomize within the top 30 (freshest entries) so we don't all pile onto
        // the single first server, but stay in the healthiest part of the list.
        return proxies[Math.floor(Math.random() * Math.min(proxies.length, 30))]
      }
    } catch { continue }  // timeout / network error → try the next endpoint
  }
  return null
}

// ── Proxy application ──────────────────────────────────────────────────────────
// Push one set of proxy rules onto every non-ghost session at once. Ghost (Tor) tabs
// are deliberately excluded — they own their own Tor SOCKS rule (net/sessions.ts's
// applyTorProxyRule) and must never be re-pointed at a VPN proxy. Scheme is plain
// socks5:// — Chromium's SOCKS5 client always resolves hostnames through the proxy
// regardless of scheme name, so there's no separate "remote DNS" variant to opt into
// here (curl's socks5h is a curl-only convention, not something Chromium recognizes).
export async function applyProxyToAllSessions(ctx: NetContext, rules: string): Promise<void> {
  await Promise.all(
    ctx.getNonGhostSessions().map(sess => sess.setProxy({ proxyRules: rules }))
  )
}

// ── Kill-switch (fail closed) ──────────────────────────────────────────────────
// Route ALL non-ghost traffic to a dead loopback port so every request fails closed
// (ERR_PROXY_CONNECTION_FAILED) instead of silently falling back to the direct ISP
// connection. proxyBypassRules:'' is load-bearing — the empty bypass list forces even
// localhost/LAN through the dead proxy, so nothing (not even in-flight or
// auto-refreshing requests) can escape while the switch is engaged.
export async function applyKillSwitch(ctx: NetContext): Promise<void> {
  const config = { proxyRules: KILLSWITCH_RULES, proxyBypassRules: '' }
  await Promise.all(
    ctx.getNonGhostSessions().map(sess => sess.setProxy(config))
  )
}

// Lift the kill-switch by restoring the plain direct connection. Used when a connect
// attempt fails: block during the try, but don't leave the user stranded on the
// blackhole afterward.
export async function releaseKillSwitch(ctx: NetContext): Promise<void> {
  await applyProxyToAllSessions(ctx, 'direct://')
}

// ── VPN lifecycle ──────────────────────────────────────────────────────────────
export async function vpnConnect(ctx: NetContext, country?: string): Promise<ProxyResult> {
  // SEAL FIRST. fetchFreeProxy can take several seconds, and until it returns the
  // sessions are still on their previous (likely direct) connection. Engage the
  // kill-switch BEFORE fetching so the real IP can't leak through any request that
  // fires during that window — we fail closed until the new proxy is actually live.
  await applyKillSwitch(ctx)

  const proxy = await fetchFreeProxy(country)
  if (!proxy) {
    // Nothing found — lift the kill-switch back to direct so the user can still
    // browse. Traffic was blocked (not leaked) during the attempt; the caller just
    // learns it failed. Also clear ipRotation/activeProxy: without this, a failed
    // connect (or a failed restoreVpnOnStartup retry) leaves settings claiming
    // "IP Rotation: ON" while every session is silently on direct:// — a state
    // that can only be discovered by inspecting the DB, not from the UI.
    await releaseKillSwitch(ctx)
    ctx.setSetting(SETTINGS.ipRotation, 'false')
    ctx.setSetting(SETTINGS.activeProxy, '')
    return { success: false, error: `No servers found${country && country !== 'all' ? ' for ' + country : ''}. Try Auto or another country.` }
  }

  // Proxy is live — swing every non-ghost session over to it and persist the state so
  // it survives restarts (main.ts re-applies activeProxy on boot when ipRotation=true).
  await applyProxyToAllSessions(ctx, `socks5://${proxy}`)
  ctx.setSetting(SETTINGS.ipRotation, 'true')
  ctx.setSetting(SETTINGS.vpnCountry, country ?? 'all')
  ctx.setSetting(SETTINGS.activeProxy, proxy)
  return { success: true, proxy, country: country ?? 'Auto' }
}

export async function vpnDisconnect(ctx: NetContext): Promise<void> {
  // Straight back to direct and clear the persisted proxy so nothing re-applies it.
  await applyProxyToAllSessions(ctx, 'direct://')
  ctx.setSetting(SETTINGS.ipRotation, 'false')
  ctx.setSetting(SETTINGS.activeProxy, '')
}

export async function vpnRotate(ctx: NetContext): Promise<ProxyResult> {
  // Rotate = grab a fresh proxy for the country the user already picked. We reuse the
  // full vpnConnect flow so rotation also seals with the kill-switch and re-persists —
  // a mid-session rotation must never leak during its own fetch window either.
  const country = ctx.getSetting(SETTINGS.vpnCountry) ?? 'all'
  return vpnConnect(ctx, country)
}
