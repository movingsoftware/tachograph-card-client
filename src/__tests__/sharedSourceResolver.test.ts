// @vitest-environment node
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const RESOLVER = resolve(ROOT, 'scripts/resolve-shared-js-source.mjs')
const SHARED_MAIN_SHA = '8a3180913e94efa95af5abe9ab7ce77792207ebc'
const TCC_SHA = 'a'.repeat(40)

type ResolverOptions = {
    gitResponse?: string
    gitExitCode?: string
    releaseDependencies?: string | null
    token?: string
}

let directory: string
let repositoryRoot: string
let binDirectory: string
let runnerTemp: string
let gitArgumentsFile: string

beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tcc-shared-source-'))
    repositoryRoot = join(directory, 'repository')
    binDirectory = join(directory, 'bin')
    runnerTemp = join(directory, 'runner-temp')
    gitArgumentsFile = join(directory, 'git-arguments.json')
    mkdirSync(repositoryRoot)
    mkdirSync(binDirectory)
    mkdirSync(runnerTemp)
    writeFileSync(gitArgumentsFile, '')

    const fakeGit = [
        '#!/usr/bin/env node',
        "import {appendFileSync} from 'node:fs'",
        "appendFileSync(process.env.GIT_ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)))",
        "if (process.env.GIT_EXIT_CODE !== '0') process.exit(Number(process.env.GIT_EXIT_CODE))",
        "process.stdout.write(process.env.GIT_RESPONSE ?? '')",
    ].join('\n')
    const fakeGitPath = join(binDirectory, 'git')
    writeFileSync(fakeGitPath, fakeGit)
    chmodSync(fakeGitPath, 0o755)
})

afterEach(() => rmSync(directory, {recursive: true, force: true}))

function resolveSource(mode: 'development' | 'release', options: ResolverOptions = {}) {
    const outputPath = join(directory, 'github-output')
    const summaryPath = join(directory, 'step-summary.md')
    writeFileSync(outputPath, '')
    writeFileSync(summaryPath, '')

    if (options.releaseDependencies !== undefined && options.releaseDependencies !== null) {
        writeFileSync(join(repositoryRoot, 'release-dependencies.json'), options.releaseDependencies)
    }

    const result = spawnSync(process.execPath, [RESOLVER, mode], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: binDirectory + ':' + (process.env.PATH ?? ''),
            CROSS_REPO_READ_TOKEN: options.token ?? 'unit-test-only-value',
            GITHUB_SHA: TCC_SHA,
            GITHUB_RUN_ID: '123456789',
            GITHUB_RUN_ATTEMPT: '2',
            GITHUB_OUTPUT: outputPath,
            GITHUB_STEP_SUMMARY: summaryPath,
            RUNNER_TEMP: runnerTemp,
            GIT_ARGUMENTS_FILE: gitArgumentsFile,
            GIT_RESPONSE: options.gitResponse ?? '',
            GIT_EXIT_CODE: options.gitExitCode ?? '0',
        },
    })

    return {
        ...result,
        output: readFileSync(outputPath, 'utf8'),
        summary: readFileSync(summaryPath, 'utf8'),
        gitArguments: readFileSync(gitArgumentsFile, 'utf8'),
        evidencePath: join(runnerTemp, 'shared-js-source.json'),
        evidenceExists: existsSync(join(runnerTemp, 'shared-js-source.json')),
    }
}

