import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiRequestConfig } from 'shared.js'
import { AuthSessionInvalidatedError } from 'shared.js'
import api from '../services/api'
import { fleetApi } from '../services/fleet'
import { useAuthStore } from '../stores/useAuthStore'
import { useFleetAuthStore } from '../stores/useFleetAuthStore'
import { useFleetStore } from '../stores/useFleetStore'
import { communicationEvents } from '../services/communicationEvents'
import { useFleet } from '../composables/useFleet'
import { invoke } from '@tauri-apps/api/core'
import { Notify } from 'quasar'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
    getCurrentDeviceRegistrationPayload,
    getCurrentDeviceVersionUpdatePayload,
    getCurrentRuntimeVersionSignature,
} from '../services/deviceRuntime'

vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
const tauri = vi.hoisted(() => ({ keychain: new Map<string, string>(), native: vi.fn() }))

vi.mock('@tauri-apps/api/core', async () => {
    const { withKeychain } = await import('./support/keychain')
    return { invoke: vi.fn(withKeychain(tauri.keychain, tauri.native)) }
})
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

beforeEach(() => {
    tauri.keychain.clear()
})

const ok = (config: ApiRequestConfig, data: unknown = {}) => ({
    status: 200, data, headers: {}, config, statusText: 'OK',
})
const reject = (config: ApiRequestConfig, status: number) => Object.assign(new Error('Rejected'), {
    code: 'ERR_BAD_RESPONSE', config, response: { ...ok(config), status },
})

function setupPlatform(expired = false, tokenPrefix = 'fleet', companyId = 'company') {
    const bearers: string[] = []
    const sessions = vi.fn()
    const companies = vi.fn()
    api.defaults.adapter = (config) => {
        if (config.url === '/auth/session') {
            sessions()
            expect(config.headers.Authorization).toBe('Bearer device')
            return Promise.resolve(ok(config, { token: 'platform-new' }))
        }
        if (config.url === '/actions/management/fleet/tokens') {
            bearers.push(String(config.headers.Authorization))
            if (expired && config.headers.Authorization === 'Bearer platform') {
                throw reject(config, 401)
            }
            companies()
            return Promise.resolve(ok(config, { token: `${tokenPrefix}-${companies.mock.calls.length}`, company_id: companyId }))
        }
        return Promise.resolve(ok(config))
    }
    return { sessions, companies, bearers }
}

