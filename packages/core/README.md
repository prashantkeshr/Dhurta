# @dhurta/core

Platform-agnostic privacy core for the Dhurta browser ecosystem. **Zero Node.js
and zero Electron runtime dependencies** — safe to import from a renderer, a
Capacitor mobile layer, a service worker, or a codegen script.

It is the single source of truth every host draws from: Electron (desktop),
GeckoView (Android), WKWebView (iOS), and the Connect PWA.

## Modules

| Import | Purpose |
| --- | --- |
| `@dhurta/core/fingerprint` | Uniform anti-fingerprint profiles + document-start injection script builders (extracted from the desktop preload). |
| `@dhurta/core/webrtc` | WebRTC strict-block injection script + GeckoView engine prefs. |
| `@dhurta/core/blocklist` | ABP/EasyList parser + Safari Content Blocker JSON compiler (iOS). |
| `@dhurta/core/paths` | Path Neutralization Engine — resolves tool roots from env → bundle → dev-relative. No hard-coded paths. |
| `@dhurta/core/ipc` | Unified cross-platform IPC schema + fail-closed heartbeat kill-switch. |

## Build

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsup → dual ESM (.js) + CJS (.cjs) + .d.ts
```

## Cross-platform contract

The TypeScript types in `ipc/schema.ts` are authoritative. The Kotlin
(`packages/android`) and Swift (`packages/ios`) hosts mirror them field-for-field
so an action like `p2p.startChat` or `proxy.set` carries an identical payload on
every platform. The `HeartbeatWatchdog` cadence (`1000ms` beat, `1500ms` grace)
is likewise mirrored by `TorController` (Kotlin) and `TorProxy` (Swift).

Version: **1.0.8.0** (`DHURTA_VERSION`).
