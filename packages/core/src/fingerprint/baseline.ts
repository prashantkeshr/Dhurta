import type { FingerprintProfile } from './profile'
import { DESKTOP_PROFILE } from './profile'

/**
 * Generates the *baseline* main-world injection script: the static navigator /
 * screen / userAgentData surface that makes every client look identical. This
 * is the extracted, parameterised form of the `baselineScript` string that was
 * previously hard-coded in electron/webviewPreload.js.
 *
 * The returned string is designed to run at document-start in world 0 (the
 * page's own world), so page scripts read the spoofed values. It is host-neutral:
 *  - Electron: webFrame.executeJavaScript(buildBaselineScript())
 *  - GeckoView: session.loadUri via a document-start user script, or the
 *    GeckoView WebExtension content-script channel
 *  - WKWebView: new WKUserScript(source: buildBaselineScript(), .atDocumentStart)
 *
 * All property definitions are wrapped in try/catch individually so a single
 * locked-down property on an exotic page can never abort the whole surface.
 */
export function buildBaselineScript(
  profile: FingerprintProfile = DESKTOP_PROFILE,
): string {
  const s = profile.screen
  const n = profile.navigator
  const ua = profile.userAgentData
  const langs = JSON.stringify(n.languages)
  const brands = JSON.stringify(ua.brands)

  return `(function() {
  'use strict';
  function def(obj, prop, val) {
    try { Object.defineProperty(obj, prop, { get: function() { return val; }, configurable: true }); } catch (e) {}
  }
  // Screen
  def(screen, 'width', ${s.width});
  def(screen, 'height', ${s.height});
  def(screen, 'availWidth', ${s.availWidth});
  def(screen, 'availHeight', ${s.availHeight});
  def(screen, 'colorDepth', ${s.colorDepth});
  def(screen, 'pixelDepth', ${s.pixelDepth});
  def(window, 'devicePixelRatio', ${s.devicePixelRatio});
  def(window, 'outerWidth', ${s.width});
  def(window, 'outerHeight', ${s.availHeight});
  def(window, 'innerWidth', ${s.width});
  def(window, 'innerHeight', ${s.availHeight});
  // Hardware
  def(navigator, 'hardwareConcurrency', ${n.hardwareConcurrency});
  def(navigator, 'deviceMemory', ${n.deviceMemory});
  // Language
  try { Object.defineProperty(navigator, 'languages', { get: function() { return Object.freeze(${langs}); }, configurable: true }); } catch (e) {}
  def(navigator, 'language', ${JSON.stringify(n.language)});
  // Platform identity
  def(navigator, 'platform', ${JSON.stringify(n.platform)});
  def(navigator, 'oscpu', undefined);
  def(navigator, 'vendor', ${JSON.stringify(n.vendor)});
  def(navigator, 'maxTouchPoints', ${n.maxTouchPoints});
  def(navigator, 'doNotTrack', ${JSON.stringify(n.doNotTrack)});
  def(navigator, 'webdriver', false);
  // Plugins — standard Chromium PDF viewer set
  try {
    Object.defineProperty(navigator, 'plugins', { get: function() {
      var p = { length: 5 };
      var names = ['Chrome PDF Viewer','Chromium PDF Viewer','Microsoft Edge PDF Viewer','PDF Viewer','WebKit built-in PDF'];
      for (var i = 0; i < 5; i++) { p[i] = { name: names[i], description: 'Portable Document Format', filename: 'internal-pdf-viewer', length: 2 }; }
      p.item = function(i) { return p[i] || null; };
      p.namedItem = function(nm) { for (var j = 0; j < 5; j++) if (p[j].name === nm) return p[j]; return null; };
      p.refresh = function() {};
      return p;
    }, configurable: true });
  } catch (e) {}
  // window.chrome — reCAPTCHA v2/v3 and Cloudflare Turnstile score the browser
  // as a bot when chrome.runtime is absent from a Chromium UA. Inject the
  // minimal surface CAPTCHA providers probe so the fingerprint score stays high.
  try {
    if (!window.chrome) window.chrome = {};
    var _cr = window.chrome;
    if (!_cr.runtime) {
      _cr.runtime = {
        id: undefined, lastError: undefined,
        connect: function() { return { postMessage: function(){}, disconnect: function(){}, onMessage: { addListener: function(){}, removeListener: function(){} }, onDisconnect: { addListener: function(){}, removeListener: function(){} } }; },
        sendMessage: function() {},
        onMessage:         { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        onConnect:         { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        onInstalled:       { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        onStartup:         { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        onUpdateAvailable: { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        getManifest: function(){ return {}; },
        getURL: function(p){ return 'chrome-extension://invalid/' + (p||''); },
        reload: function(){},
        requestUpdateCheck: function(){},
      };
    }
    if (!_cr.app) {
      _cr.app = {
        isInstalled: false,
        getDetails: function(){ return null; },
        getIsInstalled: function(){ return false; },
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
      };
    }
    if (!_cr.csi) {
      _cr.csi = function() {
        return { onloadT: Date.now(), pageT: Math.round(performance.now()), startE: 0, tran: 15 };
      };
    }
    if (!_cr.loadTimes) {
      _cr.loadTimes = function() {
        var t = performance.timing || {};
        var ns = t.navigationStart || Date.now();
        return {
          requestTime: ns / 1000, startLoadTime: ns / 1000,
          commitLoadTime: (t.responseStart || ns) / 1000,
          finishDocumentLoadTime: 0, finishLoadTime: 0,
          firstPaintTime: 0, firstPaintAfterLoadTime: 0,
          navigationType: 'Other', wasFetchedViaSpdy: false,
          wasNpnNegotiated: false, npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
        };
      };
    }
  } catch (e) {}
  // Client Hints (userAgentData)
  try {
    var UA_BRANDS = ${brands};
    var fakeUAData = {
      brands: UA_BRANDS, mobile: ${ua.platform === 'Android'}, platform: ${JSON.stringify(ua.platform)},
      getHighEntropyValues: function(hints) {
        var out = {
          brands: UA_BRANDS,
          fullVersionList: UA_BRANDS.map(function(b) { return { brand: b.brand, version: b.version + '.0.0.0' }; }),
          mobile: ${ua.platform === 'Android'}, platform: ${JSON.stringify(ua.platform)},
          platformVersion: ${JSON.stringify(ua.platformVersion)}, architecture: ${JSON.stringify(ua.architecture)},
          bitness: ${JSON.stringify(ua.bitness)}, model: '', uaFullVersion: ${JSON.stringify(ua.uaFullVersion)}, wow64: false
        };
        var filtered = {};
        (hints || []).forEach(function(h) { if (h in out) filtered[h] = out[h]; });
        filtered.brands = out.brands; filtered.mobile = out.mobile; filtered.platform = out.platform;
        return Promise.resolve(filtered);
      },
      toJSON: function() { return { brands: UA_BRANDS, mobile: ${ua.platform === 'Android'}, platform: ${JSON.stringify(ua.platform)} }; }
    };
    Object.defineProperty(navigator, 'userAgentData', { get: function() { return fakeUAData; }, configurable: true });
  } catch (e) {}
})();`
}
