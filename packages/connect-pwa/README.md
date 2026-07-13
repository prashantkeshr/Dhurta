# @dhurta/connect-pwa

Turns the existing **Dhurta Connect** client (`dhurta-connect/client`) into an
installable, offline-first Progressive Web App — no fork, no source duplication.

The build layer takes the client's production `dist`, layers the PWA shell on
top (manifest, service worker, generated icons, offline fallback), and injects
the manifest link + service-worker registration into `index.html`.

## Build & preview

```bash
# 1. Build the Connect client first (produces its dist/)
cd ../../../dhurta-connect/client && npm run build

# 2. Assemble the PWA
cd -                       # back to packages/connect-pwa
npm run build              # → dist/  (deployable static PWA)

# 3. Serve it over HTTP (service workers require http/localhost, not file://)
npm run serve              # http://localhost:5183
# or do both:
npm run preview
```

Override the client dist location (Path Neutralization — no hard-coded paths):

```bash
DHURTA_CONNECT_CLIENT_DIST=/path/to/client/dist npm run build
```

## What's included

| File | Role |
| --- | --- |
| `public/manifest.webmanifest` | App identity, icons, theme (`#FF4500`), standalone display. |
| `public/sw.js` | Offline-first service worker — precached app shell, network-first navigation with SPA fallback, stale-while-revalidate for assets. RTC signalling/media are never cached. |
| `public/offline.html` | Shown when navigation fails with no cache. |
| `public/icons/*` | Generated 192/512 + maskable icons (`genIcons.mjs`, pure Node, a few KB each). |
| `build.mjs` | Assembler. |
| `serve.mjs` | Static host with SPA fallback + no-cache on `sw.js`. |

## Verified

Built and served locally; in-browser checks confirmed: app renders, manifest
recognised (name "Dhurta Connect", version 1.0.8.0, 3 icons), service worker
registers and controls the page (offline-capable), theme colour applied, and no
horizontal overflow at 375 px mobile width.

Regenerate icons after a brand change: `node genIcons.mjs`.
