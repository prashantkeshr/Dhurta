/**
 * Dhurta Connect PWA assembler.
 *
 * The Connect client (dhurta-connect/client) is already a complete React+Vite
 * P2P app. Rather than fork it, this build layer takes its production `dist`,
 * layers on the PWA shell (manifest, service worker, icons, offline fallback),
 * and injects the manifest link + service-worker registration into index.html —
 * producing a deployable, installable Progressive Web App with no source
 * duplication.
 *
 * Run: node build.mjs   (or `npm run build` in this package)
 *
 * The Path Neutralization principle applies here too: the client dist location
 * is resolved from an env override → sibling checkout, never a hard-coded drive.
 */
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'dist')
const PUBLIC = path.join(__dirname, 'public')

/** Resolve the built Connect client dist. Override with DHURTA_CONNECT_CLIENT_DIST. */
function resolveClientDist() {
  const override = process.env.DHURTA_CONNECT_CLIENT_DIST
  if (override && override.trim()) return override.trim()
  // Default: the in-repo consolidated tool at Dhurta/tools/connect/client/dist,
  // relative to Dhurta/packages/connect-pwa.
  return path.resolve(__dirname, '..', '..', 'tools', 'connect', 'client', 'dist')
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}

/** Injects PWA head tags + SW registration into the client index.html. */
function pwaify(html) {
  const headInject = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#FF4500" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />`

  const swRegister = `
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('/sw.js').catch(function (err) {
            console.error('[Dhurta Connect] SW registration failed:', err)
          })
        })
      }
    </script>`

  let out = html
  if (out.includes('</head>')) {
    out = out.replace('</head>', `${headInject}\n  </head>`)
  }
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${swRegister}\n  </body>`)
  }
  return out
}

async function main() {
  const clientDist = resolveClientDist()
  if (!existsSync(path.join(clientDist, 'index.html'))) {
    throw new Error(
      `Connect client dist not found at ${clientDist}. ` +
        `Build it first (dhurta-connect/client: npm run build) or set DHURTA_CONNECT_CLIENT_DIST.`,
    )
  }

  // 1. Clean output.
  await fs.rm(OUT, { recursive: true, force: true })
  await fs.mkdir(OUT, { recursive: true })

  // 2. Copy the built client app.
  await copyDir(clientDist, OUT)

  // 3. Layer the PWA shell (manifest, sw, offline, icons).
  await copyDir(PUBLIC, OUT)

  // 4. Ensure icons exist — source the brand logo (dist first, then the client's
  //    public/ dir which Vite doesn't always copy) and use it for the app icons
  //    and the favicon. Browsers accept a single high-res source for all sizes.
  const iconsDir = path.join(OUT, 'icons')
  await fs.mkdir(iconsDir, { recursive: true })
  const logoCandidates = [
    path.join(clientDist, 'logo.png'),
    path.resolve(clientDist, '..', 'public', 'logo.png'),
  ]
  const logo = logoCandidates.find((p) => existsSync(p))
  if (logo) {
    // Favicon (client index.html references /logo.png).
    await fs.copyFile(logo, path.join(OUT, 'logo.png'))
  }
  // App icons: prefer the pre-generated, correctly-sized PNGs from public/icons
  // (see genIcons.mjs). Only fall back to the raw logo if a size is missing.
  for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    const target = path.join(iconsDir, name)
    if (!existsSync(target) && logo) {
      await fs.copyFile(logo, target)
    }
  }

  // 5. Inject PWA tags + SW registration into index.html.
  const indexPath = path.join(OUT, 'index.html')
  const html = await fs.readFile(indexPath, 'utf8')
  await fs.writeFile(indexPath, pwaify(html), 'utf8')

  console.log(`[connect-pwa] Built installable PWA → ${OUT}`)
  console.log(`[connect-pwa] Source client dist: ${clientDist}`)
}

main().catch((err) => {
  console.error('[connect-pwa] Build failed:', err.message)
  process.exit(1)
})
