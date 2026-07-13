import path from 'path'
import type { ToolEntry } from './types'
import { resolveToolRoot } from './pathHost'

const connect: ToolEntry = {
  id: 'connect',
  name: 'Dhurta Connect',
  description: 'P2P encrypted chat, call & file share',
  // Path Neutralization Engine — no hard-coded drive-letter path. Resolves via
  // DHURTA_TOOL_CONNECT_ROOT → packaged <resources>/tools/connect → in-repo tools/connect.
  projectRoot: resolveToolRoot({
    id: 'connect',
    bundleDir: 'connect',
    devRelativeRoot: 'tools/connect',
  }),
  type: 'server',
  clientDist: path.join('client', 'dist'),
  relayEntry: path.join('server', 'src', 'index.js'),
  relayPort: 8080,
  clientPort: 17710,
}

export default connect
