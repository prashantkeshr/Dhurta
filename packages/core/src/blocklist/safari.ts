import type { ParsedRule } from './parser'

/**
 * Compiles parsed filter rules into Safari Content Blocker JSON — the native,
 * in-engine blocking format WKWebView loads on iOS. Content Blocker rules run
 * at WebKit's network layer (no JS, no per-request callback), so blocking costs
 * effectively nothing at runtime.
 *
 * Apple caps a single content-blocker list at 50,000 rules; {@link MAX_SAFARI_RULES}
 * enforces that ceiling and the compiler truncates deterministically (block
 * rules first, then exceptions) so the most protective rules always survive.
 */

export const MAX_SAFARI_RULES = 50_000

export interface SafariContentRule {
  readonly trigger: {
    'url-filter': string
    'if-domain'?: string[]
    'resource-type'?: string[]
  }
  readonly action: {
    type: 'block' | 'ignore-previous-rules'
  }
}

/** Maps ABP resource types to Safari Content Blocker resource types. */
const RESOURCE_TYPE_MAP: Readonly<Record<string, string>> = {
  script: 'script',
  image: 'image',
  stylesheet: 'style-sheet',
  font: 'font',
  media: 'media',
  xmlhttprequest: 'raw',
  websocket: 'raw',
  document: 'document',
  subdocument: 'document',
}

/**
 * Escapes an ABP pattern into a valid Content Blocker `url-filter` regex.
 * ABP wildcards (`*`) map to `.*`; anchors and separators are normalised.
 */
function patternToUrlFilter(rule: ParsedRule): string {
  // Escape regex metacharacters, then re-expand the ABP wildcard.
  let escaped = rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  escaped = escaped.replace(/\*/g, '.*')
  // ABP separator ^ → any non-alphanumeric/non-dot/non-hyphen boundary.
  escaped = escaped.replace(/\^/g, '[^a-zA-Z0-9._-]')
  if (rule.domainAnchor) {
    // ||example.com anchors to the host portion of the URL.
    return `^https?://([^/]+\\.)?${escaped}`
  }
  return escaped
}

export function compileToSafariRules(
  rules: readonly ParsedRule[],
): SafariContentRule[] {
  const out: SafariContentRule[] = []

  // Block rules first so that when we truncate at the cap, protection wins.
  const ordered = [...rules].sort((a, b) =>
    a.action === b.action ? 0 : a.action === 'block' ? -1 : 1,
  )

  for (const rule of ordered) {
    if (out.length >= MAX_SAFARI_RULES) break

    const urlFilter = patternToUrlFilter(rule)
    if (urlFilter.length === 0) continue

    const trigger: SafariContentRule['trigger'] = { 'url-filter': urlFilter }

    if (rule.domains.length > 0) {
      trigger['if-domain'] = rule.domains.map((d) =>
        d.startsWith('~') ? d : `*${d}`,
      )
    }

    if (rule.resourceTypes.length > 0) {
      const mapped = rule.resourceTypes
        .map((t) => RESOURCE_TYPE_MAP[t])
        .filter((t): t is string => typeof t === 'string')
      if (mapped.length > 0) trigger['resource-type'] = mapped
    }

    out.push({
      trigger,
      action: {
        type: rule.action === 'allow' ? 'ignore-previous-rules' : 'block',
      },
    })
  }

  return out
}

/** Serialises compiled rules to the exact JSON string WKWebView expects. */
export function serializeSafariRules(rules: readonly SafariContentRule[]): string {
  return JSON.stringify(rules)
}
