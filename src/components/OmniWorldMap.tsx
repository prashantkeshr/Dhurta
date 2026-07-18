import React, { useEffect, useRef } from 'react'

interface Marker {
  lat?: number
  lon?: number
  label?: string
}

interface Props {
  // Legacy single-marker form (still supported — some callers only ever have
  // one point to show).
  lat?: number
  lon?: number
  label?: string
  // Two-marker form: your real, unmasked location vs. what a site currently
  // sees (VPN exit / Tor exit). Colors are fixed so the legend stays accurate
  // regardless of which mode is active: real is always magenta, masked/seen
  // is always cyan-green.
  real?: Marker
  masked?: Marker
  width?: number
  height?: number
}

const REAL_COLOR = '#ff2bd6'
const MASKED_COLOR = '#39ff14'

// Approximate country/region silhouettes as OVERLAPPING ellipses in lon/lat
// space — no bundled map tiles/GeoJSON (stays fully offline). Regions overlap
// their neighbors deliberately so the rendered landmass reads as one
// continuous coastline (like a real map) rather than a cluster of separate
// circles — each region is only ever rendered as a soft FILL (no individual
// border stroke), which is what actually avoids the "balls" look; a name
// label at each region's center is what makes a country identifiable, not
// precise coastline geometry.
const LANDMASSES: { cx: number; cy: number; rx: number; ry: number; name?: string }[] = [
  // North America — enlarged/overlapping so Canada/USA/Mexico read as one continent
  { cx: -110, cy: 55, rx: 20, ry: 13, name: 'Canada' },
  { cx: -97, cy: 40, rx: 18, ry: 11, name: 'USA' },
  { cx: -102, cy: 23, rx: 13, ry: 9, name: 'Mexico' },
  { cx: -150, cy: 63, rx: 11, ry: 9, name: 'Alaska' },
  { cx: -42, cy: 72, rx: 11, ry: 9, name: 'Greenland' },
  // South America
  { cx: -58, cy: -8, rx: 13, ry: 15, name: 'Brazil' },
  { cx: -66, cy: -32, rx: 9, ry: 15, name: 'Argentina' },
  { cx: -77, cy: 3, rx: 6, ry: 9, name: 'Colombia' },
  { cx: -75, cy: -13, rx: 6, ry: 10, name: 'Peru' },
  // Europe — overlapping so it reads as one contiguous landmass
  { cx: -3, cy: 53, rx: 6, ry: 6, name: 'UK' },
  { cx: 3, cy: 47, rx: 7, ry: 7, name: 'France' },
  { cx: 10, cy: 51, rx: 7, ry: 6, name: 'Germany' },
  { cx: 12, cy: 43, rx: 7, ry: 7, name: 'Italy' },
  { cx: 23, cy: 54, rx: 14, ry: 9, name: 'E. Europe' },
  { cx: 18, cy: 61, rx: 11, ry: 10, name: 'Scandinavia' },
  // Africa
  { cx: 6, cy: 21, rx: 14, ry: 12, name: 'N. Africa' },
  { cx: 20, cy: 3, rx: 16, ry: 14, name: 'C. Africa' },
  { cx: 26, cy: -21, rx: 15, ry: 14, name: 'S. Africa' },
  { cx: 39, cy: 8, rx: 9, ry: 12, name: 'E. Africa' },
  // Asia — overlapping so Russia/China/India/SE Asia connect into one mass
  { cx: 52, cy: 57, rx: 19, ry: 14, name: 'W. Russia' },
  { cx: 105, cy: 62, rx: 34, ry: 13, name: 'Siberia' },
  { cx: 35, cy: 30, rx: 10, ry: 10, name: 'Middle East' },
  { cx: 78, cy: 22, rx: 13, ry: 14, name: 'India' },
  { cx: 102, cy: 35, rx: 19, ry: 14, name: 'China' },
  { cx: 128, cy: 39, rx: 7, ry: 8, name: 'Korea' },
  { cx: 139, cy: 37, rx: 6, ry: 9, name: 'Japan' },
  { cx: 104, cy: 13, rx: 12, ry: 9, name: 'SE Asia' },
  { cx: 118, cy: -3, rx: 14, ry: 7, name: 'Indonesia' },
  // Oceania
  { cx: 134, cy: -25, rx: 16, ry: 9, name: 'Australia' },
  { cx: 173, cy: -41, rx: 5, ry: 7, name: 'New Zealand' },
]

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

function isLand(lon: number, lat: number) {
  for (const m of LANDMASSES) {
    const dx = (lon - m.cx) / m.rx
    const dy = (lat - m.cy) / m.ry
    if (dx * dx + dy * dy <= 1) return true
  }
  return false
}