describe('TCC scoped authentication with the installed shared.js package', () => {
    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem('transportklok_device_token', 'device')
        localStorage.setItem('transportklok_session_token', 'platform')
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('replaces a legacy Platform copy with a real company-token before fleet startup', async () => {
        localStorage.setItem('fleet_token', 'platform')
        localStorage.setItem('fleet_company_id', 'company')
        localStorage.setItem('fleet_client_id', 'client')
        localStorage.setItem('fleet_client_name', 'TBA1234567890123')
        const platform = setupPlatform()
        fleetApi.defaults.adapter = (config) => {
            expect(config.headers.Authorization).toBe('Bearer fleet-1')
            expect(config.url).toContain('/companies/company/')
            return Promise.resolve(ok(config, { id: 'client', data: [] }))
        }
        await useFleet().ensureSetup()
        expect(platform.companies).toHaveBeenCalledTimes(1)
        expect(platform.sessions).not.toHaveBeenCalled()
        expect(localStorage.getItem('fleet_token')).toBeNull()
        expect(useAuthStore().sessionToken).toBe('platform')
        expect(useFleetStore().clientId).toBe('client')
    })

    it.each([false, true])('fleet401 refreshes company and only an expired Platform session (expired=%s)', async (expired) => {
        const platform = setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        platform.sessions.mockClear()
        platform.companies.mockClear()
        const bearers: string[] = []
        fleetApi.defaults.adapter = (config) => {
            bearers.push(String(config.headers.Authorization))
            if (bearers.length === 1) throw reject(config, 401)
            return Promise.resolve(ok(config))
        }
        const renewed = setupPlatform(expired, 'fleet-renewed')
        await fleetApi.get('/v1/companies/company/cards')
        expect(renewed.companies).toHaveBeenCalledTimes(1)
        expect(renewed.sessions).toHaveBeenCalledTimes(expired ? 1 : 0)
        expect(bearers).toHaveLength(2)
        expect(bearers[1]).toBe('Bearer fleet-renewed-1')
        expect(useAuthStore().sessionToken).toBe(expired ? 'platform-new' : 'platform')
    })

    it('keeps fleet unchanged when only Platform renews', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const fleetToken = fleet.token
        const issue = vi.fn()
        api.defaults.adapter = (config) => {
            if (config.url === '/auth/session') {
                issue()
                return Promise.resolve(ok(config, { token: 'platform-new' }))
            }
            if (config.headers.Authorization === 'Bearer platform') throw reject(config, 401)
            return Promise.resolve(ok(config))
        }
        await api.get('/rest/me')
        expect(issue).toHaveBeenCalledTimes(1)
        expect(useAuthStore().sessionToken).toBe('platform-new')
        expect(fleet.token).toBe(fleetToken)
    })

    it('shares concurrent fleet401 issuance', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const issue = vi.fn()
        api.defaults.adapter = async (config) => {
            issue()
            await new Promise((resolve) => setTimeout(resolve, 5))
            return ok(config, { token: 'fleet-new', company_id: 'company' })
        }
        fleetApi.defaults.adapter = (config) => {
            if (config.headers.Authorization === 'Bearer fleet-1') throw reject(config, 401)
            expect(config.headers.Authorization).toBe('Bearer fleet-new')
            return Promise.resolve(ok(config))
        }
        await Promise.all(Array.from({ length: 8 }, () => fleetApi.get('/v1/companies/company/cards')))
        expect(issue).toHaveBeenCalledTimes(1)
        expect(useAuthStore().sessionToken).toBe('platform')
    })

    it('keeps device and Platform credentials after failed fleet issuance', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        api.defaults.adapter = (config) => { throw reject(config, 500) }
        fleetApi.defaults.adapter = (config) => { throw reject(config, 401) }
        const unauthorized = vi.spyOn(communicationEvents, 'emitUnauthorized')
        await expect(fleetApi.get('/v1/companies/company/cards')).rejects.toMatchObject({ status: 500 })
        expect(useAuthStore().deviceToken).toBe('device')
        expect(useAuthStore().sessionToken).toBe('platform')
        expect(fleet.token).toBe('fleet-1')
        expect(unauthorized).not.toHaveBeenCalled()
        unauthorized.mockRestore()
    })

    it('does not restore a fleet credential after clearing authentication', async () => {
        const auth = useAuthStore()
        const fleet = useFleetAuthStore()
        let release!: () => void
        let started = false
        const gate = new Promise<void>((resolve) => { release = resolve })
        api.defaults.adapter = async (config) => {
            if (config.url === '/actions/management/fleet/tokens') {
                started = true
                await gate
                return ok(config, { token: 'late-fleet', company_id: 'company' })
            }
            return ok(config)
        }
        const renewal = fleet.authSession.ensure()
        const assertion = expect(renewal).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        await vi.waitFor(() => expect(started).toBe(true))
        await auth.clearAuth()
        release()
        await assertion
        expect(fleet.token).toBeNull()
        expect(auth.sessionToken).toBeNull()
        expect(auth.deviceToken).toBeNull()
    })

    it('does not store a late login device after disconnect', async () => {
        const auth = useAuthStore()
        auth.pendingToken = 'pending-login'
        let release!: () => void
        let started = false
        const gate = new Promise<void>((resolve) => { release = resolve })
        api.defaults.adapter = async (config) => {
            if (config.url === '/auth/device/authentication-token/check') {
                return ok(config, { success: true })
            }
            if (config.url === '/auth/device' && config.method === 'post') {
                started = true
                await gate
                return ok(config, { token: 'late-device' })
            }
            return ok(config)
        }
        const poll = auth.checkStatusOnFocus()
        await vi.waitFor(() => expect(started).toBe(true))
        await auth.disconnect()
        release()
        await poll
        expect(auth.deviceToken).toBeNull()
        expect(auth.sessionToken).toBeNull()
        expect(auth.authState).toBe('needs-login')
        expect(localStorage.getItem('transportklok_device_token')).toBeNull()
    })

    it('does not delete a client remotely when fleet authentication is absent', async () => {
        const auth = useAuthStore()
        useFleetStore().setClientId('client')
        const adapter = vi.fn()
        fleetApi.defaults.adapter = adapter

        await auth.disconnect()

        expect(adapter).not.toHaveBeenCalled()
        expect(Notify.create).not.toHaveBeenCalled()
    })

    it.each([200, 409])('does not publish a late client response after fleet logout (%s)', async (status) => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const store = useFleetStore()
        const started = vi.fn()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        fleetApi.defaults.adapter = async (config) => {
            if (config.method === 'post') {
                started()
                await gate
                if (status === 409) {
                    throw Object.assign(new Error('Client exists'), { response: { status }, id: 'late-client' })
                }
                return ok(config, { id: 'late-client' })
            }
            return ok(config, { id: 'late-client' })
        }

        const setup = useFleet().ensureSetup()
        await vi.waitFor(() => expect(started).toHaveBeenCalled())
        fleet.authSession.invalidate()
        release()

        await expect(setup).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        expect(store.clientId).toBeNull()
    })

    it('cancels client publication when a response interceptor invalidates after the API fence', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const store = useFleetStore()
        const interceptor = fleetApi.interceptors.response.use((response) => {
            fleet.authSession.invalidate()
            return response
        })

        try {
            fleetApi.defaults.adapter = (config) => Promise.resolve(ok(config, { id: 'late-client' }))
            const setup = useFleet().ensureSetup()
            await expect(setup).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
            expect(store.clientId).toBeNull()
        } finally {
            fleetApi.interceptors.response.eject(interceptor)
        }
    })

    it.each([200, 404])('does not let a late client delete reset a newer client (%s)', async (status) => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const store = useFleetStore()
        store.setClientId('old-client')
        const started = vi.fn()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        fleetApi.defaults.adapter = async (config) => {
            if (config.method === 'delete') {
                started()
                await gate
                if (status === 404) throw reject(config, status)
                return ok(config)
            }
            return ok(config)
        }

        const deletion = useFleet().deleteClient('old-client')
        await vi.waitFor(() => expect(started).toHaveBeenCalled())
        const assertion = expect(deletion).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        store.setClientId('new-client')
        fleet.authSession.invalidate()
        release()
        await assertion
        expect(store.clientId).toBe('new-client')
    })

    it.each([200, 404])('cancels a late card DELETE after company replacement (%s)', async (status) => {
        setupPlatform(false, 'fleet-company-a', 'companyA')
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        let started = false
        fleetApi.defaults.adapter = async (config) => {
            if (config.method === 'delete') {
                started = true
                await gate
                if (status === 404) {
                    throw reject(config, status)
                }
            }
            return ok(config)
        }

        const deletion = useFleet().deleteCard('CARD', 'old-card')
        await vi.waitFor(() => expect(started).toBe(true))
        const assertion = expect(deletion).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        fleet.authSession.invalidate()
        setupPlatform(false, 'fleet-company-b', 'companyB')
        await fleet.authSession.ensure()
        expect(fleet.companyId).toBe('companyB')
        release()
        await assertion
    })

    it('does not issue a card DELETE when lookup completion is invalidated', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const interceptor = fleetApi.interceptors.response.use((response) => {
            if (response.config.method === 'get') {
                fleet.authSession.invalidate()
            }
            return response
        })
        let deletes = 0

        try {
            fleetApi.defaults.adapter = (config) => {
                if (config.method === 'delete') {
                    deletes += 1
                }
                return Promise.resolve(ok(config, { data: [
                    { id: 'remote', number: 'CARD', name: 'Card', label: 'Card' },
                ] }))
            }

            await expect(useFleet().deleteCard('CARD')).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
            expect(deletes).toBe(0)
        } finally {
            fleetApi.interceptors.response.eject(interceptor)
        }
    })

    it('returns an operation that rejects after a valid card deletion is invalidated', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        fleetApi.defaults.adapter = (config) => Promise.resolve(ok(config, { data: [] }))

        const operation = await useFleet().deleteCard('CARD', 'remote')
        fleet.authSession.invalidate()

        expect(() => operation.assertCurrent()).toThrow(AuthSessionInvalidatedError)
    })

    it('does not publish device metadata after runtime payload resolution is invalidated', async () => {
        const auth = useAuthStore()
        vi.mocked(getCurrentRuntimeVersionSignature).mockReturnValueOnce('late-signature')
        vi.mocked(getCurrentDeviceVersionUpdatePayload).mockReturnValueOnce({
            name: 'device', os_version: 'os', application_version: 'app',
        })
        const adapter = vi.fn((config) => Promise.resolve(ok(config)))
        api.defaults.adapter = adapter

        const sync = auth.syncDeviceVersion()
        await Promise.resolve()
        await auth.clearAuth()

        await expect(sync).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        expect(adapter.mock.calls.filter(([config]) => config.method === 'put')).toHaveLength(0)
    })

    it('cancels device metadata persistence when logout arrives during the PUT', async () => {
        const auth = useAuthStore()
        vi.mocked(getCurrentRuntimeVersionSignature).mockReturnValueOnce('late-signature')
        vi.mocked(getCurrentDeviceVersionUpdatePayload).mockReturnValueOnce({
            name: 'device', os_version: 'os', application_version: 'app',
        })
        const started = vi.fn()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        api.defaults.adapter = async (config) => {
            if (config.method === 'put') {
                started()
                await gate
                return ok(config)
            }
            return ok(config)
        }

        const sync = auth.syncDeviceVersion()
        await vi.waitFor(() => expect(started).toHaveBeenCalled())
        const assertion = expect(sync).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        const disconnect = auth.disconnect()
        release()
        await assertion
        await disconnect

        expect(localStorage.getItem('transportklok_device_runtime_signature')).toBeNull()
        expect(localStorage.getItem('transportklok_device_runtime_signature_device_token')).toBeNull()
    })

    it.each([
        ['cancellation', new AuthSessionInvalidatedError(), false],
        ['server failure', reject({} as ApiRequestConfig, 500), true],
    ])('handles DELETE %s without a false cancellation notification', async (_label, failure, shouldNotify) => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        useFleetStore().setClientId('client')
        fleetApi.defaults.adapter = () => Promise.reject(failure)

        await useAuthStore().disconnect()

        expect(Notify.create).toHaveBeenCalledTimes(shouldNotify ? 1 : 0)
    })

    it('normalizes a real DELETE401 cancellation during disconnect without notifying', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        useFleetStore().setClientId('client')
        fleetApi.defaults.adapter = (config) => {
            if (config.method === 'delete') {
                fleet.authSession.invalidate()
                return Promise.reject(reject(config, 401))
            }
            return Promise.resolve(ok(config))
        }

        await useAuthStore().disconnect()

        expect(Notify.create).not.toHaveBeenCalled()
    })

    it('cancels sync result application when cards fetch is invalidated after the API fence', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const interceptor = fleetApi.interceptors.response.use((response) => {
            fleet.authSession.invalidate()
            return response
        })

        try {
            fleetApi.defaults.adapter = (config) => Promise.resolve(ok(config, { data: [] }))
            const sync = useFleet().syncCards({ CARD: { id: 'local', name: 'Local', iccid: '' } })
            await expect(sync).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
            expect(tauri.native).not.toHaveBeenCalled()
        } finally {
            fleetApi.interceptors.response.eject(interceptor)
        }
    })

    it.each(['logout', 'replacement'])('does not perform a second native removal after %s during the first', async (mode) => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        const native = tauri.native
        native.mockImplementationOnce(async () => gate)
        fleetApi.defaults.adapter = (config) => Promise.resolve(ok(config, { data: [] }))

        const sync = useFleet().syncCards({
            FIRST: { id: 'one', name: 'One', iccid: '' },
            SECOND: { id: 'two', name: 'Two', iccid: '' },
        })
        await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(1))
        const assertion = expect(sync).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        fleet.authSession.invalidate()
        if (mode === 'replacement') {
            setupPlatform(false, 'fleet-company-b', 'companyB')
            await fleet.authSession.ensure()
            expect(fleet.companyId).toBe('companyB')
        }
        release()
        await assertion
        expect(native).toHaveBeenCalledTimes(1)
    })

    it('does not perform a second remote update after invalidation during the first PUT', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        let puts = 0
        fleetApi.defaults.adapter = async (config) => {
            if (config.method === 'put') {
                puts += 1
                if (puts === 1) {
                    await gate
                }
                return ok(config)
            }
            return ok(config, { data: [
                { id: 'one', number: 'FIRST', name: 'Remote', label: 'Remote' },
                { id: 'two', number: 'SECOND', name: 'Remote', label: 'Remote' },
            ] })
        }

        const sync = useFleet().syncCards({
            FIRST: { id: 'one', name: 'One', iccid: '' },
            SECOND: { id: 'two', name: 'Two', iccid: '' },
        })
        await vi.waitFor(() => expect(puts).toBe(1))
        const assertion = expect(sync).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        fleet.authSession.invalidate()
        release()
        await assertion
        expect(puts).toBe(1)
    })

    it('returns an operation that rejects result application after invalidation', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        fleetApi.defaults.adapter = (config) => Promise.resolve(ok(config, { data: [] }))

        const result = await useFleet().syncCards({})
        fleet.authSession.invalidate()

        expect(() => result.operation.assertCurrent()).toThrow(AuthSessionInvalidatedError)
    })

    it('does not reuse a prior company card cache after a new fleet generation', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const fleetPosts: string[] = []
        fleetApi.defaults.adapter = (config) => {
            if (config.method === 'post') {
                fleetPosts.push(String(config.url))
            }
            return Promise.resolve(ok(config, config.method === 'get' ? { data: [] } : { id: 'client' }))
        }

        await useFleet().syncCards({ CACHED: { id: 'cached', name: 'Cached', iccid: '' } })
        fleet.authSession.invalidate()
        await fleet.authSession.ensure()
        await useFleet().ensureSetup()

        expect(fleetPosts.filter((url) => url.includes('tachograph-company-cards'))).toHaveLength(0)
    })

    it('resolves a legacy client only within the newly issued company', async () => {
        localStorage.setItem('fleet_client_id', 'unscoped-client')
        localStorage.setItem('fleet_client_name', 'TBA1234567890123')
        const platform = setupPlatform()
        fleetApi.defaults.adapter = (config) => {
            expect(config.headers.Authorization).toBe('Bearer fleet-1')
            expect(config.url).toContain('/companies/company/')
            if (config.method === 'post') {
                throw Object.assign(new Error('Client exists'), {
                    config,
                    response: { ...ok(config, { id: 'verified-client' }), status: 409 },
                })
            }
            expect(config.url).toContain('/verified-client')
            return Promise.resolve(ok(config, { id: 'verified-client' }))
        }
        await useFleet().ensureSetup()
        expect(platform.companies).toHaveBeenCalledTimes(1)
        expect(useFleetStore().clientId).toBe('verified-client')
    })

    it('cancels create409 when a response interceptor invalidates the fleet session', async () => {
        setupPlatform()
        const fleet = useFleetAuthStore()
        await fleet.authSession.ensure()
        const operation = await useFleet().startOperation()
        fleetApi.defaults.adapter = (config) => Promise.reject(Object.assign(new Error('Conflict'), {
            config,
            response: { status: 409, config },
        }))
        const interceptor = fleetApi.interceptors.response.use(undefined, (error) => {
            fleet.authSession.invalidate()
            return Promise.reject(error as Error)
        })
        try {
            await expect(useFleet().createCard('1234567890123456', { name: 'Existing', iccid: '' }, operation)).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        } finally {
            fleetApi.interceptors.response.eject(interceptor)
        }
    })
})

