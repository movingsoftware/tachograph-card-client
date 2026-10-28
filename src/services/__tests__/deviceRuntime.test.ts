// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getCurrentDeviceRegistrationPayload, getDeviceRuntimeInfo, getInstallationId, initializeDeviceRuntime} from '../deviceRuntime'

/** An in-memory local storage, since the node environment has none. */
const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
    const items = new Map<string, string>()
    return {getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value) }}
}

describe('device runtime version initialization', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage())
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('creates one stable installation id and sends it with device registration', () => {
        const installationId = getInstallationId()

        expect(installationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(getInstallationId()).toBe(installationId)
        expect(localStorage.getItem('transportklok_installation_id')).toBe(installationId)
        expect(getCurrentDeviceRegistrationPayload().installation_id).toBe(installationId)
    })

    it('uses the native installed version and compile-time operating system target', async () => {
        await initializeDeviceRuntime({
            isNative: true,
            getNativeVersion: async () => '1.9.0',
            getPlatform: async () => 'macos',
            getArchitecture: async () => 'aarch64',
            browserVersion: '0.7.0',
        })
        const payload = getCurrentDeviceRegistrationPayload()
        expect(payload.application_version).toBe('1.9.0')
        expect(payload.device_platform).toBe('macos')
        expect(getDeviceRuntimeInfo().target).toBe('darwin-aarch64')
    })

    it('uses the injected browser build version without calling native APIs', async () => {
        const getNativeVersion = vi.fn()
        await initializeDeviceRuntime({
            isNative: false,
            getNativeVersion,
            getPlatform: async () => 'linux',
            getArchitecture: async () => 'x86_64',
            browserVersion: '0.7.0',
        })
        expect(getCurrentDeviceRegistrationPayload().application_version).toBe('0.7.0')
        expect(getNativeVersion).not.toHaveBeenCalled()
    })
})
