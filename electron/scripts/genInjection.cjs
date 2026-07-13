/**
 * Build-time generator: emits dist-electron/injectionScripts.js from @dhurta/core.
 *
 * webviewPreload.js is copied into dist-electron verbatim and loaded as a raw
 * Electron preload (no bundler, no node_modules resolution inside the asar). To
 * keep @dhurta/core the single source of truth for the fingerprint/WebRTC
 * injection payloads without shipping the whole package into the preload, we
 * pre-render the three script strings here at build time and write a tiny,
 * self-contained CommonJS module the preload requires with a relative path.
 *
 * Run automatically by `npm run build:electron`. Regenerate manually with:
 *   node electron/scripts/genInjection.cjs
 */
const fs = require('fs')
const path = require('path')

function main() {
  // Resolve the built CJS bundle of @dhurta/core. Its `build` must have run.
  let core
  try {
    core = require('@dhurta/core')
  } catch (err) {
    console.error(
      '[genInjection] Could not load @dhurta/core. Run `npm run build:core` first.',
    )
    throw err
  }

  const { buildBaselineScript, buildNoiseScript, buildWebRTCBlockScript, DESKTOP_PROFILE } = core

  const baselineScript = buildBaselineScript(DESKTOP_PROFILE)
  const fingerprintScript = buildNoiseScript(DESKTOP_PROFILE)
  const webrtcBlockScript = buildWebRTCBlockScript()

  const banner =
    '// AUTO-GENERATED from @dhurta/core — DO NOT EDIT BY HAND.\n' +
    '// Regenerate: node electron/scripts/genInjection.cjs\n' +
    `// Ecosystem version: ${core.DHURTA_VERSION}\n`

  const body =
    banner +
    'module.exports = {\n' +
    `  baselineScript: ${JSON.stringify(baselineScript)},\n` +
    `  fingerprintScript: ${JSON.stringify(fingerprintScript)},\n` +
    `  webrtcBlockScript: ${JSON.stringify(webrtcBlockScript)}\n` +
    '}\n'

  const outDir = path.resolve(process.cwd(), 'dist-electron')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  const outFile = path.join(outDir, 'injectionScripts.js')
  fs.writeFileSync(outFile, body, 'utf8')
  console.log(
    `[genInjection] Wrote ${outFile} ` +
      `(baseline ${baselineScript.length}b, noise ${fingerprintScript.length}b, webrtc ${webrtcBlockScript.length}b)`,
  )
}

main()
