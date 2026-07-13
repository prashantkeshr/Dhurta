/**
 * Minimal static server for the built Connect PWA. Serves ./dist over HTTP so
 * the service worker registers (SW requires a secure/localhost origin, not
 * file://). SPA fallback routes unknown paths to index.html.
 */
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 5183

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname))

    // Directory → index.html
    if (url.pathname === '/' || url.pathname.endsWith('/')) {
      filePath = path.join(ROOT, 'index.html')
    }
    // Guard against path traversal.
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    // SPA fallback for client-side routes.
    if (!existsSync(filePath)) {
      filePath = path.join(ROOT, 'index.html')
    }

    const ext = path.extname(filePath).toLowerCase()
    const data = await fs.readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      // Never cache the SW itself so updates roll out.
      ...(path.basename(filePath) === 'sw.js'
        ? { 'Cache-Control': 'no-cache' }
        : {}),
    })
    res.end(data)
  } catch {
    res.writeHead(404).end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`[connect-pwa] Serving ${ROOT} at http://localhost:${PORT}`)
})
