#!/usr/bin/env node
import {execFileSync} from 'node:child_process'
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const SHARED_REPOSITORY = 'transportklok/shared.js'
const SHARED_REMOTE_URL = 'https://github.com/transportklok/shared.js.git'
const COMMIT_SHA = /^[0-9a-f]{40}$/
const RELEASE_TAG = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function fail(message) {
    throw new Error(message)
}

function releaseTag(repositoryRoot) {
    let source

    try {
        source = readFileSync(join(repositoryRoot, 'release-dependencies.json'), 'utf8')
    } catch {
        fail('A release build requires committed release-dependencies.json with a stable shared.js tag.')
    }

    let dependencies

    try {
        dependencies = JSON.parse(source)
    } catch {
        fail('release-dependencies.json is not valid JSON.')
    }

    if (dependencies === null || Array.isArray(dependencies) || typeof dependencies !== 'object') {
        fail('release-dependencies.json must be an object with a shared.js stable tag.')
    }

    const tag = dependencies['shared.js']

    if (typeof tag !== 'string' || !RELEASE_TAG.test(tag)) {
        fail('release-dependencies.json must pin shared.js to a stable X.Y.Z tag.')
    }

    return tag
}

function requireContext(environment) {
    const tccSha = environment.GITHUB_SHA
    const runId = environment.GITHUB_RUN_ID
    const runAttempt = environment.GITHUB_RUN_ATTEMPT

    if (!COMMIT_SHA.test(tccSha ?? '')) {
        fail('GITHUB_SHA must be the full checked-out TCC commit.')
    }
    if (!/^[1-9]\d*$/.test(runId ?? '')) {
        fail('GITHUB_RUN_ID must identify this workflow run.')
    }
    if (!/^[1-9]\d*$/.test(runAttempt ?? '')) {
        fail('GITHUB_RUN_ATTEMPT must identify this workflow attempt.')
    }
    if (!environment.GITHUB_OUTPUT || !environment.GITHUB_STEP_SUMMARY || !environment.RUNNER_TEMP) {
        fail('GitHub output, summary, and runner temporary paths are required.')
    }

    return {tccSha, runId, runAttempt}
}

function remoteReadFailureClassification(error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr ?? '')
        : ''
    const status = stderr.match(/The requested URL returned error:\s*([1-5]\d{2})\b/i)?.[1]

    if (status) {
        return 'HTTP status ' + status
    }

    if (/\b(?:Could not resolve host|Failed to connect|Connection timed out|Connection refused|Connection reset|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b/i.test(stderr)) {
        return 'transport failure'
    }

    return 'remote failure with no HTTP status'
}

function remoteRefs(refs, token, environment) {
    const authorization = Buffer.from('x-access-token:' + token).toString('base64')
    const gitEnvironment = {
        ...environment,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + authorization,
    }

    try {
        return execFileSync('git', ['ls-remote', SHARED_REMOTE_URL, ...refs], {
            encoding: 'utf8',
            env: gitEnvironment,
            maxBuffer: 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch (error) {
        fail('Could not read shared.js source metadata from its private repository ('
            + remoteReadFailureClassification(error) + ').')
    }
}

function shaForRef(output, expectedRef, description) {
    const matches = output.split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => line.trim().split(/\s+/))
        .filter(([, ref]) => ref === expectedRef)

    if (matches.length !== 1 || !COMMIT_SHA.test(matches[0][0] ?? '')) {
        fail('The shared.js ' + description + ' did not resolve to one full commit SHA.')
    }

    return matches[0][0]
}

function resolveSharedSource(mode, repositoryRoot, environment) {
    const token = environment.CROSS_REPO_READ_TOKEN

    if (!token) {
        fail('CROSS_REPO_READ_TOKEN is required to read the private shared.js repository.')
    }

    if (mode === 'development') {
        const ref = 'refs/heads/main'
        const output = remoteRefs([ref], token, environment)

        return {repository: SHARED_REPOSITORY, ref, sha: shaForRef(output, ref, ref)}
    }

    if (mode === 'release') {
        const tag = releaseTag(repositoryRoot)
        const tagRef = 'refs/tags/' + tag
        const peeledRef = tagRef + '^{}'
        const output = remoteRefs([tagRef, peeledRef], token, environment)

        shaForRef(output, tagRef, 'annotated release tag object')
        const sha = shaForRef(output, peeledRef, 'annotated stable tag peel')

        return {repository: SHARED_REPOSITORY, ref: tagRef, sha}
    }

    fail('Shared source mode must be development or release.')
}

function writeGitHubEvidence(source, context, environment) {
    const evidence = {
        repository: source.repository,
        ref: source.ref,
        sha: source.sha,
        tcc_sha: context.tccSha,
        workflow_run_id: context.runId,
        workflow_run_attempt: context.runAttempt,
    }
    const outputs = {
        shared_source_repository: evidence.repository,
        shared_source_ref: evidence.ref,
        shared_source_sha: evidence.sha,
        tcc_source_sha: evidence.tcc_sha,
        workflow_run_id: evidence.workflow_run_id,
        workflow_run_attempt: evidence.workflow_run_attempt,
    }

    appendFileSync(environment.GITHUB_OUTPUT, Object.entries(outputs)
        .map(([name, value]) => name + '=' + value)
        .join('\n') + '\n')
    writeFileSync(join(environment.RUNNER_TEMP, 'shared-js-source.json'), JSON.stringify(evidence, null, 2) + '\n')

    const summary = [
        '### Shared.js source',
        '',
        '- Repository: ' + evidence.repository,
        '- Ref: ' + evidence.ref,
        '- Commit: ' + evidence.sha,
        '- TCC commit: ' + evidence.tcc_sha,
        '- Workflow run: ' + evidence.workflow_run_id + ' (attempt ' + evidence.workflow_run_attempt + ')',
        '',
    ].join('\n')
    appendFileSync(environment.GITHUB_STEP_SUMMARY, summary)
}

function main() {
    const mode = process.argv[2]
    const repositoryRoot = process.cwd()
    const context = requireContext(process.env)
    const source = resolveSharedSource(mode, repositoryRoot, process.env)

    writeGitHubEvidence(source, context, process.env)
    console.log('Resolved ' + source.repository + ' ' + source.ref + ' to ' + source.sha + '.')
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not resolve the shared.js source.')
    process.exitCode = 1
}

