import path from 'path'
import fs from 'fs'
import http from 'http'
import { pathToFileURL } from 'url'
import type { ChildProcess } from 'child_process'
import type { ToolEntry } from './types'
import setu from './setu'
import connect from './connect'

export type { ToolEntry } from './types'

const TOOL_REGISTRY: ToolEntry[] = [setu, connect]

const _httpServers = new Map<string, http.Server>()
const _relayProcesses = new Map<string, ChildProcess>()

export function getToolById(id: string): ToolEntry | undefined {
  return TOOL_REGISTRY.find(t => t.id === id)
}

export async function resolveToolUrl(id: string): Promise<string | null> {
  const tool = getToolById(id)
  if (!tool) return null

  if (tool.type === 'static') {
    const entry = path.join(tool.projectRoot, tool.entryFile || 'index.html')
    return fs.existsSync(entry) ? pathToFileURL(entry).href : null
  }

  if (tool.type === 'server') {
    return ensureServerTool(tool)
  }

  return null
}

export function isToolAvailable(id: string): boolean {
  const tool = getToolById(id)
  if (!tool) return false
  return fs.existsSync(tool.projectRoot)
}

export function shutdownAllTools(): void {
  for (const [, server] of _httpServers) {
    try { server.close() } catch (_) {}
  }
  _httpServers.clear()
  for (const [, proc] of _relayProcesses) {
    try { proc.kill() } catch (_) {}
  }
  _relayProcesses.clear()
}

async function ensureServerTool(tool: ToolEntry): Promise<string | null> {
  const distDir = path.join(tool.projectRoot, tool.clientDist || 'dist')
  if (!fs.existsSync(path.join(distDir, 'index.html'))) return null

  if (tool.relayEntry && !_relayProcesses.has(tool.id)) {
    const relayPath = path.join(tool.projectRoot, tool.relayEntry)
    if (fs.existsSync(relayPath)) {
      const { spawn } = require('child_process') as typeof import('child_process')
      const proc = spawn(process.execPath, [relayPath], {
        cwd: path.dirname(relayPath),
        env: { ...process.env, PORT: String(tool.relayPort || 8080) },
        stdio: 'ignore',
        detached: false,
      })
      proc.on('exit', () => { _relayProcesses.delete(tool.id) })
      _relayProcesses.set(tool.id, proc)
    }
  }

  if (!_httpServers.has(tool.id)) {
    const server = http.createServer((req, res) => {
      let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url || '')
      if (!filePath.startsWith(distDir)) { res.writeHead(403); res.end(); return }
      if (!fs.existsSync(filePath)) {
        filePath = path.join(distDir, 'index.html')
      }
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
        '.webp': 'image/webp', '.jpg': 'image/jpeg', '.gif': 'image/gif',
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      try {
        const data = fs.readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(data)
      } catch {
        res.writeHead(404); res.end('Not found')
      }
    })
    server.listen(tool.clientPort || 17710, '127.0.0.1')
    _httpServers.set(tool.id, server)
  }

  return `http://127.0.0.1:${tool.clientPort || 17710}`
}
