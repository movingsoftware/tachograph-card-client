// @vitest-environment node
import {describe, expect, it} from 'vitest'
import {BundleUpdaterConfigurationError, parseBundleUpdaterConfiguration} from '../bundleUpdaterConfig'

const completeConfig = {
    VITE_BUNDLE_UPDATER_ENABLED: 'true',
    VITE_BUNDLE_UPDATER_API_BASE_URL: 'https://api.transportklok.nl',
    VITE_BUNDLE_UPDATER_APPLICATION_ID: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
    VITE_BUNDLE_UPDATER_SIGNING_KEY_ID: 'desktop-release-2026',
}

describe('bundle updater configuration', () => {
    it('disables updater configuration when no release values are present', () => {
        expect(parseBundleUpdaterConfiguration({})).toEqual({enabled: false})
    })

    it('requires all public configuration when enabled and rejects partial values', () => {
        expect(() => parseBundleUpdaterConfiguration({...completeConfig, VITE_BUNDLE_UPDATER_SIGNING_KEY_ID: ''}))
            .toThrow(BundleUpdaterConfigurationError)
    })

    it('accepts complete HTTPS configuration without a private key', () => {
        expect(parseBundleUpdaterConfiguration(completeConfig)).toEqual({
            enabled: true,
            apiBaseUrl: 'https://api.transportklok.nl',
            applicationId: completeConfig.VITE_BUNDLE_UPDATER_APPLICATION_ID,
            signingKeyId: 'desktop-release-2026',
        })
    })

    it('rejects insecure API origins and invalid UUIDs', () => {
        expect(() => parseBundleUpdaterConfiguration({...completeConfig, VITE_BUNDLE_UPDATER_API_BASE_URL: 'http://api.transportklok.nl'})).toThrow()
        expect(() => parseBundleUpdaterConfiguration({...completeConfig, VITE_BUNDLE_UPDATER_APPLICATION_ID: 'placeholder'})).toThrow()
    })
})
