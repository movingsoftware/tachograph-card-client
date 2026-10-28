// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'
import {createBundleUpdateGate} from '../bundleUpdateGate'

type Updater = Parameters<typeof createBundleUpdateGate>[0]['updaters'][number]

const updater = (order: string[], name: string, overrides: Partial<Record<keyof Updater, unknown>> = {}): Updater => ({
    start: vi.fn(async () => { order.push(`${name}:start`); return 'continue' as const }),
    check: vi.fn(async () => { order.push(`${name}:check`); return {status: 'no-release' as const} }),
    download: vi.fn(async () => { order.push(`${name}:download`); return {version: '2.0.0'} }),
    apply: vi.fn(async () => { order.push(`${name}:apply`); return 'relaunching' as const }),
    ...overrides,
}) as Updater

const available = {status: 'available' as const, candidate: {} as never}

describe('bundle update gate at launch', () => {
    it('checks the native bundle before the web bundle and continues when neither updates', async () => {
        const order: string[] = []
        const gate = createBundleUpdateGate({updaters: [updater(order, 'native'), updater(order, 'web')], isBusy: () => false})

        await expect(gate.atLaunch()).resolves.toBe('continue')
        expect(order).toEqual(['native:start', 'web:start'])
    })

    it('stops before the web bundle when the native update relaunches', async () => {
        const order: string[] = []
        const native = updater(order, 'native', {start: vi.fn(async () => { order.push('native:start'); return 'relaunching' })})
        const gate = createBundleUpdateGate({updaters: [native, updater(order, 'web')], isBusy: () => false})

        await expect(gate.atLaunch()).resolves.toBe('relaunching')
        expect(order).toEqual(['native:start'])
    })

    it('keeps the launch screen when the web update relaunches', async () => {
        const order: string[] = []
        const web = updater(order, 'web', {start: vi.fn(async () => 'relaunching')})

        await expect(createBundleUpdateGate({updaters: [updater(order, 'native'), web], isBusy: () => false}).atLaunch()).resolves.toBe('relaunching')
    })

    it('blocks when an install fails', async () => {
        const order: string[] = []
        const native = updater(order, 'native', {start: vi.fn().mockRejectedValue(new Error('install failed'))})

        await expect(createBundleUpdateGate({updaters: [native, updater(order, 'web')], isBusy: () => false}).atLaunch()).resolves.toBe('blocked')
        expect(order).toEqual([])
    })

    it('runs the launch check once, however often the launch flow restarts', async () => {
        const order: string[] = []
        const gate = createBundleUpdateGate({updaters: [updater(order, 'native'), updater(order, 'web')], isBusy: () => false})

        await gate.atLaunch()
        await expect(gate.atLaunch()).resolves.toBe('continue')
        expect(order).toEqual(['native:start', 'web:start'])
    })
})

describe('bundle update gate on resume', () => {
    it('checks native then web and applies the first available update while no card is busy', async () => {
        const order: string[] = []
        const web = updater(order, 'web', {check: vi.fn(async () => { order.push('web:check'); return available })})
        const gate = createBundleUpdateGate({updaters: [updater(order, 'native'), web], isBusy: () => false})

        await expect(gate.onResume()).resolves.toBe(true)
        expect(order).toEqual(['native:check', 'web:check', 'web:download', 'web:apply'])
    })

    it('does not even check while a card is busy', async () => {
        const order: string[] = []
        const gate = createBundleUpdateGate({updaters: [updater(order, 'native')], isBusy: () => true})

        await expect(gate.onResume()).resolves.toBe(false)
        expect(order).toEqual([])
    })

    it('does not download when a card became busy during the check', async () => {
        const order: string[] = []
        let busy = false
        const native = updater(order, 'native', {check: vi.fn(async () => { busy = true; return available })})
        const gate = createBundleUpdateGate({updaters: [native], isBusy: () => busy})

        await expect(gate.onResume()).resolves.toBe(false)
        expect(native.download).not.toHaveBeenCalled()
    })

    it('leaves a downloaded update for the next start when a card became busy during the download', async () => {
        let busy = false
        const order: string[] = []
        const native = updater(order, 'native', {
            check: vi.fn(async () => available),
            download: vi.fn(async () => { busy = true; return {version: '2.0.0'} }),
        })
        const gate = createBundleUpdateGate({updaters: [native], isBusy: () => busy})

        await expect(gate.onResume()).resolves.toBe(false)
        expect(native.apply).not.toHaveBeenCalled()
    })

    it('checks at most once per interval', async () => {
        const order: string[] = []
        let time = 0
        const gate = createBundleUpdateGate({updaters: [updater(order, 'native')], isBusy: () => false, resumeIntervalMs: 1000, now: () => time})

        await gate.onResume()
        time = 500
        await gate.onResume()
        time = 1000
        await gate.onResume()

        expect(order).toEqual(['native:check', 'native:check'])
    })

    it('keeps running when applying fails', async () => {
        const order: string[] = []
        const native = updater(order, 'native', {check: vi.fn(async () => available), apply: vi.fn().mockRejectedValue(new Error('relaunch failed'))})

        await expect(createBundleUpdateGate({updaters: [native], isBusy: () => false}).onResume()).resolves.toBe(false)
    })

    it('keeps running when installing the update fails', async () => {
        const order: string[] = []
        const native = updater(order, 'native', {check: vi.fn(async () => available), download: vi.fn().mockRejectedValue(new Error('install failed'))})

        await expect(createBundleUpdateGate({updaters: [native], isBusy: () => false}).onResume()).resolves.toBe(false)
        expect(native.apply).not.toHaveBeenCalled()
    })

    it('reports no update when there was nothing staged to apply', async () => {
        const order: string[] = []
        const native = updater(order, 'native', {check: vi.fn(async () => available), apply: vi.fn(async () => 'continue' as const)})

        await expect(createBundleUpdateGate({updaters: [native], isBusy: () => false}).onResume()).resolves.toBe(false)
    })
})
