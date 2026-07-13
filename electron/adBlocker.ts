import { ElectronBlocker } from '@cliqz/adblocker-electron'
import { Session } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let blocker: ElectronBlocker | null = null

// Session-lifetime counter of blocked ad/tracker requests — surfaced in the
// Omni dashboard as a concrete "here's what was actually stopped" stat.
let blockedCount = 0
export function getBlockedCount() { return blockedCount }

export async function setupAdBlocker(sess: Session) {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'filters')
    : path.join(__dirname, '../resources/filters')

  const easylistPath = path.join(resourcesPath, 'easylist.txt')

  try {
    if (fs.existsSync(easylistPath)) {
      blocker = await ElectronBlocker.fromLists(fetch, [
        `file://${easylistPath}`,
      ])
    } else {
      // Fallback: load from bundled minimal list
      blocker = await ElectronBlocker.fromPrebuiltAdsOnly(fetch)
    }
    blocker.on('request-blocked', () => { blockedCount++ })
    blocker.enableBlockingInSession(sess)
    console.log('[Dhurta] AdBlocker active')
  } catch (e) {
    console.error('[Dhurta] AdBlocker init failed:', e)
  }
}

export function disableAdBlocker(sess: Session) {
  blocker?.disableBlockingInSession(sess)
}

export function enableAdBlocker(sess: Session) {
  blocker?.enableBlockingInSession(sess)
}
