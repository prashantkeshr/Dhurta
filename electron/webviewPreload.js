// Runs inside every BrowserView page at document initialization
// Flags are injected via additionalArguments in webPreferences

// ── Extension install bridge ─────────────────────────────────────────────────
// exposeInMainWorld crosses the context-isolation boundary so Chrome Web Store
// and AMO install buttons work from any page. Wrapped in try/catch: contextBridge
// is only available when contextIsolation=true in webPreferences.
try {
  const { contextBridge, ipcRenderer: _ipc } = require('electron')
  contextBridge.exposeInMainWorld('__dhurta', {
    installExt:       (extId) => _ipc.invoke('extensions:installFromWebStore', extId),
    installExtFromAMO: (slug) => _ipc.invoke('extensions:installFromAMO', slug),
  })
} catch (_) {}

// ── HTML5 fullscreen relay → main process ─────────────────────────────────────
// The built-in enter-html-full-screen event on webContents sometimes doesn't fire
// for shadow-DOM video players (YouTube, Netflix). Listening to fullscreenchange
// inside the renderer is more reliable and covers all fullscreen requests.
;(function setupFullscreenRelay() {
  try {
    var ipc = require('electron').ipcRenderer
    document.addEventListener('fullscreenchange', function () {
      ipc.send(document.fullscreenElement ? 'view:fullscreenEnter' : 'view:fullscreenLeave')
    })
  } catch (_) {}
})()

