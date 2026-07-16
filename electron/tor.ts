import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

const SOCKS_PORT = 19050

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

/** Proxy rules string for Electron session.setProxy().
 *  Always returns the SOCKS5 address — callers should apply this even before
 *  Tor is running. Chromium will ECONNREFUSED until Tor bootstraps (fail-closed). */
export function getTorProxyRules() {
  // socks5h = DNS resolved by the proxy (Tor), not locally — prevents DNS leaks
  return `socks5h://127.0.0.1:${SOCKS_PORT}`
}

export function startTor(): Promise<{ socksPort: number }> {
  if (torReady) return Promise.resolve({ socksPort: SOCKS_PORT })
  if (startPromise) return startPromise

  startPromise = new Promise((resolve, reject) => {
    const resDir = torResourceDir()
    const torExe = path.join(resDir, 'tor', 'tor.exe')
    const geoip  = path.join(resDir, 'data', 'geoip')
    const geoip6 = path.join(resDir, 'data', 'geoip6')

    if (!fs.existsSync(torExe)) {
      startPromise = null
      reject(new Error('Tor binary not found'))
      return
    }

    // Fresh, ephemeral data directory per run — wiped on stop so Ghost Mode
    // leaves no Tor state on disk between sessions.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhurta-tor-'))
    const torrcPath = path.join(dataDir, 'torrc')
    const torrc = [
      // IsolateDestDomain: each destination domain gets a separate Tor circuit,
      // preventing cross-site correlation attacks (same technique Tor Browser uses).
      `SocksPort 127.0.0.1:${SOCKS_PORT} IsolateDestDomain`,
      `DataDirectory ${dataDir}`,
      `GeoIPFile ${geoip}`,
      ...(fs.existsSync(geoip6) ? [`GeoIPv6File ${geoip6}`] : []),
      'Log notice stdout',
      'ClientOnly 1',
      'AvoidDiskWrites 1',
      'CookieAuthentication 0',
      // Privacy hardening
      'EnforceDistinctSubnets 1',   // prevent Guard/Exit in same /16
      'ClientUseIPv6 0',            // IPv4 only — IPv6 exit coverage is sparse
      'NumEntryGuards 3',           // Tor Browser default — guards are stable, long-lived
      // Remote hostname resolution: Tor's SOCKS5 listener resolves DNS server-side.
      // Chromium's setProxy("socks5://…") sends the hostname (not the resolved IP)
      // to the SOCKS5 server, so DNS never reaches the ISP. DNSPort is an additional
      // defence-in-depth resolver that local tools (if any) can use.
      `DNSPort 127.0.0.1:19053`,
      // Exit node country pinning (only set when the user explicitly picks a country)
      ...(exitNodeCountry ? [
        `ExitNodes {${exitNodeCountry}}`,
        'StrictNodes 1',   // refuse to route if no exit in the chosen country is available
      ] : []),
    ].join('\n')
    fs.writeFileSync(torrcPath, torrc, 'utf8')

    const proc = spawn(torExe, ['-f', torrcPath, '--ignore-missing-torrc'], {
      windowsHide: true,
      cwd: resDir,
    })
    torProcess = proc

    const timeout = setTimeout(() => {
      cleanupFailedStart()
      reject(new Error('Tor bootstrap timed out'))
    }, 60000)   // 60 s — first-run circuit building can be slow on cold start

    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString()
      if (buffer.includes('Bootstrapped 100%')) {
        clearTimeout(timeout)
        torReady = true
        startPromise = null
        fireTorReady()   // notify all waiting ghost sessions
        resolve({ socksPort: SOCKS_PORT })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    proc.on('error', (err) => {
      clearTimeout(timeout)
      cleanupFailedStart()
      reject(err)
    })

    proc.on('exit', () => {
      if (!torReady) {
        // Bootstrap never completed — normal rejection path
        clearTimeout(timeout)
        cleanupFailedStart()
        reject(new Error('Tor process exited before bootstrapping'))
      } else {
        // Was running, died unexpectedly → notify ipc.ts so it can warn the UI
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
    try { torProcess.kill() } catch (_) {}
    torProcess = null
  }
  torReady = false
  startPromise = null
  if (dataDir) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (_) {}
    dataDir = null
  }
}

app.on('before-quit', stopTor)
