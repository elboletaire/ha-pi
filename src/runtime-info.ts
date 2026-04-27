import { log } from './options'

export interface RuntimeInfo {
  haVersion: string
  addonVersion: string
  connectionType: 'ingress' | 'direct'
  deployment: string
  arch: string
}

/**
 * Fetch Home Assistant version from Supervisor API.
 * Returns 'unknown' if the API is unavailable or not configured.
 */
export async function fetchHaVersion(): Promise<string> {
  const haToken = process.env.HA_TOKEN
  const haUrl = process.env.HA_URL

  if (!haToken || !haUrl) {
    return 'unknown'
  }

  try {
    const response = await fetch(`${haUrl}/api/config`, {
      headers: {
        Authorization: `Bearer ${haToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      log.warn(`Failed to fetch HA config: ${response.statusText}`)
      return 'unknown'
    }

    const data = (await response.json()) as { version?: string }
    return data.version ?? 'unknown'
  } catch (err) {
    log.debug(`Error fetching HA version: ${err instanceof Error ? err.message : String(err)}`)
    return 'unknown'
  }
}

/**
 * Detect connection/access type.
 *
 * When running as a HAOS add-on, SUPERVISOR_TOKEN is always present,
 * meaning ingress access is available. Otherwise we're running standalone
 * with direct access only.
 */
export function getConnectionType(): 'ingress' | 'direct' {
  return process.env.SUPERVISOR_TOKEN ? 'ingress' : 'direct'
}

/**
 * Detect deployment environment.
 */
export function getDeploymentType(): string {
  // Running as HAOS add-on (SUPERVISOR_TOKEN injected by HAOS)
  if (process.env.SUPERVISOR_TOKEN) {
    return 'HAOS Add-on'
  }
  // Running with HA integration but not as add-on
  if (process.env.HA_TOKEN) {
    return 'Supervised'
  }
  // Standalone deployment
  return 'Standalone'
}

/**
 * Get system architecture from environment or fallback to process.arch.
 */
export function getArchitecture(): string {
  return process.env.ARCH ?? process.arch
}

/**
 * Get add-on version in priority order:
 * 1. ADDON_VERSION env var (runtime override)
 * 2. ADDON_VERSION_BUILD (injected at build time by esbuild)
 * 3. Fallback 'unknown'
 */
export function getAddonVersion(): string {
  // Runtime override
  if (process.env.ADDON_VERSION) {
    return process.env.ADDON_VERSION
  }

  // Build-time injection (set by esbuild define)
  const buildTimeVersion = (process.env as unknown as Record<string, string>).ADDON_VERSION_BUILD
  if (typeof buildTimeVersion === 'string' && buildTimeVersion) {
    return buildTimeVersion
  }

  return 'unknown'
}

/**
 * Format all runtime information as a markdown section for injection into agent instructions.
 */
export function formatRuntimeInfo(info: RuntimeInfo): string {
  return `## Runtime Environment

**System Information:**
- Home Assistant: ${info.haVersion}
- Pi Agent Add-on: ${info.addonVersion}
- Access: ${info.connectionType}
- Deployment: ${info.deployment}
- Architecture: ${info.arch}

---
`
}

/**
 * Gather all runtime information in one call.
 */
export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  const haVersion = await fetchHaVersion()

  return {
    haVersion,
    addonVersion: getAddonVersion(),
    connectionType: getConnectionType(),
    deployment: getDeploymentType(),
    arch: getArchitecture(),
  }
}

/**
 * Main entry point: gather and format all runtime info for injection.
 */
export async function generateRuntimeInfoMarkdown(): Promise<string> {
  const info = await getRuntimeInfo()
  log.debug(`Runtime info gathered: HA=${info.haVersion}, Addon=${info.addonVersion}, Deployment=${info.deployment}`)
  return formatRuntimeInfo(info)
}
