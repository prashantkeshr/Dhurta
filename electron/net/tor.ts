// ─────────────────────────────────────────────────────────────────────────────
// Dhurta Network Layer — Tor onion server lifecycle + circuits
// ─────────────────────────────────────────────────────────────────────────────
// Spawns and supervises a bundled tor.exe, exposes a SOCKS5 endpoint for ghost
// tabs, rotates circuits via the control port, and — critically on Windows —
// guarantees NO orphaned tor.exe survives a crash or quit. Every Tor process we
// start binds our private ports (19050/19051/19053); a leaked one holds those
// ports and makes the next startTor() fail with "Address already in use", so we
// aggressively sweep-then-spawn and force-kill the whole tree on stop.
//
// Per the net-layer contract this module depends only on `electron` and
// `./types` — never on other net/ modules or the DB.
// ─────────────────────────────────────────────────────────────────────────────

import { app } from 'electron'
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import net from 'node:net'
import { PORTS } from './types'

// Per-attempt wait for bootstrap before a caller gives up (NOT a hard kill —
// see startTor). Descriptor loading has been observed taking well over 60s on
// slow/congested networks; a generous wait avoids repeatedly abandoning an
// attempt that's about to succeed.
const BOOTSTRAP_WAIT_MS = 90_000

// ── Live process state ───────────────────────────────────────────────────────
let torProcess: ChildProcessWithoutNullStreams | null = null
let torReady = false
// In-flight start promise — lets concurrent startTor() calls share one boot.
let startPromise: Promise<{ socksPort: number }> | null = null
// Ephemeral data dir for the current run; wiped on stop so no Tor state persists.
let dataDir: string | null = null
// Preferred exit-node country (ISO 3166-1 alpha-2, e.g. "DE"), or null for any.
let exitNodeCountry: string | null = null
// Number of distinct circuits used this session (bootstrap = 1, +1 per NEWNYM).
let _circuitCount = 0

// Listeners fired once when Tor reaches 100% bootstrap (drained on fire).
const _readyListeners: Array<() => void> = []
// Listeners fired every time Tor exits AFTER being ready (i.e. an unexpected
// crash, never a deliberate stopTor()). Kept — they survive across restarts.
const _exitListeners: Array<() => void> = []

// ── Public: exit-node selection ──────────────────────────────────────────────
/** Set the preferred Tor exit-node country. Pass null to allow any country.
 *  Takes effect on the next startTor(); callers wanting it applied immediately
 *  should stopTor() then startTor() (or pass exitCountry straight to startTor). */
export function setExitNodeCountry(cc: string | null): void {
  exitNodeCountry = cc ? cc.toUpperCase() : null
}

// ── Public: readiness / status queries ───────────────────────────────────────
/** True only once Tor has fully bootstrapped (100%) and hasn't since died. */
export function isTorReady(): boolean {
  return torReady
}

/** Proxy rules string for Electron's session.setProxy(). Uses socks5, NOT
 *  socks5h: "socks5h" is a curl-specific scheme name for "resolve hostnames
 *  through the proxy" — Chromium's proxy-config parser doesn't recognize it as
 *  a valid scheme at all, and setting it produces ERR_NO_SUPPORTED_PROXIES on
 *  every navigation (confirmed live: Tor itself was fully bootstrapped and the
 *  SOCKS port worked fine via curl, yet every Electron navigation through this
 *  string failed — because curl accepts "socks5h" and Chromium silently
 *  doesn't). This is not a downgrade: Chromium's SOCKS5 client ALWAYS resolves
 *  hostnames through the proxy by default (there is no separate "local DNS"
 *  mode for it to opt out of), so plain socks5 already gives the same
 *  no-local-DNS-leak guarantee curl needs the "h" suffix to request. Safe to
 *  apply even before Tor is up: Chromium fails closed with
 *  ERR_PROXY_CONNECTION_FAILED until the listener exists, rather than going direct. */
export function getTorProxyRules(): string {
  return `socks5://127.0.0.1:${PORTS.torSocks}`
}

