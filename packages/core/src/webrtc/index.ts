/**
 * WebRTC strict-blocking policy.
 *
 * WebRTC can enumerate a device's real LAN/public IP through STUN/ICE even when
 * every HTTP request rides a VPN or Tor tunnel — the single most common way a
 * "protected" browser leaks identity. Dhurta neutralises the entire API surface
 * at document-start so no page script can construct a peer connection or reach
 * getUserMedia.
 *
 * Extracted verbatim (behaviour-preserving) from the `webrtcBlockScript` string
 * in electron/webviewPreload.js.
 */

/** The complete set of WebRTC constructor globals removed from `window`. */
export const BLOCKED_WEBRTC_GLOBALS: readonly string[] = [
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'mozRTCPeerConnection',
  'RTCSessionDescription',
  'webkitRTCSessionDescription',
  'mozRTCSessionDescription',
  'RTCIceCandidate',
  'webkitRTCIceCandidate',
  'mozRTCIceCandidate',
  'RTCDataChannel',
  'RTCPeerConnectionIceEvent',
  'MediaStreamTrack',
  'RTCRtpReceiver',
  'RTCRtpSender',
  'RTCRtpTransceiver',
  'RTCDtlsTransport',
  'RTCIceTransport',
  'RTCSctpTransport',
  'RTCCertificate',
  'RTCStatsReport',
]

/**
 * Builds the main-world injection script that dismantles WebRTC. Every global
 * in {@link BLOCKED_WEBRTC_GLOBALS} is made permanently `undefined`
 * (non-configurable) and `navigator.mediaDevices` / legacy `getUserMedia`
 * variants are removed so neither modern nor legacy media capture can run.
 */
export function buildWebRTCBlockScript(): string {
  const names = JSON.stringify(BLOCKED_WEBRTC_GLOBALS)
  return `(function() {
  'use strict';
  var names = ${names};
  names.forEach(function(n) {
    try { Object.defineProperty(window, n, { get: function() { return undefined; }, set: function() {}, configurable: false, enumerable: false }); } catch (e) {}
  });
  // Kill mediaDevices entirely to prevent getUserMedia / enumerateDevices
  try { Object.defineProperty(navigator, 'mediaDevices', { get: function() { return undefined; }, configurable: false }); } catch (e) {}
  // Legacy getUserMedia variants
  try { Object.defineProperty(navigator, 'getUserMedia', { get: function() { return undefined; }, configurable: false }); } catch (e) {}
  try { Object.defineProperty(navigator, 'webkitGetUserMedia', { get: function() { return undefined; }, configurable: false }); } catch (e) {}
  try { Object.defineProperty(navigator, 'mozGetUserMedia', { get: function() { return undefined; }, configurable: false }); } catch (e) {}
})();`
}

/**
 * The GeckoView equivalent: preference flags to set on the runtime settings so
 * the engine itself refuses WebRTC, rather than relying on a content script.
 * Consumed by the Android host (see packages/android GeckoController).
 */
export const GECKO_WEBRTC_PREFS: Readonly<Record<string, boolean>> = {
  'media.peerconnection.enabled': false,
  'media.navigator.enabled': false,
  'media.navigator.streams.fake': true,
  'media.peerconnection.ice.default_address_only': true,
  'media.peerconnection.ice.no_host': true,
}
