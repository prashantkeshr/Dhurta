import type { ToolEntry } from './types'
import { resolveToolRoot } from './pathHost'

const setu: ToolEntry = {
  id: 'setu',
  name: 'Dhurta Setu',
  description: 'Bridge & web index platform',
  // Path Neutralization Engine — no hard-coded drive-letter path. Resolves via
  // DHURTA_TOOL_SETU_ROOT → packaged <resources>/tools/setu → in-repo tools/setu.
  projectRoot: resolveToolRoot({
    id: 'setu',
    bundleDir: 'setu',
    devRelativeRoot: 'tools/setu',
  }),
  type: 'static',
  entryFile: 'index.html',
}

export default setu
