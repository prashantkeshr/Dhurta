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
// The whole trick is `net.fetch(url, { session })`: routing the lookup THROUGH a
// specific session means the request inherits that session's proxy, so the IP we
// read back is exactly what the far end would attribute to that session — not the
// main-process default. A plain global fetch() would bypass the proxy and lie.
//
// Per the net-layer contract this module depends only on `electron` and
// `./types` — never on other net/ modules or the DB.
// ─────────────────────────────────────────────────────────────────────────────

import { net, session } from 'electron'
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

// Look up the egress IP/geo AS SEEN THROUGH `sess`. Binding net.fetch to the
// passed session is deliberate and load-bearing: it forces the request out that
// session's proxy (a tab's Tor circuit, an active VPN, or direct://), so the
// result reflects that session's real egress rather than the process default.
// The 6s AbortSignal keeps a wedged provider from hanging the dashboard.
export async function lookupIp(sess: Session): Promise<IpInfo> {
  for (const p of PROVIDERS) {
    try {
      // `session` isn't in the DOM RequestInit type but is a valid Electron
      // net.fetch option — the `as any` is only to satisfy TS, not a behaviour hack.
      const resp = await net.fetch(p.url, { session: sess, signal: AbortSignal.timeout(6000) } as any)
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
