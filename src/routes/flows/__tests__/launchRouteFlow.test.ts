// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({check: vi.fn(), replaceRoute: vi.fn()}))

vi.mock('src/boot/bundle-updates', () => ({checkBundleUpdates: () => state.check()}))
vi.mock('src/services/routerNavigation', () => ({replaceRoute: (...args: unknown[]) => state.replaceRoute(...args)}))

describe('launch route flow', () => {
    beforeEach(() => {
        state.check.mockReset()
        state.replaceRoute.mockReset()
    })

    it('checks for bundle updates before the auth flow lets the user in', async () => {
        const order: string[] = []
        state.check.mockImplementation(async () => { order.push('check-bundle-update'); return 'continue' })
        const startChildFlow = vi.fn(async () => { order.push('auth') })
        const {createLaunchRouteFlow} = await import('../launchRouteFlow')

        await createLaunchRouteFlow({startChildFlow} as never).start()

        expect(order).toEqual(['check-bundle-update', 'auth'])
    })

    it.each(['relaunching', 'blocked'] as const)('keeps the user on the launch screen when the update check is %s', async (result) => {
        state.check.mockResolvedValue(result)
        const startChildFlow = vi.fn()
        const {createLaunchRouteFlow} = await import('../launchRouteFlow')

        await createLaunchRouteFlow({startChildFlow} as never).start()

        expect(startChildFlow).not.toHaveBeenCalled()
        expect(state.replaceRoute).not.toHaveBeenCalled()
    })
})
