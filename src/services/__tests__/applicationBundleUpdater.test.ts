// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'
import type {
    ApplicationBundleCandidate,
    ApplicationBundleClient,
    ApplicationBundleDownloadReceipt,
    ApplicationBundleReleaseData,
} from 'shared.js'
import applicationBundleFixture from '../../../../shared.js/src/services/__fixtures__/applicationBundle.json'
import {createApplicationBundleUpdater} from '../applicationBundleUpdater'

const release: ApplicationBundleReleaseData = applicationBundleFixture.data as ApplicationBundleReleaseData
const artifact = release.artifacts.find((item) => item.kind === 'updater')
if (!artifact) throw new Error('The generated application bundle fixture has no updater artifact.')

const candidate: ApplicationBundleCandidate = {
    applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
    target: 'darwin-aarch64',
    kind: 'updater',
    currentVersion: '1.9.0',
    release,
    artifact,
}

const client = (checkForUpdate: ApplicationBundleClient['checkForUpdate']): ApplicationBundleClient => ({
    listBundles: vi.fn(),
    getLatestBundle: vi.fn(),
    getBundle: vi.fn(),
    checkForUpdate,
    downloadBundle: vi.fn(async (selected): Promise<ApplicationBundleDownloadReceipt> => ({
        release: selected.release,
        artifact: selected.artifact,
        result: {handle: 'held'},
        verification: 'native-signature',
    })),
})

describe('application bundle startup updater', () => {
    it('initializes the installed version before metadata check and installs the same held native handle', async () => {
        const order: string[] = []
        const bundleClient = client(vi.fn(async () => {
            order.push('check')
            return {status: 'available' as const, candidate}
        }))
        const native = {
            install: vi.fn(async (handle: unknown) => { order.push(`install:${(handle as {handle: string}).handle}`) }),
            relaunch: vi.fn(async () => { order.push('relaunch') }),
        }
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native,
            initializeRuntime: vi.fn(async () => {
                order.push('runtime')
                return {version: '1.9.0', target: 'darwin-aarch64'}
            }),
        })

        await expect(updater.startBeforeRouteFlow()).resolves.toBe('relaunching')
        expect(order).toEqual(['runtime', 'check', 'install:held', 'relaunch'])
        expect(bundleClient.downloadBundle).toHaveBeenCalledOnce()
        await expect(updater.startBeforeRouteFlow()).rejects.toMatchObject({code: 'startup_already_run'})
    })

    it('continues startup on offline metadata failure and schedules periodic metadata checks only', async () => {
        const checkForUpdate = vi.fn().mockRejectedValue(new Error('offline'))
        const bundleClient = client(checkForUpdate)
        const setTimer = vi.fn(() => 1)
        const checkError = vi.fn()
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native: {install: vi.fn(), relaunch: vi.fn()},
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
            setTimer,
            random: () => 0.5,
            onCheckError: checkError,
        })

        await expect(updater.startBeforeRouteFlow()).resolves.toBe('continue')
        expect(bundleClient.downloadBundle).not.toHaveBeenCalled()
        expect(checkError).toHaveBeenCalledOnce()
        expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1000)
        await updater.checkManually()
        expect(bundleClient.downloadBundle).not.toHaveBeenCalled()
    })

    it('reports a download failure while allowing the installed application to continue', async () => {
        const checkForUpdate = vi.fn().mockResolvedValue({status: 'available', candidate})
        const downloadError = vi.fn()
        const bundleClient = client(checkForUpdate)
        bundleClient.downloadBundle = vi.fn().mockRejectedValue(new Error('download failed'))
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native: {install: vi.fn(), relaunch: vi.fn()},
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
            onDownloadError: downloadError,
            setTimer: vi.fn(() => 1),
        })

        await expect(updater.startBeforeRouteFlow()).resolves.toBe('continue')
        expect(downloadError).toHaveBeenCalledOnce()
        expect(updater.canStartRouteFlow()).toBe(true)
    })

    it('forwards native download progress from the client adapter', async () => {
        const checkForUpdate = vi.fn().mockResolvedValue({status: 'available', candidate})
        const bundleClient = client(checkForUpdate)
        const onDownloadProgress = vi.fn()
        bundleClient.downloadBundle = vi.fn(async (selected: ApplicationBundleCandidate, options?: {onProgress?: (received: number, total: number) => void}) => {
            options?.onProgress?.(2, 3)
            return {
                release: selected.release,
                artifact: selected.artifact,
                result: {handle: 'held'},
                verification: 'native-signature' as const,
            }
        })
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native: {install: vi.fn(), relaunch: vi.fn()},
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
            onDownloadProgress,
        })

        await updater.startBeforeRouteFlow()
        expect(onDownloadProgress).toHaveBeenCalledWith(2, 3)
    })

    it('blocks route flow and exposes an installation failure distinctly', async () => {
        const bundleClient = client(vi.fn().mockResolvedValue({status: 'available', candidate}))
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native: {install: vi.fn().mockRejectedValue(new Error('install failed')), relaunch: vi.fn()},
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
        })
        await expect(updater.startBeforeRouteFlow()).rejects.toMatchObject({code: 'install_failed'})
        expect(updater.canStartRouteFlow()).toBe(false)
    })

    it('keeps route flow blocked when relaunch fails after installation', async () => {
        const bundleClient = client(vi.fn().mockResolvedValue({status: 'available', candidate}))
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native: {
                install: vi.fn(),
                relaunch: vi.fn().mockRejectedValue(new Error('relaunch failed')),
            },
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
        })
        await expect(updater.startBeforeRouteFlow()).rejects.toMatchObject({code: 'install_failed'})
        expect(updater.canStartRouteFlow()).toBe(false)
    })

    it('does not download or install after startup has entered running state', async () => {
        const bundleClient = client(vi.fn().mockResolvedValue({status: 'available', candidate}))
        const updater = createApplicationBundleUpdater({
            enabled: false,
            client: bundleClient,
            native: {install: vi.fn(), relaunch: vi.fn()},
            initializeRuntime: vi.fn().mockResolvedValue({version: '0.7.0', target: 'darwin-aarch64'}),
        })
        await expect(updater.startBeforeRouteFlow()).resolves.toBe('continue')
        expect(updater.canStartRouteFlow()).toBe(true)
        expect(bundleClient.checkForUpdate).not.toHaveBeenCalled()
        expect(bundleClient.downloadBundle).not.toHaveBeenCalled()
    })

    it('only checks metadata after startup and never installs while route flow is running', async () => {
        const checkForUpdate = vi.fn()
            .mockResolvedValueOnce({status: 'up-to-date', release: {version: '1.9.0'}})
            .mockResolvedValueOnce({status: 'available', candidate})
        const bundleClient = client(checkForUpdate)
        const native = {install: vi.fn(), relaunch: vi.fn()}
        const updater = createApplicationBundleUpdater({
            enabled: true,
            client: bundleClient,
            native,
            initializeRuntime: vi.fn().mockResolvedValue({version: '1.9.0', target: 'darwin-aarch64'}),
            setTimer: vi.fn(() => 1),
        })
        await expect(updater.startBeforeRouteFlow()).resolves.toBe('continue')
        await expect(updater.checkManually()).resolves.toMatchObject({status: 'available'})
        expect(bundleClient.downloadBundle).not.toHaveBeenCalled()
        expect(native.install).not.toHaveBeenCalled()
        expect(native.relaunch).not.toHaveBeenCalled()
    })
})
