import {relaunch as relaunchApplication} from '@tauri-apps/plugin-process'
import type {DownloadEvent, Update} from '@tauri-apps/plugin-updater'
import {ApplicationBundleError, type ApplicationBundleDownloadDescriptor, type ApplicationBundleDownloadResult} from 'shared.js'

export type NativeUpdaterEvent = DownloadEvent
export type NativeUpdaterUpdate = Pick<Update, 'version' | 'currentVersion' | 'rawJson' | 'download' | 'install' | 'close'>

export interface NativeBundleDownloaderOptions {
    readonly check: () => Promise<NativeUpdaterUpdate | null>
    readonly signingKeyId: string
    readonly currentVersion: () => string
    readonly relaunch?: () => Promise<void>
}

interface HeldNativeUpdate {
    readonly update: NativeUpdaterUpdate
    readonly signal: AbortSignal | undefined
    abortListener?: () => void
    closePromise?: Promise<void>
    closed: boolean
    installed: boolean
    installing: boolean
}

export interface NativeBundleDownloader {
    download(descriptor: ApplicationBundleDownloadDescriptor): Promise<ApplicationBundleDownloadResult<unknown>>
    install(handle: unknown): Promise<void>
    close(handle: unknown): Promise<void>
    relaunch(): Promise<void>
}

const sizeError = (): ApplicationBundleError => new ApplicationBundleError('size_mismatch', 'Native updater download size did not match release metadata.')

const rawJsonString = (rawJson: Record<string, unknown>, property: string): string | undefined => {
    const value = rawJson[property]
    return typeof value === 'string' ? value : undefined
}

export const createNativeBundleDownloader = (options: NativeBundleDownloaderOptions): NativeBundleDownloader => {
    const handles = new WeakMap<object, HeldNativeUpdate>()

    const closeResource = (resource: HeldNativeUpdate): Promise<void> => {
        if (resource.closePromise) return resource.closePromise
        resource.closed = true
        if (resource.abortListener) resource.signal?.removeEventListener('abort', resource.abortListener)
        resource.closePromise = Promise.resolve().then(() => resource.update.close()).then(() => undefined)
        return resource.closePromise
    }

    const resourceFor = (handle: unknown): HeldNativeUpdate => {
        if (!handle || typeof handle !== 'object') {
            throw new ApplicationBundleError('candidate_changed', 'Native updater handle is invalid.')
        }
        const resource = handles.get(handle)
        if (!resource) {
            throw new ApplicationBundleError('candidate_changed', 'Native updater handle is no longer available.')
        }
        return resource
    }

    return {
        download: async (descriptor) => {
            if (descriptor.signal?.aborted) throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
            let update: NativeUpdaterUpdate | null
            try {
                update = await options.check()
            } catch {
                throw new ApplicationBundleError('native_download_failed', 'Native updater metadata request failed.')
            }
            if (!update) throw new ApplicationBundleError('http', 'The native updater has no matching release.', 204)
            if (descriptor.signal?.aborted) {
                await Promise.resolve().then(() => update.close()).catch(() => undefined)
                throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
            }

            const identityMatches = update.version === descriptor.version
                && update.currentVersion === options.currentVersion()
                && rawJsonString(update.rawJson, 'url') === descriptor.artifact.download_url
                && rawJsonString(update.rawJson, 'signature') === descriptor.artifact.signature
                && descriptor.artifact.signing_key_id === options.signingKeyId
            if (!identityMatches) {
                await Promise.resolve().then(() => update.close()).catch(() => undefined)
                throw new ApplicationBundleError('candidate_changed', 'Native updater metadata did not match the selected release.')
            }

            let receivedBytes = 0
            let announcedBytes: number | undefined
            let progressError: unknown
            try {
                await update.download((event) => {
                    if (event.event === 'Started') {
                        const contentLength = event.data.contentLength
                        if (contentLength !== undefined && contentLength !== null) {
                            if (!Number.isSafeInteger(contentLength) || contentLength !== descriptor.artifact.size_bytes) {
                                progressError = sizeError()
                            } else {
                                announcedBytes = contentLength
                            }
                        }
                    }
                    if (event.event === 'Progress') {
                        const chunkLength = event.data.chunkLength
                        if (!Number.isSafeInteger(chunkLength) || chunkLength < 0) {
                            progressError = sizeError()
                            return
                        }
                        receivedBytes += chunkLength
                        if (receivedBytes > descriptor.artifact.size_bytes) progressError = sizeError()
                        try {
                            descriptor.onProgress?.(receivedBytes, descriptor.artifact.size_bytes)
                        } catch (error) {
                            progressError = error
                        }
                    }
                }, {timeout: 120000})
            } catch {
                await Promise.resolve().then(() => update.close()).catch(() => undefined)
                if (descriptor.signal?.aborted) throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
                throw new ApplicationBundleError('native_download_failed', 'Native updater download failed.')
            }

            if (descriptor.signal?.aborted) {
                await Promise.resolve().then(() => update.close()).catch(() => undefined)
                throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
            }
            if (progressError) {
                await Promise.resolve().then(() => update.close()).catch(() => undefined)
                if (progressError instanceof ApplicationBundleError) throw progressError
                throw new ApplicationBundleError('invalid_response', 'Native updater progress callback failed.')
            }
            if ((announcedBytes !== undefined && announcedBytes !== descriptor.artifact.size_bytes)
                || (receivedBytes > 0 && receivedBytes !== descriptor.artifact.size_bytes)) {
                await Promise.resolve(update.close()).catch(() => undefined)
                throw sizeError()
            }

            const handle = {}
            const resource: HeldNativeUpdate = {
                update,
                signal: descriptor.signal,
                closed: false,
                installed: false,
                installing: false,
            }
            resource.abortListener = () => {
                if (!resource.installing) void closeResource(resource).catch(() => undefined)
            }
            descriptor.signal?.addEventListener('abort', resource.abortListener, {once: true})
            handles.set(handle, resource)
            if (descriptor.signal?.aborted) {
                await closeResource(resource)
                throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
            }
            return {verification: 'native-signature', value: handle}
        },
        install: async (handle) => {
            const resource = resourceFor(handle)
            if (resource.signal?.aborted) {
                await closeResource(resource)
                throw new ApplicationBundleError('aborted', 'Application bundle download was aborted.')
            }
            if (resource.closed) {
                throw new ApplicationBundleError('candidate_changed', 'Native updater handle is no longer available.')
            }
            if (resource.installed) throw new ApplicationBundleError('candidate_changed', 'Native updater handle was already installed.')
            resource.installed = true
            resource.installing = true
            try {
                await resource.update.install()
                if (resource.signal?.aborted) {
                    throw new ApplicationBundleError('aborted', 'Application bundle installation was aborted.')
                }
            } catch (error) {
                if (error instanceof ApplicationBundleError) throw error
                throw new ApplicationBundleError('install_failed', 'Native application update installation failed.')
            } finally {
                resource.installing = false
                await closeResource(resource).catch(() => undefined)
            }
        },
        close: async (handle) => {
            const resource = resourceFor(handle)
            if (resource.installing) {
                throw new ApplicationBundleError('operation_in_progress', 'Native application installation is still in progress.')
            }
            await closeResource(resource)
        },
        relaunch: options.relaunch ?? relaunchApplication,
    }
}
