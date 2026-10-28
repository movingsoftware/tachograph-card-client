// @vitest-environment node
import {spawnSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {load} from 'js-yaml'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

type Step = {name?: string; run?: string; uses?: string; with?: Record<string, string>}
type Job = {if?: string; needs?: string | string[]; environment?: string; steps: Step[]; outputs?: Record<string, string>}
type Workflow = {
    on: {push: {tags: string[]}; workflow_dispatch: {inputs: Record<string, {options?: string[]; required?: boolean}>}}
    jobs: Record<string, Job>
}
type Context = {github: {event_name: string}; needs: {release: {outputs: {path: string}}}}

const workflow = load(readFileSync(join(ROOT, '.github/workflows/publish-application-bundles.yml'), 'utf8')) as Workflow

function script(job: string) {
    return workflow.jobs[job].steps.map((step) => step.run ?? '').join('\n')
}

// Evaluates a job's `if` the way Actions does for the comparisons this workflow uses.
function condition(expression: string, context: Context) {
    const body = expression.replace(/^\$\{\{|\}\}$/g, '').replace(/==/g, '===').replace(/!===/g, '!==')
    return Boolean(new Function('github', 'needs', `return (${body})`)(context.github, context.needs))
}

// The jobs that run for one event and one detector answer, skipping a job whose needs did not run.
function jobsThatRun(event: string, path: string) {
    const ran: string[] = []
    for (const [name, job] of Object.entries(workflow.jobs)) {
        const needs = [job.needs ?? []].flat()
        if (needs.every((need) => ran.includes(need))
            && condition(job.if ?? 'true', {github: {event_name: event}, needs: {release: {outputs: {path}}}})) {
            ran.push(name)
        }
    }
    return ran
}

describe('publish-application-bundles.yml path choice', () => {
    it('runs on a stable version tag and on manual widen and rollback', () => {
        expect(workflow.on.push.tags).toEqual(['[0-9]+.[0-9]+.[0-9]+'])
        expect(workflow.on.workflow_dispatch.inputs.action.options).toEqual(['widen', 'rollback'])
        expect(workflow.on.workflow_dispatch.inputs.reason.required).toBe(true)
    })

    it('asks the native-change detector and passes its answer as the path', () => {
        expect(script('release')).toContain('node scripts/native-change.mjs')
        expect(workflow.jobs.release.outputs?.path).toBe('${{ steps.path.outputs.path }}')
    })

    it('publishes only the web bundle when the detector says web', () => {
        expect(jobsThatRun('push', 'web')).toEqual(['release', 'web'])
    })

    it('hands over only the native release when the detector says native', () => {
        expect(jobsThatRun('push', 'native')).toEqual(['release', 'native'])
    })

    it('publishes nothing when the detector cannot decide', () => {
        expect(jobsThatRun('push', '')).toEqual(['release'])
    })

    it('only acts on the channel in a manual run', () => {
        expect(jobsThatRun('workflow_dispatch', '')).toEqual(['channel'])
    })
})

describe('publish-application-bundles.yml web job', () => {
    const web = script('web')

    it('builds dist/spa, zips and minisigns it and writes the manifest with the native range', () => {
        expect(workflow.jobs.web.environment).toBe('tcc-production')
        expect(web).toContain('npm run build:release -- --web-only')
        expect(web).toContain('zip -qrX')
        expect(web).toContain('npm run tauri -- signer sign')
        expect(web).toContain('node scripts/web-bundle.mjs')
    })

    it('uploads create-only, then imports, publishes and puts it on the channel at 10%', () => {
        expect(web.match(/--if-none-match '\*'/g)).toHaveLength(2)
        expect(web.indexOf('applications:bundles:import')).toBeLessThan(web.indexOf('applications:bundles:publish'))
        expect(web.indexOf('applications:bundles:publish')).toBeLessThan(web.indexOf('applications:bundles:channel'))
        expect(web).toContain('--rollout=10')
    })
})

describe('publish-application-bundles.yml channel job', () => {
    it('widens or rolls back through Platform with the reason passed as task environment', () => {
        const channel = script('channel')

        expect(workflow.jobs.channel.environment).toBe('tcc-production')
        expect(channel).toContain('applications:bundles:widen "$BUNDLE_APP" "$BUNDLE_CHANNEL" "$BUNDLE_PERCENT"')
        expect(channel).toContain('applications:bundles:rollback "$BUNDLE_APP" "$BUNDLE_CHANNEL"')
        expect(channel).toContain('"BUNDLE_REASON=$REASON"')
        expect(channel).not.toContain('${{ inputs.reason }}')
    })
})

describe('release.yml', () => {
    it('stays a draft-installer workflow only', () => {
        const release = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')

        expect(release).toContain('# Installers only')
        expect(release).toContain('releaseDraft: true')
        expect(release).not.toContain('applications:bundles')
    })
})

describe('platform-artisan.sh', () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'tcc-platform-artisan-'))
    })

    afterEach(() => rmSync(dir, {recursive: true, force: true}))

    // Runs the script against a fake aws CLI that logs its calls and stops the task with the given exit code.
    function run(exitCode: number, ...args: string[]) {
        writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
echo "$*" >> "${dir}/calls"
case "$2" in
  describe-services) echo '{"services":[{"status":"ACTIVE","taskDefinition":"arn:td:7","launchType":"FARGATE","networkConfiguration":{"awsvpcConfiguration":{"subnets":["s"]}}}]}' ;;
  run-task) printf '%s' "$4" > "${dir}/request.json"; echo '{"tasks":[{"taskArn":"arn:task:1"}],"failures":[]}' ;;
  wait) ;;
  describe-tasks) echo '{"tasks":[{"containers":[{"name":"app","exitCode":${exitCode}}]}]}' ;;
esac
`)
        chmodSync(join(dir, 'aws'), 0o755)
        return spawnSync('bash', [join(ROOT, 'scripts/platform-artisan.sh'), ...args], {
            encoding: 'utf8',
            env: {PATH: `${dir}:${process.env.PATH}`, PLATFORM_ECS_CLUSTER: 'c', PLATFORM_ECS_SERVICE: 's', AWS_REGION: 'eu-west-2'},
        })
    }

    it('runs the command on the service task definition with the values as task environment', () => {
        const result = run(0, 'php artisan x "$REASON"', 'REASON=it is "broken"; rm -rf /')

        expect(result.status).toBe(0)
        const request = JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8'))
        expect(request.taskDefinition).toBe('arn:td:7')
        expect(request.launchType).toBe('FARGATE')
        expect(request.networkConfiguration.awsvpcConfiguration.subnets).toEqual(['s'])
        expect(request.overrides.containerOverrides[0].command).toEqual(['/bin/sh', '-lc', 'php artisan x "$REASON"'])
        expect(request.overrides.containerOverrides[0].environment).toContainEqual({name: 'REASON', value: 'it is "broken"; rm -rf /'})
    })

    it('fails when the Platform task fails', () => {
        const result = run(1, 'php artisan x')

        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('exit code 1')
    })
})
