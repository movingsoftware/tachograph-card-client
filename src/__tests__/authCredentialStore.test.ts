import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiRequestConfig } from 'shared.js'
import { invoke } from '@tauri-apps/api/core'
import api from '../services/api'
import { useAuthStore } from '../stores/useAuthStore'
import {
    getCurrentDeviceVersionUpdatePayload,
    getCurrentRuntimeVersionSignature,
} from '../services/deviceRuntime'

vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../services/routerNavigation', () => ({ getCurrentPath: () => '/' }))
vi.mock('../services/deviceRuntime', () => ({
    getCurrentDeviceRegistrationPayload: vi.fn(),
    getCurrentDeviceVersionUpdatePayload: vi.fn(),
    getCurrentRuntimeVersionSignature: vi.fn(),
}))
vi.mock('../stores/useFlespiStore', () => ({
    useFlespiStore: () => ({
        setCachedIdent: vi.fn(),
        applyFlespiServerConfig: vi.fn().mockResolvedValue(undefined),
        setServerConfigFromBackend: vi.fn(),
    }),
}))

const ok = (config: ApiRequestConfig) => ({ status: 200, data: {}, headers: {}, config, statusText: 'OK' })

describe('TCC credentials in the OS credential store', () => {
    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem('transportklok_device_token', 'device')
        localStorage.setItem('transportklok_session_token', 'platform')
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('remembers the device token behind the runtime signature as a fingerprint only', async () => {
        vi.mocked(getCurrentRuntimeVersionSignature).mockReturnValueOnce('signature')
        vi.mocked(getCurrentDeviceVersionUpdatePayload).mockReturnValueOnce({
            name: 'device', os_version: 'os', application_version: 'app',
        })
        api.defaults.adapter = (config) => Promise.resolve(ok(config))

        await expect(useAuthStore().syncDeviceVersion()).resolves.toBe(true)

        expect(localStorage.getItem('transportklok_device_runtime_signature_device_token'))
            .toBe(createHash('sha256').update('device').digest('hex'))
    })

    it('stores a new session token in the credential store instead of localStorage', async () => {
        const auth = useAuthStore()
        api.defaults.adapter = (config) => Promise.resolve({ ...ok(config), data: { token: 'platform-new' } })

        await auth.authSession.refresh()

        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('secure_store_set', {
            key: 'transportklok_session_token',
            value: 'platform-new',
        }))
        await vi.waitFor(() => expect(localStorage.getItem('transportklok_session_token')).toBeNull())
        expect(auth.sessionToken).toBe('platform-new')
    })
})
