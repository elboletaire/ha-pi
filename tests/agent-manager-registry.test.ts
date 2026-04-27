// tests/agent-manager-registry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mariozechner/pi-coding-agent', async () => {
  const actual = await vi.importActual('@mariozechner/pi-coding-agent')

  const mockSession = {
    sessionId: 'new-session-id',
    sessionFile: '/tmp/new.jsonl',
    model: null,
    isStreaming: false,
    thinkingLevel: 'auto',
    messages: [],
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    setModel: vi.fn().mockResolvedValue(undefined),
    cycleModel: vi.fn().mockResolvedValue(undefined),
  }

  return {
    ...actual,
    ModelRegistry: {
      create: vi.fn(),
    },
    SessionManager: {
      create: vi.fn().mockReturnValue({}),
      open: vi.fn().mockReturnValue({}),
      list: vi.fn().mockResolvedValue([]),
    },
    SettingsManager: {
      create: vi.fn().mockReturnValue({
        getDefaultProvider: () => null,
        getDefaultModel: () => null,
      }),
    },
    createAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
  }
})

import { AgentManager } from '../src/agent-manager'
import { ModelRegistry } from '@mariozechner/pi-coding-agent'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModel(id: string) {
  return { provider: 'test', id, name: id }
}

function makeRegistry(models: ReturnType<typeof makeModel>[]) {
  return { getAvailable: vi.fn().mockReturnValue(models) }
}

function makeManager() {
  return new AgentManager('anthropic', 'claude-sonnet', {} as any, {} as any)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AgentManager — modelRegistry is updated after newSession()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getAvailableModels() after newSession() uses the new registry, not the init() one', async () => {
    const oldRegistry = makeRegistry([makeModel('old-model')])
    const newRegistry = makeRegistry([makeModel('new-model')])

    // ModelRegistry.create returns old on first call, new on second
    ;(ModelRegistry.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(newRegistry) // called by newSession()

    const manager = makeManager()
    // Simulate state after init(): old registry is stored, session exists
    ;(manager as any).modelRegistry = oldRegistry
    ;(manager as any).session = { sessionId: 'test' } as any

    await manager.newSession()

    const models = manager.getAvailableModels()
    expect(models[0].id).toBe('new-model')
    expect(newRegistry.getAvailable).toHaveBeenCalledOnce()
    expect(oldRegistry.getAvailable).not.toHaveBeenCalled()
  })

  it('getAvailableModels() after switchSession() uses the new registry', async () => {
    const oldRegistry = makeRegistry([makeModel('old-model')])
    const newRegistry = makeRegistry([makeModel('switched-model')])

    ;(ModelRegistry.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(newRegistry)

    const manager = makeManager()
    ;(manager as any).modelRegistry = oldRegistry
    ;(manager as any).session = { sessionId: 'test' } as any

    await manager.switchSession('/tmp/other.jsonl')

    const models = manager.getAvailableModels()
    expect(models[0].id).toBe('switched-model')
    expect(newRegistry.getAvailable).toHaveBeenCalledOnce()
    expect(oldRegistry.getAvailable).not.toHaveBeenCalled()
  })
})
