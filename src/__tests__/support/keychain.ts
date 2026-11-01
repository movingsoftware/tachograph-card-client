/** The arguments the native secure_store commands take. */
type SecureStoreArgs = { key: string; value: string }

/** The native secure_store commands, answered from an in-memory keychain. */
const secureStoreCommands: Record<string, (keychain: Map<string, string>, args: SecureStoreArgs) => string | null | undefined> = {
    secure_store_get: (keychain, { key }) => keychain.get(key) ?? null,
    secure_store_set: (keychain, { key, value }) => {
        keychain.set(key, value)
        return undefined
    },
    secure_store_remove: (keychain, { key }) => {
        keychain.delete(key)
        return undefined
    },
}

/** Builds a Tauri invoke double that keeps the OS credential store in memory and hands every other command to `next`. */
export const withKeychain = <Result>(
    keychain: Map<string, string>,
    next: (command: string, args?: unknown) => Result,
) => (command: string, args?: unknown): Result | Promise<string | null | undefined> => {
    const secureStore = secureStoreCommands[command]

    if (secureStore === undefined) {
        return next(command, args)
    }

    return Promise.resolve(secureStore(keychain, args as SecureStoreArgs))
}
