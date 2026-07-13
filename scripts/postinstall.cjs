/**
 * Post-install: rebuild native modules (better-sqlite3) against Electron's ABI
 * for local `npm run dev`. Runs `electron-builder install-app-deps`.
 *
 * NON-FATAL by design. This root script fires on ANY workspace install —
 * including CI jobs that only build the pure-TypeScript @dhurta/core package on
 * a runner with no need for (or ability to) rebuild native Electron modules.
 * A failure here must never break the install; packaging rebuilds native deps
 * again anyway (electron-builder does this during --dir/--publish), so nothing
 * downstream depends on this step succeeding at install time.
 */
const { execSync } = require('node:child_process')

try {
  // npm augments PATH with node_modules/.bin during lifecycle scripts, so the
  // bare `electron-builder` binary resolves. Inherit stdio for visibility.
  execSync('electron-builder install-app-deps', { stdio: 'inherit' })
} catch (err) {
  console.warn(
    '[postinstall] electron-builder install-app-deps was skipped ' +
      '(non-fatal — native deps are rebuilt again during packaging): ' +
      (err && err.message ? err.message : String(err)),
  )
  // Exit 0 regardless so the install always succeeds.
  process.exit(0)
}
