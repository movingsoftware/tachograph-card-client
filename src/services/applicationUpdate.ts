import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

export type ApplicationUpdateResult =
    | { status: 'skipped' | 'no-update' }
    | { status: 'updated' }
    | { status: 'failed'; error: unknown }

let updateCheckPromise: Promise<ApplicationUpdateResult> | null = null

const isTauriRuntime = (): boolean =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Check for and install a signed Tauri application update when the updater is configured.
 *
 * The updater configuration and signing key stay in the release pipeline. A development
 * build or a build without a configured update feed falls back to the manual update page.
 *
 * @return {Promise<ApplicationUpdateResult>}
 */
export const checkAndApplyApplicationUpdate = async (): Promise<ApplicationUpdateResult> => {
    if (updateCheckPromise) {
        return updateCheckPromise
    }

    updateCheckPromise = (async (): Promise<ApplicationUpdateResult> => {
        if (import.meta.env.MODE !== 'production' || !isTauriRuntime()) {
            return { status: 'skipped' }
        }

        try {
            const update = await check()

            if (!update) {
                return { status: 'no-update' }
            }

            await update.downloadAndInstall()
            await relaunch()

            return { status: 'updated' }
        } catch (error) {
            console.error('[ApplicationUpdate] Update check failed.', error)

            return { status: 'failed', error }
        } finally {
            updateCheckPromise = null
        }
    })()

    return updateCheckPromise
}
