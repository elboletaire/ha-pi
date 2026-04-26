import { describe, expect, it } from 'vitest'
import { resolveThemeMode } from './theme'

describe('resolveThemeMode', () => {
  it('returns the parent color-scheme when available', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: null,
        parentColorScheme: 'dark',
        prefersDark: false,
      } as any)
    ).toBe('dark')
  })

  it('returns the parent light color-scheme when available', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: null,
        parentColorScheme: 'light',
        prefersDark: true,
      } as any)
    ).toBe('light')
  })

  it('returns dark for a dark parent background color', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: 'rgb(26, 27, 30)',
        prefersDark: false,
      })
    ).toBe('dark')
  })

  it('returns light for a light parent background color', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: 'rgb(248, 249, 250)',
        prefersDark: true,
      })
    ).toBe('light')
  })

  it('falls back to prefers-color-scheme when the parent background is unavailable', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: null,
        prefersDark: true,
      })
    ).toBe('dark')
  })

  it('falls back to light when the parent background is unavailable and prefers-color-scheme is light', () => {
    expect(
      resolveThemeMode({
        parentBackgroundColor: null,
        prefersDark: false,
      })
    ).toBe('light')
  })
})
