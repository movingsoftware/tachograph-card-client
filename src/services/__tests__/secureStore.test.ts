import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { readSecret, writeSecret } from '../secureStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const native = vi.mocked(invoke)

describe('secureStore', () => {
    beforeEach(() => {
        localStorage.clear()
        native.mockReset()
    })

    it('reads a stored secret and drops a leftover localStorage copy', async () => {
        native.mockResolvedValueOnce('from-keychain')
        localStorage.setItem('token', 'legacy')

        await expect(readSecret('token')).resolves.toBe('from-keychain')

        expect(native).toHaveBeenCalledWith('secure_store_get', { key: 'token' })
        expect(localStorage.getItem('token')).toBeNull()
    })

    it('moves a legacy localStorage secret into the credential store', async () => {
        native.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined)
        localStorage.setItem('token', 'legacy')

        await expect(readSecret('token')).resolves.toBe('legacy')

        expect(native).toHaveBeenLastCalledWith('secure_store_set', { key: 'token', value: 'legacy' })
        expect(localStorage.getItem('token')).toBeNull()
    })

    it('answers nothing when neither store holds the secret', async () => {
        native.mockResolvedValueOnce(null)

        await expect(readSecret('token')).resolves.toBeNull()

        expect(native).toHaveBeenCalledTimes(1)
    })

    it('writes a secret to the credential store only', async () => {
        localStorage.setItem('token', 'legacy')

        await writeSecret('token', 'fresh')

        expect(native).toHaveBeenCalledWith('secure_store_set', { key: 'token', value: 'fresh' })
        expect(localStorage.getItem('token')).toBeNull()
    })

    it('removes a cleared secret from both stores', async () => {
        localStorage.setItem('token', 'legacy')

        await writeSecret('token', null)

        expect(native).toHaveBeenCalledWith('secure_store_remove', { key: 'token' })
        expect(localStorage.getItem('token')).toBeNull()
    })

    it('keeps the localStorage copy when the credential store refuses the write', async () => {
        native.mockRejectedValueOnce(new Error('locked'))
        localStorage.setItem('token', 'legacy')

        await expect(writeSecret('token', 'fresh')).rejects.toThrow('locked')

        expect(localStorage.getItem('token')).toBe('legacy')
    })
})
