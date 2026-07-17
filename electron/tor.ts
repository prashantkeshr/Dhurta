import { app } from 'electron'
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import net from 'net'

const SOCKS_PORT = 19050
export const CONTROL_PORT = 19051

let _circuitCount = 0

let torProcess: ChildProcessWithoutNullStreams | null = null
let torReady = false
let startPromise: Promise<{ socksPort: number }> | null = null
let dataDir: string | null = null
let exitNodeCountry: string | null = null  // ISO 3166-1 alpha-2, e.g. "DE"

/** Set the preferred Tor exit-node country. Pass null to allow any country.
 *  Takes effect on the next startTor() call; callers should stopTor()+startTor()
 *  if Tor is already running to apply immediately. */
export function setExitNodeCountry(cc: string | null) {
  exitNodeCountry = cc ? cc.toUpperCase() : null
}

// Listeners called once when Tor reaches 100% bootstrap
const _readyListeners: Array<() => void> = []
// Listeners called whenever Tor exits unexpectedly (was ready → now dead)
const _exitListeners: Array<() => void> = []

/** Register a callback that fires as soon as Tor is fully bootstrapped.
 *  If Tor is already ready the callback runs immediately (synchronously). */
export function addTorReadyListener(cb: () => void) {
  if (torReady) { cb(); return }
  _readyListeners.push(cb)
}

/** Register a callback that fires when Tor exits after having been ready
 *  (i.e. unexpected crash, not a normal stopTor() call). */
export function addTorExitListener(cb: () => void) {
  _exitListeners.push(cb)
}

function fireTorReady() {
  const cbs = _readyListeners.splice(0)
  for (const cb of cbs) { try { cb() } catch (_) {} }
}

function fireTorExit() {
  for (const cb of _exitListeners) { try { cb() } catch (_) {} }
}

function torResourceDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tor')
    : path.join(__dirname, '..', 'resources', 'tor')
}

export function isTorReady() {
  return torReady
}

export function getTorSocksPort() {
  return SOCKS_PORT
}

export function getCircuitCount() {
  return _circuitCount
}

/** Send NEWNYM to Tor's control port to request a new circuit.
 *  No-op if Tor isn't running. Resolves when the signal is acknowledged. */
export function sendNewnym(): Promise<void> {
  if (!torReady) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: CONTROL_PORT, host: '127.0.0.1' })
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

/** Proxy rules string for Electron session.setProxy().
 *  Always returns the SOCKS5 address — callers should apply this even before
 *  Tor is running. Chromium will ECONNREFUSED until Tor bootstraps (fail-closed). */
export function getTorProxyRules() {
  // socks5h = DNS resolved by the proxy (Tor), not locally — prevents DNS leaks
  return `socks5h://127.0.0.1:${SOCKS_PORT}`
}

/** Kill any orphaned tor.exe still bound to OUR ports (19050/19051/19053).
 *  These are leftovers from a previous app session that crashed before
 *  stopTor() ran — they hold the ports and make a fresh startTor() fail with
 *  "Address already in use". The ports are non-standard (not Tor Browser's
 *  9150), so anything listening on them is almost certainly our own orphan.
 *  Best-effort and synchronous — safe to call right before spawn. */
function killStaleTorProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true })
      const pids = new Set<string>()
      for (const line of out.split('\n')) {
        if (/127\.0\.0\.1:(19050|19051|19053)\b/.test(line)) {
          const m = line.trim().match(/(\d+)\s*$/)
          if (m && m[1] !== '0') pids.add(m[1])
        }
      }
      for (const pid of pids) {
        console.log('[Tor] killing stale process holding our port, PID', pid)
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true }) } catch (_) {}
      }
    } else {
      // Unix: our data dirs are prefixed dhurta-tor- — kill by that signature.
      try { execSync(`pkill -f "dhurta-tor-"`, { stdio: 'ignore' }) } catch (_) {}
    }
  } catch (_) { /* netstat/pkill unavailable — nothing we can do, proceed */ }
}

export function startTor(): Promise<{ socksPort: number }> {
  if (torReady) return Promise.resolve({ socksPort: SOCKS_PORT })
  if (startPromise) return startPromise

  // Clear any orphaned Tor from a prior crashed session before we try to bind.
  killStaleTorProcesses()

  startPromise = new Promise((resolve, reject) => {
    const resDir = torResourceDir()
    const torExe = path.join(resDir, 'tor', 'tor.exe')
    // GeoIP data lives in resDir/data/ — guard both with existsSync so a
    // missing file is silently omitted instead of making Tor refuse to start.
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
    // leaves no Tor state on disk between sessions.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhurta-tor-'))
    const torrcPath = path.join(dataDir, 'torrc')
    const torrc = [
      `SocksPort 127.0.0.1:${SOCKS_PORT} IsolateDestAddr IsolateDestPort`,
      `ControlPort 127.0.0.1:${CONTROL_PORT}`,
      `DataDirectory ${dataDir}`,
      ...(fs.existsSync(geoip) ? [`GeoIPFile ${geoip}`] : []),
      ...(fs.existsSync(geoip6) ? [`GeoIPv6File ${geoip6}`] : []),
      'Log notice stdout',
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'CookieAuthentication 0',
      'EnforceDistinctSubnets 1',
      'ClientUseIPv6 0',
      'NumEntryGuards 3',
      `DNSPort 127.0.0.1:19053`,
      ...(exitNodeCountry ? [
        `ExitNodes {${exitNodeCountry}}`,
        'StrictNodes 1',
      ] : []),
    ].join('\n')
    console.log('[Tor] torrc:\n' + torrc)
    fs.writeFileSync(torrcPath, torrc, 'utf8')

    const proc = spawn(torExe, ['-f', torrcPath, '--ignore-missing-torrc'], {
      windowsHide: true,
      cwd: path.dirname(torExe),
    })
    torProcess = proc

    const timeout = setTimeout(() => {
      cleanupFailedStart()
      reject(new Error(`Tor bootstrap timed out after 60 s. Last output:\n${buffer.slice(-500)}`))
    }, 60000)

    let buffer = ''
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      buffer += text
      process.stdout.write('[Tor] ' + text)   // echo to main process console
      if (buffer.includes('Bootstrapped 100%')) {
        clearTimeout(timeout)
        torReady = true
        startPromise = null
        fireTorReady()
        resolve({ socksPort: SOCKS_PORT })
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
        clearTimeout(timeout)
        cleanupFailedStart()
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        console.error('[Tor] exited before bootstrap:', reason, '\nOutput:', buffer.slice(-500))
        reject(new Error(`Tor exited before bootstrapping (${reason}).\nOutput: ${buffer.slice(-300)}`))
      } else {
        torReady = false
        torProcess = null
        fireTorExit()
      }
    })
  })

  return startPromise
}

function cleanupFailedStart() {
  startPromise = null
  torProcess = null
  torReady = false
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (_) {}
    dataDir = null
  }
}

export function stopTor() {
  if (torProcess) {
    const pid = torProcess.pid
    // torProcess.kill() sends SIGTERM, which Tor on Windows frequently ignores,
    // leaving an orphan that holds our ports on next launch. Force-kill the whole
    // process tree so the ports are actually released.
    try {
      if (process.platform === 'win32' && pid) {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true })
      } else {
        torProcess.kill('SIGKILL')
      }
    } catch (_) {
      try { torProcess.kill('SIGKILL') } catch (_) {}
    }
    torProcess = null
  }
  torReady = false
  startPromise = null
  _circuitCount = 0
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (_) {}
    dataDir = null
  }
}

app.on('before-quit', stopTor)
