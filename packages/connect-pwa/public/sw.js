/* Dhurta Connect — Service Worker (v1.0.8.0)
 *
 * Offline-first caching for the P2P chat/call/file-share PWA. The app shell is
 * precached on install so Connect opens instantly and works with no network;
 * runtime navigation falls back to the cached shell (SPA routing). WebRTC
 * signalling and media never touch the cache — only static assets do.
 */

const CACHE_VERSION = 'dhurta-connect-v1.0.8.0'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

// App-shell assets precached at install. Hashed bundle names are added at build
// time by the Vite PWA step; this base set guarantees a working offline shell.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/offline.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE)
        await cache.addAll(SHELL_ASSETS)
        await self.skipWaiting()
      } catch (err) {
        // A single missing asset must not block activation of a working SW.
        console.error('[Dhurta Connect SW] install failed:', err)
      }
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never cache non-GET or cross-origin signalling/media requests.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/rtc') || url.pathname.startsWith('/relay')) return

  // Navigation requests → network-first, fall back to cached shell (SPA offline).
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          return fresh
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (
            (await cache.match('/index.html')) ??
            (await cache.match('/offline.html')) ??
            Response.error()
          )
        }
      })()
    )
    return
  }

  // Static assets → stale-while-revalidate for instant loads + background refresh.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE)
      const cached = await cache.match(request)
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => cached ?? Response.error())
      return cached ?? network
    })()
  )
})
