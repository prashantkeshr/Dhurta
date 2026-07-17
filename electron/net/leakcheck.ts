// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — IP / DNS leak telemetry
// ─────────────────────────────────────────────────────────────────────────────
// Answers two questions for the security dashboard:
//   1. "What is this tab leaking RIGHT NOW?"  (checkPublicIp) — the egress IP a
//      website's IP checker would see for a given tab, honouring whatever proxy /
//      Tor circuit that tab currently rides.
//   2. "What is my TRUE IP?"  (checkRealIp) — the underlying ISP address, forced
//      out a direct:// path so VPN/Ghost Mode can't mask the baseline.
//
// The whole trick is `sess.fetch(url)` — the SESSION's own fetch method, not the
// module-level `net.fetch(url, { session })` — which routes the lookup through
// that session's actual proxy, so the IP we read back is exactly what the far
// end would attribute to that session. A plain global fetch(), or net.fetch with
// a session option, would bypass the proxy and lie (see lookupIp for how this
// was confirmed).
//
// Per the net-layer contract this module depends only on `electron` and
// `./types` — never on other net/ modules or the DB.
// ─────────────────────────────────────────────────────────────────────────────

import { session } from 'electron'
import type { Session } from 'electron'
import type { IpInfo, NetContext } from './types'

// Two independent geo-IP providers, tried in order. Kept independent (different
// hosts, different JSON shapes) so one being blocked/rate-limited/down doesn't
// take out the whole readout. Each `map` normalises that provider's field names
// onto our shared IpInfo shape.
const PROVIDERS: Array<{ url: string; map: (j: any) => Partial<IpInfo> }> = [
  {
    url: 'https://ipapi.co/json/',
    map: (j) => ({
      ip: j.ip,
      country: j.country_name,
      countryCode: j.country_code,
      city: j.city,
      region: j.region,
      lat: j.latitude,
      lon: j.longitude,
      org: j.org,
    }),
  },
  {
    url: 'http://ip-api.com/json/',
    map: (j) => ({
      ip: j.query,
      country: j.country,
      countryCode: j.countryCode,
      city: j.city,
      region: j.regionName,
      lat: j.lat,
      lon: j.lon,
      org: j.isp,
    }),
  },
]

// Look up the egress IP/geo AS SEEN THROUGH `sess`. MUST use `sess.fetch()` (the
// session's own method), NOT the module-level `net.fetch(url, { session })`.
// Confirmed by direct testing: net.fetch(url, {session}) SILENTLY IGNORES a
// session's SOCKS5 proxy and falls through to a direct connection — it returned
// the real ISP IP even with a session explicitly configured to route through
// Tor, while sess.fetch() on the exact same session correctly returned the Tor
// exit IP. This was a real, previously-hidden bug: the Omni dashboard's "what
// does this tab leak" check was silently checking the wrong (unproxied) path
// while actual page navigations in the same tab were genuinely Tor-routed —
// so the dashboard could show your real IP even while browsing was safely
// anonymized. The 6s AbortSignal keeps a wedged provider from hanging the
// dashboard.
export async function lookupIp(sess: Session): Promise<IpInfo> {
  for (const p of PROVIDERS) {
    try {
      const resp = await sess.fetch(p.url, { signal: AbortSignal.timeout(6000) })
      if (!resp.ok) continue
      const json = await resp.json()
      const mapped = p.map(json)
      // A truthy ip is our success signal — some providers answer 200 with an
      // error/empty body when rate-limited, so we don't trust resp.ok alone.
      if (mapped.ip) return { success: true, ...mapped }
    } catch (_) {
      // Timeout, DNS failure, proxy refusal, malformed JSON — fall through to
      // the next provider rather than aborting the whole check.
      continue
    }
  }
  return { success: false, error: 'Could not reach an IP-lookup service (offline, or all providers blocked).' }
}

// "What is tab N leaking right now?" — resolve the tab's live session via the
// orchestrator (never by reaching into tab state ourselves) and look up through
// it, so the answer honours that tab's current proxy/Tor state. Omitting tabId
// falls back to the primary normal session inside getTabSession.
export async function checkPublicIp(ctx: NetContext, tabId?: number): Promise<IpInfo> {
  const sess = ctx.getTabSession(tabId)
  if (!sess) return { success: false, error: 'No active tab session.' }
  return lookupIp(sess)
}

// "What is my TRUE IP?" — the underlying ISP address regardless of VPN/Ghost.
// We use a dedicated partition that no other code path ever proxies, and force
// it to direct:// on every call, so an active VPN (which also proxies the
// default session) can't contaminate this baseline. Then look up through it.
export async function checkRealIp(): Promise<IpInfo> {
  const realSess = session.fromPartition('net:realip-check')
  await realSess.setProxy({ proxyRules: 'direct://' })
  return lookupIp(realSess)
}
