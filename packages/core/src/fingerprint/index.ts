export type { FingerprintProfile } from './profile'
export { DESKTOP_PROFILE, MOBILE_PROFILE } from './profile'
export { buildBaselineScript } from './baseline'
export { buildNoiseScript } from './noise'

import type { FingerprintProfile } from './profile'
import { DESKTOP_PROFILE } from './profile'
import { buildBaselineScript } from './baseline'
import { buildNoiseScript } from './noise'

export interface FingerprintOptions {
  /** Inject the static baseline surface (screen, navigator, userAgentData). */
  readonly baseline?: boolean
  /** Inject canvas/WebGL/audio noise + timezone flattening. */
  readonly noise?: boolean
  /** The uniform profile to present. Defaults to DESKTOP_PROFILE. */
  readonly profile?: FingerprintProfile
}

/**
 * Composes the full document-start injection payload for a given policy.
 * Returns a single string ready to hand to any host's document-start injector.
 *
 * Mirrors the desktop preload's gating: baseline always runs under
 * anti-fingerprint; noise runs additionally. Ghost mode enables both.
 */
export function buildFingerprintScript(opts: FingerprintOptions = {}): string {
  const profile = opts.profile ?? DESKTOP_PROFILE
  const parts: string[] = []
  if (opts.baseline !== false) parts.push(buildBaselineScript(profile))
  if (opts.noise) parts.push(buildNoiseScript(profile))
  return parts.join('\n')
}
