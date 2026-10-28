import {defineBoot} from '#q-app/wrappers'
import {invoke, isTauri} from '@tauri-apps/api/core'
import {Loading, Notify} from 'quasar'
import {check} from '@tauri-apps/plugin-updater'
import {createApplicationBundleClient, createLiveBundleUpdater} from 'shared.js'
import {createBundleUpdateGate, type BundleUpdateGate, type BundleUpdateGateResult} from '../services/bundleUpdateGate'
import {getBundleUpdaterConfiguration} from '../services/bundleUpdaterConfig'
import {isCardActivityBusy, watchCardActivity} from '../services/cardActivity'
import {createNativeBundleDownloader} from '../services/nativeBundleDownloader'
import {
    getCurrentNativeApplicationVersion,
    getCurrentWebBundleVersion,
    getDeviceRuntimeInfo,
    getInstallationId,
    initializeDeviceRuntime,
} from '../services/deviceRuntime'

/** Channel this installation follows unless Platform overrides it. */
const WEB_BUNDLE_CHANNEL = 'stable'

export let bundleUpdatesCanStartRouteFlow = true
let gate: BundleUpdateGate | undefined

/** Checks native then web bundles before the user gets in; anything but `continue` keeps the launch screen. */
export const checkBundleUpdates = async (): Promise<BundleUpdateGateResult> => {
    if (!gate) return 'continue'
    Loading.show({message: 'Controleren op een applicatie-update…'})
    try {
        return await gate.atLaunch()
    } finally {
        Loading.hide()
    }
}

const holdStartupUntilNativeRestart = (): Promise<void> => new Promise(() => undefined)

const showUnknownVersion = (): void => {
    Notify.create({
        type: 'negative',
        message: 'De geïnstalleerde applicatieversie kon niet worden vastgesteld.',
        caption: 'Start de applicatie opnieuw of neem contact op met support.',
        timeout: 0,
    })
}

const showNativeRelaunchFailure = (): void => {
    Notify.create({
        type: 'negative',
        message: 'De applicatie kon niet opnieuw worden gestart.',
        caption: 'Start de applicatie handmatig opnieuw.',
        timeout: 0,
    })
}

const requestNativeRelaunch = async (relaunch: () => Promise<void>): Promise<void> => {
    try {
        await relaunch()
    } catch {
        showNativeRelaunchFailure()
    }
}

export const runBundleUpdateBoot = async (): Promise<void> => {
    try {
        await initializeDeviceRuntime()
    } catch {
        bundleUpdatesCanStartRouteFlow = false
        showUnknownVersion()
        await holdStartupUntilNativeRestart()
        return
    }

    let configuration: ReturnType<typeof getBundleUpdaterConfiguration>
    try {
        configuration = getBundleUpdaterConfiguration()
    } catch {
        Notify.create({
            type: 'negative',
            message: 'De configuratie voor applicatie-updates is onvolledig.',
            caption: 'De bestaande applicatie blijft beschikbaar.',
        })
        return
    }
    if (!configuration.enabled || !isTauri()) return

    const apiHost = new URL(configuration.apiBaseUrl).hostname
    const native = createNativeBundleDownloader({
        check: () => check({timeout: 10000}),
        signingKeyId: configuration.signingKeyId,
        currentVersion: getCurrentNativeApplicationVersion,
    })
    const clientOptions = {
        apiBaseUrl: configuration.apiBaseUrl,
        applicationId: configuration.applicationId,
        allowedDownloadHosts: [apiHost],
        timeoutMs: 10000,
    }
    const notices = {
        onUpdateAvailable: (version: string) => {
            Notify.create({
                type: 'info',
                message: `Versie ${version} is beschikbaar.`,
                caption: 'De update wordt bij de volgende herstart geïnstalleerd.',
                timeout: 0,
            })
        },
        onCheckError: () => {
            Notify.create({
                type: 'warning',
                message: 'Controleren op applicatie-updates is niet gelukt.',
                caption: 'De bestaande applicatie blijft beschikbaar.',
            })
        },
        onDownloadError: () => {
            Notify.create({
                type: 'warning',
                message: 'De applicatie-update kon niet worden gedownload.',
                caption: 'De bestaande applicatie blijft beschikbaar.',
            })
        },
        onDownloadProgress: (receivedBytes: number, totalBytes: number) => {
            const percentage = totalBytes > 0 ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : 0
            Loading.show({message: `Applicatie-update downloaden… ${percentage}%`})
        },
        onRuntimeError: showUnknownVersion,
        onInstallError: () => {
            Notify.create({
                type: 'negative',
                message: 'De update kon niet veilig worden geïnstalleerd.',
                caption: 'De applicatie blijft geblokkeerd totdat een veilige herstart lukt.',
                actions: [{label: 'Herstarten', color: 'white', handler: () => { void requestNativeRelaunch(native.relaunch) }}],
                timeout: 0,
            })
        },
    }

    const nativeUpdater = createLiveBundleUpdater({
        ...notices,
        enabled: true,
        client: createApplicationBundleClient({
            ...clientOptions,
            runtimeTarget: getDeviceRuntimeInfo().target,
            kind: 'updater',
            downloader: native.download,
        }),
        kind: 'updater',
        installer: {install: native.install, apply: native.relaunch},
        runtime: async () => getDeviceRuntimeInfo(),
    })

    const webClient = createApplicationBundleClient({
        ...clientOptions,
        runtimeTarget: 'web',
        kind: 'web',
        // The native side downloads the zip and checks its signature, so this only hands over where it is.
        downloader: async ({artifact, version}) => ({
            verification: 'native-signature',
            value: {url: artifact.download_url, version, sha256: artifact.sha256, signature: artifact.signature},
        }),
    })
    const webUpdater = createLiveBundleUpdater({
        ...notices,
        enabled: true,
        client: {
            ...webClient,
            checkForUpdate: (currentVersion) => webClient.checkForWebUpdate({
                currentVersion,
                installationId: getInstallationId(),
                nativeVersion: getCurrentNativeApplicationVersion(),
                channel: WEB_BUNDLE_CHANNEL,
            }),
        },
        kind: 'web',
        installer: {
            install: async (download) => { await invoke('install_web_bundle', download as Record<string, unknown>) },
            apply: native.relaunch,
        },
        runtime: async () => ({version: getCurrentWebBundleVersion(), target: 'web'}),
    })

    gate = createBundleUpdateGate({updaters: [nativeUpdater, webUpdater], isBusy: isCardActivityBusy})
    void watchCardActivity()
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void gate?.onResume()
    })
}

export default defineBoot(runBundleUpdateBoot)
