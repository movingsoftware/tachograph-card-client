// @vitest-environment node
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'

let sharedExports!: typeof import('shared.js')

const state = vi.hoisted(() => ({
    enabled: false,
    order: [] as string[],
    client: {checkForUpdate: vi.fn(), checkForWebUpdate: vi.fn(), downloadBundle: vi.fn()},
    invoke: vi.fn(),
    visibility: [] as Array<() => void>,
    native: {download: vi.fn(), install: vi.fn(), close: vi.fn(), relaunch: vi.fn()},
    notify: vi.fn(),
    loadingShow: vi.fn(),
}))

vi.mock('#q-app/wrappers', () => ({defineBoot: (callback: (context?: unknown) => unknown) => callback}))
vi.mock('@tauri-apps/api/core', () => ({isTauri: () => true, invoke: (...args: unknown[]) => state.invoke(...args)}))
vi.mock('../../services/cardActivity', () => ({isCardActivityBusy: () => false, watchCardActivity: async () => () => undefined}))
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
    getCurrentWebBundleVersion: () => '0.7.0',
    getInstallationId: () => 'installation-1',
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
        state.client.checkForWebUpdate.mockReset().mockResolvedValue({status: 'no-release'})
        state.invoke.mockReset().mockResolvedValue(undefined)
        state.visibility = []
        vi.stubGlobal('document', {
            visibilityState: 'visible',
            addEventListener: (event: string, listener: () => void) => { if (event === 'visibilitychange') state.visibility.push(listener) },
        })
        state.client.downloadBundle.mockReset().mockImplementation(async (_candidate: unknown, options?: {onProgress?: (received: number, total: number) => void}) => {
                options?.onProgress?.(50, 100)
                return {result: {held: true}}
            })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('initializes installed runtime before config and resolves ordinary disabled startup', async () => {
        const bootModule = await import('../bundle-updates')
        await expect(bootModule.runBundleUpdateBoot()).resolves.toBeUndefined()
        expect(state.order).toEqual(['runtime', 'configuration'])
        expect(bootModule.bundleUpdatesCanStartRouteFlow).toBe(true)
    })

    it.each(['relaunching', 'install-failure'] as const)('keeps the launch screen after a native update that is %s', async (scenario) => {
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
        await bootModule.runBundleUpdateBoot()
        expect(state.client.checkForUpdate).not.toHaveBeenCalled()

        await expect(bootModule.checkBundleUpdates()).resolves.toBe(scenario === 'relaunching' ? 'relaunching' : 'blocked')
        expect(state.native.install).toHaveBeenCalledOnce()
        expect(state.loadingShow).toHaveBeenCalledWith({message: 'Applicatie-update downloaden… 50%'})
        expect(state.client.checkForWebUpdate).not.toHaveBeenCalled()
        if (scenario === 'relaunching') expect(state.native.relaunch).toHaveBeenCalledOnce()
        else expect(state.native.relaunch).not.toHaveBeenCalled()
    })

    it('then checks the web bundle for this installation and has the native side install it before relaunching', async () => {
        state.enabled = true
        state.client.checkForUpdate.mockResolvedValue({status: 'up-to-date', release: {version: '1.9.0'}})
        state.client.checkForWebUpdate.mockResolvedValue({
            status: 'available',
            candidate: {applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7', target: 'web', kind: 'web', currentVersion: '0.7.0', release: {version: '0.8.0'}, artifact: {}},
        })
        state.client.downloadBundle.mockResolvedValue({result: {url: 'https://api.transportklok.nl/web.zip', version: '0.8.0', sha256: 'a'.repeat(64), signature: 'sig'}})

        const bootModule = await import('../bundle-updates')
        await bootModule.runBundleUpdateBoot()

        await expect(bootModule.checkBundleUpdates()).resolves.toBe('relaunching')
        expect(state.client.checkForWebUpdate).toHaveBeenCalledWith({currentVersion: '0.7.0', installationId: 'installation-1', nativeVersion: '1.9.0', channel: 'stable'})
        expect(state.invoke).toHaveBeenCalledWith('install_web_bundle', {url: 'https://api.transportklok.nl/web.zip', version: '0.8.0', sha256: 'a'.repeat(64), signature: 'sig'})
        expect(state.native.install).not.toHaveBeenCalled()
        expect(state.native.relaunch).toHaveBeenCalledOnce()
    })

    it('checks again when the app becomes visible after the launch', async () => {
        state.enabled = true
        state.client.checkForUpdate.mockResolvedValue({status: 'up-to-date', release: {version: '1.9.0'}})
        const bootModule = await import('../bundle-updates')
        await bootModule.runBundleUpdateBoot()
        await expect(bootModule.checkBundleUpdates()).resolves.toBe('continue')

        state.visibility.forEach((listener) => listener())
        for (let index = 0; index < 20; index += 1) await Promise.resolve()

        expect(state.client.checkForUpdate).toHaveBeenCalledTimes(2)
        expect(state.client.checkForWebUpdate).toHaveBeenCalledTimes(2)
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
        await bootModule.runBundleUpdateBoot()
        await bootModule.checkBundleUpdates()

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
    })
})
