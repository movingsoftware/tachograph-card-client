import { defineBoot } from '#q-app/wrappers'
import { Notify } from 'quasar'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

// Installs a signed release published on GitHub; an unsigned or tampered update is rejected by the updater.
const installAvailableUpdate = async () => {
    const update = await check()

    if (!update) {
        return
    }

    await update.downloadAndInstall()

    Notify.create({
        type: 'info',
        message: `Versie ${update.version} is geïnstalleerd.`,
        timeout: 0,
        actions: [{ label: 'Nu herstarten', color: 'white', handler: () => void relaunch() }],
    })
}

export default defineBoot(() => {
    if (import.meta.env.DEV) {
        return
    }

    installAvailableUpdate().catch((error: unknown) => {
        console.error('Controleren op updates is mislukt', error)
    })
})