describe('resolve-shared-js-source.mjs', () => {
    it('resolves development builds from shared.js main and records immutable evidence', () => {
        const result = resolveSource('development', {
            gitResponse: SHARED_MAIN_SHA + '\trefs/heads/main\n',
        })

        expect(result.status).toBe(0)
        expect(JSON.parse(result.gitArguments)).toEqual([
            'ls-remote',
            'https://github.com/transportklok/shared.js.git',
            'refs/heads/main',
        ])
        expect(result.output).toContain('shared_source_ref=refs/heads/main\n')
        expect(result.output).toContain('shared_source_sha=' + SHARED_MAIN_SHA + '\n')
        expect(result.output).toContain('tcc_source_sha=' + TCC_SHA + '\n')
        expect(result.output).toContain('workflow_run_id=123456789\n')
        expect(result.output).toContain('workflow_run_attempt=2\n')
        expect(result.summary).toContain('refs/heads/main')
        expect(result.summary).toContain(SHARED_MAIN_SHA)
        expect(result.evidenceExists).toBe(true)
        expect(JSON.parse(readFileSync(result.evidencePath, 'utf8'))).toEqual({
            repository: 'transportklok/shared.js',
            ref: 'refs/heads/main',
            sha: SHARED_MAIN_SHA,
            tcc_sha: TCC_SHA,
            workflow_run_id: '123456789',
            workflow_run_attempt: '2',
        })
    })

    it('peels the committed stable release tag to its exact commit SHA', () => {
        const tagObjectSha = 'b'.repeat(40)
        const commitSha = 'c'.repeat(40)
        const tag = '1.5.0'
        const result = resolveSource('release', {
            releaseDependencies: JSON.stringify({'shared.js': tag}),
            gitResponse: tagObjectSha + '\trefs/tags/' + tag + '\n'
                + commitSha + '\trefs/tags/' + tag + '^{}\n',
        })

        expect(result.status).toBe(0)
        expect(JSON.parse(result.gitArguments)).toEqual([
            'ls-remote',
            'https://github.com/transportklok/shared.js.git',
            'refs/tags/' + tag,
            'refs/tags/' + tag + '^{}',
        ])
        expect(result.output).toContain('shared_source_ref=refs/tags/' + tag + '\n')
        expect(result.output).toContain('shared_source_sha=' + commitSha + '\n')
        expect(result.output).not.toContain(tagObjectSha)
        expect(result.summary).toContain('Workflow run: 123456789 (attempt 2)')
        expect(JSON.parse(readFileSync(result.evidencePath, 'utf8'))).toEqual({
            repository: 'transportklok/shared.js',
            ref: 'refs/tags/' + tag,
            sha: commitSha,
            tcc_sha: TCC_SHA,
            workflow_run_id: '123456789',
            workflow_run_attempt: '2',
        })
    })

    it.each([
        ['missing file', null],
        ['malformed JSON', '{'],
        ['missing shared.js pin', '{}'],
        ['branch name', JSON.stringify({'shared.js': 'main'})],
        ['prerelease tag', JSON.stringify({'shared.js': '1.5.0-rc.1'})],
        ['prefixed tag', JSON.stringify({'shared.js': 'v1.5.0'})],
    ] as const)('fails closed for %s release metadata', (_name, metadata) => {
        const result = resolveSource('release', {
            releaseDependencies: metadata,
            gitResponse: 'b'.repeat(40) + '\trefs/tags/1.5.0\n',
        })

        expect(result.status).not.toBe(0)
        expect(result.output).toBe('')
        expect(result.gitArguments).toBe('')
        expect(result.stderr).toMatch(/release-dependencies\.json/)
    })

    it('fails closed when the development main ref is missing or malformed', () => {
        for (const gitResponse of ['', 'not-a-sha\trefs/heads/main\n']) {
            const result = resolveSource('development', {gitResponse})

            expect(result.status).not.toBe(0)
            expect(result.stderr).toMatch(/refs\/heads\/main/)
            expect(result.evidenceExists).toBe(false)
        }
    })

    it('fails closed when the stable tag has no annotated-tag peel', () => {
        const tag = '1.5.0'
        const result = resolveSource('release', {
            releaseDependencies: JSON.stringify({'shared.js': tag}),
            gitResponse: 'b'.repeat(40) + '\trefs/tags/' + tag + '\n',
        })

        expect(result.status).not.toBe(0)
        expect(result.stderr).toMatch(/annotated stable tag/)
        expect(result.evidenceExists).toBe(false)
    })

    it('fails closed when the private shared.js ref cannot be read', () => {
        const result = resolveSource('development', {gitExitCode: '128'})

        expect(result.status).not.toBe(0)
        expect(result.stderr).toMatch(/Could not read shared\.js/)
        expect(result.output).toBe('')
    })

    it('requires the existing cross-repository read secret without printing it', () => {
        const result = resolveSource('development', {token: ''})

        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('CROSS_REPO_READ_TOKEN')
        expect(result.stdout).not.toContain('unit-test-only-value')
        expect(result.gitArguments).toBe('')
    })

    it('keeps the configured read credential out of command arguments and diagnostics', () => {
        const token = 'test-secret-that-must-not-be-printed'
        const result = resolveSource('development', {token, gitExitCode: '128'})

        expect(result.status).not.toBe(0)
        expect(result.gitArguments).not.toContain(token)
        expect(result.stdout).not.toContain(token)
        expect(result.stderr).not.toContain(token)
    })
})

