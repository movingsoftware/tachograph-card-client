// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {RouteLocationNormalized} from 'vue-router'
import {ROUTES} from '../../enums/routes'
import {confirmWebBundleOnSettledRoutes} from '../webBundleTrial'

const state = vi.hoisted(() => ({invoke: vi.fn(), notify: vi.fn()}))

vi.mock('@tauri-apps/api/core', () => ({invoke: (...args: unknown[]) => state.invoke(...args)}))
vi.mock('quasar', () => ({Notify: {create: (...args: unknown[]) => state.notify(...args)}}))

/** Registers the trial hook on a stand-in router and returns a navigation to `path`. */
const navigation = (): ((path: string) => Promise<void>) => {
    let hook: ((to: RouteLocationNormalized) => void) | undefined
    confirmWebBundleOnSettledRoutes({afterEach: (guard) => { hook = guard as typeof hook; return () => undefined }})
    return async (path) => {
        hook?.({path} as RouteLocationNormalized)
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

describe('web bundle trial', () => {
    beforeEach(() => {
        state.invoke.mockReset().mockResolvedValue(null)
        state.notify.mockReset()
    })

    it.each([ROUTES.AUTH, ROUTES.OFFLINE, ROUTES.ERROR_OUTDATED, ROUTES.ERROR_MAINTENANCE])(
        'confirms a bundle that started on %s, so it is not rolled back at the next launch',
        async (path) => {
            await navigation()(path)

            expect(state.invoke).toHaveBeenCalledOnce()
            expect(state.invoke).toHaveBeenCalledWith('bundle_ready')
        },
    )

    it('leaves the launch screen, home and unknown routes unconfirmed', async () => {
        const navigate = navigation()

        for (const path of [ROUTES.LAUNCH, ROUTES.HOME, '/missing']) await navigate(path)

        expect(state.invoke).not.toHaveBeenCalled()
    })

    it('reports the bundle the native side rolled back to the last good one', async () => {
        state.invoke.mockResolvedValue('2.0.0')

        await navigation()(ROUTES.ERROR_OUTDATED)

        expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({type: 'warning', message: 'Update 2.0.0 kon niet starten en is teruggedraaid.'}))
    })
})
