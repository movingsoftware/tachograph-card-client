// @vitest-environment node
import {execFileSync, spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {synchronizeApplicationVersion} from '../../scripts/set-application-version.mjs'

const ROOT = resolve(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'native-change.mjs')
const MANIFESTS = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']

let repo: string

function write(path: string, content: string) {
    mkdirSync(dirname(join(repo, path)), {recursive: true})
    writeFileSync(join(repo, path), content)
}

function read(path: string) {
    return readFileSync(join(repo, path), 'utf8')
}

function git(...args: string[]) {
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {stdio: 'pipe'})
}

function commit() {
    git('add', '-A')
    git('commit', '-q', '-m', 'change')
}

function detect() {
    return spawnSync('node', [SCRIPT, '--repo', repo], {encoding: 'utf8'})
}

// Adds or changes a resolved package in the lockfile, as npm install would.
function lockPackage(name: string, version: string) {
    const lock = JSON.parse(read('package-lock.json'))
    lock.packages[`node_modules/${name}`] = {...lock.packages[`node_modules/${name}`], version}
    write('package-lock.json', JSON.stringify(lock, null, 2))
}

// A release of TCC's own manifests at 0.8.0, tagged as the native baseline.
beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'tcc-native-change-'))
    git('init', '-q')
    for (const file of MANIFESTS) {
        mkdirSync(dirname(join(repo, file)), {recursive: true})
        copyFileSync(join(ROOT, file), join(repo, file))
    }
    await synchronizeApplicationVersion(repo, '0.8.0')
    write('native-baseline.json', JSON.stringify({baseline_tag: '0.8.0'}))
    write('src/main.ts', 'console.log(1)\n')
    write('src-tauri/src/lib.rs', 'pub fn run() {}\n')
    commit()
    git('tag', '0.8.0')
})

afterEach(() => rmSync(repo, {recursive: true, force: true}))

describe('native-change', () => {
    it('says web when only the frontend and the release version change', async () => {
        write('src/main.ts', 'console.log(2)\n')
        lockPackage('pinia', '3.0.99')
        await synchronizeApplicationVersion(repo, '0.8.1')
        commit()

        const result = detect()

        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe('web')
    })

    it('says native when the Rust source changes', () => {
        write('src-tauri/src/lib.rs', 'pub fn run() { println!("x"); }\n')
        commit()

        expect(detect().stdout.trim().split('\n')).toEqual(['native', 'src-tauri/src/lib.rs: changed'])
    })

    it('says native when a Tauri package resolves differently', () => {
        lockPackage('@tauri-apps/plugin-updater', '2.9.1')
        commit()

        expect(detect().stdout.trim().split('\n')).toEqual(['native', 'package-lock.json: @tauri-apps/plugin-updater 2.9.0 -> 2.9.1'])
    })

    it('says native when a Tauri plugin is declared in package.json', () => {
        const manifest = JSON.parse(read('package.json'))
        manifest.dependencies['@tauri-apps/plugin-fs'] = '^2.0.0'
        write('package.json', JSON.stringify(manifest, null, 2))
        commit()

        expect(detect().stdout.trim().split('\n')).toEqual(['native', 'package.json: @tauri-apps/plugin-fs absent -> ^2.0.0'])
    })

    it('says native when tauri.conf.json changes beyond its version', async () => {
        const config = JSON.parse(read('src-tauri/tauri.conf.json'))
        config.app.security.csp = "default-src 'self'"
        write('src-tauri/tauri.conf.json', JSON.stringify(config, null, 2))
        await synchronizeApplicationVersion(repo, '0.8.1')
        commit()

        expect(detect().stdout.trim().split('\n')).toEqual(['native', 'src-tauri/tauri.conf.json: changed'])
    })

    it('says native when a Rust dependency in Cargo.lock changes, not only the app version', async () => {
        await synchronizeApplicationVersion(repo, '0.8.1')
        write('src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').replace(/(\nname = "serde"\nversion = ")[^"]+"/, '$19.9.9"'))
        commit()

        expect(detect().stdout.trim().split('\n')).toEqual(['native', 'src-tauri/Cargo.lock: changed'])
    })

    it('says native for the baseline release itself', () => {
        const result = detect()

        expect(result.status).toBe(0)
        expect(result.stdout.trim().split('\n')).toEqual(['native', 'native-baseline.json: 0.8.0 is the native baseline release itself'])
    })

    it('refuses to decide when the baseline tag does not exist', () => {
        write('native-baseline.json', JSON.stringify({baseline_tag: '0.7.9'}))
        commit()

        const result = detect()

        expect(result.status).toBe(2)
        expect(result.stderr).toContain('Cannot decide web or native')
    })
})

describe('TCC native-baseline.json', () => {
    it('names a stable baseline tag', () => {
        const baseline = JSON.parse(readFileSync(join(ROOT, 'native-baseline.json'), 'utf8'))

        expect(baseline.baseline_tag).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/)
    })
})
