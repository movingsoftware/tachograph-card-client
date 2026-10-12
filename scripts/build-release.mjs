import {spawnSync} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {prepareBundleUpdaterConfig} from './prepare-bundle-updater-config.mjs'
import {parseReleaseBuildArguments} from './release-build-arguments.mjs'
import {synchronizeApplicationVersion} from './set-application-version.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const forwardedArguments = parseReleaseBuildArguments(process.argv.slice(2))
const version = process.env.BUNDLE_APP_VERSION
if (!version) throw new Error('Set BUNDLE_APP_VERSION before building a release.')
const prepared = prepareBundleUpdaterConfig(process.env, {
    package: version,
    tauri: version,
    cargo: version,
})
await synchronizeApplicationVersion(root, version)

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const tauriConfig = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargoToml = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8')
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
if (!cargoVersion) throw new Error('Cargo package version was not found.')
if (packageJson.version !== version || tauriConfig.version !== version || cargoVersion !== version) {
    throw new Error('Release version synchronization did not update every native package manifest.')
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tcc-bundle-updater-'))
try {
    const configPath = join(temporaryDirectory, 'updater-config.json')
    await writeFile(configPath, JSON.stringify(prepared.tauriConfig), {mode: 0o600})
    const npmCli = process.env.npm_execpath
    if (!npmCli) throw new Error('Run the release build through npm so its CLI path is available.')
    const result = spawnSync(process.execPath, [npmCli, 'run', 'tauri', '--', 'build', '--config', configPath, ...forwardedArguments], {
        cwd: root,
        env: {...process.env, ...prepared.frontendEnvironment},
        stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
    await rm(temporaryDirectory, {recursive: true, force: true})
}
