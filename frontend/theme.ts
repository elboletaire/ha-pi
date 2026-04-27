export type ThemeMode = 'light' | 'dark'

interface ResolveThemeModeInput {
  parentColorScheme?: ThemeMode | null
  parentBackgroundColor: string | null
  prefersDark: boolean
}

const PARENT_THEME_COLOR_VARS = [
  '--primary-background-color',
  '--card-background-color',
  '--ha-card-background',
  '--secondary-background-color',
]

let initialized = false

export function resolveThemeMode({
  parentColorScheme,
  parentBackgroundColor,
  prefersDark,
}: ResolveThemeModeInput): ThemeMode {
  if (parentColorScheme) {
    return parentColorScheme
  }

  const rgb = parseColor(parentBackgroundColor)
  if (rgb) {
    return isDarkColor(rgb) ? 'dark' : 'light'
  }

  return prefersDark ? 'dark' : 'light'
}

export function initTheme() {
  if (initialized) return
  initialized = true

  const apply = () => {
    const mode = detectThemeMode()
    applyTheme(mode)
  }

  apply()

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return
  }

  const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')
  const mediaQueryListener = () => apply()

  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', mediaQueryListener)
  } else if (typeof mediaQueryList.addListener === 'function') {
    mediaQueryList.addListener(mediaQueryListener)
  }
}

export function detectThemeMode(): ThemeMode {
  return resolveThemeMode({
    parentColorScheme: readParentColorScheme(),
    parentBackgroundColor: readParentBackgroundColor(),
    prefersDark: prefersDarkMode(),
  })
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode
}

function readParentColorScheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null
  if (window.parent === window) return null

  try {
    const parentDocument = window.parent.document
    return readColorSchemeFromElement(parentDocument.documentElement) ?? readColorSchemeFromElement(parentDocument.body)
  } catch {
    return null
  }
}

function readParentBackgroundColor(): string | null {
  if (typeof window === 'undefined') return null
  if (window.parent === window) return null

  try {
    const parentDocument = window.parent.document
    return (
      readBackgroundColorFromElement(parentDocument.documentElement) ??
      readBackgroundColorFromElement(parentDocument.body)
    )
  } catch {
    return null
  }
}

function prefersDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readColorSchemeFromElement(element: Element | null): ThemeMode | null {
  if (!element) return null

  const styles = getComputedStyle(element)
  const declared = styles.getPropertyValue('color-scheme').trim() || styles.colorScheme.trim()
  const parsed = parseColorScheme(declared)
  if (parsed) return parsed

  return null
}

function readBackgroundColorFromElement(element: Element | null): string | null {
  if (!element) return null

  const styles = getComputedStyle(element)
  for (const variableName of PARENT_THEME_COLOR_VARS) {
    const value = styles.getPropertyValue(variableName).trim()
    if (value) return value
  }

  const backgroundColor = styles.backgroundColor.trim()
  return backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? backgroundColor
    : null
}

function parseColorScheme(input: string): ThemeMode | null {
  if (!input) return null

  const tokens = input
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.includes('dark') && !tokens.includes('light')) return 'dark'
  if (tokens.includes('light') && !tokens.includes('dark')) return 'light'
  if (tokens[0] === 'dark' || tokens[0] === 'light') return tokens[0]

  return null
}

function parseColor(input: string | null): { r: number; g: number; b: number } | null {
  if (!input) return null

  const value = input.trim().toLowerCase()
  if (!value) return null

  if (value.startsWith('#')) {
    return parseHexColor(value)
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/)
  if (!rgbMatch) return null

  const channels = rgbMatch[1]
    .split(',')
    .map((part) => Number.parseFloat(part.trim()))
    .slice(0, 3)

  if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) {
    return null
  }

  const [r, g, b] = channels
  return { r, g, b }
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const hex = value.slice(1)

  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0]
    const g = hex[1]
    const b = hex[2]
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    }
  }

  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    }
  }

  return null
}

function isDarkColor({ r, g, b }: { r: number; g: number; b: number }): boolean {
  return getRelativeLuminance(r, g, b) < 0.5
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
