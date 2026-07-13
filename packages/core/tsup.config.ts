import { defineConfig } from 'tsup'

/**
 * Dual ESM + CommonJS build.
 *
 * Every host consumes @dhurta/core differently:
 *  - Vite renderer (desktop + mobile web layer) → ESM
 *  - Electron main process (CommonJS require)    → CJS
 *  - Node tooling / codegen scripts              → CJS
 *
 * tsup emits both from a single TypeScript source and generates a matching
 * `.d.ts` per entry so the `exports` map in package.json resolves types
 * correctly under both module systems.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'fingerprint/index': 'src/fingerprint/index.ts',
    'webrtc/index': 'src/webrtc/index.ts',
    'blocklist/index': 'src/blocklist/index.ts',
    'paths/index': 'src/paths/index.ts',
    'ipc/index': 'src/ipc/index.ts',
  },
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' }
  },
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2021',
  platform: 'neutral',
})