/** Circuits used this session — 1 after bootstrap, +1 per successful NEWNYM. */
export function getCircuitCount(): number {
  return _circuitCount
}

// ── Public: event subscription ───────────────────────────────────────────────
/** Register a callback that fires as soon as Tor is fully bootstrapped.
 *  If Tor is ALREADY ready the callback runs immediately (synchronously). */
export function onTorReady(cb: () => void): void {
  if (torReady) { cb(); return }
  _readyListeners.push(cb)
}

/** Register a callback that fires when Tor exits after having been ready — i.e.
 *  an unexpected crash. It never fires for a deliberate stopTor(). */
export function onTorExit(cb: () => void): void {
  _exitListeners.push(cb)
}

function fireTorReady(): void {
  // Splice so each ready listener runs at most once per boot.
  const cbs = _readyListeners.splice(0)
  for (const cb of cbs) { try { cb() } catch (_) {} }
}

function fireTorExit(): void {
  for (const cb of _exitListeners) { try { cb() } catch (_) {} }
}

// ── Binary / resource resolution ─────────────────────────────────────────────
// This file compiles to dist-electron/net/tor.js, so __dirname is
// dist-electron/net. In dev the resources live two levels up at the project
// root (<root>/resources/tor); when packaged they sit under resourcesPath.
function torResourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tor')
    : path.join(__dirname, '..', '..', 'resources', 'tor')
}

// ── Orphan sweeper ───────────────────────────────────────────────────────────
/** Kill any stale process still bound to OUR ports (19050/19051/19053). Those
 *  are leftovers from a prior session that crashed before stopTor() ran; they
 *  hold the ports and make a fresh spawn fail with "Address already in use".
 *  The ports are non-standard (not Tor Browser's 9150), so anything listening
 *  on them is almost certainly our own orphan. Best-effort, synchronous, and
 *  wrapped so it NEVER throws — it must not block a start. */
function killStaleTorProcesses(): void {
  try {
    if (process.platform === 'win32') {
      // netstat -ano lists every connection with the owning PID in the last
      // column. windowsHide avoids flashing a console window.
      const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true })
      const portGroup = [PORTS.torSocks, PORTS.torControl, PORTS.torDns].join('|')
      const portRe = new RegExp(`127\\.0\\.0\\.1:(${portGroup})\\b`)
      const pids = new Set<string>()
      for (const line of out.split('\n')) {
        if (portRe.test(line)) {
          const m = line.trim().match(/(\d+)\s*$/)
          // Skip PID 0 (System Idle) — taskkill on it errors and is meaningless.
          if (m && m[1] !== '0') pids.add(m[1])
        }
      }
      for (const pid of pids) {
        console.log('[Tor] killing stale process holding our port, PID', pid)
        // /F force, /T whole tree — Tor may have spawned helper children.
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true }) } catch (_) {}
      }
    } else {
      // Non-Windows: our ephemeral data dirs are prefixed dhurta-tor-, so the
      // tor process cmdline carries that signature — kill by it, best-effort.
      try { execSync('pkill -f "dhurta-tor-"', { stdio: 'ignore' }) } catch (_) {}
    }
  } catch (_) { /* netstat/pkill unavailable — nothing to do, just proceed */ }
}

// ── Cleanup after a failed start ─────────────────────────────────────────────
// Resets all live state and wipes the ephemeral data dir. Deliberately does NOT
// touch _circuitCount (that belongs to stopTor's full reset).
function cleanupFailedStart(): void {
  startPromise = null
  torProcess = null
  torReady = false
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (_) {}
    dataDir = null
  }
}

// ── Public: start ────────────────────────────────────────────────────────────
/** Boot Tor and resolve with the SOCKS port once fully bootstrapped.
 *  - If already ready, resolves immediately.
 *  - If a start is in-flight, returns that same promise (dedupe).
 *  - `exitCountry`, when passed, overrides the stored preference for THIS start
 *    only (undefined = use the stored one; explicit null = any country). */
