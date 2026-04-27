import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchHaVersion,
  getConnectionType,
  getDeploymentType,
  getArchitecture,
  getAddonVersion,
  formatRuntimeInfo,
  getRuntimeInfo,
  type RuntimeInfo,
} from './runtime-info'

describe('runtime-info', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('fetchHaVersion', () => {
    it('should return HA version from Supervisor API when available', async () => {
      vi.stubEnv('HA_TOKEN', 'test-token')
      vi.stubEnv('HA_URL', 'http://supervisor/core')

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '2026.4.0' }),
      })

      const version = await fetchHaVersion()

      expect(version).toBe('2026.4.0')
      expect(global.fetch).toHaveBeenCalledWith(
        'http://supervisor/core/api/config',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    it('should return "unknown" when HA_TOKEN is missing', async () => {
      vi.stubEnv('HA_URL', 'http://supervisor/core')
      // HA_TOKEN not set

      const version = await fetchHaVersion()
      expect(version).toBe('unknown')
    })

    it('should return "unknown" when HA_URL is missing', async () => {
      vi.stubEnv('HA_TOKEN', 'test-token')
      // HA_URL not set

      const version = await fetchHaVersion()
      expect(version).toBe('unknown')
    })

    it('should return "unknown" when API call fails', async () => {
      vi.stubEnv('HA_TOKEN', 'test-token')
      vi.stubEnv('HA_URL', 'http://supervisor/core')

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const version = await fetchHaVersion()
      expect(version).toBe('unknown')
    })

    it('should return "unknown" when API returns non-ok response', async () => {
      vi.stubEnv('HA_TOKEN', 'test-token')
      vi.stubEnv('HA_URL', 'http://supervisor/core')

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      })

      const version = await fetchHaVersion()
      expect(version).toBe('unknown')
    })
  })

  describe('getConnectionType', () => {
    it('should return "ingress" when SUPERVISOR_TOKEN is present (add-on mode)', () => {
      vi.stubEnv('SUPERVISOR_TOKEN', 'some-token')

      const type = getConnectionType()
      expect(type).toBe('ingress')
    })

    it('should return "direct" when SUPERVISOR_TOKEN is not present', () => {
      // No SUPERVISOR_TOKEN set

      const type = getConnectionType()
      expect(type).toBe('direct')
    })
  })

  describe('getDeploymentType', () => {
    it('should return "HAOS Add-on" when SUPERVISOR_TOKEN is present', () => {
      vi.stubEnv('SUPERVISOR_TOKEN', 'some-token')

      const deployment = getDeploymentType()
      expect(deployment).toBe('HAOS Add-on')
    })

    it('should return "Supervised" when HA_TOKEN is present but not SUPERVISOR_TOKEN', () => {
      vi.stubEnv('HA_TOKEN', 'some-token')
      // No SUPERVISOR_TOKEN

      const deployment = getDeploymentType()
      expect(deployment).toBe('Supervised')
    })

    it('should return "Standalone" when no HA tokens present', () => {
      // No tokens set

      const deployment = getDeploymentType()
      expect(deployment).toBe('Standalone')
    })
  })

  describe('getArchitecture', () => {
    it('should return ARCH env var when set', () => {
      vi.stubEnv('ARCH', 'aarch64')

      const arch = getArchitecture()
      expect(arch).toBe('aarch64')
    })

    it('should fall back to process.arch when ARCH not set', () => {
      // No ARCH env var

      const arch = getArchitecture()
      expect(arch).toBe(process.arch)
    })
  })

  describe('getAddonVersion', () => {
    it('should return ADDON_VERSION env var when set', () => {
      vi.stubEnv('ADDON_VERSION', '1.2.3')

      const version = getAddonVersion()
      expect(version).toBe('1.2.3')
    })

    it('should fall back to build-time version when env var not set', () => {
      // No ADDON_VERSION env var - should use build-time injected value

      const version = getAddonVersion()
      // Will return the build-time value or 'unknown'
      expect(typeof version).toBe('string')
      expect(version.length).toBeGreaterThan(0)
    })
  })

  describe('formatRuntimeInfo', () => {
    it('should format all runtime info as markdown', () => {
      const info: RuntimeInfo = {
        haVersion: '2026.4.0',
        addonVersion: '0.7.1',
        connectionType: 'ingress',
        deployment: 'HAOS Add-on',
        arch: 'amd64',
      }

      const markdown = formatRuntimeInfo(info)

      expect(markdown).toContain('## Runtime Environment')
      expect(markdown).toContain('Home Assistant: 2026.4.0')
      expect(markdown).toContain('Pi Agent Add-on: 0.7.1')
      expect(markdown).toContain('Access: ingress')
      expect(markdown).toContain('Deployment: HAOS Add-on')
      expect(markdown).toContain('Architecture: amd64')
    })

    it('should handle unknown values gracefully', () => {
      const info: RuntimeInfo = {
        haVersion: 'unknown',
        addonVersion: 'unknown',
        connectionType: 'direct',
        deployment: 'Standalone',
        arch: 'x64',
      }

      const markdown = formatRuntimeInfo(info)

      expect(markdown).toContain('Home Assistant: unknown')
      expect(markdown).toContain('## Runtime Environment')
    })
  })

  describe('getRuntimeInfo', () => {
    it('should gather all runtime info in one call', async () => {
      vi.stubEnv('HA_TOKEN', 'test-token')
      vi.stubEnv('HA_URL', 'http://supervisor/core')
      vi.stubEnv('SUPERVISOR_TOKEN', 'supervisor-token')
      vi.stubEnv('ARCH', 'amd64')
      vi.stubEnv('ADDON_VERSION', '0.8.0')

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '2026.4.0' }),
      })

      const info = await getRuntimeInfo()

      expect(info.haVersion).toBe('2026.4.0')
      expect(info.addonVersion).toBe('0.8.0')
      expect(info.connectionType).toBe('ingress')
      expect(info.deployment).toBe('HAOS Add-on')
      expect(info.arch).toBe('amd64')
    })
  })
})
