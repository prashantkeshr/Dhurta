/**
 * Generates lightweight, correctly-sized PWA icons with zero dependencies.
 *
 * Rasterises a simple on-brand mark — Dhurta navy ground with the orange
 * "Connect" motif (two linked discs) — into a pixel buffer and encodes it as a
 * real PNG via Node's built-in zlib. Produces exact 192x192 and 512x512 assets
 * (a few KB each) rather than shipping a multi-MB source logo relabelled.
 */
import { deflateSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Brand palette ──
const NAVY = [0x0b, 0x11, 0x20]
const ORANGE = [0xff, 0x45, 0x00]

// ── CRC32 (PNG chunk checksums) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** Draws the icon into an RGBA pixel buffer of the given size. */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = 255
  }

  // Background fill.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, NAVY)

  // Two overlapping orange rings = the "Connect" motif.
  const cy = size / 2
  const r = size * 0.19
  const ringW = size * 0.055
  const c1x = size * 0.4
  const c2x = size * 0.6
  const inR1 = r - ringW
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = Math.hypot(x - c1x, y - cy)
      const d2 = Math.hypot(x - c2x, y - cy)
      const onRing1 = d1 <= r && d1 >= inR1
      const onRing2 = d2 <= r && d2 >= inR1
      if (onRing1 || onRing2) set(x, y, ORANGE)
    }
  }
  return px
}

function encodePng(size) {
  const raw = drawIcon(size)
  // Prefix each scanline with filter byte 0 (none).
  const stride = size * 4
  const filtered = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0
    raw.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function main() {
  const iconsDir = path.join(__dirname, 'public', 'icons')
  await fs.mkdir(iconsDir, { recursive: true })
  const outputs = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
  ]
  for (const [name, size] of outputs) {
    const png = encodePng(size)
    await fs.writeFile(path.join(iconsDir, name), png)
    console.log(`[genIcons] ${name} — ${size}x${size}, ${(png.length / 1024).toFixed(1)} KB`)
  }
}

main().catch((e) => {
  console.error('[genIcons] failed:', e)
  process.exit(1)
})
