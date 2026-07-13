/**
 * @dhurta/core — platform-agnostic privacy core for the Dhurta browser ecosystem.
 *
 * Consumed identically by:
 *   - the Electron desktop host (main + renderer)
 *   - the Android GeckoView host (via the JS content-script bridge + Kotlin mirrors)
 *   - the iOS WKWebView host (via WKUserScript + Swift mirrors)
 *   - the Dhurta Connect PWA
 *
 * Contains ZERO Node.js and ZERO Electron runtime dependencies by construction.
 */

// Version
export {
  DHURTA_VERSION,
  DHURTA_SEMVER,
  DHURTA_CHANNEL,
} from './config/version'

// Fingerprint
export type { FingerprintProfile, FingerprintOptions } from './fingerprint/index'
export {
  DESKTOP_PROFILE,
  MOBILE_PROFILE,
  buildBaselineScript,
  buildNoiseScript,
  buildFingerprintScript,
} from './fingerprint/index'

// WebRTC
export {
  BLOCKED_WEBRTC_GLOBALS,
  buildWebRTCBlockScript,
  GECKO_WEBRTC_PREFS,
} from './webrtc/index'

// Blocklist
export type { ParsedRule, ParseResult, RuleAction, SafariContentRule } from './blocklist/index'
export {
  parseFilterList,
  compileToSafariRules,
  serializeSafariRules,
  MAX_SAFARI_RULES,
} from './blocklist/index'

// Paths
export type {
  PathHostAdapter,
  ToolPathSpec,
  ToolResourceKind,
} from './paths/index'
export {
  resolveToolRoot,
  toolRootEnvVar,
  TOOL_PATH_SPECS,
} from './paths/index'

// IPC + kill-switch
export * from './ipc/index'
