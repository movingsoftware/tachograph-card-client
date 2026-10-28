import { createApp, defineComponent, h, type PropType } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import api from '../services/api'
import { fleetApi } from '../services/fleet'
import { useFleetAuthStore } from '../stores/useFleetAuthStore'
import type { SmartCard } from '../components/models'

const state = vi.hoisted(() => ({
    emit: null as ((event: 'add-card' | 'update-card' | 'delete-card', ...args: unknown[]) => void) | null,
    cards: null as Record<string, SmartCard> | null,
    started: false,
    release: null as (() => void) | null,
    startupComplete: false,
    invoke: vi.fn(),
    notify: vi.fn(),
    requests: [] as Array<{ method: string; url: string; authorization: string; data: unknown }>,
    issues: 0,
    validAdd: false,
    remoteLabel: 'New card',
    holdBootstrap: false,
    delayedListeners: false,
    pendingListeners: [] as Array<() => void>,
    frontendEmits: 0,
    nativeCalls: [] as string[],
    gateCompany: null as string | null,
    getReleases: {} as Record<string, (() => void) | undefined>,
    rejectEvent: null as string | null,
    unlisteners: [] as Array<ReturnType<typeof vi.fn>>,
    listeners: {} as Record<string, (event: { payload: unknown }) => void>,
}))

vi.mock('../components/SmartCardList.vue', () => ({
    default: defineComponent({
        props: { cards: { type: Object as PropType<Record<string, SmartCard>>, required: true } },
        emits: ['add-card', 'update-card', 'delete-card'],
        setup(props, { emit }) {
            state.emit = emit as unknown as typeof state.emit
            state.cards = props.cards
            return () => {
                state.cards = props.cards
                return h('div')
            }
        },
    }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }))
vi.mock('quasar', () => ({ Notify: { create: state.notify } }))
vi.mock('@tauri-apps/api/event', () => ({
    emit: vi.fn((event: string) => {
        if (event === 'frontend-loaded') state.frontendEmits += 1
        if (event === 'frontend-loaded' && !state.holdBootstrap) {
            state.listeners['global-config-server']?.({ payload: {} })
        }
        return Promise.resolve()
    }),
    listen: vi.fn((event: string, callback: (event: { payload: unknown }) => void) => {
        state.listeners[event] = callback
        if (state.rejectEvent === event) return Promise.reject(new Error(`registration failed: ${event}`))
        const unlisten = vi.fn()
        state.unlisteners.push(unlisten)
        if (state.delayedListeners) {
            return new Promise((resolve) => state.pendingListeners.push(() => resolve(unlisten)))
        }
        return Promise.resolve(unlisten)
    }),
}))

const ok = <Config>(config: Config, data: unknown = {}) => ({ status: 200, data, headers: {}, config, statusText: 'OK' })
const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (condition()) return
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`Timed out waiting for component operation: ${JSON.stringify(state.requests)} issues=${state.issues}`)
}

const mountComponent = async (waitForStartup = true) => {
    const { default: component } = await import('../components/TachoMainComponent.vue')
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(component)
    app.mount(host)
    if (waitForStartup) await waitFor(() => state.startupComplete)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { app, host }
}

