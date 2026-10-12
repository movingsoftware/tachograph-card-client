// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'
import type {ApplicationBundleDownloadDescriptor} from 'shared.js'
import {createNativeBundleDownloader, type NativeUpdaterEvent, type NativeUpdaterUpdate} from '../nativeBundleDownloader'

const descriptor: ApplicationBundleDownloadDescriptor = {
    applicationId: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
    target: 'darwin-aarch64',
    kind: 'updater',
    version: '1.10.0',
    allowedDownloadHosts: ['api.transportklok.nl'],
    artifact: {
        id: '8d684bee-0e3f-4d59-9ae0-36ec16b84c59',
        target: 'darwin-aarch64',
        kind: 'updater',
        format: 'app.tar.gz',
        file_name: 'TransportKlok.app.tar.gz',
        content_type: 'application/gzip',
        size_bytes: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        signature: 'signature-value',
        signing_key_id: 'desktop-release-2026',
        download_url: 'https://api.transportklok.nl/rest/v1/applications/c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7/bundles/1.10.0/download?target=darwin-aarch64&kind=updater',
    },
}

const update = (overrides: Partial<NativeUpdaterUpdate> = {}): NativeUpdaterUpdate => ({
    version: '1.10.0',
    currentVersion: '1.9.0',
    rawJson: {url: descriptor.artifact.download_url, signature: descriptor.artifact.signature},
    download: vi.fn(async (onEvent?: (event: NativeUpdaterEvent) => void) => {
        onEvent?.({event: 'Started', data: {contentLength: 3}})
        onEvent?.({event: 'Progress', data: {chunkLength: 3}})
        onEvent?.({event: 'Finished'})
    }),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
})

