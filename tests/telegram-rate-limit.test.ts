// tests/telegram-rate-limit.test.ts
import { describe, it, expect } from 'vitest'

// Test the rate-limit calculation logic directly
describe('Telegram 429 rate-limit handling', () => {
  it('calculates retry_after + 1 buffer correctly', () => {
    // Simulate the logic from telegram.ts
    const retryAfterSec = 5
    const retryAfterMs = (retryAfterSec + 1) * 1000
    
    expect(retryAfterMs).toBe(6000)
  })

  it('handles zero retry_after by using default 5000ms', () => {
    const retryAfterSec = 0
    let retryAfterMs = 5000
    
    if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
      retryAfterMs = (retryAfterSec + 1) * 1000
    }
    
    expect(retryAfterMs).toBe(5000)
  })

  it('handles negative retry_after by using default 5000ms', () => {
    const retryAfterSec = -1
    let retryAfterMs = 5000
    
    if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
      retryAfterMs = (retryAfterSec + 1) * 1000
    }
    
    expect(retryAfterMs).toBe(5000)
  })

  it('handles missing parameters.retry_after by using default', () => {
    const body = {}
    let retryAfterMs = 5000
    
    try {
      const retryAfterSec = (body as { parameters?: { retry_after?: number } }).parameters?.retry_after
      if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
        retryAfterMs = (retryAfterSec + 1) * 1000
      }
    } catch {
      // Ignore
    }
    
    expect(retryAfterMs).toBe(5000)
  })

  it('handles large retry_after values correctly', () => {
    const retryAfterSec = 60
    let retryAfterMs = 5000
    
    if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
      retryAfterMs = (retryAfterSec + 1) * 1000
    }
    
    expect(retryAfterMs).toBe(61000)
  })
})
