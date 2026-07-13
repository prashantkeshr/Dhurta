/**
 * Tracker/ad blocklist parser.
 *
 * Parses Adblock Plus / EasyList filter syntax into a normalised, host-neutral
 * rule model. The desktop app hands raw lists to @cliqz/adblocker (an Electron
 * dependency); mobile hosts cannot use that engine, so this pure parser gives
 * every platform a shared, dependency-free representation that each host
 * compiles to its native blocking mechanism:
 *  - iOS  → Safari Content Blocker JSON (see ./safari.ts)
 *  - Android/GeckoView → WebExtension declarativeNetRequest rules
 *  - Desktop → still delegates to @cliqz/adblocker, but reuses this model for
 *              the Omni dashboard's rule inspection.
 */

export type RuleAction = 'block' | 'allow'

export interface ParsedRule {
  /** Original filter text, retained for debugging and dashboard display. */
  readonly raw: string
  readonly action: RuleAction
  /** URL substring / pattern the rule matches against. */
  readonly pattern: string
  /** Domains the rule is scoped to (from `$domain=`), if any. */
  readonly domains: readonly string[]
  /** True when the rule anchors to a domain boundary (`||`). */
  readonly domainAnchor: boolean
  /** Resource types (from `$script`, `$image`, …); empty = all types. */
  readonly resourceTypes: readonly string[]
}

export interface ParseResult {
  readonly rules: readonly ParsedRule[]
  /** Cosmetic (`##`) and comment lines skipped, for reporting. */
  readonly skipped: number
}

const COMMENT_PREFIXES = ['!', '[', '#'] as const
const COSMETIC_MARKERS = ['##', '#@#', '#?#'] as const

/**
 * Parses a full filter list. Never throws — malformed individual lines are
 * skipped and counted, so a single bad line in a 100k-line list cannot abort
 * the whole parse.
 */
export function parseFilterList(text: string): ParseResult {
  const rules: ParsedRule[] = []
  let skipped = 0

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (COMMENT_PREFIXES.some((p) => trimmed.startsWith(p))) {
      skipped++
      continue
    }
    if (COSMETIC_MARKERS.some((m) => trimmed.includes(m))) {
      // Element-hiding cosmetic rules are not network rules; skip.
      skipped++
      continue
    }
    try {
      const rule = parseLine(trimmed)
      if (rule) rules.push(rule)
      else skipped++
    } catch {
      skipped++
    }
  }

  return { rules, skipped }
}

function parseLine(line: string): ParsedRule | null {
  let action: RuleAction = 'block'
  let body = line

  // Exception rules start with @@
  if (body.startsWith('@@')) {
    action = 'allow'
    body = body.slice(2)
  }

  // Split options after the last unescaped $
  let options = ''
  const dollar = body.lastIndexOf('$')
  if (dollar !== -1) {
    options = body.slice(dollar + 1)
    body = body.slice(0, dollar)
  }

  let domainAnchor = false
  if (body.startsWith('||')) {
    domainAnchor = true
    body = body.slice(2)
  } else if (body.startsWith('|')) {
    body = body.slice(1)
  }
  if (body.endsWith('|')) body = body.slice(0, -1)

  const pattern = body.trim()
  if (pattern.length === 0) return null

  const domains: string[] = []
  const resourceTypes: string[] = []
  if (options.length > 0) {
    for (const opt of options.split(',')) {
      const o = opt.trim()
      if (o.startsWith('domain=')) {
        for (const d of o.slice('domain='.length).split('|')) {
          const dd = d.trim()
          if (dd.length > 0) domains.push(dd)
        }
      } else if (RESOURCE_TYPE_OPTIONS.has(o)) {
        resourceTypes.push(o)
      }
    }
  }

  return {
    raw: line,
    action,
    pattern,
    domains,
    domainAnchor,
    resourceTypes,
  }
}

const RESOURCE_TYPE_OPTIONS = new Set([
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'subdocument',
  'document',
  'font',
  'media',
  'websocket',
  'ping',
  'other',
])
