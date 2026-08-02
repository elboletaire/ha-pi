import { isToolCallEventType } from '@earendil-works/pi-coding-agent'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { log } from './options'

/**
 * RTK integration — https://github.com/rtk-ai/rtk
 *
 * RTK is a CLI proxy that rewrites common dev commands to `rtk`-prefixed
 * equivalents which emit far less output (filtering, grouping, deduplication).
 * Less bash output reaching the model means fewer input tokens per turn.
 *
 * This is a *rewrite-only* optimizer. It never blocks, confirms, or audits a
 * command — permission gating is deliberately out of scope, matching upstream's
 * design intent. Every failure path passes the original command through
 * unchanged, so a missing, broken, or slow rtk can only cost us the savings,
 * never the command.
 *
 * We register this inline rather than shipping upstream's `hooks/pi/rtk.ts` as a
 * loose file: as an ExtensionFactory it is bundled by esbuild, typechecked, and
 * unit-testable — no `rtk init` step at container start and no untracked file
 * under /data.
 */

/** `rtk rewrite` was introduced in 0.23.0; older binaries have no usable interface. */
const MIN_SUPPORTED_RTK_MINOR = 23

/** Upper bound on any single rtk call. A hung proxy must not stall the agent. */
const REWRITE_TIMEOUT_MS = 2_000

/** Minimal shape we need from ExtensionAPI — keeps the unit tests free of a real session. */
type ExecFn = ExtensionAPI['exec']

/** Parses "X.Y.Z" out of arbitrary version output. Returns null when absent. */
export function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * True when the reported version predates `rtk rewrite`.
 *
 * Unparseable output is treated as new enough: a version string we do not
 * recognise is more likely a format change than a decade-old binary, and the
 * rewrite call itself fails safe anyway.
 */
export function isRtkTooOld(versionOutput: string): boolean {
  const parsed = parseSemver(versionOutput.replace(/^rtk\s+/i, ''))
  if (!parsed) return false
  const [major, minor] = parsed
  return major === 0 && minor < MIN_SUPPORTED_RTK_MINOR
}

/**
 * Asks rtk for a cheaper equivalent of `command`.
 *
 * Exit code contract (upstream `rtk rewrite`):
 *   0 + stdout  rewrite found
 *   1           no rtk equivalent — pass through
 *   3 + stdout  advisory rewrite, treated identically to 0
 *
 * Returns null whenever the original command should be used as-is.
 */
export async function rewriteCommand(exec: ExecFn, command: string, signal?: AbortSignal): Promise<string | null> {
  const result = await exec('rtk', ['rewrite', command], { timeout: REWRITE_TIMEOUT_MS, signal })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  return result.stdout.trim() || null
}

/**
 * Registers the bash-rewriting hook.
 *
 * Probes rtk once at load. If it is missing or too old we log and register
 * nothing at all, so the per-call path costs nothing for the rest of the
 * session rather than failing repeatedly.
 */
export async function rtkExtension(pi: ExtensionAPI): Promise<void> {
  if (process.env.RTK_DISABLED === '1') {
    log.info('RTK disabled via RTK_DISABLED=1 — bash commands will not be rewritten')
    return
  }

  let version: string
  try {
    const probe = await pi.exec('rtk', ['--version'], { timeout: REWRITE_TIMEOUT_MS })
    if (probe.code !== 0) {
      log.warn('rtk binary not found in PATH — token-saving rewrites disabled')
      return
    }
    version = probe.stdout.trim()
  } catch (err) {
    log.warn('rtk version probe failed — token-saving rewrites disabled:', err)
    return
  }

  if (isRtkTooOld(version)) {
    log.warn(`${version} is too old (need >= 0.23.0) — token-saving rewrites disabled`)
    return
  }

  log.info(`RTK active (${version}) — bash commands will be rewritten to reduce token usage`)

  pi.on('tool_call', async (event, ctx) => {
    try {
      if (!isToolCallEventType('bash', event)) return

      const command = event.input.command
      if (typeof command !== 'string' || command.trim() === '') return

      // Already an rtk call — rewriting it again would be a no-op at best.
      if (command.startsWith('rtk ')) return

      // Wrapped rather than passed by reference: pi.exec may be a method that
      // relies on `this`, which a bare reference would drop.
      const exec: ExecFn = (cmd, args, opts) => pi.exec(cmd, args, opts)
      const rewritten = await rewriteCommand(exec, command, ctx.signal)
      if (rewritten && rewritten !== command) {
        log.debug(`RTK rewrote: ${command} → ${rewritten}`)
        event.input.command = rewritten
      }
    } catch (err) {
      // Fail open. A rewrite is an optimisation; never let it break a tool call.
      log.warn('RTK rewrite failed, passing command through unchanged:', err)
    }
  })
}
