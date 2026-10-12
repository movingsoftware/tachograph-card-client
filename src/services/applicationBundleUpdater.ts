import type {ApplicationBundleClient, ApplicationBundleDownloadReceipt, ApplicationBundleUpdateCheck} from 'shared.js'
import {ApplicationBundleError} from 'shared.js'
import type {NativeBundleDownloader} from './nativeBundleDownloader'

export interface DeviceRuntimeInfo {
    readonly version: string
    readonly target: string
}

export interface ApplicationBundleUpdaterOptions {
    readonly enabled: boolean
    readonly client: ApplicationBundleClient
    readonly native: Pick<NativeBundleDownloader, 'install' | 'relaunch'>
    readonly initializeRuntime: () => Promise<DeviceRuntimeInfo>
    readonly setTimer?: (callback: () => void, delayMs: number) => unknown
    readonly random?: () => number
    readonly onUpdateAvailable?: (releaseVersion: string) => void
    readonly onStartupError?: (error: unknown) => void
    readonly onCheckError?: (error: unknown) => void
    readonly onDownloadError?: (error: unknown) => void
    readonly onDownloadProgress?: (receivedBytes: number, totalBytes: number) => void
}

export type StartupUpdateResult = 'continue' | 'relaunching'
type StartupState = 'unstarted' | 'checking' | 'downloading' | 'installing' | 'running' | 'blocked' | 'relaunching'

export class ApplicationBundleStartupError extends Error {
    readonly code = 'install_failed'

    constructor() {
        super('The application update could not be installed safely.')
        this.name = 'ApplicationBundleStartupError'
    }
}

const periodicCheckBaseMs = 6 * 60 * 60 * 1000

export const createApplicationBundleUpdater = (options: ApplicationBundleUpdaterOptions) => {
    const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    const random = options.random ?? Math.random
    let state: StartupState = 'unstarted'
    let runtime: DeviceRuntimeInfo | undefined

    const inspectUpdate = async (): Promise<ApplicationBundleUpdateCheck | undefined> => {
        if (!runtime) return undefined
        try {
            const result = await options.client.checkForUpdate(runtime.version, {
                target: runtime.target,
                kind: 'updater',
            })
            if (result.status === 'available') options.onUpdateAvailable?.(result.candidate.release.version)
            return result
        } catch (error) {
            options.onCheckError?.(error)
            return undefined
        }
    }

    const schedulePeriodicCheck = (): void => {
        if (!options.enabled || state !== 'running') return
        const jitter = 0.9 + random() * 0.2
        setTimer(() => {
            void inspectUpdate().finally(schedulePeriodicCheck)
        }, Math.floor(periodicCheckBaseMs * jitter))
    }

    return {
        startBeforeRouteFlow: async (): Promise<StartupUpdateResult> => {
            if (state !== 'unstarted') {
                throw new ApplicationBundleError('startup_already_run', 'Startup update check has already run.')
            }
            state = 'checking'
            try {
                runtime = await options.initializeRuntime()
            } catch (error) {
                state = 'blocked'
                options.onStartupError?.(error)
                throw error
            }
            if (!options.enabled) {
                state = 'running'
                return 'continue'
            }

            let update: ApplicationBundleUpdateCheck
            try {
                update = await options.client.checkForUpdate(runtime.version, {
                    target: runtime.target,
                    kind: 'updater',
                })
            } catch (error) {
                options.onCheckError?.(error)
                state = 'running'
                schedulePeriodicCheck()
                return 'continue'
            }
            if (update.status !== 'available') {
                state = 'running'
                schedulePeriodicCheck()
                return 'continue'
            }

            state = 'downloading'
            let receipt: ApplicationBundleDownloadReceipt
            try {
                const downloadOptions = options.onDownloadProgress
                    ? {onProgress: options.onDownloadProgress}
                    : undefined
                receipt = await options.client.downloadBundle(update.candidate, downloadOptions)
            } catch (error) {
                options.onDownloadError?.(error)
                state = 'running'
                schedulePeriodicCheck()
                return 'continue'
            }

            state = 'installing'
            try {
                await options.native.install(receipt.result)
            } catch {
                state = 'blocked'
                const startupError = new ApplicationBundleStartupError()
                options.onStartupError?.(startupError)
                throw startupError
            }

            state = 'relaunching'
            try {
                await options.native.relaunch()
            } catch {
                state = 'blocked'
                const startupError = new ApplicationBundleStartupError()
                options.onStartupError?.(startupError)
                throw startupError
            }
            return 'relaunching'
        },
        checkManually: async (): Promise<ApplicationBundleUpdateCheck | undefined> => {
            if (state !== 'running') return undefined
            return inspectUpdate()
        },
        canStartRouteFlow: (): boolean => state === 'running',
        currentState: (): StartupState => state,
    }
}