describe('TachoMainComponent fleet operation ownership', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        localStorage.clear()
        localStorage.setItem('transportklok_device_token', 'device')
        localStorage.setItem('transportklok_session_token', 'platform')
        setActivePinia(createPinia())
        state.emit = null
        state.cards = null
        state.started = false
        state.release = null
        state.startupComplete = false
        state.requests = []
        state.issues = 0
        state.validAdd = false
        state.remoteLabel = 'New card'
        state.holdBootstrap = false
        state.delayedListeners = false
        state.pendingListeners = []
        state.frontendEmits = 0
        state.nativeCalls = []
        state.gateCompany = null
        state.getReleases = {}
        state.rejectEvent = null
        state.unlisteners = []
        state.listeners = {}
        api.defaults.adapter = (config) => {
            if (config.url === '/actions/management/fleet/tokens') {
                state.issues += 1
                const company = state.issues === 1 ? 'companyA' : 'companyB'
                return Promise.resolve(ok(config, { token: `fleet-${company}`, company_id: company }))
            }
            return Promise.resolve(ok(config))
        }
        fleetApi.defaults.adapter = (config) => {
            state.requests.push({ method: String(config.method), url: config.url ?? '', authorization: String(config.headers?.Authorization), data: config.data })
            if (config.url?.includes('tachograph-company-cards') && config.method?.toLowerCase() === 'get') {
                const data = state.validAdd
                    ? [{ id: 'created-card', number: '1234567890123456', name: 'New card', label: state.remoteLabel }]
                    : []
                const company = config.url.match(/companies\/([^/]+)/)?.[1] ?? ''
                const response = Promise.resolve(ok(config, { data: company === 'companyB' ? [{ id: 'b-card', number: '1234567890123456', name: 'B card', label: 'B card' }] : data }))
                if (state.gateCompany === company) {
                    return new Promise<Awaited<typeof response>>((resolve) => { state.getReleases[company] = () => resolve(response) }).then((result) => {
                        state.startupComplete = true
                        return result
                    })
                }
                return response.then((result) => {
                    state.startupComplete = true
                    return result
                })
            }
            return Promise.resolve(ok(config, { id: 'created-card', data: [] }))
        }
        state.invoke.mockImplementation((command: string) => {
            state.nativeCalls.push(command)
            if (command === 'update_card') {
                state.started = true
                return new Promise<void>((resolve) => { state.release = resolve })
            }
            return Promise.resolve(undefined)
        })
        await useFleetAuthStore().authSession.ensure()
    })

    afterEach(() => {
        state.emit = null
        state.cards = null
    })

    it('does not POST after native persistence crosses a real company replacement', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await new Promise((resolve) => setTimeout(resolve, 0))
            const startCount = state.requests.length
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            await waitFor(() => state.started)
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            expect(state.cards).toEqual({})
            await authSession.ensure()
            expect(useFleetAuthStore().companyId).toBe('companyB')
            const release = state.release
            if (release === null) throw new Error('Native gate ontbreekt')
            release()
            await waitFor(() => errors.mock.calls.some((call) => String(call[0]).includes('Kon kaart niet toevoegen') && call.some((value) => (value as { code?: string })?.code === 'ERR_AUTH_SESSION_INVALIDATED')))
            expect(state.requests).toHaveLength(startCount)
            expect(state.cards).toEqual({})
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it('does not continue a card operation released by bootstrap when the component unmounts', async () => {
        state.holdBootstrap = true
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent(false))
            await waitFor(() => state.emit !== null)
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            await authSession.ensure()
            expect(useFleetAuthStore().companyId).toBe('companyB')
            app.unmount()
            state.listeners['global-config-server']?.({ payload: {} })
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.invoke).not.toHaveBeenCalledWith('update_card', expect.anything())
            expect(state.requests.filter((request) => request.method.toLowerCase() === 'post')).toHaveLength(0)
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('unlistens late registrations without emitting frontend-loaded after unmount', async () => {
        state.delayedListeners = true
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent(false))
            app.unmount()
            for (const resolve of state.pendingListeners) resolve()
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.frontendEmits).toBe(0)
            expect(state.unlisteners).toHaveLength(4)
            for (const unlisten of state.unlisteners) expect(unlisten).toHaveBeenCalledTimes(1)
            const requestCount = state.requests.length
            state.listeners['global-cards-sync']?.({ payload: { iccid: 'late', reader_name: 'late-reader', card_state: 'CONNECTED', card_number: 'late-card' } })
            state.listeners['global-card-config-updated']?.({ payload: { card_number: 'late-card', content: { name: 'late', iccid: 'late', expire: null } } })
            window.dispatchEvent(new Event('focus'))
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.requests).toHaveLength(requestCount)
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('confirms the web bundle once the frontend has loaded', async () => {
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            expect(state.frontendEmits).toBe(1)
            expect(state.invoke).toHaveBeenCalledWith('bundle_ready')
            expect(state.notify).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('teruggedraaid') }))
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('reports a web bundle the native side rolled back', async () => {
        state.invoke.mockImplementation((command: string) => Promise.resolve(command === 'bundle_ready' ? '2.0.0' : undefined))
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await waitFor(() => state.notify.mock.calls.length > 0)
            expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: 'Update 2.0.0 kon niet starten en is teruggedraaid.' }))
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('fails bootstrap when the required card listener cannot register', async () => {
        state.rejectEvent = 'global-card-config-updated'
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent(false))
            await waitFor(() => state.emit !== null)
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.frontendEmits).toBe(0)
            expect(state.invoke).not.toHaveBeenCalledWith('bundle_ready')
            expect(state.nativeCalls).toHaveLength(0)
            expect(state.requests.filter((request) => request.method.toLowerCase() === 'post')).toHaveLength(0)
            expect(errors).toHaveBeenCalled()
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it('ignores an old config echo before the cancelled native completion settles', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await new Promise((resolve) => setTimeout(resolve, 0))
            const startCount = state.requests.length
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            await waitFor(() => state.started)
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            await authSession.ensure()
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'A card', iccid: '', expire: null } } })
            const release = state.release
            if (release === null) throw new Error('Native gate ontbreekt')
            release()
            await waitFor(() => errors.mock.calls.some((call) => String(call[0]).includes('Kon kaart niet toevoegen')))
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.requests).toHaveLength(startCount)
            expect(state.cards).toEqual({})
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it('ignores an old config echo after native cancellation completes', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            const startCount = state.requests.length
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            await waitFor(() => state.started)
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            await authSession.ensure()
            const release = state.release
            if (release === null) throw new Error('Native gate ontbreekt')
            release()
            await waitFor(() => errors.mock.calls.some((call) => String(call[0]).includes('Kon kaart niet toevoegen')))
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'A card', iccid: '', expire: null } } })
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.requests).toHaveLength(startCount)
            expect(state.cards).toEqual({})
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it('keeps a valid add on companyA and publishes native state', async () => {
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            const startCount = state.requests.length
            state.validAdd = true
            state.invoke.mockImplementation((command: string) => {
                state.nativeCalls.push(command)
                if (command === 'update_card') {
                    state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'New card', iccid: '', expire: null } } })
                }
                return Promise.resolve(undefined)
            })
            state.emit?.('add-card', '1234567890123456', { name: 'New card', iccid: '' })
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'created-card')
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'New card', iccid: '', expire: null } } })
            await new Promise((resolve) => setTimeout(resolve, 0))
            const posts = state.requests.filter((request) => request.method?.toLowerCase() === 'post')
            expect(posts).toHaveLength(1)
            expect(posts[0]?.url).toContain('/companies/companyA/')
            expect(posts[0]?.authorization).toBe('Bearer fleet-companyA')
            expect(state.requests.length).toBeGreaterThan(startCount + 1)
            expect(state.cards?.['1234567890123456']).toMatchObject({ id: 'created-card', name: 'New card', iccid: '' })
            expect(state.invoke).toHaveBeenCalledWith('update_card', expect.anything())
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('does not continue update after native persistence crosses a real replacement', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            const startCount = state.requests.length
            state.emit?.('update-card', '1234567890123456', { name: 'Updated', iccid: '' })
            await waitFor(() => state.started)
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            await authSession.ensure()
            expect(useFleetAuthStore().companyId).toBe('companyB')
            const release = state.release
            if (release === null) throw new Error('Native gate ontbreekt')
            release()
            await waitFor(() => errors.mock.calls.some((call) => String(call[0]).includes('Kon kaart niet bijwerken') && call.some((value) => (value as { code?: string })?.code === 'ERR_AUTH_SESSION_INVALIDATED')))
            expect(state.requests).toHaveLength(startCount)
            expect(state.cards).toEqual({})
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it.each([
        ['add-card', '1234567890123456', { name: 'New card', iccid: '' }],
        ['update-card', '0000000000000000', { name: 'Updated', iccid: 'boot-iccid' }],
        ['delete-card', '0000000000000000', undefined],
    ] as const)('cancels %s captured before bootstrap when auth changes to companyB', async (event, number, card) => {
        state.holdBootstrap = true
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent(false))
            await waitFor(() => state.emit !== null)
            if (event === 'delete-card' && state.cards) state.cards[number] = { name: 'Bootstrap card', iccid: 'boot-iccid', id: 'boot-card' }
            state.emit?.(event, number, ...(card === undefined ? [] : [card]))
            await new Promise((resolve) => setTimeout(resolve, 0))
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            await authSession.ensure()
            expect(useFleetAuthStore().companyId).toBe('companyB')
            state.listeners['global-config-server']?.({ payload: {} })
            await waitFor(() => errors.mock.calls.some((call) => call.some((value) => (value as { code?: string })?.code === 'ERR_AUTH_SESSION_INVALIDATED')))
            expect(state.nativeCalls).toHaveLength(0)
            expect(state.requests.filter((request) => request.method.toLowerCase() !== 'get')).toHaveLength(0)
        } finally {
            app?.unmount()
            host?.remove()
            errors.mockRestore()
        }
    })

    it('publishes a bootstrap config card with ICCID without a config echo sync loop', async () => {
        state.validAdd = true
        state.invoke.mockResolvedValue(true)
        state.holdBootstrap = true
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent(false))
            await waitFor(() => state.emit !== null)
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: null, iccid: 'boot-iccid', expire: null } } })
            expect(state.requests).toHaveLength(0)
            state.validAdd = true
            state.listeners['global-config-server']?.({ payload: {} })
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'created-card')
            expect(state.cards?.['1234567890123456']).toMatchObject({ id: 'created-card', iccid: 'boot-iccid' })
            expect(state.requests.filter((request) => request.method.toLowerCase() === 'put')).toHaveLength(0)
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('keeps the B generation flight alive when A is released and focus repeats', async () => {
        state.validAdd = true
        state.invoke.mockResolvedValue(true)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'created-card')
            expect(state.cards?.['1234567890123456']).toMatchObject({ name: 'New card' })
            state.invoke.mockResolvedValue(undefined)
            state.gateCompany = 'companyA'
            window.dispatchEvent(new Event('focus'))
            await waitFor(() => state.requests.filter((request) => request.method.toLowerCase() === 'get').length === 2)
            const authSession = useFleetAuthStore().authSession
            authSession.invalidate()
            expect(state.cards).toEqual({})
            await authSession.ensure()
            expect(useFleetAuthStore().companyId).toBe('companyB')
            state.gateCompany = 'companyB'
            window.dispatchEvent(new Event('focus'))
            await waitFor(() => state.requests.filter((request) => request.method.toLowerCase() === 'get').length === 3)
            const releaseA = state.getReleases.companyA
            if (releaseA === undefined) throw new Error('A GET gate ontbreekt')
            releaseA()
            await new Promise((resolve) => setTimeout(resolve, 0))
            window.dispatchEvent(new Event('focus'))
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.requests.filter((request) => request.method.toLowerCase() === 'get')).toHaveLength(3)
            const releaseB = state.getReleases.companyB
            if (releaseB === undefined) throw new Error('B GET gate ontbreekt')
            releaseB()
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'b-card')
            expect(state.cards?.['1234567890123456']).toMatchObject({ id: 'b-card', name: 'B card' })
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('updates an existing card once while native config echoes are ignored', async () => {
        state.validAdd = true
        state.invoke.mockResolvedValue(true)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'created-card')
            state.invoke.mockImplementation((command: string) => {
                if (command === 'update_card') {
                    state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'Updated', iccid: 'updated-iccid', expire: null } } })
                }
                return Promise.resolve(undefined)
            })
            state.emit?.('update-card', '1234567890123456', { name: 'Updated', iccid: 'updated-iccid' })
            await waitFor(() => state.requests.some((request) => request.method.toLowerCase() === 'put'))
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: { name: 'Updated', iccid: 'updated-iccid', expire: null } } })
            await new Promise((resolve) => setTimeout(resolve, 0))
            const updates = state.requests.filter((request) => request.method.toLowerCase() === 'put')
            expect(updates).toHaveLength(1)
            expect(updates[0]).toMatchObject({ url: expect.stringContaining('/companies/companyA/'), authorization: 'Bearer fleet-companyA' })
            expect(JSON.parse(String(updates[0]?.data))).toMatchObject({ name: 'Updated', iccid: 'updated-iccid' })
            expect(state.cards?.['1234567890123456']).toMatchObject({ id: 'created-card', name: 'Updated', iccid: 'updated-iccid' })
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

    it('deletes an existing card once while native removal echoes are ignored', async () => {
        state.validAdd = true
        state.invoke.mockResolvedValue(true)
        let app: ReturnType<typeof createApp> | undefined
        let host: HTMLDivElement | undefined
        try {
            ({ app, host } = await mountComponent())
            await waitFor(() => state.cards?.['1234567890123456']?.id === 'created-card')
            state.invoke.mockImplementation((command: string) => {
                if (command === 'remove_card') {
                    state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: null } })
                }
                return Promise.resolve(undefined)
            })
            state.emit?.('delete-card', '1234567890123456')
            await waitFor(() => state.cards?.['1234567890123456'] === undefined)
            state.listeners['global-card-config-updated']?.({ payload: { card_number: '1234567890123456', content: null } })
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(state.requests.filter((request) => request.method.toLowerCase() === 'delete')).toHaveLength(1)
            expect(state.requests.find((request) => request.method.toLowerCase() === 'delete')).toMatchObject({ url: expect.stringContaining('/companies/companyA/'), authorization: 'Bearer fleet-companyA' })
            expect(state.cards?.['1234567890123456']).toBeUndefined()
        } finally {
            app?.unmount()
            host?.remove()
        }
    })

})