describe('native bundle downloader', () => {
    it('distinguishes the native no-update response from a check failure', async () => {
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(null), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        await expect(adapter.download(descriptor)).rejects.toMatchObject({code: 'http', status: 204})
        const failedCheck = createNativeBundleDownloader({check: vi.fn().mockRejectedValue(new Error('offline')), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        await expect(failedCheck.download(descriptor)).rejects.toMatchObject({code: 'native_download_failed'})
    })

    it('checks native identity, downloads once, forwards progress, and installs the held update', async () => {
        const checkedUpdate = update()
        const check = vi.fn().mockResolvedValue(checkedUpdate)
        const adapter = createNativeBundleDownloader({check, signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const onProgress = vi.fn()
        const result = await adapter.download({...descriptor, onProgress})

        expect(check).toHaveBeenCalledOnce()
        expect(checkedUpdate.download).toHaveBeenCalledOnce()
        expect(result.verification).toBe('native-signature')
        expect(onProgress).toHaveBeenCalledWith(3, 3)
        await adapter.install(result.value)
        expect(checkedUpdate.install).toHaveBeenCalledOnce()
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
    })

    it.each([
        ['version', {version: '1.11.0'}],
        ['current version', {currentVersion: '0.7.0'}],
        ['key ID', {}],
        ['url', {rawJson: {url: 'https://api.transportklok.nl/other', signature: 'signature-value'}}],
        ['signature', {rawJson: {url: descriptor.artifact.download_url, signature: 'other-signature'}}],
    ] as const)('closes and rejects a native %s mismatch before download', async (label, overrides) => {
        const checkedUpdate = update(overrides)
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(checkedUpdate), signingKeyId: label === 'key ID' ? 'different-key' : 'desktop-release-2026', currentVersion: () => '1.9.0'})
        await expect(adapter.download(descriptor)).rejects.toMatchObject({code: 'candidate_changed'})
        expect(checkedUpdate.download).not.toHaveBeenCalled()
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
    })

    it('closes an update returned after abort during the native metadata check without starting download', async () => {
        let resolveCheck!: (value: NativeUpdaterUpdate) => void
        const checkedUpdate = update()
        const check = vi.fn(() => new Promise<NativeUpdaterUpdate>((resolve) => { resolveCheck = resolve }))
        const adapter = createNativeBundleDownloader({check, signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const controller = new AbortController()
        const pending = adapter.download({...descriptor, signal: controller.signal})
        controller.abort()
        resolveCheck(checkedUpdate)

        await expect(pending).rejects.toMatchObject({code: 'aborted'})
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
        expect(checkedUpdate.download).not.toHaveBeenCalled()
    })

    it('waits for the native download to settle before closing after abort', async () => {
        let finishDownload!: () => void
        let markDownloadStarted!: () => void
        const downloadStarted = new Promise<void>((resolve) => { markDownloadStarted = resolve })
        const checkedUpdate = update({download: vi.fn((onEvent?: (event: NativeUpdaterEvent) => void) => {
            onEvent?.({event: 'Started', data: {contentLength: 3}})
            markDownloadStarted()
            return new Promise<void>((resolve) => { finishDownload = resolve })
        })})
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(checkedUpdate), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const controller = new AbortController()
        const pending = adapter.download({...descriptor, signal: controller.signal})
        await downloadStarted
        controller.abort()
        expect(checkedUpdate.close).not.toHaveBeenCalled()
        finishDownload()
        await expect(pending).rejects.toMatchObject({code: 'aborted'})
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
        expect(checkedUpdate.install).not.toHaveBeenCalled()
    })

    it('waits for install to settle before closing after abort', async () => {
        let finishInstall!: () => void
        const checkedUpdate = update({install: vi.fn(() => new Promise<void>((resolve) => { finishInstall = resolve }))})
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(checkedUpdate), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const controller = new AbortController()
        const result = await adapter.download({...descriptor, signal: controller.signal})
        const pending = adapter.install(result.value)
        await Promise.resolve()
        controller.abort()
        expect(checkedUpdate.close).not.toHaveBeenCalled()
        finishInstall()
        await expect(pending).rejects.toMatchObject({code: 'aborted'})
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
    })

    it('rejects an explicit close during install and closes exactly once after install settles', async () => {
        let finishInstall!: () => void
        const checkedUpdate = update({install: vi.fn(() => new Promise<void>((resolve) => { finishInstall = resolve }))})
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(checkedUpdate), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const result = await adapter.download(descriptor)
        const installation = adapter.install(result.value)
        await Promise.resolve()

        await expect(adapter.close(result.value)).rejects.toMatchObject({code: 'operation_in_progress'})
        expect(checkedUpdate.close).not.toHaveBeenCalled()
        finishInstall()
        await installation
        await adapter.close(result.value)
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
    })

    it.each([
        ['announced', {download: vi.fn(async (onEvent?: (event: NativeUpdaterEvent) => void) => onEvent?.({event: 'Started', data: {contentLength: 4}}))}],
        ['received', {download: vi.fn(async (onEvent?: (event: NativeUpdaterEvent) => void) => {
            onEvent?.({event: 'Started', data: {contentLength: 3}})
            onEvent?.({event: 'Progress', data: {chunkLength: 2}})
        })}],
    ] as const)('rejects wrong %s byte counts and closes before installation', async (_label, overrides) => {
        const checkedUpdate = update(overrides)
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(checkedUpdate), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        await expect(adapter.download(descriptor)).rejects.toMatchObject({code: 'size_mismatch'})
        expect(checkedUpdate.close).toHaveBeenCalledOnce()
        expect(checkedUpdate.install).not.toHaveBeenCalled()
    })

    it('closes native state when download fails or is aborted after settlement', async () => {
        const failed = update({download: vi.fn().mockRejectedValue(new Error('signature verification failed'))})
        const failedCheck = vi.fn().mockResolvedValue(failed)
        const failedAdapter = createNativeBundleDownloader({check: failedCheck, signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        await expect(failedAdapter.download(descriptor)).rejects.toMatchObject({code: 'native_download_failed'})
        expect(failedCheck).toHaveBeenCalledOnce()
        expect(failed.download).toHaveBeenCalledOnce()
        expect(failed.close).toHaveBeenCalledOnce()

        const settled = update()
        const controller = new AbortController()
        const adapter = createNativeBundleDownloader({check: vi.fn().mockResolvedValue(settled), signingKeyId: 'desktop-release-2026', currentVersion: () => '1.9.0'})
        const result = await adapter.download({...descriptor, signal: controller.signal})
        controller.abort()
        await Promise.resolve()
        await expect(adapter.install(result.value)).rejects.toMatchObject({code: 'aborted'})
        expect(settled.close).toHaveBeenCalledOnce()
        expect(settled.install).not.toHaveBeenCalled()
    })
})
