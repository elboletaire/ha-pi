/**
 * SenderSessionRegistry — persists the senderId → sessionFile mapping across restarts.
 *
 * Stored as a plain JSON object at `${PATHS.piAgentDir}/bridge-sessions.json`.
 * Loaded synchronously on construction; saved synchronously on every mutation
 * (the file is small and writes are infrequent: one per conversation turn).
 *
 * Example file contents:
 * {
 *   "telegram:123456789": "/data/pi-agent/sessions/--data-workspace--/2025-01-01T00-00-00-000Z_abc123.jsonl",
 *   "telegram:-1001234567890": "/data/pi-agent/sessions/--data-workspace--/2025-01-01T00-01-00-000Z_def456.jsonl"
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../options'

export class SenderSessionRegistry {
  private sessions: Map<string, string> = new Map()

  constructor(private readonly filePath: string) {
    this.load()
  }

  /**
   * Return the last known session file path for `senderId`, or `undefined` if
   * no mapping exists yet.
   */
  get(senderId: string): string | undefined {
    return this.sessions.get(senderId)
  }

  /**
   * Associate `senderId` with `sessionFile` and persist to disk.
   */
  set(senderId: string, sessionFile: string): void {
    this.sessions.set(senderId, sessionFile)
    this.save()
  }

  /**
   * Remove the mapping for `senderId` and persist the change.
   */
  delete(senderId: string): void {
    this.sessions.delete(senderId)
    this.save()
  }

  /**
   * Read-only view of the full registry (primarily for testing / diagnostics).
   */
  getAll(): ReadonlyMap<string, string> {
    return this.sessions
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw)
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          if (typeof key === 'string' && typeof value === 'string') {
            this.sessions.set(key, value)
          }
        }
      }
    } catch (err: any) {
      log.warn(`SenderSessionRegistry: failed to load ${this.filePath}: ${err.message}`)
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const data = Object.fromEntries(this.sessions)
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err: any) {
      log.warn(`SenderSessionRegistry: failed to save ${this.filePath}: ${err.message}`)
    }
  }
}
