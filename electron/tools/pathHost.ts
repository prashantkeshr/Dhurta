import path from 'path'
import { app } from 'electron'

/**
 * Node/Electron-side path resolution for ecosystem tools.
 *
 * This is the concrete host implementation of the platform-neutral policy in
 * @dhurta/core/paths (`resolveToolRoot`). It is kept dependency-free here so the
 * desktop main-process build never needs the built core bundle at compile time,
 * while following the exact same precedence chain so behaviour stays identical
 * to the cross-platform contract:
 *
 *   1. Explicit env override   →  DHURTA_TOOL_<ID>_ROOT
 *   2. Packaged bundle         →  <resourcesPath>/tools/<bundleDir>
 *   3. Dev checkout (relative) →  <appRoot>/<devRelativeRoot>
 *
 * No absolute drive-letter paths appear anywhere. A checkout on C:\, D:\, /home,
 * or /Applications resolves correctly with zero source edits.
 */

export interface ToolPathSpec {
  id: string
  bundleDir: string
  devRelativeRoot: string
}

export function toolRootEnvVar(id: string): string {
  return `DHURTA_TOOL_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ROOT`
}

/**
 * The app root in a dev checkout. `app.getAppPath()` points at the Dhurta
 * project directory; tool siblings live one level up (the workspace root).
 */
function appRoot(): string {
  try {
    return app.getAppPath()
  } catch {
    // app may be unavailable in some tooling contexts; fall back to cwd.
    return process.cwd()
  }
}

export function resolveToolRoot(spec: ToolPathSpec): string {
  const override = process.env[toolRootEnvVar(spec.id)]
  if (override && override.trim().length > 0) {
    return override.trim()
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tools', spec.bundleDir)
  }

  return path.resolve(appRoot(), spec.devRelativeRoot)
}
