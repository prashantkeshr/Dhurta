/**
 * Path Neutralization Engine.
 *
 * Purpose: erase every hard-coded absolute path (historically
 * `P:\Project\Shiva\...`) from the codebase and resolve resources dynamically
 * from the runtime environment instead. A checkout on any drive, any OS, or a
 * packaged app whose resources live inside the bundle must all resolve
 * correctly with no source edits.
 *
 * This module is deliberately free of `node:path` and `node:fs` imports so it
 * stays usable in a renderer/mobile context. The host injects a tiny
 * {@link PathHostAdapter} that knows how to join segments and read env vars for
 * its platform; the resolution *policy* lives here, once, for everyone.
 */

export type ToolResourceKind = 'static-entry' | 'server-relay' | 'server-client'

export interface PathHostAdapter {
  /** Platform path separator join (Node `path.join`, or a mobile shim). */
  join(...segments: string[]): string
  /** Reads an environment variable, or returns undefined. */
  env(name: string): string | undefined
  /** True when running from a packaged/installed build (not a dev checkout). */
  isPackaged: boolean
  /** Absolute path to the app's bundled resources (Electron `process.resourcesPath`). */
  resourcesPath: string
  /** Absolute path to the app root / working directory in dev. */
  appPath: string
}

export interface ToolPathSpec {
  readonly id: string
  /**
   * Directory name of the tool inside the bundled `tools/` resources folder
   * when packaged (e.g. 'setu', 'connect'). Used to build the packaged path.
   */
  readonly bundleDir: string
  /**
   * Relative path from the workspace root to the tool's project directory in a
   * dev checkout (e.g. '../Dhurta Setu'). Resolved against {@link PathHostAdapter.appPath}.
   */
  readonly devRelativeRoot: string
  /** Env var that, when set, overrides the resolved root entirely. */
  readonly envOverride: string
}

/**
 * Resolves a tool's absolute project root using a strict precedence chain:
 *
 *   1. Explicit environment override      (`DHURTA_TOOL_<ID>_ROOT`)
 *   2. Packaged bundle resources          (`<resourcesPath>/tools/<bundleDir>`)
 *   3. Dev checkout relative to app root   (`<appPath>/<devRelativeRoot>`)
 *
 * The precedence guarantees a deployed app never depends on a developer's disk
 * layout, while a developer can still point any tool at an arbitrary local
 * directory via an env var without touching source.
 */
export function resolveToolRoot(
  host: PathHostAdapter,
  spec: ToolPathSpec,
): string {
  const override = host.env(spec.envOverride)
  if (override && override.trim().length > 0) {
    return override.trim()
  }

  if (host.isPackaged) {
    return host.join(host.resourcesPath, 'tools', spec.bundleDir)
  }

  return host.join(host.appPath, spec.devRelativeRoot)
}

/**
 * Builds the conventional env-var name for a tool root override so hosts and
 * docs never disagree on spelling: id 'setu' → 'DHURTA_TOOL_SETU_ROOT'.
 */
export function toolRootEnvVar(id: string): string {
  return `DHURTA_TOOL_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ROOT`
}

/**
 * The canonical tool path specifications. These replace the hard-coded
 * `path.join('P:', 'Project', 'Shiva', 'Dhurta Setu')` literals that previously
 * lived in electron/tools/*.ts. The dev-relative roots assume the standard
 * sibling-directory workspace layout:
 *
 *   <workspace>/
 *     Dhurta/           ← appPath (the browser)
 *     Dhurta Setu/
 *     Dhurta Connect/
 */
export const TOOL_PATH_SPECS: Readonly<Record<string, ToolPathSpec>> = {
  setu: {
    id: 'setu',
    bundleDir: 'setu',
    devRelativeRoot: 'tools/setu',
    envOverride: toolRootEnvVar('setu'),
  },
  connect: {
    id: 'connect',
    bundleDir: 'connect',
    devRelativeRoot: 'tools/connect',
    envOverride: toolRootEnvVar('connect'),
  },
}
