import {invoke} from '@tauri-apps/api/core'
import {Notify} from 'quasar'
import type {Router} from 'vue-router'
import {ROUTES} from '../enums/routes'

/** Screens without the card bridge on which a started bundle has proven itself; home confirms once its card listeners register. */
const SETTLED_ROUTES: readonly string[] = [ROUTES.AUTH, ROUTES.OFFLINE, ROUTES.ERROR_OUTDATED, ROUTES.ERROR_MAINTENANCE]

/** Tells the native side this web bundle started, so it is not rolled back at the next launch, and reports a rollback. */
export const confirmWebBundle = async (): Promise<void> => {
    try {
        const rolledBack = await invoke<string | null>('bundle_ready')
        if (rolledBack) {
            Notify.create({
                type: 'warning',
                message: `Update ${rolledBack} kon niet starten en is teruggedraaid.`,
                caption: 'De vorige versie van de applicatie wordt gebruikt.',
                timeout: 0,
            })
        }
    } catch (error) {
        console.error('Error confirming the web bundle:', error)
    }
}

/** Confirms the web bundle once the launch settles on a screen other than home. */
export const confirmWebBundleOnSettledRoutes = (router: Pick<Router, 'afterEach'>): void => {
    router.afterEach((to) => {
        if (SETTLED_ROUTES.includes(to.path)) void confirmWebBundle()
    })
}
