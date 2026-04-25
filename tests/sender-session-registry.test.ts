/**
 * Unit tests for SenderSessionRegistry.
 *
 * All file I/O is real but uses OS-managed temp files so tests are hermetic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SenderSessionRegistry } from '../src/channel-bridge/sender-session-registry'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `pi-bridge-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SenderSessionRegistry — in-memory operations', () => {
  let tmpDir: string
  let filePath: string
  let registry: SenderSessionRegistry

  beforeEach(() => {
    tmpDir = makeTmpDir()
    filePath = join(tmpDir, 'bridge-sessions.json')
    registry = new SenderSessionRegistry(filePath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns undefined for an unknown sender', () => {
    expect(registry.get('telegram:123')).toBeUndefined()
  })

  it('stores and retrieves a session file', () => {
    registry.set('telegram:123', '/sessions/abc.jsonl')
    expect(registry.get('telegram:123')).toBe('/sessions/abc.jsonl')
  })

  it('overwrites an existing entry for the same sender', () => {
    registry.set('telegram:123', '/sessions/old.jsonl')
    registry.set('telegram:123', '/sessions/new.jsonl')
    expect(registry.get('telegram:123')).toBe('/sessions/new.jsonl')
  })

  it('stores multiple senders independently', () => {
    registry.set('telegram:111', '/sessions/a.jsonl')
    registry.set('telegram:222', '/sessions/b.jsonl')
    expect(registry.get('telegram:111')).toBe('/sessions/a.jsonl')
    expect(registry.get('telegram:222')).toBe('/sessions/b.jsonl')
  })

  it('deletes an entry', () => {
    registry.set('telegram:123', '/sessions/abc.jsonl')
    registry.delete('telegram:123')
    expect(registry.get('telegram:123')).toBeUndefined()
  })

  it('delete is a no-op for an unknown sender', () => {
    expect(() => registry.delete('telegram:unknown')).not.toThrow()
  })

  it('getAll returns a read-only view of all entries', () => {
    registry.set('telegram:1', '/a.jsonl')
    registry.set('telegram:2', '/b.jsonl')
    const all = registry.getAll()
    expect(all.size).toBe(2)
    expect(all.get('telegram:1')).toBe('/a.jsonl')
    expect(all.get('telegram:2')).toBe('/b.jsonl')
  })
})

describe('SenderSessionRegistry — disk persistence', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    filePath = join(tmpDir, 'bridge-sessions.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the JSON file on first set()', () => {
    const registry = new SenderSessionRegistry(filePath)
    expect(existsSync(filePath)).toBe(false)
    registry.set('telegram:123', '/sessions/abc.jsonl')
    expect(existsSync(filePath)).toBe(true)
  })

  it('persists data so a second instance reads it back', () => {
    const r1 = new SenderSessionRegistry(filePath)
    r1.set('telegram:111', '/sessions/a.jsonl')
    r1.set('telegram:222', '/sessions/b.jsonl')

    // Simulate restart: create a new instance pointing at the same file
    const r2 = new SenderSessionRegistry(filePath)
    expect(r2.get('telegram:111')).toBe('/sessions/a.jsonl')
    expect(r2.get('telegram:222')).toBe('/sessions/b.jsonl')
  })

  it('persists deletions across restarts', () => {
    const r1 = new SenderSessionRegistry(filePath)
    r1.set('telegram:111', '/sessions/a.jsonl')
    r1.set('telegram:222', '/sessions/b.jsonl')
    r1.delete('telegram:111')

    const r2 = new SenderSessionRegistry(filePath)
    expect(r2.get('telegram:111')).toBeUndefined()
    expect(r2.get('telegram:222')).toBe('/sessions/b.jsonl')
  })

  it('writes valid JSON that matches the in-memory state', () => {
    const registry = new SenderSessionRegistry(filePath)
    registry.set('telegram:123', '/sessions/abc.jsonl')
    registry.set('telegram:-1001234567890', '/sessions/group.jsonl')

    const raw = JSON.parse(require('node:fs').readFileSync(filePath, 'utf-8'))
    expect(raw).toEqual({
      'telegram:123': '/sessions/abc.jsonl',
      'telegram:-1001234567890': '/sessions/group.jsonl',
    })
  })

  it('starts empty when the registry file does not exist', () => {
    const registry = new SenderSessionRegistry(filePath)
    expect(registry.getAll().size).toBe(0)
  })

  it('creates parent directories automatically', () => {
    const nestedPath = join(tmpDir, 'nested', 'deep', 'registry.json')
    const registry = new SenderSessionRegistry(nestedPath)
    registry.set('telegram:1', '/a.jsonl')
    expect(existsSync(nestedPath)).toBe(true)
  })
})

describe('SenderSessionRegistry — error resilience', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts empty when the registry file contains invalid JSON', () => {
    const filePath = join(tmpDir, 'corrupt.json')
    writeFileSync(filePath, '{ this is not valid JSON }', 'utf-8')
    const registry = new SenderSessionRegistry(filePath)
    expect(registry.getAll().size).toBe(0)
  })

  it('starts empty when the registry file contains a JSON array (wrong shape)', () => {
    const filePath = join(tmpDir, 'array.json')
    writeFileSync(filePath, '["telegram:123", "/sessions/abc.jsonl"]', 'utf-8')
    const registry = new SenderSessionRegistry(filePath)
    expect(registry.getAll().size).toBe(0)
  })

  it('ignores non-string values in the JSON object', () => {
    const filePath = join(tmpDir, 'mixed.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        'telegram:123': '/sessions/good.jsonl',
        'telegram:456': 42, // non-string — should be skipped
        'telegram:789': null, // non-string — should be skipped
      }),
      'utf-8'
    )
    const registry = new SenderSessionRegistry(filePath)
    expect(registry.get('telegram:123')).toBe('/sessions/good.jsonl')
    expect(registry.get('telegram:456')).toBeUndefined()
    expect(registry.get('telegram:789')).toBeUndefined()
  })
})
