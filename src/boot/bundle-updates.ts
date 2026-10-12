import {defineBoot} from '#q-app/wrappers'
import {isTauri} from '@tauri-apps/api/core'
import {Loading, Notify} from 'quasar'
import {check} from '@tauri-apps/plugin-updater'
import {createApplicationBundleClient} from 'shared.js'
import {createApplicationBundleUpdater} from '../services/applicationBundleUpdater'
import {getBundleUpdaterConfiguration} from '../services/bundleUpdaterConfig'
import {createNativeBundleDownloader} from '../services/nativeBundleDownloader'
import {
    getCurrentNativeApplicationVersion,
    getDeviceRuntimeInfo,
    initializeDeviceRuntime,
} from '../services/deviceRuntime'

export let bundleUpdatesCanStartRouteFlow = true
let bundleUpdater: ReturnType<typeof createApplicationBundleUpdater> | undefined

export const checkBundleUpdateManually = () => bundleUpdater?.checkManually()
const holdStartupUntilNativeRestart = (): Promise<void> => new Promise(() => undefined)

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
        Notify.create({
            type: 'negative',
            message: 'De geïnstalleerde applicatieversie kon niet worden vastgesteld.',
            caption: 'Start de applicatie opnieuw of neem contact op met support.',
            timeout: 0,
        })
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
    const client = createApplicationBundleClient({
        apiBaseUrl: configuration.apiBaseUrl,
        applicationId: configuration.applicationId,
        runtimeTarget: getDeviceRuntimeInfo().target,
        kind: 'updater',
        allowedDownloadHosts: [apiHost],
        downloader: native.download,
        timeoutMs: 10000,
    })
    const updater = createApplicationBundleUpdater({
        enabled: true,
        client,
        native,
        initializeRuntime: async () => getDeviceRuntimeInfo(),
        onUpdateAvailable: (version) => {
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
        onDownloadProgress: (receivedBytes, totalBytes) => {
            const percentage = totalBytes > 0 ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : 0
            Loading.show({message: `Applicatie-update downloaden… ${percentage}%`})
        },
        onStartupError: () => {
            Notify.create({
                type: 'negative',
                message: 'De update kon niet veilig worden geïnstalleerd.',
                caption: 'De applicatie blijft geblokkeerd totdat een veilige herstart lukt.',
                actions: [{label: 'Herstarten', color: 'white', handler: () => { void requestNativeRelaunch(native.relaunch) }}],
                timeout: 0,
            })
        },
    })
    bundleUpdater = updater

    Loading.show({message: 'Controleren op een applicatie-update…'})
    try {
        const result = await updater.startBeforeRouteFlow()
        if (result === 'relaunching' || !updater.canStartRouteFlow()) {
            bundleUpdatesCanStartRouteFlow = false
        }
    } catch {
        bundleUpdatesCanStartRouteFlow = false
    } finally {
        Loading.hide()
    }
    if (!bundleUpdatesCanStartRouteFlow) await holdStartupUntilNativeRestart()
}

export default defineBoot(runBundleUpdateBoot)
