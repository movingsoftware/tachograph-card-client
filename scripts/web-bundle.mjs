#!/usr/bin/env node
// Writes the Platform ingress manifest for a signed web bundle zip, reaching the native shells from native-baseline.json up to this release.
//
//   node scripts/web-bundle.mjs --zip FILE --signature FILE --output FILE --application-id UUID --version X.Y.Z
//       --release-notes TEXT --signing-key-id ID --source-revision SHA --shared-source-revision SHA --run-id N --run-attempt N
//
// Prints {"manifest_key","artifact_key","raw_manifest_sha256"} for the upload and the import.

import {createHash} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import {basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateApplicationVersion} from './set-application-version.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const revision = /^[a-f0-9]{40}$/
const flags = ['zip', 'signature', 'output', 'application-id', 'version', 'release-notes', 'signing-key-id', 'source-revision', 'shared-source-revision', 'run-id', 'run-attempt']

// Compares two stable versions.
function compareVersions(left, right) {
    const [a, b] = [left, right].map((version) => version.split('.').map(Number))
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// The native shells a web bundle of this version may reach: from the baseline up to this release.
export function nativeRange(baselineTag, version) {
    validateApplicationVersion(baselineTag)
    validateApplicationVersion(version)
    if (compareVersions(baselineTag, version) > 0) {
        throw new Error(`native-baseline.json starts at ${baselineTag}, above this release ${version}.`)
    }
    return {native_min: baselineTag, native_max: version}
}

// The ingress manifest of one web bundle, with its object keys and the raw manifest bytes.
export function webBundleManifest(options, zip, signature, baselineTag) {
    if (!uuid.test(options['application-id'])) throw new Error('The application id must be a UUID.')
    if (!revision.test(options['source-revision']) || !revision.test(options['shared-source-revision'])) {
        throw new Error('The source revisions must be full commit SHAs.')
    }
    if (!/^[0-9]+$/.test(options['run-id']) || !/^[1-9][0-9]*$/.test(options['run-attempt'])) {
        throw new Error('The run id and attempt must be whole numbers.')
    }
    if (!options['release-notes'].trim()) throw new Error('The release notes are empty.')
    const range = nativeRange(baselineTag, options.version)
    const prefix = `application-bundles/ingress/${options['application-id']}/run-${options['run-id']}-attempt-${options['run-attempt']}`
    const fileName = `tcc-web-${options.version}.zip`
    const artifactKey = `${prefix}/artifacts/web/web/${fileName}`
    const manifest = {
        schema_version: 1,
        application_id: options['application-id'],
        version: options.version,
        release_notes: options['release-notes'],
        expected_artifacts: [{target: 'web', kind: 'web'}],
        artifacts: [{
            target: 'web',
            kind: 'web',
            format: 'zip',
            file_name: fileName,
            content_type: 'application/zip',
            size_bytes: zip.length,
            sha256: createHash('sha256').update(zip).digest('hex'),
            signature: signature.trim(),
            signing_key_id: options['signing-key-id'],
            source_key: artifactKey,
        }],
        source_repository: 'movingsoftware/tachograph-card-client',
        source_revision: options['source-revision'],
        shared_source_revision: options['shared-source-revision'],
        workflow_run_id: options['run-id'],
        workflow_attempt: Number(options['run-attempt']),
        ...range,
    }
    const raw = `${JSON.stringify(manifest)}\n`
    return {
        manifest,
        raw,
        manifest_key: `${prefix}/manifest.json`,
        artifact_key: artifactKey,
        raw_manifest_sha256: createHash('sha256').update(raw).digest('hex'),
    }
}

// The options given on the command line; every one is required.
function parseArgs(argv) {
    const options = {}
    for (let index = 0; index < argv.length; index += 2) {
        const [flag, value] = [argv[index], argv[index + 1]]
        if (!flag.startsWith('--') || !flags.includes(flag.slice(2)) || value === undefined) {
            throw new Error(`Unknown or incomplete option '${flag}'.`)
        }
        options[flag.slice(2)] = value
    }
    const missing = flags.filter((flag) => !options[flag])
    if (missing.length) throw new Error(`Missing --${missing.join(', --')}.`)
    return options
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const options = parseArgs(process.argv.slice(2))
    const baseline = JSON.parse(readFileSync(process.env.NATIVE_BASELINE_FILE ?? `${root}native-baseline.json`, 'utf8'))
    const result = webBundleManifest(options, readFileSync(options.zip), readFileSync(options.signature, 'utf8'), baseline.baseline_tag)
    if (basename(options.zip) !== result.manifest.artifacts[0].file_name) {
        throw new Error(`Name the zip ${result.manifest.artifacts[0].file_name}.`)
    }
    writeFileSync(options.output, result.raw)
    console.log(JSON.stringify({manifest_key: result.manifest_key, artifact_key: result.artifact_key, raw_manifest_sha256: result.raw_manifest_sha256}))
}
