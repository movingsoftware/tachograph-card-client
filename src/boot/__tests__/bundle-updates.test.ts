// @vitest-environment node
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'

let sharedExports!: typeof import('shared.js')

const state = vi.hoisted(() => ({
    enabled: false,
    order: [] as string[],
    client: {checkForUpdate: vi.fn(), downloadBundle: vi.fn()},
    native: {download: vi.fn(), install: vi.fn(), close: vi.fn(), relaunch: vi.fn()},
    notify: vi.fn(),
    loadingShow: vi.fn(),
}))

vi.mock('#q-app/wrappers', () => ({defineBoot: (callback: (context?: unknown) => unknown) => callback}))
vi.mock('@tauri-apps/api/core', () => ({isTauri: () => true}))
vi.mock('@tauri-apps/plugin-updater', () => ({check: vi.fn()}))
vi.mock('quasar', () => ({
    Loading: {show: (...args: unknown[]) => state.loadingShow(...args), hide: vi.fn()},
    Notify: {create: (...args: unknown[]) => state.notify(...args)},
}))
vi.mock('shared.js', () => ({...sharedExports, createApplicationBundleClient: () => state.client}))
vi.mock('../../services/bundleUpdaterConfig', () => ({
    getBundleUpdaterConfiguration: () => {
        state.order.push('configuration')
        return state.enabled
            ? {enabled: true, apiBaseUrl: 'https://api.transportklok.nl', applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7', signingKeyId: 'desktop-release-2026'}
            : {enabled: false}
    },
}))
vi.mock('../../services/deviceRuntime', () => ({
    initializeDeviceRuntime: async () => { state.order.push('runtime') },
    getDeviceRuntimeInfo: () => ({version: '1.9.0', target: 'darwin-aarch64'}),
    getCurrentNativeApplicationVersion: () => '1.9.0',
}))
vi.mock('../../services/nativeBundleDownloader', () => ({
    createNativeBundleDownloader: () => state.native,
}))

describe('bundle updater boot gate', () => {
    beforeAll(async () => {
        sharedExports = await vi.importActual<typeof import('shared.js')>('shared.js')
    }, 20000)

    beforeEach(() => {
        vi.resetModules()
        state.enabled = false
        state.order = []
        state.notify.mockClear()
        state.loadingShow.mockClear()
        state.native.download.mockReset()
        state.native.install.mockReset()
        state.native.close.mockReset()
        state.native.relaunch.mockReset().mockResolvedValue(undefined)
        state.client.checkForUpdate.mockReset()
        state.client.downloadBundle.mockReset().mockImplementation(async (_candidate: unknown, options?: {onProgress?: (received: number, total: number) => void}) => {
                options?.onProgress?.(50, 100)
                return {result: {held: true}}
            })
    })

    it('initializes installed runtime before config and resolves ordinary disabled startup', async () => {
        const bootModule = await import('../bundle-updates')
        await expect(bootModule.runBundleUpdateBoot()).resolves.toBeUndefined()
        expect(state.order).toEqual(['runtime', 'configuration'])
        expect(bootModule.bundleUpdatesCanStartRouteFlow).toBe(true)
    })

    it.each(['relaunching', 'install-failure'] as const)('keeps subsequent boot/mount work pending after %s', async (scenario) => {
        state.enabled = true
        const candidate = {
            applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
            target: 'darwin-aarch64',
            kind: 'updater',
            currentVersion: '1.9.0',
            release: {version: '1.10.0'},
            artifact: {},
        }
        state.client.checkForUpdate.mockResolvedValue({status: 'available', candidate})
        if (scenario === 'install-failure') state.native.install.mockRejectedValue(new Error('install failed'))

        const bootModule = await import('../bundle-updates')
        let mounted = false
        const bootPromise = bootModule.runBundleUpdateBoot().then(() => { mounted = true })
        for (let index = 0; index < 50; index += 1) await Promise.resolve()

        expect(bootModule.bundleUpdatesCanStartRouteFlow).toBe(false)
        expect(mounted).toBe(false)
        expect(state.native.install).toHaveBeenCalledOnce()
        expect(state.loadingShow).toHaveBeenCalledWith({message: 'Applicatie-update downloaden… 50%'})
        if (scenario === 'relaunching') expect(state.native.relaunch).toHaveBeenCalledOnce()
        else expect(state.native.relaunch).not.toHaveBeenCalled()
        void bootPromise
    })

    it('reports a safe persistent message when a recovery relaunch action fails', async () => {
        state.enabled = true
        state.client.checkForUpdate.mockResolvedValue({
            status: 'available',
            candidate: {
                applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
                target: 'darwin-aarch64',
                kind: 'updater',
                currentVersion: '1.9.0',
                release: {version: '1.10.0'},
                artifact: {},
            },
        })
        state.native.relaunch.mockRejectedValue(new Error('restart failed'))
        const bootModule = await import('../bundle-updates')
        const bootPromise = bootModule.runBundleUpdateBoot()
        for (let index = 0; index < 50; index += 1) await Promise.resolve()

        const startupFailure = state.notify.mock.calls.at(-1)?.[0] as {actions?: Array<{handler: () => void}>} | undefined
        const restartAction = startupFailure?.actions?.[0]
        expect(restartAction).toBeDefined()
        if (!restartAction) throw new Error('Startup recovery did not offer a restart action.')
        restartAction.handler()
        for (let index = 0; index < 20; index += 1) await Promise.resolve()

        expect(state.notify.mock.calls.at(-1)?.[0]).toMatchObject({
            type: 'negative',
            message: 'De applicatie kon niet opnieuw worden gestart.',
            timeout: 0,
        })
        void bootPromise
    })
})
