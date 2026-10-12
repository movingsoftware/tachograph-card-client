const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maximumVersionPart = 4294967295

function decodeCanonicalBase64(value) {
    const decoded = Buffer.from(value, 'base64')
    if (!value || decoded.toString('base64') !== value) throw new Error('invalid base64')
    return decoded
}

function validateUpdaterPublicKey(value) {
    if (/secret key|private key|BEGIN .*PRIVATE KEY/i.test(value)) {
        throw new Error('Bundle updater public key must not contain secret key material.')
    }
    try {
        const decodedBytes = decodeCanonicalBase64(value)
        const decodedText = decodedBytes.toString('utf8')
        if (!Buffer.from(decodedText, 'utf8').equals(decodedBytes)) throw new Error('invalid UTF-8 minisign key')
        const lines = decodedText.split(/\r?\n/)
        if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) throw new Error('invalid minisign key')
        const key = decodeCanonicalBase64(lines[1])
        if (key.length !== 42 || key[0] !== 0x45 || key[1] !== 0x64) {
            throw new Error('unsupported minisign public key')
        }
    } catch {
        throw new Error('Bundle updater public key must be a valid Tauri minisign public key.')
    }
}

export function prepareBundleUpdaterConfig(environment, sourceVersions) {
    const required = [
        'BUNDLE_UPDATER_API_BASE_URL',
        'BUNDLE_UPDATER_APPLICATION_ID',
        'BUNDLE_UPDATER_SIGNING_KEY_ID',
        'BUNDLE_UPDATER_PUBLIC_KEY',
        'BUNDLE_APP_VERSION',
    ]
    const values = Object.fromEntries(required.map((key) => [key, environment[key]?.trim() ?? '']))
    if (required.some((key) => !values[key])) {
        throw new Error('Release updater configuration is incomplete; provide API origin, application UUID, key ID, public key, and stable version.')
    }

    let api
    try {
        api = new URL(values.BUNDLE_UPDATER_API_BASE_URL)
    } catch {
        throw new Error('Bundle updater API origin is invalid.')
    }
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || !['', '/'].includes(api.pathname)) {
        throw new Error('Bundle updater API origin must use public HTTPS.')
    }
    if (!uuid.test(values.BUNDLE_UPDATER_APPLICATION_ID)) throw new Error('Bundle updater application ID must be a UUID.')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(values.BUNDLE_UPDATER_SIGNING_KEY_ID)) throw new Error('Bundle updater signing key ID is invalid.')
    validateUpdaterPublicKey(values.BUNDLE_UPDATER_PUBLIC_KEY)
    const versionParts = stableVersion.exec(values.BUNDLE_APP_VERSION)
    if (!versionParts || versionParts.slice(1).some((part) => Number(part) > maximumVersionPart)) {
        throw new Error('Bundle application version must use stable x.y.z semantic versioning with bounded components.')
    }
    if (new Set(Object.values(sourceVersions)).size !== 1 || Object.values(sourceVersions)[0] !== values.BUNDLE_APP_VERSION) {
        throw new Error('package.json, Tauri, Cargo, and BUNDLE_APP_VERSION must use the same stable version.')
    }

    const endpoint = `${api.origin}/rest/v1/applications/${values.BUNDLE_UPDATER_APPLICATION_ID}/bundles/latest?format=tauri&target={{target}}-{{arch}}&current_version={{current_version}}`
    return {
        tauriConfig: {
            bundle: {createUpdaterArtifacts: true},
            plugins: {updater: {pubkey: values.BUNDLE_UPDATER_PUBLIC_KEY, endpoints: [endpoint]}},
        },
        frontendEnvironment: {
            VITE_APP_VERSION: values.BUNDLE_APP_VERSION,
            VITE_BUNDLE_UPDATER_ENABLED: 'true',
            VITE_BUNDLE_UPDATER_API_BASE_URL: api.origin,
            VITE_BUNDLE_UPDATER_APPLICATION_ID: values.BUNDLE_UPDATER_APPLICATION_ID,
            VITE_BUNDLE_UPDATER_SIGNING_KEY_ID: values.BUNDLE_UPDATER_SIGNING_KEY_ID,
        },
    }
}
