// @vitest-environment node
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {nativeRange, webBundleManifest} from '../../scripts/web-bundle.mjs'

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'web-bundle.mjs')
const signature = Buffer.from('untrusted comment: signature\nRWQ=\ntrusted comment: t\nAA==\n').toString('base64')
const options = {
    'application-id': 'c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7',
    version: '0.8.3',
    'release-notes': 'Kaartlezer sneller',
    'signing-key-id': 'tcc-updates-2026',
    'source-revision': 'a'.repeat(40),
    'shared-source-revision': 'b'.repeat(40),
    'run-id': '123',
    'run-attempt': '2',
}
const prefix = 'application-bundles/ingress/c86b7a60-9ef2-4ba8-b4d1-42ef6346ecb7/run-123-attempt-2'

let dir: string

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tcc-web-bundle-'))
})

afterEach(() => rmSync(dir, {recursive: true, force: true}))

describe('nativeRange', () => {
    it('reaches the shells from the native baseline up to this release', () => {
        expect(nativeRange('0.8.0', '0.8.3')).toEqual({native_min: '0.8.0', native_max: '0.8.3'})
        expect(nativeRange('0.8.0', '0.10.0')).toEqual({native_min: '0.8.0', native_max: '0.10.0'})
    })

    it('refuses a baseline above the release', () => {
        expect(() => nativeRange('0.9.0', '0.8.3')).toThrow(/above this release/)
    })
})

describe('webBundleManifest', () => {
    it('writes one signed web zip with the native range and ingress keys Platform imports', () => {
        const zip = Buffer.from('zip bytes')

        const result = webBundleManifest(options, zip, `${signature}\n`, '0.8.0')

        expect(result.manifest_key).toBe(`${prefix}/manifest.json`)
        expect(result.artifact_key).toBe(`${prefix}/artifacts/web/web/tcc-web-0.8.3.zip`)
        expect(result.manifest).toEqual({
            schema_version: 1,
            application_id: options['application-id'],
            version: '0.8.3',
            release_notes: 'Kaartlezer sneller',
            expected_artifacts: [{target: 'web', kind: 'web'}],
            artifacts: [{
                target: 'web',
                kind: 'web',
                format: 'zip',
                file_name: 'tcc-web-0.8.3.zip',
                content_type: 'application/zip',
                size_bytes: zip.length,
                sha256: createHash('sha256').update(zip).digest('hex'),
                signature,
                signing_key_id: 'tcc-updates-2026',
                source_key: result.artifact_key,
            }],
            source_repository: 'movingsoftware/tachograph-card-client',
            source_revision: 'a'.repeat(40),
            shared_source_revision: 'b'.repeat(40),
            workflow_run_id: '123',
            workflow_attempt: 2,
            native_min: '0.8.0',
            native_max: '0.8.3',
        })
        expect(result.raw_manifest_sha256).toBe(createHash('sha256').update(result.raw).digest('hex'))
    })

    it('refuses malformed identities', () => {
        const zip = Buffer.from('zip')

        expect(() => webBundleManifest({...options, 'application-id': 'tcc'}, zip, signature, '0.8.0')).toThrow(/UUID/)
        expect(() => webBundleManifest({...options, 'source-revision': 'main'}, zip, signature, '0.8.0')).toThrow(/commit SHAs/)
        expect(() => webBundleManifest({...options, 'release-notes': ' '}, zip, signature, '0.8.0')).toThrow(/release notes/)
    })
})

describe('web-bundle.mjs', () => {
    function run(zipName: string) {
        const zip = join(dir, zipName)
        writeFileSync(zip, 'zip bytes')
        writeFileSync(`${zip}.sig`, signature)
        writeFileSync(join(dir, 'native-baseline.json'), JSON.stringify({baseline_tag: '0.8.0'}))
        const args = Object.entries(options).flatMap(([flag, value]) => [`--${flag}`, value])
        return spawnSync('node', [SCRIPT, '--zip', zip, '--signature', `${zip}.sig`, '--output', join(dir, 'manifest.json'), ...args], {
            encoding: 'utf8',
            env: {...process.env, NATIVE_BASELINE_FILE: join(dir, 'native-baseline.json')},
        })
    }

    it('writes the manifest file and prints the keys and the raw sha256', () => {
        const result = run('tcc-web-0.8.3.zip')

        expect(result.status).toBe(0)
        const raw = readFileSync(join(dir, 'manifest.json'))
        expect(JSON.parse(result.stdout)).toEqual({
            manifest_key: `${prefix}/manifest.json`,
            artifact_key: `${prefix}/artifacts/web/web/tcc-web-0.8.3.zip`,
            raw_manifest_sha256: createHash('sha256').update(raw).digest('hex'),
        })
        expect(JSON.parse(raw.toString()).native_min).toBe('0.8.0')
    })

    it('refuses a zip not named after the release', () => {
        const result = run('bundle.zip')

        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('tcc-web-0.8.3.zip')
    })
})
