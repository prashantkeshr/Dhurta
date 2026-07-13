export interface ToolEntry {
  id: string
  name: string
  description: string
  projectRoot: string
  type: 'static' | 'server'
  entryFile?: string
  clientDist?: string
  relayEntry?: string
  relayPort?: number
  clientPort?: number
}