export function startTor(exitCountry?: string | null): Promise<{ socksPort: number }> {
  if (torReady) return Promise.resolve({ socksPort: PORTS.torSocks })
  if (startPromise) return startPromise

  // A process from an EARLIER startTor() call may still be alive and bootstrapping
  // even though that call's own promise already timed out and rejected (descriptor
  // loading has been observed taking several minutes on slow/congested networks —
  // well past any reasonable per-call wait). Re-spawning here would kill a process
  // that might succeed seconds later, then restart bootstrap from 0%. Instead,
  // attach a fresh promise to the SAME eventual completion via onTorReady rather
  // than touching the live process at all.
  if (torProcess) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tor still hasn't finished bootstrapping (still in progress in the background — it will keep trying).`))
      }, BOOTSTRAP_WAIT_MS)
      onTorReady(() => { clearTimeout(timeout); resolve({ socksPort: PORTS.torSocks }) })
    })
  }

  // Effective exit country for this boot: an explicitly-passed value (even null)
  // wins over the stored preference; undefined falls back to the stored one.
  const effectiveExit = exitCountry !== undefined
    ? (exitCountry ? exitCountry.toUpperCase() : null)
    : exitNodeCountry

  // Clear any orphaned Tor from a prior crashed session before we try to bind.
  killStaleTorProcesses()

  startPromise = new Promise((resolve, reject) => {
    const resDir = torResourceDir()
    const torExe = path.join(resDir, 'tor', 'tor.exe')
    // GeoIP data lives under resDir/data/. Both paths are guarded with existsSync
    // below so a missing file is silently omitted — it must NOT stop Tor booting.
    const geoip  = path.join(resDir, 'data', 'geoip')
    const geoip6 = path.join(resDir, 'data', 'geoip6')

    console.log('[Tor] resource dir:', resDir)
    console.log('[Tor] binary path:', torExe, '— exists:', fs.existsSync(torExe))

    if (!fs.existsSync(torExe)) {
      startPromise = null
      reject(new Error(`Tor binary not found at: ${torExe}`))
      return
    }

    // Fresh, ephemeral data directory per run — wiped on stop so Ghost Mode
    // leaves zero Tor state on disk between sessions.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhurta-tor-'))
    const torrcPath = path.join(dataDir, 'torrc')

    // NOTE: IsolateDestAddr + IsolateDestPort give per-destination circuit
    // isolation. Do NOT add IsolateDestDomain — it is NOT a valid Tor flag and
    // makes Tor refuse to parse the torrc.
    const torrc = [
      `SocksPort 127.0.0.1:${PORTS.torSocks} IsolateDestAddr IsolateDestPort`,
      `ControlPort 127.0.0.1:${PORTS.torControl}`,
      `DataDirectory ${dataDir}`,
      ...(fs.existsSync(geoip)  ? [`GeoIPFile ${geoip}`]    : []),
      ...(fs.existsSync(geoip6) ? [`GeoIPv6File ${geoip6}`] : []),
      'Log notice stdout',
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'CookieAuthentication 0',
      'EnforceDistinctSubnets 1',
      'ClientUseIPv6 0',
      'NumEntryGuards 3',
      `DNSPort 127.0.0.1:${PORTS.torDns}`,
      ...(effectiveExit ? [
        `ExitNodes {${effectiveExit}}`,
        'StrictNodes 1',
      ] : []),
    ].join('\n')
    console.log('[Tor] torrc:\n' + torrc)
    fs.writeFileSync(torrcPath, torrc, 'utf8')

    // cwd = the tor.exe dir so its relative lookups (pluggable transports etc.)
    // resolve. windowsHide keeps the console window from flashing.
    const proc = spawn(torExe, ['-f', torrcPath, '--ignore-missing-torrc'], {
      windowsHide: true,
      cwd: path.dirname(torExe),
    })
    torProcess = proc

    // Soft wait on bootstrap — rejects THIS caller if it's taking too long, but
    // deliberately does NOT touch torProcess/dataDir. The real Tor process is
    // still alive and may still succeed (descriptor loading alone has taken
    // several minutes on a slow network in testing); killing it here would
    // sabotage an attempt that might finish seconds later, and a subsequent
    // startTor() call would otherwise re-spawn and restart bootstrap from 0%.
    // Only clear startPromise so a later call re-attaches (see the `if
    // (torProcess)` branch above) instead of assuming nothing is in flight.
    const timeout = setTimeout(() => {
      startPromise = null
      reject(new Error(`Tor bootstrap is taking longer than ${BOOTSTRAP_WAIT_MS / 1000}s. Last output:\n${buffer.slice(-500)}`))
    }, BOOTSTRAP_WAIT_MS)

    let buffer = ''
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      buffer += text
      process.stdout.write('[Tor] ' + text)  // echo ALL stdout+stderr to console
      if (buffer.includes('Bootstrapped 100%')) {
        clearTimeout(timeout)
        torReady = true
        startPromise = null
        _circuitCount = 1  // first working circuit is live
        fireTorReady()
        resolve({ socksPort: PORTS.torSocks })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    proc.on('error', (err) => {
      console.error('[Tor] spawn error:', err)
      clearTimeout(timeout)
      cleanupFailedStart()
      reject(new Error(`Tor spawn error: ${err.message}`))
    })

    proc.on('exit', (code, signal) => {
      if (!torReady) {
        // Died during bootstrap — a real start failure. Reject with the reason
        // plus the tail of output so the caller can diagnose.
        clearTimeout(timeout)
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        console.error('[Tor] exited before bootstrap:', reason, '\nOutput:', buffer.slice(-500))
        cleanupFailedStart()
        reject(new Error(`Tor exited before bootstrapping (${reason}).\nOutput: ${buffer.slice(-500)}`))
      } else {
        // Was ready and now dead — an unexpected crash. Flip state and notify
        // exit listeners (stopTor nulls torProcess first, so it won't reach here).
        torReady = false
        torProcess = null
        fireTorExit()
      }
    })
  })

  return startPromise
}

