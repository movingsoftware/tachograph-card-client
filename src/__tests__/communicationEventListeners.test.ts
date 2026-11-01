// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
    handlers: new Map<string, () => Promise<void>>(),
    order: [] as string[],
    checkManually: vi.fn(),
    clear: vi.fn(),
    start: vi.fn(),
}))

vi.mock('../boot/bundle-updates', () => ({
    checkBundleUpdateManually: async () => {
        state.order.push('check')
        return state.checkManually()
    },
}))
vi.mock('../services/communicationEvents', () => ({
    communicationEvents: {
        on: (name: string, handler: () => Promise<void>) => {
            state.handlers.set(name, handler)
            return () => state.handlers.delete(name)
        },
    },
}))
vi.mock('../services/routeFlow', () => ({
    routeFlow: {
        clear: () => state.clear(),
        start: async (...args: unknown[]) => {
            state.order.push('start')
            return state.start(...args)
        },
        isFlowActive: () => false,
    },
}))
vi.mock('../services/routerNavigation', () => ({getCurrentPath: () => '/', navigateTo: vi.fn()}))

describe('communication event listeners', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.order.length = 0
        vi.clearAllMocks()
    })

    it('answers a 426 through the updater before showing the outdated flow', async () => {
        const module = await import('../communicationEventListeners')
        module.setupCommunicationEventListeners()

        await state.handlers.get('updateRequired')?.()

        expect(state.checkManually).toHaveBeenCalledTimes(1)
        expect(state.clear).toHaveBeenCalledTimes(1)
        expect(state.start).toHaveBeenCalledWith('outdated', expect.objectContaining({onComplete: expect.any(Function)}))
        expect(state.order).toEqual(['check', 'start'])

        module.teardownCommunicationEventListeners()
    })
})