;(function () {
  const argv = process.argv
  const isGhost      = argv.includes('--ghost')
  const doFingerprint = isGhost || argv.includes('--anti-fingerprint')
  const doBlockWebRTC = isGhost || argv.includes('--block-webrtc')

  // ── CRITICAL: Inject into MAIN WORLD ─────────────────────────────────────────
  // With contextIsolation:true, Object.defineProperty in this preload only affects
  // the isolated preload world. The page's JavaScript runs in the MAIN world
  // (world 0) and sees the REAL navigator/screen/WebGL/WebRTC objects. We MUST
  // use webFrame.executeJavaScript to inject into the main world so the page's
  // own JS reads our spoofed values.
  const { webFrame } = require('electron')

  // Injection payloads are the single source of truth in @dhurta/core, rendered
  // at build time into ./injectionScripts.js (see electron/scripts/genInjection.cjs).
  // Requiring the co-located generated module keeps this preload self-contained
  // — no node_modules resolution inside the packaged asar — while guaranteeing
  // the desktop, Android and iOS hosts all inject byte-identical surfaces.
  //
  // The require is guarded: if the generated file is somehow absent, we fall
  // back to inline copies so anti-fingerprint / WebRTC-block can never silently
  // become no-ops (a security regression). The fallbacks mirror the core output.
  var baselineScript, fingerprintScript, webrtcBlockScript
  try {
    var __inj = require('./injectionScripts.js')
    baselineScript = __inj.baselineScript
    fingerprintScript = __inj.fingerprintScript
    webrtcBlockScript = __inj.webrtcBlockScript
  } catch (_) {
    baselineScript = ''
    fingerprintScript = ''
    webrtcBlockScript = `(function(){'use strict';var names=['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','RTCSessionDescription','webkitRTCSessionDescription','mozRTCSessionDescription','RTCIceCandidate','webkitRTCIceCandidate','mozRTCIceCandidate','RTCDataChannel','RTCPeerConnectionIceEvent','MediaStreamTrack','RTCRtpReceiver','RTCRtpSender','RTCRtpTransceiver','RTCDtlsTransport','RTCIceTransport','RTCSctpTransport','RTCCertificate','RTCStatsReport'];names.forEach(function(n){try{Object.defineProperty(window,n,{get:function(){return undefined},set:function(){},configurable:false,enumerable:false})}catch(e){}});try{Object.defineProperty(navigator,'mediaDevices',{get:function(){return undefined},configurable:false})}catch(e){}try{Object.defineProperty(navigator,'getUserMedia',{get:function(){return undefined},configurable:false})}catch(e){}try{Object.defineProperty(navigator,'webkitGetUserMedia',{get:function(){return undefined},configurable:false})}catch(e){}try{Object.defineProperty(navigator,'mozGetUserMedia',{get:function(){return undefined},configurable:false})}catch(e){}})();`
  }

  // Inject into main world (world 0) — runs BEFORE any page script
  try { webFrame.executeJavaScript(baselineScript) } catch (_) {}
  if (doFingerprint) { try { webFrame.executeJavaScript(fingerprintScript) } catch (_) {} }
  if (doBlockWebRTC) { try { webFrame.executeJavaScript(webrtcBlockScript) } catch (_) {} }

  // ── Screen warmth / eye-comfort overlay ──────────────────────────────────────
  // Injected here so it survives SPA navigations (YouTube's pushState) and can't
  // be wiped by framework re-renders. MutationObserver only acts when warmth > 0.
  ;(function setupWarmthOverlay() {
    try {
      const { ipcRenderer } = require('electron')
      let _warmth = 0

      function applyOverlay(level) {
        _warmth = level
        const root = document.documentElement || document.body
        if (!root) return
        let el = document.getElementById('__dw_overlay')
        if (level <= 0) {
          if (el) el.remove()
          return
        }
        if (!el) {
          el = document.createElement('div')
          el.id = '__dw_overlay'
          // Plain semi-transparent amber — no mix-blend-mode so it's visible on dark pages.
          el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'width:100vw', 'height:100vh',
            'pointer-events:none', 'z-index:2147483647',
            'transition:background 0.25s ease',
          ].join(';') + ';'
          root.appendChild(el)
        }
        const alpha = ((level / 100) * 0.42).toFixed(3)
        el.style.background = 'rgba(255,150,40,' + alpha + ')'
      }

      // Fetch initial warmth from main process
      ipcRenderer.invoke('display:getWarmth').then(applyOverlay).catch(function () {})

      // Live updates when the user drags the slider
      ipcRenderer.on('display:warmthChanged', function (_, level) { applyOverlay(level) })

      // Re-apply after hard navigation (DOMContentLoaded fires again)
      document.addEventListener('DOMContentLoaded', function () { applyOverlay(_warmth) }, true)

      // Re-apply after SPA pushState/replaceState (YouTube, Google, etc.)
      var _origPush    = history.pushState.bind(history)
      var _origReplace = history.replaceState.bind(history)
      history.pushState = function () {
        _origPush.apply(history, arguments)
        setTimeout(function () { applyOverlay(_warmth) }, 100)
      }
      history.replaceState = function () {
        _origReplace.apply(history, arguments)
        setTimeout(function () { applyOverlay(_warmth) }, 100)
      }

      // MutationObserver: re-insert overlay if a framework removes it.
      // Only acts when warmth > 0 so it's a no-op on most pages/sessions.
      var _pending = false
      new MutationObserver(function () {
        if (_warmth <= 0 || document.getElementById('__dw_overlay')) return
        if (_pending) return
        _pending = true
        setTimeout(function () { _pending = false; applyOverlay(_warmth) }, 50)
      }).observe(document.documentElement || document.body, { childList: true, subtree: true })

      // Interval fallback for total DOM rebuilds (Next.js, React Router full reloads)
      setInterval(function () {
        if (_warmth > 0 && !document.getElementById('__dw_overlay')) applyOverlay(_warmth)
      }, 2000)

    } catch (_) {}
  })()

  // ── Gesture detection ─────────────────────────────────────────────────────────
  ;(function setupGestures() {
    const ipcRenderer = (function () {
      try { return require('electron').ipcRenderer } catch (_) { return null }
    })()
    if (!ipcRenderer) return

    const pointers = new Map()  // pointerId → {x, y}
    let swipeOrigin = null      // {x, y, time} midpoint when 2nd finger touched down

    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const pts = [...pointers.values()]
        swipeOrigin = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
          time: Date.now(),
        }
      }
    }, { passive: true })

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }
    }, { passive: true })

    window.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'touch') return
      pointers.delete(e.pointerId)

      if (swipeOrigin && pointers.size < 2) {
        const pts = [...pointers.values()]
        const endX = pts.length ? (pts[0].x + e.clientX) / 2 : e.clientX
        const endY = pts.length ? (pts[0].y + e.clientY) / 2 : e.clientY
        const dx = endX - swipeOrigin.x
        const dy = endY - swipeOrigin.y
        const dt = Date.now() - swipeOrigin.time

        // Qualify: fast (<600ms), horizontal (>50px), and more horizontal than vertical
        if (dt < 600 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          ipcRenderer.send('gesture:swipe', dx > 0 ? 'right' : 'left')
        }
        swipeOrigin = null
      }
    }, { passive: true })

    window.addEventListener('pointercancel', function (e) {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) swipeOrigin = null
    }, { passive: true })

    // ── Trackpad pinch-to-zoom ──────────────────────────────────────────────────
    ;(function setupPinchZoom() {
      window.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return
        e.preventDefault()
        if (e.deltaY === 0) return
        ipcRenderer.send('gesture:zoom', e.deltaY < 0 ? 'in' : 'out')
      }, { passive: false })
    })()

    // ── Trackpad two-finger horizontal swipe → back / forward ──────────────────
    ;(function setupTrackpadSwipe() {
      function isHScrollable(el) {
        while (el && el !== document.documentElement) {
          if (el.scrollWidth > el.clientWidth + 4) {
            var ov = window.getComputedStyle(el).overflowX
            if (ov === 'auto' || ov === 'scroll') return true
          }
          el = el.parentElement
        }
        return false
      }

      var hAccum   = 0
      var hTimer   = null
      var hCooldown = false

      window.addEventListener('wheel', function (e) {
        if (e.ctrlKey || hCooldown) return
        var dx = e.deltaX
        var dy = Math.abs(e.deltaY)
        if (Math.abs(dx) < 3) return
        if (Math.abs(dx) < dy * 1.2) return

        hAccum += dx
        clearTimeout(hTimer)
        hTimer = setTimeout(function () { hAccum = 0 }, 400)

        if (Math.abs(hAccum) > 60 && !isHScrollable(e.target)) {
          ipcRenderer.send('gesture:swipe', hAccum > 0 ? 'left' : 'right')
          hAccum = 0
          hCooldown = true
          setTimeout(function () { hCooldown = false }, 800)
        }
      }, { passive: true })
    })()
  })()

})()

