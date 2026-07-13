import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'

let db: Database.Database

export function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'dhurta.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      favicon TEXT,
      visited_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      favicon TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_visited ON history(visited_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
  `)

  // Default settings — ALL security features OFF so they never activate without
  // explicit user action. Gestures stay on (they're not a security risk).
  const defaults: Record<string, string> = {
    incinerateDays: '30',
    ghostMode: 'false',
    cookieGuard: 'false',
    adBlocker: 'false',
    gesturePinchZoom: 'true',
    gestureSwipe: 'true',
    security_antiFingerprint: 'false',
    security_blockWebRTC: 'false',
    security_autoClean: 'false',
    security_ipRotation: 'false',
    security_cookieGuard: 'false',
    security_adBlocker: 'false',
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  )
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v)
  }

  // One-time migration: older versions seeded security flags as 'true' by mistake.
  // Reset them all to 'false' once so existing installs match the new default.
  // After this runs, the marker row prevents it from firing again, so any
  // security features the user later enables are preserved across restarts.
  const migrated = db.prepare("SELECT value FROM settings WHERE key = '_migration_v2_secoff'").get()
  if (!migrated) {
    const forceOff = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    ;['security_antiFingerprint','security_blockWebRTC','security_autoClean',
      'security_ipRotation','security_cookieGuard','security_adBlocker'].forEach(k => forceOff.run(k, 'false'))
    forceOff.run('_migration_v2_secoff', '1')
  }

  // Seed default favourites on first run only (table starts empty)
  const bmCount = (db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get() as { n: number }).n
  if (bmCount === 0) {
    const seedBm = db.prepare(
      'INSERT OR IGNORE INTO bookmarks (url, title, favicon) VALUES (?, ?, ?)'
    )
    seedBm.run('dhurta-tool://setu', 'Dhurta Setu', '')
    seedBm.run('https://www.youtube.com', 'YouTube', 'https://www.youtube.com/favicon.ico')
    seedBm.run('https://aistudio.google.com', 'Google AI Studio', 'https://www.gstatic.com/aistudio/ai_studio_favicon.png')
  }

  // Backfill: ensure Dhurta Setu exists as a bookmark for existing installs
  db.prepare('INSERT OR IGNORE INTO bookmarks (url, title, favicon) VALUES (?, ?, ?)').run('dhurta-tool://setu', 'Dhurta Setu', '')

  // Backfill: fix existing seeded bookmarks that were stored with empty favicon
  const favicons: Record<string, string> = {
    'https://www.youtube.com':    'https://www.youtube.com/favicon.ico',
    'https://aistudio.google.com': 'https://www.gstatic.com/aistudio/ai_studio_favicon.png',
  }
  const fixFav = db.prepare('UPDATE bookmarks SET favicon = ? WHERE url = ? AND (favicon IS NULL OR favicon = \'\')')
  for (const [url, fav] of Object.entries(favicons)) fixFav.run(fav, url)

  // Run incinerate on startup
  runIncinerate()
}

export function getDb() {
  return db
}

export function runIncinerate() {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('incinerateDays') as { value: string } | undefined
  const days = parseInt(row?.value ?? '30', 10)
  if (days > 0) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    db.prepare('DELETE FROM history WHERE visited_at < ?').run(cutoff)
  }
}

export function nukeDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'dhurta.db')
  db.close()
  fs.unlinkSync(dbPath)
}
