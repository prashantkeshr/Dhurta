import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

const lockFile = () => path.join(app.getPath('userData'), 'applock.json')

interface LockData { pinHash: string; recoveryHash: string }

function sha256(s: string) { return crypto.createHash('sha256').update(s).digest('hex') }
function read(): LockData | null {
  try { return JSON.parse(fs.readFileSync(lockFile(), 'utf8')) } catch { return null }
}

export function isLockEnabled(): boolean { return !!read()?.pinHash }

export function verifyPin(pin: string): boolean {
  const d = read()
  if (!d) return true
  return d.pinHash === sha256(pin.trim())
}

export function verifyRecovery(phrase: string): boolean {
  const d = read()
  if (!d?.recoveryHash) return false
  return d.recoveryHash === sha256(phrase.toLowerCase().trim())
}

export function setupPin(pin: string): string {
  const recovery = generatePhrase()
  fs.writeFileSync(lockFile(), JSON.stringify({ pinHash: sha256(pin.trim()), recoveryHash: sha256(recovery) }), 'utf8')
  return recovery
}

export function changePin(oldPin: string, newPin: string): boolean {
  if (!verifyPin(oldPin)) return false
  const d = read()
  if (!d) return false
  fs.writeFileSync(lockFile(), JSON.stringify({ ...d, pinHash: sha256(newPin.trim()) }), 'utf8')
  return true
}

export function clearPin(): void {
  try { fs.unlinkSync(lockFile()) } catch (_) {}
}

const WORDS = [
  'alpha','amber','blade','brave','brook','cedar','coral','crane',
  'delta','dream','ember','falcon','frost','grove','haven','ivory',
  'jade','karma','kite','lemon','lunar','maple','night','nova',
  'ocean','orbit','opal','pearl','pixel','quest','raven','ridge',
  'sigma','solar','storm','swift','titan','ultra','umbra','vapor',
  'vivid','vortex','water','whisper','xenon','zenith','arrow','blaze',
]

function generatePhrase(): string {
  const bytes = crypto.randomBytes(6)
  return Array.from({ length: 6 }, (_, i) => WORDS[bytes[i] % WORDS.length]).join(' ')
}
