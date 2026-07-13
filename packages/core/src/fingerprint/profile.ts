/**
 * Fingerprint profile — the single source of truth for the *uniform anonymity
 * set* every Dhurta client presents. Anonymity through uniformity (the Tor
 * Browser doctrine): every user on a platform reports identical values, so a
 * fingerprint cannot single anyone out.
 *
 * The desktop preload historically hard-coded these values inline. They now
 * live here so Electron, GeckoView (Android) and WKWebView (iOS) all inject the
 * exact same surface. Change a value once, every platform moves together.
 */

export interface FingerprintProfile {
  readonly screen: {
    readonly width: number
    readonly height: number
    readonly availWidth: number
    readonly availHeight: number
    readonly colorDepth: number
    readonly pixelDepth: number
    readonly devicePixelRatio: number
  }
  readonly navigator: {
    readonly hardwareConcurrency: number
    readonly deviceMemory: number
    readonly platform: string
    readonly vendor: string
    readonly language: string
    readonly languages: readonly string[]
    readonly maxTouchPoints: number
    readonly doNotTrack: string
  }
  readonly webgl: {
    readonly vendor: string
    readonly renderer: string
  }
  readonly userAgentData: {
    readonly platform: string
    readonly platformVersion: string
    readonly architecture: string
    readonly bitness: string
    readonly uaFullVersion: string
    readonly brands: ReadonlyArray<{ readonly brand: string; readonly version: string }>
  }
  readonly timezone: string
}

/**
 * The canonical desktop profile — a generic Windows/Chrome 131 machine on a
 * 1920x1080 display. Matched to the values the desktop preload already emitted
 * so behaviour is byte-identical after extraction.
 */
export const DESKTOP_PROFILE: FingerprintProfile = {
  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    devicePixelRatio: 1,
  },
  navigator: {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    platform: 'Win32',
    vendor: 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    maxTouchPoints: 0,
    doNotTrack: '1',
  },
  webgl: {
    vendor: 'Google Inc. (NVIDIA)',
    renderer:
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  userAgentData: {
    platform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    uaFullVersion: '131.0.0.0',
    brands: [
      { brand: 'Not/A)Brand', version: '8' },
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
    ],
  },
  timezone: 'UTC',
}

/**
 * Mobile profile — a generic mid-range Android phone. Reported by the GeckoView
 * host (and the iOS WKWebView layer, which cannot fully mask WebKit internals
 * but presents this identical navigator surface so all Dhurta mobile users
 * share one anonymity set).
 */
export const MOBILE_PROFILE: FingerprintProfile = {
  screen: {
    width: 412,
    height: 915,
    availWidth: 412,
    availHeight: 915,
    colorDepth: 24,
    pixelDepth: 24,
    devicePixelRatio: 2,
  },
  navigator: {
    hardwareConcurrency: 8,
    deviceMemory: 4,
    platform: 'Linux armv8l',
    vendor: 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    maxTouchPoints: 5,
    doNotTrack: '1',
  },
  webgl: {
    vendor: 'Qualcomm',
    renderer: 'Adreno (TM) 640',
  },
  userAgentData: {
    platform: 'Android',
    platformVersion: '14.0.0',
    architecture: '',
    bitness: '64',
    uaFullVersion: '131.0.0.0',
    brands: [
      { brand: 'Not/A)Brand', version: '8' },
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
    ],
  },
  timezone: 'UTC',
}
