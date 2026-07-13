/**
 * Single source of truth for the ecosystem version. Every host (desktop
 * package.json, Android versionName, iOS CFBundleShortVersionString) is expected
 * to track this string so a support log or crash dump identifies the exact build
 * across all platforms.
 */
export const DHURTA_VERSION = '1.0.8.0' as const

/** Semver core (without the build segment) for package-manager consumption. */
export const DHURTA_SEMVER = '1.0.8' as const

/** Human-readable build channel. */
export const DHURTA_CHANNEL = 'stable' as const
