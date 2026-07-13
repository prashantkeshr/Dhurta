import type { FingerprintProfile } from './profile'
import { DESKTOP_PROFILE } from './profile'

/**
 * Generates the *noise + spoof* main-world injection script: canvas/WebGL/audio
 * randomisation and WebGL vendor-renderer overriding plus timezone flattening.
 * Extracted verbatim (behaviour-preserving) from the `fingerprintScript` string
 * in electron/webviewPreload.js.
 *
 * Canvas and audio get per-read jitter so a hash of the surface differs every
 * time it is sampled — defeating persistent canvas/audio fingerprinting — while
 * WebGL vendor/renderer are pinned to the profile's uniform values.
 */
export function buildNoiseScript(
  profile: FingerprintProfile = DESKTOP_PROFILE,
): string {
  return `(function() {
  'use strict';
  function rf(min, max) { return Math.random() * (max - min) + min; }

  // Canvas noise — toDataURL + toBlob
  try {
    var origToDU = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      var ctx = this.getContext('2d');
      if (ctx) { try {
        var img = ctx.getImageData(0, 0, this.width, this.height);
        for (var i = 0; i < img.data.length; i += 4) {
          img.data[i]   = Math.min(255, Math.max(0, img.data[i]   + Math.floor(rf(-2, 3))));
          img.data[i+1] = Math.min(255, Math.max(0, img.data[i+1] + Math.floor(rf(-2, 3))));
          img.data[i+2] = Math.min(255, Math.max(0, img.data[i+2] + Math.floor(rf(-2, 3))));
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {} }
      return origToDU.apply(this, arguments);
    };
    var origToBl = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
      var ctx = this.getContext('2d');
      if (ctx) { try {
        var img = ctx.getImageData(0, 0, this.width, this.height);
        for (var i = 0; i < img.data.length; i += 4) {
          img.data[i]   = Math.min(255, Math.max(0, img.data[i]   + Math.floor(rf(-2, 3))));
          img.data[i+1] = Math.min(255, Math.max(0, img.data[i+1] + Math.floor(rf(-2, 3))));
          img.data[i+2] = Math.min(255, Math.max(0, img.data[i+2] + Math.floor(rf(-2, 3))));
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {} }
      return origToBl.call(this, cb, type, quality);
    };
  } catch (e) {}

  // AudioContext noise
  try {
    var origGCD = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(ch) {
      var data = origGCD.call(this, ch);
      for (var i = 0; i < data.length; i += 100) { data[i] += rf(-0.0001, 0.0001); }
      return data;
    };
  } catch (e) {}

  // WebGL vendor/renderer spoof
  try {
    var UV = 0x9245, UR = 0x9246;
    function pGL(proto) {
      if (!proto || proto.__dGL) return;
      var orig = proto.getParameter;
      proto.getParameter = function(p) {
        if (p === UV) return ${JSON.stringify(profile.webgl.vendor)};
        if (p === UR) return ${JSON.stringify(profile.webgl.renderer)};
        return orig.call(this, p);
      };
      proto.__dGL = true;
    }
    if (window.WebGLRenderingContext) pGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) pGL(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // Timezone → flatten to profile timezone
  try { Date.prototype.getTimezoneOffset = function() { return 0; }; } catch (e) {}
  try {
    var _ro = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      var o = _ro.call(this); o.timeZone = ${JSON.stringify(profile.timezone)}; return o;
    };
  } catch (e) {}
})();`
}
