// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import {getCurrentDeviceRegistrationPayload, getDeviceRuntimeInfo, initializeDeviceRuntime} from '../deviceRuntime'

describe('device runtime version initialization', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
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
