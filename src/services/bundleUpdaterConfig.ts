export type BundleUpdaterConfiguration =
    | {readonly enabled: false}
    | {
        readonly enabled: true
        readonly apiBaseUrl: string
        readonly applicationId: string
        readonly signingKeyId: string
    }

export class BundleUpdaterConfigurationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BundleUpdaterConfigurationError'
    }
}

const requiredKeys = [
    'VITE_BUNDLE_UPDATER_API_BASE_URL',
    'VITE_BUNDLE_UPDATER_APPLICATION_ID',
    'VITE_BUNDLE_UPDATER_SIGNING_KEY_ID',
] as const

const requiredValue = (value: string | undefined, key: string): string => {
    const normalized = value?.trim()
    if (!normalized) throw new BundleUpdaterConfigurationError(`Bundle updater configuration is missing ${key}.`)
    return normalized
}

export const parseBundleUpdaterConfiguration = (
    environment: Record<string, string | undefined>,
): BundleUpdaterConfiguration => {
    const apiBaseUrlValue = environment[requiredKeys[0]]?.trim()
    const applicationIdValue = environment[requiredKeys[1]]?.trim()
    const signingKeyIdValue = environment[requiredKeys[2]]?.trim()
    const configuredCount = [apiBaseUrlValue, applicationIdValue, signingKeyIdValue].filter(Boolean).length
    const enabledSetting = environment.VITE_BUNDLE_UPDATER_ENABLED?.trim()
    if (enabledSetting && enabledSetting !== 'true' && enabledSetting !== 'false') {
        throw new BundleUpdaterConfigurationError('The bundle updater enabled flag must be true or false.')
    }
    if (enabledSetting === 'false' && configuredCount === 0) return {enabled: false}
    if (configuredCount === 0 && enabledSetting !== 'true') return {enabled: false}
    if (configuredCount !== requiredKeys.length || enabledSetting === 'false') {
        throw new BundleUpdaterConfigurationError('Bundle updater configuration is incomplete.')
    }

    const apiBaseUrl = requiredValue(apiBaseUrlValue, requiredKeys[0])
    const applicationId = requiredValue(applicationIdValue, requiredKeys[1])
    const signingKeyId = requiredValue(signingKeyIdValue, requiredKeys[2])
    let api: URL
    try {
        api = new URL(apiBaseUrl)
    } catch {
        throw new BundleUpdaterConfigurationError('Bundle updater API URL is invalid.')
    }
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || !['', '/'].includes(api.pathname)) {
        throw new BundleUpdaterConfigurationError('Bundle updater API URL must be a public HTTPS origin.')
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
        throw new BundleUpdaterConfigurationError('Bundle updater application ID must be a UUID.')
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(signingKeyId)) {
        throw new BundleUpdaterConfigurationError('Bundle updater signing key ID is invalid.')
    }
    return {enabled: true, apiBaseUrl: api.origin, applicationId, signingKeyId}
}

export const getBundleUpdaterConfiguration = (): BundleUpdaterConfiguration => parseBundleUpdaterConfiguration(import.meta.env)
