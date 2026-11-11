// @vitest-environment node
import {spawnSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {load} from 'js-yaml'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ROOT = resolve(__dirname, '..', '..')

type Step = {id?: string; name?: string; run?: string; uses?: string; if?: string; with?: Record<string, string>; env?: Record<string, string>}
type Job = {if?: string; needs?: string | string[]; environment?: string; steps: Step[]; outputs?: Record<string, string>}
type Workflow = {
    env?: Record<string, string>
    on?: {
        push?: {tags?: string[]}
        pull_request?: {branches?: string[]}
        workflow_dispatch?: {inputs?: Record<string, {options?: string[]; required?: boolean}>}
    }
    jobs: Record<string, Job>
}
type Context = {github: {event_name: string; same_repository: boolean}; needs: {release: {outputs: {path: string}}}}

const workflow = load(readFileSync(join(ROOT, '.github/workflows/publish-application-bundles.yml'), 'utf8')) as Workflow

function requiredJob(name: string): Job {
    const selected = workflow.jobs[name]
    if (!selected) throw new Error(`Workflow is missing job ${name}.`)
    return selected
}

function script(job: string) {
    return requiredJob(job).steps.map((step) => step.run ?? '').join('\n')
}

// Evaluates the equality expressions used by this workflow, joined by ||, without executing YAML as JavaScript.
function condition(expression: string, context: Context) {
    if (expression === 'true') return true
    const body = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(expression)
    if (!body) throw new Error(`Unsupported workflow condition: ${expression}`)
    return body[1].split(/\s*\|\|\s*/).some((clause) => {
        if (clause === 'github.event.pull_request.head.repo.full_name == github.repository') return context.github.same_repository
        const comparison = /^(github\.event_name|needs\.release\.outputs\.path)\s*==\s*'([^']+)'$/.exec(clause)
        if (!comparison) throw new Error(`Unsupported workflow condition: ${expression}`)
        const actual = comparison[1] === 'github.event_name'
            ? context.github.event_name
            : context.needs.release.outputs.path
        return actual === comparison[2]
    })
}

// The jobs that run for one event and one detector answer, skipping a job whose needs did not run.
function jobsThatRun(event: string, path: string, sameRepository = true) {
    const ran: string[] = []
    for (const [name, job] of Object.entries(workflow.jobs)) {
        const needs = [job.needs ?? []].flat()
        if (needs.every((need) => ran.includes(need))
            && condition(job.if ?? 'true', {github: {event_name: event, same_repository: sameRepository}, needs: {release: {outputs: {path}}}})) {
            ran.push(name)
        }
    }
    return ran
}

