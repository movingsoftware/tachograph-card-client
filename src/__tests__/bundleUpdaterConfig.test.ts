// @vitest-environment node
import {describe, expect, it} from 'vitest'
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {prepareBundleUpdaterConfig} from '../../scripts/prepare-bundle-updater-config.mjs'
import {parseReleaseBuildArguments} from '../../scripts/release-build-arguments.mjs'
import {synchronizeApplicationVersion, validateApplicationVersion} from '../../scripts/set-application-version.mjs'

const environment = {
    BUNDLE_UPDATER_API_BASE_URL: 'https://api.transportklok.nl',
    BUNDLE_UPDATER_APPLICATION_ID: 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
    BUNDLE_UPDATER_SIGNING_KEY_ID: 'desktop-release-2026',
    BUNDLE_UPDATER_PUBLIC_KEY: Buffer.from(`untrusted comment: test public key\n${Buffer.concat([Buffer.from([0x45, 0x64]), Buffer.alloc(40, 1)]).toString('base64')}`).toString('base64'),
    BUNDLE_APP_VERSION: '0.7.0',
}
const versions = {package: '0.7.0', tauri: '0.7.0', cargo: '0.7.0'}

describe('release updater config preparation', () => {
    it('builds the Tauri endpoint and frontend config from the same explicit release inputs', () => {
        const result = prepareBundleUpdaterConfig(environment, versions)
        expect(result.tauriConfig.plugins.updater.endpoints[0]).toBe(
            'https://api.transportklok.nl/rest/v1/applications/c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7/bundles/latest?format=tauri&target={{target}}-{{arch}}&current_version={{current_version}}',
        )
        expect(result.tauriConfig.plugins.updater.pubkey).toBe(environment.BUNDLE_UPDATER_PUBLIC_KEY)
        expect(result.tauriConfig.bundle.createUpdaterArtifacts).toBe(true)
        expect(result.frontendEnvironment.VITE_BUNDLE_UPDATER_SIGNING_KEY_ID).toBe(environment.BUNDLE_UPDATER_SIGNING_KEY_ID)
    })

    it('fails closed on missing release configuration, invalid origin, or mismatched source versions', () => {
        expect(() => prepareBundleUpdaterConfig({}, versions)).toThrow(/incomplete/)
        expect(() => prepareBundleUpdaterConfig({...environment, BUNDLE_UPDATER_API_BASE_URL: 'http://api.transportklok.nl'}, versions)).toThrow(/HTTPS/)
        expect(() => prepareBundleUpdaterConfig(environment, {...versions, cargo: '0.6.0'})).toThrow(/same stable version/)
        expect(() => prepareBundleUpdaterConfig({...environment, BUNDLE_UPDATER_PUBLIC_KEY: ''}, versions)).toThrow(/incomplete/)
        expect(() => prepareBundleUpdaterConfig({...environment, BUNDLE_UPDATER_PUBLIC_KEY: 'placeholder-key'}, versions)).toThrow(/valid Tauri minisign/)
        expect(() => prepareBundleUpdaterConfig({...environment, BUNDLE_UPDATER_PUBLIC_KEY: 'secret key data'}, versions)).toThrow(/secret key material/)
        expect(() => prepareBundleUpdaterConfig({...environment, BUNDLE_APP_VERSION: '4294967296.0.0'}, {
            package: '4294967296.0.0',
            tauri: '4294967296.0.0',
            cargo: '4294967296.0.0',
        })).toThrow(/bounded components/)
    })

    it('validates version components and forwards target and bundle matrix arguments', () => {
        expect(validateApplicationVersion('4294967295.0.1')).toBe('4294967295.0.1')
        expect(() => validateApplicationVersion('4294967296.0.1')).toThrow(/bounded/)
        expect(parseReleaseBuildArguments(['--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg'])).toEqual([
            '--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg',
        ])
        expect(parseReleaseBuildArguments(['--target=x86_64-pc-windows-msvc'])).toEqual(['--target', 'x86_64-pc-windows-msvc'])
        expect(() => parseReleaseBuildArguments(['--target'])).toThrow(/requires a value/)
        expect(() => parseReleaseBuildArguments(['--target', 'aarch64-apple-darwin;whoami'])).toThrow(/Unsupported release target/)
        expect(() => parseReleaseBuildArguments(['--bundles', 'dmg,unknown'])).toThrow(/Unsupported release bundle format/)
        expect(() => parseReleaseBuildArguments(['--target', 'aarch64-apple-darwin', '--target', 'x86_64-apple-darwin'])).toThrow(/only once/)
    })

    it('synchronizes only the application versions across package, Tauri, Cargo, and their locks', async () => {
        const root = await mkdtemp(join(tmpdir(), 'bundle-version-test-'))
        const nativeDirectory = join(root, 'src-tauri')
        await mkdir(nativeDirectory)
        try {
            await writeFile(join(root, 'package.json'), JSON.stringify({version: '0.7.0', name: 'client'}))
            await writeFile(join(root, 'package-lock.json'), JSON.stringify({
                version: '0.7.0',
                packages: {'': {name: 'client', version: '0.7.0'}, 'node_modules/unchanged': {version: '1.0.0'}},
            }))
            await writeFile(join(nativeDirectory, 'tauri.conf.json'), JSON.stringify({version: '0.7.0', productName: 'client'}))
            await writeFile(join(nativeDirectory, 'Cargo.toml'), '[package]\nname = "tacho-bridge-application"\nversion = "0.7.0"\n')
            await writeFile(join(nativeDirectory, 'Cargo.lock'), '[[package]]\nname = "tacho-bridge-application"\nversion = "0.7.0"\n')

            await synchronizeApplicationVersion(root, '1.2.3')

            expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version).toBe('1.2.3')
            const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
            expect(packageLock.version).toBe('1.2.3')
            expect(packageLock.packages[''].version).toBe('1.2.3')
            expect(packageLock.packages['node_modules/unchanged'].version).toBe('1.0.0')
            expect(JSON.parse(await readFile(join(nativeDirectory, 'tauri.conf.json'), 'utf8')).version).toBe('1.2.3')
            expect(await readFile(join(nativeDirectory, 'Cargo.toml'), 'utf8')).toContain('version = "1.2.3"')
            expect(await readFile(join(nativeDirectory, 'Cargo.lock'), 'utf8')).toContain('version = "1.2.3"')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })
})
