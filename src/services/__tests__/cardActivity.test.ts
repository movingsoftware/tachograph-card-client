// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'

const listeners = vi.hoisted(() => ({} as Record<string, (event: {payload: unknown}) => void>))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (event: string, callback: (event: {payload: unknown}) => void) => {
        listeners[event] = callback
        return () => undefined
    }),
}))

describe('card activity', () => {
    it('is busy while any card authenticates and idle once every card is done', async () => {
        const {isCardActivityBusy, watchCardActivity} = await import('../cardActivity')
        await watchCardActivity()
        const sync = listeners['global-cards-sync']

        expect(isCardActivityBusy()).toBe(false)
        sync({payload: {reader_name: 'Reader A', authentication: true}})
        sync({payload: {reader_name: 'Reader B', authentication: true}})
        expect(isCardActivityBusy()).toBe(true)
        sync({payload: {reader_name: 'Reader A', authentication: false}})
        expect(isCardActivityBusy()).toBe(true)
        sync({payload: {reader_name: 'Reader B', authentication: null}})
        expect(isCardActivityBusy()).toBe(false)
    })
})