describe('TCC browser sign-in on the app host', () => {
    beforeEach(() => {
        localStorage.clear()
        setActivePinia(createPinia())
        vi.clearAllMocks()
        vi.mocked(getCurrentDeviceRegistrationPayload).mockReturnValue({
            device_name: 'Tachograph desk',
            device_platform: 'windows',
            os_version: '11',
            application_version: '1.0.0',
            device_manufacturer: null,
            device_model: null,
            installation_id: 'installation-1',
        })
    })

    it('opens the approval page on the app host and redeems its own device and session tokens from the API host', async () => {
        const approvalUrl = 'https://app.transportklok.nl/auth/device/approval/7'
        const apiHosts = new Set<string>()
        let approved = false
        api.defaults.adapter = (config) => {
            apiHosts.add(new URL(String(config.baseURL)).origin)
            if (config.url === '/auth/device/authentication-token') {
                expect(JSON.parse(String(config.data))).toMatchObject({ mode: 'web' })
                return Promise.resolve(ok(config, { token: 'pending-login', url: approvalUrl }))
            }
            if (config.url === '/auth/device/authentication-token/check') {
                expect(config.params).toEqual({ token: 'pending-login' })
                return Promise.resolve(ok(config, { success: approved }))
            }
            if (config.url === '/auth/device' && config.method === 'post') {
                expect(JSON.parse(String(config.data))).toMatchObject({ token: 'pending-login', device_name: 'Tachograph desk', device_platform: 'windows', os_version: '11', application_version: '1.0.0' })
                return Promise.resolve(ok(config, { data: {}, token: 'own-device' }))
            }
            if (config.url === '/auth/session') {
                expect(config.headers.Authorization).toBe('Bearer own-device')
                return Promise.resolve(ok(config, { token: 'own-session' }))
            }
            return Promise.resolve(ok(config))
        }
        const auth = useAuthStore()

        await auth.connect()
        expect(openUrl).toHaveBeenCalledWith(approvalUrl)

        await auth.checkStatusOnFocus()
        expect(auth.deviceToken).toBeNull()

        approved = true
        await auth.checkStatusOnFocus()

        expect(auth.deviceToken).toBe('own-device')
        expect(auth.sessionToken).toBe('own-session')
        expect(invoke).toHaveBeenCalledWith('secure_store_set', { key: 'transportklok_device_token', value: 'own-device' })
        expect(invoke).toHaveBeenCalledWith('secure_store_set', { key: 'transportklok_session_token', value: 'own-session' })
        expect(apiHosts).toEqual(new Set(['https://api.transportklok.nl']))
    })

    it('refuses to open a sign-in link outside the app host', async () => {
        api.defaults.adapter = (config) => Promise.resolve(ok(config, {
            token: 'pending-login',
            url: 'https://api.transportklok.nl/auth/device/token/pending-login',
        }))
        const auth = useAuthStore()

        await auth.connect()

        expect(openUrl).not.toHaveBeenCalled()
        expect(auth.statusMessage).toBe('De aanmeldlink hoort niet bij TransportKlok.')
    })
})

