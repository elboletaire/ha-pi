import { describe, expect, it } from 'vitest'
import { calculateViewportMetrics } from '../frontend/mobile-viewport'

describe('mobile viewport metrics', () => {
  it('uses the visual viewport height and keyboard inset when available', () => {
    expect(calculateViewportMetrics(800, 500, 0)).toEqual({
      appHeight: '500px',
      keyboardInset: '300px',
    })
  })

  it('falls back to the layout viewport height when visual viewport is unavailable', () => {
    expect(calculateViewportMetrics(800)).toEqual({
      appHeight: '800px',
      keyboardInset: '0px',
    })
  })
})
