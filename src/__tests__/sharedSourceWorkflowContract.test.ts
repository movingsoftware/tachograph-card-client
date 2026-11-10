// @vitest-environment node
import {readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')
const MANUAL_SHA_VARIABLE = ['SHARED', 'JS', 'SOURCE', 'REVISION'].join('_')

type WorkflowStep = {
    id?: string
    name?: string
    uses?: string
    run?: string
    with?: Record<string, string>
    env?: Record<string, string>
}
type WorkflowJob = {
    environment?: string
    env?: Record<string, string>
    needs?: string | string[]
    outputs?: Record<string, string>
    steps: WorkflowStep[]
    strategy?: {matrix?: {include?: Array<Record<string, string>>}}
}
type WorkflowDocument = {
    on: {
        push?: {branches?: string[]; tags?: string[]}
        pull_request?: {paths?: string[]}
        workflow_dispatch?: {inputs?: Record<string, {options?: string[]; required?: boolean}>}
    }
    jobs: Record<string, WorkflowJob>
}

function readWorkflow(name: string) {
    const source = readFileSync(join(WORKFLOWS, name), 'utf8')
    return {source, workflow: load(source) as WorkflowDocument}
}

function findStep(job: WorkflowJob, name: string) {
    const step = job.steps.find((candidate) => candidate.name === name)
    expect(step, 'workflow step ' + name).toBeDefined()
    return step!
}

function sharedCheckout(job: WorkflowJob) {
    const step = job.steps.find((candidate) => candidate.uses === 'actions/checkout@v4'
        && candidate.with?.repository === 'transportklok/shared.js')
    expect(step, 'shared.js checkout').toBeDefined()
    return step!
}

function expression(value: string) {
    return '$' + '{{ ' + value + ' }}'
}

describe('TCC shared.js source workflow contract', () => {
    const macos = readWorkflow('macos-signed-build.yml')
    const publish = readWorkflow('publish-application-bundles.yml')
    const release = readWorkflow('release.yml')

    it('uses the one resolver and exact resolved SHA in all three workflows', () => {
        const macosResolver = findStep(macos.workflow.jobs.build, 'Resolve shared.js source')
        const releaseResolver = findStep(publish.workflow.jobs.release, 'Resolve shared.js source')
        const installerResolver = findStep(release.workflow.jobs.resolve_shared_source, 'Resolve shared.js source')

        expect(macosResolver.id).toBe('shared')
        expect(macosResolver.run).toContain('scripts/resolve-shared-js-source.mjs')
        expect(releaseResolver.id).toBe('shared')
        expect(releaseResolver.run).toContain('scripts/resolve-shared-js-source.mjs release')
        expect(installerResolver.id).toBe('shared')
        expect(installerResolver.run).toContain('scripts/resolve-shared-js-source.mjs release')

        expect(sharedCheckout(macos.workflow.jobs.build).with?.ref)
            .toBe(expression('steps.shared.outputs.shared_source_sha'))
        expect(sharedCheckout(publish.workflow.jobs.web).with?.ref)
            .toBe(expression('needs.release.outputs.shared_source_sha'))
        expect(sharedCheckout(release.workflow.jobs['publish-tauri']).with?.ref)
            .toBe(expression('needs.resolve_shared_source.outputs.shared_source_sha'))

        expect(findStep(macos.workflow.jobs.build, 'Checkout TCC').with?.ref).toBe(expression('github.sha'))
        expect(findStep(publish.workflow.jobs.web, 'Checkout TCC').with?.ref)
            .toBe(expression('needs.release.outputs.tcc_source_sha'))
        expect(findStep(release.workflow.jobs['publish-tauri'], 'Checkout TCC').with?.ref)
            .toBe(expression('needs.resolve_shared_source.outputs.tcc_source_sha'))

        for (const job of [
            macos.workflow.jobs.build,
            publish.workflow.jobs.web,
            release.workflow.jobs['publish-tauri'],
        ]) {
            const verify = job.steps.find((step) => step.name === 'Verify exact shared.js commit')
            const verifyTcc = job.steps.find((step) => step.name === 'Verify checked-out TCC revision'
                || step.name === 'Verify exact TCC revision')
            expect(verify?.run).toContain('git -C shared.js rev-parse HEAD')
            expect(verify?.env?.EXPECTED_SHARED_SHA).toBeDefined()
            expect(verifyTcc?.run).toContain('rev-parse HEAD')
            expect(verifyTcc?.env?.EXPECTED_TCC_SHA).toBeDefined()
        }

        for (const job of [
            macos.workflow.jobs.build,
            publish.workflow.jobs.release,
            release.workflow.jobs.resolve_shared_source,
        ]) {
            const sourceEvidence = job.steps.find((step) => step.uses === 'actions/upload-artifact@v4'
                && step.with?.name === 'shared-js-source')
            expect(sourceEvidence?.with?.path).toContain('shared-js-source.json')
        }
    })

    it('selects main for development PRs into main and release pins for tagged installer work', () => {
        const mode = findStep(macos.workflow.jobs.build, 'Choose shared.js source mode')

        expect(mode.run).toContain('GITHUB_EVENT_NAME')
        expect(mode.run).toContain('GITHUB_BASE_REF')
        expect(mode.run).toContain('GITHUB_REF_TYPE')
        expect(mode.run).toContain('development')
        expect(mode.run).toContain('release')
        expect(findStep(macos.workflow.jobs.build, 'Resolve shared.js source').run)
            .toContain('node scripts/resolve-shared-js-source.mjs "$SHARED_SOURCE_MODE"')
        expect(findStep(release.workflow.jobs.resolve_shared_source, 'Resolve shared.js source').run)
            .toContain('scripts/resolve-shared-js-source.mjs release')
    })

    it('keeps release identity, protected signing environments, and channel-only actions', () => {
        const releaseGuard = findStep(publish.workflow.jobs.release, 'Check the tag is on main and equals package.json')
        const channel = publish.workflow.jobs.channel
        const channelText = channel.steps.map((step) => step.run ?? '').join('\n')

        expect(publish.workflow.on.push?.tags).toEqual(['[0-9]+.[0-9]+.[0-9]+'])
        expect(releaseGuard.run).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main')
        expect(releaseGuard.run).toContain('test "$version" = "$tag"')
        expect(publish.workflow.jobs.release.environment).toBe('tcc-production')
        expect(publish.workflow.jobs.web.environment).toBe('tcc-production')
        expect(macos.workflow.jobs.build.environment).toBe('tcc-production')
        expect(findStep(macos.workflow.jobs.build, "Require the committed identity to be the environment's").run)
            .toContain('APPLE_SIGNING_IDENTITY')
        expect(findStep(macos.workflow.jobs.build, 'Check the signature, the notarisation and the stapled ticket').run)
            .toContain('codesign --verify')
        expect(channelText).toContain('applications:bundles:widen')
        expect(channelText).toContain('applications:bundles:rollback')
        expect(channelText).not.toContain('resolve-shared-js-source.mjs')
        expect(release.workflow.on.push?.branches).toEqual(['master'])
        expect(release.workflow.jobs.resolve_shared_source.environment).toBe('tcc-production')
        expect(release.workflow.jobs['publish-tauri'].environment).toBe('tcc-production')
        expect(release.source).toContain('releaseDraft: true')
        expect(findStep(macos.workflow.jobs.build, 'Resolve shared.js source').env?.CROSS_REPO_READ_TOKEN)
            .toBe(expression('secrets.CROSS_REPO_READ_TOKEN'))
        expect(findStep(release.workflow.jobs.resolve_shared_source, 'Resolve shared.js source').env?.CROSS_REPO_READ_TOKEN)
            .toBe(expression('secrets.CROSS_REPO_READ_TOKEN'))
    })

    it('keeps the shared.js checkout beside TCC for the file dependency', () => {
        const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
        expect(packageJson.dependencies['shared.js']).toBe('file:../shared.js')

        for (const job of [
            macos.workflow.jobs.build,
            publish.workflow.jobs.web,
            release.workflow.jobs['publish-tauri'],
        ]) {
            const tcc = job.steps.find((step) => step.uses === 'actions/checkout@v4'
                && step.with?.path === 'tachograph-card-client')
            const shared = sharedCheckout(job)

            expect(tcc).toBeDefined()
            expect(shared.with?.path).toBe('shared.js')
            expect(job.steps.indexOf(tcc!)).toBeLessThan(job.steps.indexOf(shared))
        }
    })

    it('records source evidence as an artifact and passes the same SHA to web and native handoff', () => {
        const publishRelease = publish.workflow.jobs.release
        const web = publish.workflow.jobs.web
        const native = publish.workflow.jobs.native
        const webManifest = findStep(web, 'Write the manifest with the native range')
        const nativeSummary = findStep(native, 'Raise the native baseline to this release').run ?? ''

        expect(publishRelease.outputs?.shared_source_sha)
            .toBe(expression('steps.shared.outputs.shared_source_sha'))
        expect(publishRelease.outputs?.tcc_source_sha)
            .toBe(expression('steps.shared.outputs.tcc_source_sha'))
        expect(publishRelease.steps.some((step) => step.uses === 'actions/upload-artifact@v4'
            && step.with?.name === 'shared-js-source')).toBe(true)
        expect(web.steps.some((step) => step.uses === 'actions/download-artifact@v4'
            && step.with?.name === 'shared-js-source')).toBe(true)
        expect(native.steps.some((step) => step.uses === 'actions/download-artifact@v4'
            && step.with?.name === 'shared-js-source')).toBe(true)
        expect(webManifest.env?.EXPECTED_SHARED_SHA)
            .toBe(expression('needs.release.outputs.shared_source_sha'))
        expect(webManifest.run).toContain('--shared-source-revision "$EXPECTED_SHARED_SHA"')
        expect(native.env?.EXPECTED_SHARED_SHA)
            .toBe(expression('needs.release.outputs.shared_source_sha'))
        expect(nativeSummary).toContain('$EXPECTED_SHARED_SHA')
        expect(nativeSummary).toContain('shared-js-source.json')
    })

    it('does not require a manually configured source SHA in TCC workflows or docs', () => {
        const workflowSource = [macos.source, publish.source, release.source].join('\n')
        const docs = readFileSync(join(ROOT, 'docs', 'application-bundle-updates.md'), 'utf8')

        expect(workflowSource).not.toContain('vars.' + MANUAL_SHA_VARIABLE)
        expect(docs).toContain('release-dependencies.json')
        expect(docs).toContain('refs/heads/main')
        expect(docs).toContain('annotated stable tag')
        expect(docs).not.toContain(MANUAL_SHA_VARIABLE)
    })
})