describe('publish-application-bundles.yml path choice', () => {
    it('runs on a stable version tag, on pull requests into main and the release lines, and on manual widen and rollback', () => {
        expect(workflow.on?.push?.tags).toEqual(['[0-9]+.[0-9]+.[0-9]+'])
        expect(workflow.on?.pull_request?.branches).toEqual(['main', 'release/**'])
        expect(workflow.on?.workflow_dispatch?.inputs?.environment?.options).toEqual(['tcc-staging', 'tcc-production'])
        expect(workflow.on?.workflow_dispatch?.inputs?.environment?.required).toBe(true)
        expect(workflow.on?.workflow_dispatch?.inputs?.action?.options).toEqual(['widen', 'rollback'])
        expect(workflow.on?.workflow_dispatch?.inputs?.reason?.required).toBe(true)
    })

    it('asks the native-change detector and passes its answer as the path', () => {
        expect(script('release')).toContain('node scripts/native-change.mjs')
        expect(requiredJob('release').outputs?.path).toBe('${{ steps.path.outputs.path }}')
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

    it('publishes a pull request to staging through the same jobs, and never a fork', () => {
        expect(jobsThatRun('pull_request', 'web')).toEqual(['release', 'web'])
        expect(jobsThatRun('pull_request', 'native')).toEqual(['release', 'native'])
        expect(jobsThatRun('pull_request', 'web', false)).toEqual([])
    })

    it('sends a tag to production at 10% and a raised pull-request version to staging at 100%', () => {
        const guard = requiredJob('release').steps.find((step) => step.id === 'guard')
        expect(requiredJob('release').environment).toBe("${{ github.event_name == 'push' && 'tcc-production' || 'tcc-staging' }}")
        expect(guard?.run).toContain('echo environment=tcc-production; echo rollout=10; echo mode=release; echo publish=true;')
        expect(guard?.run).toContain('echo environment=tcc-staging; echo rollout=100;')
        expect(guard?.run).toContain('[ "$GITHUB_BASE_REF" = main ] || mode=release')
        expect(guard?.run).toContain('echo publish=false')
        expect(guard?.run).toContain("staging only takes a raised version")
        expect(guard?.env?.PREVIOUS_SHA).toBe("${{ github.event.action == 'synchronize' && github.event.before || github.event.pull_request.base.sha }}")
        for (const id of ['shared', 'path']) {
            expect(requiredJob('release').steps.find((step) => step.id === id)?.if).toBe("${{ steps.guard.outputs.publish == 'true' }}")
        }
    })

    it('lets the native-change detector fail the run under set -e, on both environments', () => {
        const path = requiredJob('release').steps.find((step) => step.id === 'path')
        expect(path?.run).toMatch(/^set -euo pipefail\nresult="\$\(node scripts\/native-change\.mjs\)"/)
    })

    it('raises the native baseline only for a production release', () => {
        const keep = requiredJob('native').steps.find((step) => step.name === 'Keep the raised baseline')
        expect(keep?.if).toBe("${{ needs.release.outputs.environment == 'tcc-production' }}")
        expect(script('native')).toContain('[ "$ENVIRONMENT" = tcc-production ] || exit 0')
    })

    it('only acts on the channel in a manual run', () => {
        expect(jobsThatRun('workflow_dispatch', '')).toEqual(['channel'])
    })
})

describe('publish-application-bundles.yml web job', () => {
    const web = script('web')

    it('builds dist/spa, zips and minisigns it and writes the manifest with the native range', () => {
        expect(requiredJob('web').environment).toBe('${{ needs.release.outputs.environment }}')
        expect(web).toContain('npm run build:release -- --web-only')
        expect(web).toContain('zip -qrX')
        expect(web).toContain('npm run tauri -- signer sign')
        expect(web).toContain('node scripts/web-bundle.mjs')
    })

    it('uploads create-only, then imports, publishes and puts it on the channel at 10%', () => {
        expect(web.match(/--if-none-match '\*'/g)).toHaveLength(2)
        expect(web.indexOf('applications:bundles:import')).toBeLessThan(web.indexOf('applications:bundles:publish'))
        expect(web.indexOf('applications:bundles:publish')).toBeLessThan(web.indexOf('applications:bundles:channel'))
        expect(web).toContain('--rollout="$BUNDLE_ROLLOUT"')
        expect(web).toContain('"BUNDLE_ROLLOUT=$ROLLOUT"')
    })

    it('points the bundle at its environment\'s Platform API, app and application', () => {
        const build = requiredJob('web').steps.find((step) => step.name === 'Build dist/spa with the release\'s updater configuration')
        expect(build?.env?.BUNDLE_UPDATER_APPLICATION_ID).toBe('${{ vars.TCC_APP_ID }}')
        expect(build?.env?.VITE_TRANSPORTKLOK_API_DOMAIN).toBe('${{ vars.TRANSPORTKLOK_API_DOMAIN }}')
        expect(build?.env?.VITE_TRANSPORTKLOK_APP_URL).toBe('${{ vars.TRANSPORTKLOK_APP_URL }}')
        expect(build?.env?.VITE_APP_KEY).toBe('${{ secrets.TCC_APP_KEY }}')
        const quasar = readFileSync(join(ROOT, 'quasar.config.ts'), 'utf8')
        for (const name of ['VITE_TRANSPORTKLOK_API_DOMAIN', 'VITE_TRANSPORTKLOK_APP_URL', 'VITE_APP_KEY']) {
            expect(quasar).toContain(`'${name}',`)
        }
    })

    it('publishes to the channel the app asks for', () => {
        const boot = readFileSync(join(ROOT, 'src/boot/bundle-updates.ts'), 'utf8')
        expect(workflow.env?.CHANNEL).toBe('production')
        expect(boot).toContain(`const WEB_BUNDLE_CHANNEL = '${workflow.env?.CHANNEL}'`)
    })
})

describe('publish-application-bundles.yml channel job', () => {
    it('widens or rolls back through Platform with the reason passed as task environment', () => {
        const channel = script('channel')

        expect(requiredJob('channel').environment).toBe('${{ inputs.environment }}')
        expect(channel).toContain('TCC_APP_ID is required in the $ENVIRONMENT environment.')
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
            env: {
                PATH: `${dir}:${process.env.PATH}`,
                NODE_ENV: 'test',
                VUE_ROUTER_MODE: 'hash',
                VUE_ROUTER_BASE: '/',
                VITE_APP_VERSION: '0.0.0',
                PLATFORM_ECS_CLUSTER: 'c',
                PLATFORM_ECS_SERVICE: 's',
                AWS_REGION: 'eu-west-2',
            },
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
