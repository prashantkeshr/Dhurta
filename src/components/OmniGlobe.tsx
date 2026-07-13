import React, { useEffect, useRef } from 'react'

interface Props {
  lat?: number
  lon?: number
  label?: string
  size?: number
}

// Procedural wireframe globe — no external map tiles/textures (stays fully
// offline, matches the "no external leaks" ethos of a privacy dashboard).
// Auto-rotates; drag or scroll to spin manually. Plots a pulsing marker at
// the given lat/lon once an IP lookup resolves one.
export default function OmniGlobe({ lat, lon, label, size = 300 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    rotY: 0, rotX: 0.35, autoSpin: true,
    dragging: false, lastX: 0, lastY: 0,
    pulse: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const R = size * 0.36
    const cx = size / 2
    const cy = size / 2
    let raf = 0

    function project(x: number, y: number, z: number, rotY: number, rotX: number) {
      // Rotate around Y (spin)
      const x1 = x * Math.cos(rotY) + z * Math.sin(rotY)
      const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY)
      // Rotate around X (tilt)
      const y2 = y * Math.cos(rotX) - z1 * Math.sin(rotX)
      const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX)
      return { x: x1, y: y2, z: z2 }
    }

    function sphereToXYZ(latDeg: number, lonDeg: number) {
      const latR = (latDeg * Math.PI) / 180
      const lonR = (lonDeg * Math.PI) / 180
      return {
        x: R * Math.cos(latR) * Math.sin(lonR),
        y: R * Math.sin(latR),
        z: R * Math.cos(latR) * Math.cos(lonR),
      }
    }

    function draw() {
      const st = stateRef.current
      ctx!.clearRect(0, 0, size, size)

      // Outer glow ring (atmosphere)
      const grad = ctx!.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.35)
      grad.addColorStop(0, 'rgba(0,255,242,0.28)')
      grad.addColorStop(1, 'rgba(0,255,242,0)')
      ctx!.fillStyle = grad
      ctx!.beginPath()
      ctx!.arc(cx, cy, R * 1.35, 0, Math.PI * 2)
      ctx!.fill()

      // Sphere base fill (very dark, subtle)
      ctx!.fillStyle = 'rgba(10,16,20,0.65)'
      ctx!.beginPath()
      ctx!.arc(cx, cy, R, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.strokeStyle = 'rgba(0,255,242,0.35)'
      ctx!.lineWidth = 1
      ctx!.stroke()

      // Latitude circles
      for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
        ctx!.beginPath()
        let started = false
        for (let lonDeg = 0; lonDeg <= 360; lonDeg += 6) {
          const p = sphereToXYZ(latDeg, lonDeg)
          const r = project(p.x, p.y, p.z, st.rotY, st.rotX)
          const sx = cx + r.x
          const sy = cy - r.y
          const alpha = r.z > 0 ? 0.55 : 0.08
          if (!started) { ctx!.moveTo(sx, sy); started = true } else { ctx!.lineTo(sx, sy) }
          ctx!.strokeStyle = `rgba(0,255,242,${alpha})`
        }
        ctx!.stroke()
      }

      // Longitude meridians
      for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
        ctx!.beginPath()
        let started = false
        for (let latDeg = -90; latDeg <= 90; latDeg += 6) {
          const p = sphereToXYZ(latDeg, lonDeg)
          const r = project(p.x, p.y, p.z, st.rotY, st.rotX)
          const sx = cx + r.x
          const sy = cy - r.y
          const alpha = r.z > 0 ? 0.4 : 0.06
          if (!started) { ctx!.moveTo(sx, sy); started = true } else { ctx!.lineTo(sx, sy) }
          ctx!.strokeStyle = `rgba(157,0,255,${alpha})`
        }
        ctx!.stroke()
      }

      // IP marker
      if (typeof lat === 'number' && typeof lon === 'number') {
        const p = sphereToXYZ(lat, lon)
        const r = project(p.x, p.y, p.z, st.rotY, st.rotX)
        const sx = cx + r.x
        const sy = cy - r.y
        const visible = r.z > -R * 0.15
        if (visible) {
          st.pulse = (st.pulse + 0.045) % (Math.PI * 2)
          const pulseR = 4 + Math.sin(st.pulse) * 2.5
          const opacity = Math.max(0.35, Math.min(1, (r.z + R) / (R * 1.3)))

          // Outer pulse ring
          ctx!.beginPath()
          ctx!.arc(sx, sy, pulseR + 6, 0, Math.PI * 2)
          ctx!.strokeStyle = `rgba(255,43,214,${0.5 * opacity})`
          ctx!.lineWidth = 1.5
          ctx!.stroke()

          // Core dot
          ctx!.beginPath()
          ctx!.arc(sx, sy, pulseR, 0, Math.PI * 2)
          ctx!.fillStyle = `rgba(255,43,214,${opacity})`
          ctx!.shadowColor = 'rgba(255,43,214,0.9)'
          ctx!.shadowBlur = 12
          ctx!.fill()
          ctx!.shadowBlur = 0

          if (label) {
            ctx!.font = '9px Consolas, monospace'
            ctx!.fillStyle = `rgba(255,255,255,${opacity})`
            ctx!.fillText(label, sx + 8, sy - 6)
          }
        }
      }

      if (st.autoSpin && !st.dragging) st.rotY += 0.0028
      raf = requestAnimationFrame(draw)
    }

    draw()

    // ── Drag to rotate ──
    const onDown = (e: PointerEvent) => {
      stateRef.current.dragging = true
      stateRef.current.autoSpin = false
      stateRef.current.lastX = e.clientX
      stateRef.current.lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!stateRef.current.dragging) return
      const dx = e.clientX - stateRef.current.lastX
      const dy = e.clientY - stateRef.current.lastY
      stateRef.current.rotY += dx * 0.006
      stateRef.current.rotX = Math.max(-1.2, Math.min(1.2, stateRef.current.rotX + dy * 0.004))
      stateRef.current.lastX = e.clientX
      stateRef.current.lastY = e.clientY
    }
    const onUp = () => { stateRef.current.dragging = false }
    // ── Scroll gesture to rotate ──
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      stateRef.current.autoSpin = false
      stateRef.current.rotY += e.deltaY * 0.0025 + e.deltaX * 0.0025
    }

    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [lat, lon, label, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, cursor: 'grab', touchAction: 'none' }}
      title="Drag or scroll to rotate"
    />
  )
}