// ── Public: circuit rotation ─────────────────────────────────────────────────
/** Ask Tor for a fresh circuit via NEWNYM on the control port. No-op (resolves)
 *  if Tor isn't ready. Control port has no auth (CookieAuthentication 0, loopback
 *  only), so an empty AUTHENTICATE suffices. A "250" anywhere in the reply means
 *  the signal was accepted → bump the circuit count and resolve. */
export function sendNewnym(): Promise<void> {
  if (!torReady) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: PORTS.torControl, host: '127.0.0.1' })
    sock.setTimeout(5000)
    let buf = ''
    sock.on('data', (chunk) => { buf += chunk.toString() })
    sock.on('connect', () => {
      sock.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n')
    })
    sock.on('error', (e) => reject(e))
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Tor control port timeout')) })
    sock.on('close', () => {
      if (buf.includes('250')) { _circuitCount++; resolve() }
      else reject(new Error('NEWNYM failed: ' + buf.slice(0, 100)))
    })
  })
}

// ── Public: stop ─────────────────────────────────────────────────────────────
/** Force-kill Tor, wipe its data dir, and reset session state. On Windows a
 *  plain .kill() sends SIGTERM, which Tor IGNORES — leaving an orphan that holds
 *  our ports next launch. So we taskkill /F /T the whole tree (elsewhere SIGKILL).
 *  Null out torProcess FIRST so the 'exit' handler treats this as deliberate
 *  (no crash listeners fire). */
export function stopTor(): void {
  if (torProcess) {
    const pid = torProcess.pid
    const proc = torProcess
    torProcess = null  // mark deliberate before the exit event lands
    try {
      if (process.platform === 'win32' && pid) {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true })
      } else {
        proc.kill('SIGKILL')
      }
    } catch (_) {
      // taskkill failed (already gone?) — fall back to SIGKILL as a last resort.
      try { proc.kill('SIGKILL') } catch (_) {}
    }
  }
  torReady = false
  startPromise = null
  _circuitCount = 0
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (_) {}
    dataDir = null
  }
}

// Guarantee we never leak a tor.exe when the app quits.
app.on('before-quit', stopTor)
