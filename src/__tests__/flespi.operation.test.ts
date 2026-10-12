import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import api from '../services/api'
import { useFleetAuthStore } from '../stores/useFleetAuthStore'
import { useFlespiStore } from '../stores/useFlespiStore'

type NativeGate = {
    resolve: () => void
    reject: (error?: unknown) => void
}

const state = vi.hoisted(() => ({
    calls: [] as string[],
    gates: {} as Record<string, NativeGate | undefined>,
    immediate: false,
    issueCount: 0,
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((command: string) => {
        state.calls.push(command)

        if (state.immediate) {
            return Promise.resolve(undefined)
        }

        return new Promise<void>((resolve, reject) => {
            state.gates[command] = { resolve, reject }
        })
    }),
}))

const response = <Config>(config: Config, data: unknown = {}) => ({
    status: 200,
    data,
    headers: {},
    config,
    statusText: 'OK',
})

const commands = ['update_server', 'manual_sync_cards', 'app_connection'] as const

const waitFor = async (condition: () => boolean, description: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (condition()) {
            return
        }

        await new Promise((resolve) => setTimeout(resolve, 0))
    }

    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state.calls)}`)
}

const waitForNativeStart = async (command: string): Promise<NativeGate> => {
    await waitFor(() => state.gates[command] !== undefined, `${command} to start`)
    const gate = state.gates[command]

    if (gate === undefined) {
        throw new Error(`Native gate missing for ${command}`)
    }

    return gate
}

const releaseNative = (command: string): void => {
    const gate = state.gates[command]

    if (gate === undefined) {
        throw new Error(`Native gate missing for ${command}`)
    }

    delete state.gates[command]
    gate.resolve()
}

const rejectNative = (command: string, error: unknown): void => {
    const gate = state.gates[command]

    if (gate === undefined) {
        throw new Error(`Native gate missing for ${command}`)
    }

    delete state.gates[command]
    gate.reject(error)
}

const retryCurrentConfig = async (
    store: ReturnType<typeof useFlespiStore>,
    authSession: ReturnType<typeof useFleetAuthStore>['authSession'],
): Promise<void> => {
    state.immediate = true
    const snapshot = authSession.snapshot()
    const assertCurrent = () => authSession.assertCurrent(snapshot)

    await store.applyFlespiServerConfig(assertCurrent)
}

describe('Flespi native setup operation ownership', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        localStorage.clear()
        localStorage.setItem('transportklok_device_token', 'device')
        localStorage.setItem('transportklok_session_token', 'platform')
        state.calls = []
        state.gates = {}
        state.immediate = false
        state.issueCount = 0
        setActivePinia(createPinia())
        api.defaults.adapter = (config) => {
            expect(config.url).toBe('/actions/management/fleet/tokens')
            state.issueCount += 1
            const company = state.issueCount === 1 ? 'companyA' : 'companyB'

            return Promise.resolve(response(config, {
                token: `fleet-${company}`,
                company_id: company,
            }))
        }
        await useFleetAuthStore().authSession.ensure()
        expect(useFleetAuthStore().companyId).toBe('companyA')
    })

    afterEach(() => {
        for (const gate of Object.values(state.gates)) {
            gate?.resolve()
        }

        state.gates = {}
    })

    it.each(commands)('cancels setup before %s after replacing companyA with companyB', async (cancelAt) => {
        const store = useFlespiStore()
        store.setServerConfigFromBackend('host-a', 'ident-a', 'Auto')
        const authSession = useFleetAuthStore().authSession
        const snapshot = authSession.snapshot()
        const assertCurrent = () => authSession.assertCurrent(snapshot)
        const setup = store.applyFlespiServerConfig(assertCurrent)
        const rejection = expect(setup).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })
        const cancelIndex = commands.indexOf(cancelAt)

        for (const command of commands.slice(0, cancelIndex)) {
            await waitForNativeStart(command)
            releaseNative(command)
        }

        await waitForNativeStart(cancelAt)
        authSession.invalidate()
        await authSession.ensure()
        expect(useFleetAuthStore().companyId).toBe('companyB')
        releaseNative(cancelAt)
        await rejection

        expect(state.calls).toEqual(commands.slice(0, cancelIndex + 1))
        expect(store.cachedIdent).toBe('ident-a')

        const retryStart = state.calls.length
        await retryCurrentConfig(store, authSession)
        expect(useFleetAuthStore().companyId).toBe('companyB')
        expect(state.calls.slice(retryStart)).toEqual(commands)
    })

    it('runs a valid configuration through all native commands and caches only after completion', async () => {
        const store = useFlespiStore()
        store.setServerConfigFromBackend('host-b', 'ident-b', 'Auto')
        const authSession = useFleetAuthStore().authSession
        const snapshot = authSession.snapshot()
        const assertCurrent = () => authSession.assertCurrent(snapshot)
        const setup = store.applyFlespiServerConfig(assertCurrent)

        for (const command of commands) {
            await waitForNativeStart(command)
            releaseNative(command)
        }

        await setup
        expect(state.calls).toEqual(commands)
        const callsAfterSuccess = state.calls.length
        await store.applyFlespiServerConfig(assertCurrent)
        expect(state.calls).toHaveLength(callsAfterSuccess)
    })

    it('rejects auth cancellation when the native operation fails after companyB replaces companyA', async () => {
        const store = useFlespiStore()
        store.setServerConfigFromBackend('host-a', 'ident-a', 'Auto')
        const authSession = useFleetAuthStore().authSession
        const snapshot = authSession.snapshot()
        const assertCurrent = () => authSession.assertCurrent(snapshot)
        const setup = store.applyFlespiServerConfig(assertCurrent)
        const rejection = expect(setup).rejects.toMatchObject({ code: 'ERR_AUTH_SESSION_INVALIDATED' })

        await waitForNativeStart('update_server')
        authSession.invalidate()
        await authSession.ensure()
        expect(useFleetAuthStore().companyId).toBe('companyB')
        rejectNative('update_server', new Error('native failure'))
        await rejection
        expect(state.calls).toEqual(['update_server'])

        const retryStart = state.calls.length
        await retryCurrentConfig(store, authSession)
        expect(state.calls.slice(retryStart)).toEqual(commands)
    })

    it('logs an ordinary native failure for companyA and retries the uncached config', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const store = useFlespiStore()
            store.setServerConfigFromBackend('host-a', 'ident-a', 'Auto')
            const authSession = useFleetAuthStore().authSession
            const snapshot = authSession.snapshot()
            const assertCurrent = () => authSession.assertCurrent(snapshot)
            const setup = store.applyFlespiServerConfig(assertCurrent)

            await waitForNativeStart('update_server')
            rejectNative('update_server', new Error('native failure'))
            await setup
            expect(errors).toHaveBeenCalledWith(
                'Unable to push Flespi server configuration',
                expect.any(Error),
            )
            expect(state.calls).toEqual(['update_server'])

            const retryStart = state.calls.length
            await retryCurrentConfig(store, authSession)
            expect(state.calls.slice(retryStart)).toEqual(commands)
        } finally {
            errors.mockRestore()
        }
    })
})
