#!/usr/bin/env node
// Says whether a release can ship as a web bundle or needs a new native shell, against native-baseline.json's tag.
//
//   node scripts/native-change.mjs [--repo DIR] [--head REF]
//
// Prints `web`, or `native` followed by one reason per line. Exits 2 when it cannot decide.

import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {cargoLockApplicationVersion, cargoPackageVersion} from './set-application-version.mjs'

const NATIVE_PATHS = [
    'src-tauri',
    'package.json',
    'package-lock.json',
    'scripts/build-release.mjs',
    'scripts/prepare-bundle-updater-config.mjs',
    'scripts/release-build-arguments.mjs',
]
const NATIVE_PACKAGE = /^@tauri-apps\//
const IGNORED_PATH = /^src-tauri\/gen\//

// Each native file whose own release version may change without changing the shell, with the version blanked out.
const VERSION_BLIND = {
    'src-tauri/tauri.conf.json': (text) => JSON.stringify({...JSON.parse(text), version: null}),
    'src-tauri/Cargo.toml': (text) => text.replace(cargoPackageVersion, '$1$2'),
    'src-tauri/Cargo.lock': (text) => text.replace(cargoLockApplicationVersion, '$1$2'),
}

// The options given on the command line.
function parseArgs(argv) {
    const options = {repo: process.cwd(), head: 'HEAD'}
    for (let index = 0; index < argv.length; index += 2) {
        const [flag, value] = [argv[index], argv[index + 1]]
        if (!value || !['--repo', '--head'].includes(flag)) throw new Error(`Unknown or incomplete option '${flag}'.`)
        options[flag.slice(2)] = value
    }
    options.repo = resolve(options.repo)
    return options
}

// Run git in the repository and return its output.
function git(repo, ...args) {
    return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})
}

// A file's content at a ref, or null when the ref does not have it.
function show(repo, ref, file) {
    try {
        return git(repo, 'show', `${ref}:${file}`)
    } catch {
        return null
    }
}

// The package name of a lockfile install path or a package.json dependency key.
function packageName(key) {
    const index = key.lastIndexOf('node_modules/')
    return index === -1 ? key : key.slice(index + 'node_modules/'.length)
}

// The resolved version of every Tauri package in a lockfile, keyed by its install path.
function lockedPackages(lockText) {
    const versions = new Map()
    for (const [path, entry] of Object.entries(JSON.parse(lockText ?? '{}').packages ?? {})) {
        if (path.includes('node_modules/') && NATIVE_PACKAGE.test(packageName(path))) {
            versions.set(path, entry.version ?? entry.resolved ?? '')
        }
    }
    return versions
}

// The declared range of every Tauri package in package.json.
function declaredPackages(manifestText) {
    const ranges = new Map()
    const manifest = JSON.parse(manifestText ?? '{}')
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
            if (NATIVE_PACKAGE.test(name)) ranges.set(name, range)
        }
    }
    return ranges
}

// Reasons a package file changes a Tauri package between the two refs.
function packageReasons(repo, base, head, file, packages) {
    const before = packages(show(repo, base, file))
    const after = packages(show(repo, head, file))
    const reasons = []
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        if (before.get(key) !== after.get(key)) {
            reasons.push(`${file}: ${packageName(key)} ${before.get(key) ?? 'absent'} -> ${after.get(key) ?? 'absent'}`)
        }
    }
    return reasons
}

// Whether a native file differs between the refs once its release version is blanked out.
function changedBeyondVersion(repo, base, head, file) {
    const blind = VERSION_BLIND[file]
    const [before, after] = [show(repo, base, file), show(repo, head, file)]
    return before === null || after === null || blind(before) !== blind(after)
}

// Every reason the head needs a new native shell compared with the base.
function nativeReasons(repo, base, head) {
    const reasons = []
    const files = git(repo, 'diff', '--name-only', base, head, '--', ...NATIVE_PATHS).split('\n').filter(Boolean)
    for (const file of files) {
        if (IGNORED_PATH.test(file)) continue
        if (file === 'package-lock.json') {
            reasons.push(...packageReasons(repo, base, head, file, lockedPackages))
        } else if (file === 'package.json') {
            reasons.push(...packageReasons(repo, base, head, file, declaredPackages))
        } else if (!VERSION_BLIND[file] || changedBeyondVersion(repo, base, head, file)) {
            reasons.push(`${file}: changed`)
        }
    }
    return reasons
}

// The baseline tag named in native-baseline.json at the head ref.
function baselineTag(repo, head) {
    const tag = JSON.parse(show(repo, head, 'native-baseline.json') ?? '{}').baseline_tag
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(tag ?? '')) throw new Error('native-baseline.json has no valid baseline_tag.')
    return tag
}

try {
    const options = parseArgs(process.argv.slice(2))
    const base = baselineTag(options.repo, options.head)
    git(options.repo, 'rev-parse', '--verify', '--quiet', `refs/tags/${base}^{commit}`)
    const version = JSON.parse(show(options.repo, options.head, 'package.json') ?? '{}').version
    const reasons = version === base
        ? [`native-baseline.json: ${base} is the native baseline release itself`]
        : nativeReasons(options.repo, `refs/tags/${base}`, options.head)
    console.log(reasons.length === 0 ? 'web' : ['native', ...reasons].join('\n'))
} catch (error) {
    console.error(`Cannot decide web or native: ${error.message}`)
    process.exit(2)
}
