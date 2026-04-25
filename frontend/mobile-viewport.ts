export interface ViewportMetrics {
  appHeight: string
  keyboardInset: string
}

export function calculateViewportMetrics(
  layoutViewportHeight: number,
  visualViewportHeight?: number,
  visualViewportOffsetTop = 0
): ViewportMetrics {
  const visibleHeight = visualViewportHeight ?? layoutViewportHeight
  const keyboardInset =
    visualViewportHeight === undefined
      ? 0
      : Math.max(0, Math.round(layoutViewportHeight - visualViewportHeight - visualViewportOffsetTop))

  return {
    appHeight: `${Math.max(0, Math.round(visibleHeight))}px`,
    keyboardInset: `${keyboardInset}px`,
  }
}

export function initMobileViewport(): () => void {
  const root = document.documentElement
  let rafId = 0

  const update = () => {
    rafId = 0
    const vv = window.visualViewport
    const { appHeight, keyboardInset } = calculateViewportMetrics(window.innerHeight, vv?.height, vv?.offsetTop ?? 0)

    root.style.setProperty('--app-height', appHeight)
    root.style.setProperty('--keyboard-inset', keyboardInset)
  }

  const scheduleUpdate = () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
    }
    rafId = requestAnimationFrame(update)
  }

  update()

  window.addEventListener('resize', scheduleUpdate)
  window.addEventListener('orientationchange', scheduleUpdate)
  window.visualViewport?.addEventListener('resize', scheduleUpdate)
  window.visualViewport?.addEventListener('scroll', scheduleUpdate)

  return () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
    }

    window.removeEventListener('resize', scheduleUpdate)
    window.removeEventListener('orientationchange', scheduleUpdate)
    window.visualViewport?.removeEventListener('resize', scheduleUpdate)
    window.visualViewport?.removeEventListener('scroll', scheduleUpdate)
  }
}
