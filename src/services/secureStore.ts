import { invoke } from '@tauri-apps/api/core'

/**
 * Reads a secret from the OS credential store, moving a legacy localStorage copy there first.
 */
export async function readSecret(key: string): Promise<string | null> {
    const stored = await invoke<string | null>('secure_store_get', { key })
    const legacy = localStorage.getItem(key)

    if (stored !== null) {
        localStorage.removeItem(key)
        return stored
    }

    if (legacy === null) {
        return null
    }

    await invoke('secure_store_set', { key, value: legacy })
    localStorage.removeItem(key)

    return legacy
}

/**
 * Stores or clears a secret in the OS credential store and drops any localStorage copy.
 */
export async function writeSecret(key: string, value: string | null): Promise<void> {
    if (value === null) {
        await invoke('secure_store_remove', { key })
    } else {
        await invoke('secure_store_set', { key, value })
    }

    localStorage.removeItem(key)
}

/**
 * Persists a secret in the background and reports a failure without blocking the UI.
 */
export function persistSecret(key: string, value: string | null): void {
    writeSecret(key, value).catch((error: unknown) => {
        console.error(`Kon ${key} niet veilig opslaan`, error)
    })
}