describe('TCC credentials in the OS credential store across restarts', () => {
    const keychain = tauri.keychain

    beforeEach(() => {
        localStorage.clear()
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('moves the legacy device and session tokens once and keeps the user signed in', async () => {
        localStorage.setItem('transportklok_device_token', 'legacy-device')
        localStorage.setItem('transportklok_session_token', 'legacy-session')
        localStorage.setItem('fleet_token', 'platform-copy')
        api.defaults.adapter = (config) => Promise.reject(reject(config, 500))
        const auth = useAuthStore()

        await auth.initializeConnection()

        expect(auth.deviceToken).toBe('legacy-device')
        expect(auth.sessionToken).toBe('legacy-session')
        expect(keychain.get('transportklok_device_token')).toBe('legacy-device')
        expect(keychain.get('transportklok_session_token')).toBe('legacy-session')
        expect(localStorage.getItem('transportklok_device_token')).toBeNull()
        expect(localStorage.getItem('transportklok_session_token')).toBeNull()
        expect(localStorage.getItem('fleet_token')).toBeNull()
        expect([...keychain.values()]).not.toContain('platform-copy')
    })

    it('keeps the issued fleet credential and restores it after a restart', async () => {
        localStorage.setItem('transportklok_device_token', 'device')
        localStorage.setItem('transportklok_session_token', 'platform')
        setupPlatform()
        await useFleetAuthStore().authSession.ensure()
        await vi.waitFor(() => expect(keychain.get('transportklok_fleet_credential')).toBeDefined())

        setActivePinia(createPinia())
        localStorage.removeItem('transportklok_device_token')
        localStorage.removeItem('transportklok_session_token')
        keychain.set('transportklok_device_token', 'device')
        keychain.set('transportklok_session_token', 'platform')
        api.defaults.adapter = (config) => Promise.reject(reject(config, 500))
        await useAuthStore().initializeConnection()

        expect(useFleetAuthStore().token).toBe('fleet-1')
        expect(useFleetAuthStore().companyId).toBe('company')
    })

    it('resumes a pending browser approval after a restart', async () => {
        keychain.set('transportklok_connection_state', JSON.stringify({ pendingToken: 'pending-login', startedAt: Date.now() - 1000 }))
        vi.mocked(getCurrentDeviceRegistrationPayload).mockReturnValue({
            device_name: 'Tachograph desk',
            device_platform: 'windows',
            os_version: '11',
            application_version: '1.0.0',
            device_manufacturer: null,
            device_model: null,
            installation_id: 'installation-1',
        })
        api.defaults.adapter = (config) => {
            if (config.url === '/auth/device/authentication-token/check') {
                return Promise.resolve(ok(config, { success: true }))
            }
            if (config.url === '/auth/device' && config.method === 'post') {
                return Promise.resolve(ok(config, { data: {}, token: 'own-device' }))
            }
            if (config.url === '/auth/session') {
                return Promise.resolve(ok(config, { token: 'own-session' }))
            }
            return Promise.reject(reject(config, 500))
        }
        const auth = useAuthStore()

        await auth.initializeConnection()
        expect(auth.pendingToken).toBe('pending-login')

        await auth.checkStatusOnFocus()

        expect(auth.deviceToken).toBe('own-device')
        expect(auth.sessionToken).toBe('own-session')
        expect(keychain.get('transportklok_device_token')).toBe('own-device')
    })

    it('drops a pending browser approval older than the polling window after a restart', async () => {
        keychain.set('transportklok_connection_state', JSON.stringify({ pendingToken: 'stale-login', startedAt: Date.now() - 5 * 60 * 1000 }))
        api.defaults.adapter = (config) => Promise.reject(reject(config, 500))
        const auth = useAuthStore()

        await auth.initializeConnection()

        expect(auth.pendingToken).toBeNull()
        await vi.waitFor(() => expect(keychain.has('transportklok_connection_state')).toBe(false))
    })
})
