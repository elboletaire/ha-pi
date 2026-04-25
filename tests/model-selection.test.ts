import { describe, expect, it } from 'vitest'
import { selectInitialModel, summarizeAvailableModels } from '../src/model-selection'

describe('selectInitialModel', () => {
  const availableModels = [
    { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { provider: 'github-copilot', id: 'gpt-4.1', name: 'GPT-4.1' },
    { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
  ] as const

  it('prefers the first available persisted model', () => {
    const selected = selectInitialModel(
      [
        { provider: 'openai', modelId: 'gpt-4o' },
        { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
      ],
      availableModels as unknown as Array<(typeof availableModels)[number]>
    )

    expect(selected).toMatchObject({ provider: 'openai', id: 'gpt-4o' })
  })

  it('falls back to the first available preferred model when the first choice is missing', () => {
    const selected = selectInitialModel(
      [
        { provider: 'anthropic', modelId: 'claude-opus-4-5' },
        { provider: 'github-copilot', modelId: 'gpt-4.1' },
      ],
      availableModels as unknown as Array<(typeof availableModels)[number]>
    )

    expect(selected).toMatchObject({ provider: 'github-copilot', id: 'gpt-4.1' })
  })

  it('falls back to the first available model when no preference is available', () => {
    const selected = selectInitialModel(
      [
        { provider: 'anthropic', modelId: 'claude-opus-4-5' },
        { provider: 'openai', modelId: 'gpt-5' },
      ],
      availableModels as unknown as Array<(typeof availableModels)[number]>
    )

    expect(selected).toMatchObject({ provider: 'anthropic', id: 'claude-sonnet-4-5' })
  })

  it('returns null when there are no available models', () => {
    expect(selectInitialModel([], [])).toBeNull()
  })
})

describe('summarizeAvailableModels', () => {
  it('returns the minimal public model summary used by the selector', () => {
    const summary = summarizeAvailableModels([
      { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    ] as any)

    expect(summary).toEqual([{ provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }])
  })
})