export default function OmniWorldMap({ lat, lon, label, real, masked, width = 460, height = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pulseRef = useRef(0)
  const rafRef = useRef(0)

  // Two-marker form takes priority when supplied; otherwise fall back to the
  // single lat/lon/label props so existing callers keep working unchanged.
  const markers: { lat: number; lon: number; label?: string; color: string }[] = []
  if (real && typeof real.lat === 'number' && typeof real.lon === 'number') {
    markers.push({ lat: real.lat, lon: real.lon, label: real.label, color: REAL_COLOR })
  }
  if (masked && typeof masked.lat === 'number' && typeof masked.lon === 'number') {
    markers.push({ lat: masked.lat, lon: masked.lon, label: masked.label, color: MASKED_COLOR })
  }
  if (markers.length === 0 && typeof lat === 'number' && typeof lon === 'number') {
    markers.push({ lat, lon, label, color: REAL_COLOR })
  }
  const showRealLegend = !!real && typeof real.lat === 'number' && typeof real.lon === 'number'
  const showMaskedLegend = !!masked && typeof masked.lat === 'number' && typeof masked.lon === 'number'
  const showLegend = showRealLegend || showMaskedLegend

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const project = (lonDeg: number, latDeg: number) => ({
      x: ((lonDeg + 180) / 360) * width,
      y: ((90 - latDeg) / 180) * height,
    })

    // Precompute the dot grid once (static — only the marker animates).
    // Denser + larger dots than a sparse scatter, so adjacent dots visually
    // merge into a solid coastline instead of reading as isolated points.
    const dots: { x: number; y: number }[] = []
    const step = 3
    for (let latDeg = -80; latDeg <= 80; latDeg += step) {
      for (let lonDeg = -180; lonDeg <= 180; lonDeg += step) {
        if (isLand(lonDeg, latDeg)) dots.push(project(lonDeg, latDeg))
      }
    }

    const lonScale = width / 360
    const latScale = height / 180

    function draw() {
      ctx!.clearRect(0, 0, width, height)

      // Grid lines (lat/lon reference), with equator + prime meridian emphasized
      // so the map reads as an actual projection, not just a texture.
      ctx!.lineWidth = 1
      for (let x = 0; x <= width; x += width / 12) {
        const isPrimeMeridian = Math.abs(x - width / 2) < 1
        ctx!.strokeStyle = isPrimeMeridian ? 'rgba(0,255,242,0.16)' : 'rgba(0,255,242,0.06)'
        ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, height); ctx!.stroke()
      }
      for (let y = 0; y <= height; y += height / 6) {
        const isEquator = Math.abs(y - height / 2) < 1
        ctx!.strokeStyle = isEquator ? 'rgba(0,255,242,0.18)' : 'rgba(0,255,242,0.06)'
        ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(width, y); ctx!.stroke()
      }

      // Soft landmass fill UNDER the dot texture — fill ONLY, no per-region
      // border stroke. That's what avoids the "cluster of balls" look: with no
      // individual outlines, overlapping/adjacent regions blend into one
      // continuous, map-like coastline instead of a pile of translucent bubbles.
      for (const m of LANDMASSES) {
        const p = project(m.cx, m.cy)
        ctx!.beginPath()
        ctx!.ellipse(p.x, p.y, m.rx * lonScale, m.ry * latScale, 0, 0, Math.PI * 2)
        ctx!.fillStyle = 'rgba(0,255,242,0.09)'
        ctx!.fill()
      }

      // Landmass dots (texture on top of the silhouette fill) — dense/large
      // enough to merge into a solid-looking coastline rather than scattered points.
      ctx!.fillStyle = 'rgba(0,255,242,0.65)'
      for (const d of dots) {
        ctx!.beginPath()
        ctx!.arc(d.x, d.y, 1.6, 0, Math.PI * 2)
        ctx!.fill()
      }

      // Country/region labels — only where the region renders large enough to
      // hold readable text, so the map doesn't turn into label soup at small sizes.
      ctx!.font = '9px Consolas, monospace'
      ctx!.textAlign = 'center'
      ctx!.fillStyle = 'rgba(210,255,252,0.75)'
      for (const m of LANDMASSES) {
        if (!m.name) continue
        const rxPx = m.rx * lonScale
        if (rxPx < 16) continue
        const p = project(m.cx, m.cy)
        ctx!.fillText(m.name, p.x, p.y + 3)
      }
      ctx!.textAlign = 'start'

      // Markers — plain pulsing dots, centered exactly on each coordinate.
      // Real and masked locations get their own fixed colors (see REAL_COLOR/
      // MASKED_COLOR) so the legend below the canvas stays accurate no matter
      // which one is currently plotted.
      pulseRef.current = (pulseRef.current + 0.05) % (Math.PI * 2)
      const pr = 4 + Math.sin(pulseRef.current) * 2.5
      for (const m of markers) {
        const p = project(m.lon, m.lat)
        const rgb = hexToRgb(m.color)

        ctx!.beginPath()
        ctx!.arc(p.x, p.y, pr + 7, 0, Math.PI * 2)
        ctx!.strokeStyle = `rgba(${rgb},0.55)`
        ctx!.lineWidth = 1.4
        ctx!.stroke()

        ctx!.beginPath()
        ctx!.arc(p.x, p.y, pr, 0, Math.PI * 2)
        ctx!.fillStyle = m.color
        ctx!.shadowColor = `rgba(${rgb},0.9)`
        ctx!.shadowBlur = 14
        ctx!.fill()
        ctx!.shadowBlur = 0

        if (m.label) {
          ctx!.font = '10px Consolas, monospace'
          ctx!.fillStyle = '#fff'
          ctx!.fillText(m.label, p.x + 9, p.y - 7)
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => cancelAnimationFrame(rafRef.current)
  }, [lat, lon, label, real?.lat, real?.lon, real?.label, masked?.lat, masked?.lon, masked?.label, width, height])

  return (
    <div style={{ width }}>
      <canvas ref={canvasRef} style={{ width, height }} />
      {showLegend && (
        <div className="flex items-center justify-center gap-4 mt-1.5 text-[9px] font-mono">
          {showRealLegend && (
            <span className="flex items-center gap-1.5" style={{ color: REAL_COLOR }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: REAL_COLOR, boxShadow: `0 0 6px ${REAL_COLOR}` }} />
              Real location (unmasked)
            </span>
          )}
          {showMaskedLegend && (
            <span className="flex items-center gap-1.5" style={{ color: MASKED_COLOR }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: MASKED_COLOR, boxShadow: `0 0 6px ${MASKED_COLOR}` }} />
              Masked location (what sites see)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