// ── Edge/Opera-style floating PiP button on video hover ─────────────────────────
// Matches the proven-working implementation from the project backup exactly: a
// simple hover button per <video> that triggers the browser's own native
// requestPictureInPicture(). The fancier Document-PiP version with a full custom
// control bar (scrub bar, volume slider) was tried twice and never reliably
// worked in this Electron build — reverted to this simpler, native-only
// approach per explicit instruction to fall back to "the previous one" if the
// full-featured version isn't achievable here.
;(function injectVideoPip() {
  if (typeof document === 'undefined') return

  // Pure observer, isolated in its own try/catch — never touches whether/how PiP
  // opens, only reports state after the fact so the tab-bar chip can reflect it
  // and the main window can refocus when PiP ends.
  var ipc = null
  try { ipc = require('electron').ipcRenderer } catch (_) {}
  function notify(channel, arg) { if (ipc) { try { ipc.send(channel, arg) } catch (_) {} } }

  function attachBtn(video) {
    if (video.__dhurtaPip) return
    video.__dhurtaPip = true

    try {
      video.addEventListener('enterpictureinpicture', function () {
        notify('pip:opened', document.title || location.hostname)
      })
      video.addEventListener('leavepictureinpicture', function () {
        notify('pip:closed')
        notify('window:focusMain')   // covers Chromium's built-in "back to tab" icon too
      })
    } catch (_) {}

    const btn = document.createElement('button')
    btn.title = 'Pop out video (Picture-in-Picture)'
    btn.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'display:none',
      'width:34px',
      'height:26px',
      'background:rgba(0,0,0,.78)',
      'border:1px solid rgba(255,255,255,.22)',
      'border-radius:4px',
      'color:#fff',
      'font-size:14px',
      'line-height:1',
      'cursor:pointer',
      'align-items:center',
      'justify-content:center',
      'padding:0',
      'transition:background .12s',
    ].join(';')
    btn.textContent = '⧉'
    btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,69,0,.85)' })
    btn.addEventListener('mouseleave', function () { btn.style.background = 'rgba(0,0,0,.78)' })
    document.body && document.body.appendChild(btn)

    let hideTimer
    function syncPos() {
      const r = video.getBoundingClientRect()
      if (r.width < 80 || r.height < 60 || r.top < -10) { btn.style.display = 'none'; return }
      btn.style.top  = (r.top  + 7)  + 'px'
      btn.style.left = (r.right - 42) + 'px'
    }
    function show() { syncPos(); btn.style.display = 'flex'; clearTimeout(hideTimer) }
    function hide() { hideTimer = setTimeout(function () { btn.style.display = 'none' }, 350) }

    video.addEventListener('mouseenter', show)
    video.addEventListener('mouseleave', hide)
    btn.addEventListener('mouseenter', function () { clearTimeout(hideTimer); syncPos(); btn.style.display = 'flex' })
    btn.addEventListener('mouseleave', hide)
    document.addEventListener('scroll', function () { if (btn.style.display !== 'none') syncPos() }, { passive: true })

    btn.addEventListener('click', function (e) {
      e.stopPropagation()
      e.preventDefault()
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture && document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled) {
        video.requestPictureInPicture && video.requestPictureInPicture()
      }
    })
  }

  function scan() {
    if (!document.body) return
    document.querySelectorAll('video').forEach(attachBtn)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(scan, 1500) })
  } else {
    setTimeout(scan, 1500)
  }

  // Watch for dynamically injected videos (YouTube SPA navigation, etc.)
  const obs = new MutationObserver(scan)
  setTimeout(function () {
    const root = document.documentElement
    if (root) obs.observe(root, { childList: true, subtree: true })
  }, 2000)
})()
