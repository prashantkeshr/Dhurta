// Platform detection hook — works in Electron (desktop), Capacitor (mobile), and web

export type Platform = 'desktop' | 'android' | 'ios' | 'web'

export interface PlatformInfo {
  platform: Platform
  isDesktop: boolean
  isMobile: boolean
  isAndroid: boolean
  isIOS: boolean
  isWeb: boolean
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web'

  // Electron desktop: window.dhurta is exposed via contextBridge
  if ((window as any).dhurta) return 'desktop'

  // Capacitor native: check Capacitor global
  const cap = (window as any).Capacitor
  if (cap?.isNativePlatform?.()) {
    const p = cap.getPlatform?.()
    if (p === 'android') return 'android'
    if (p === 'ios') return 'ios'
  }

  return 'web'
}

export function usePlatform(): PlatformInfo {
  const platform = detectPlatform()
  return {
    platform,
    isDesktop: platform === 'desktop',
    isMobile: platform === 'android' || platform === 'ios',
    isAndroid: platform === 'android',
    isIOS: platform === 'ios',
    isWeb: platform === 'web',
  }
}
