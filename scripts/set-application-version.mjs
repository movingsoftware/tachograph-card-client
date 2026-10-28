import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const maximumVersionPart = 4294967295
export const cargoPackageVersion = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m
export const cargoLockApplicationVersion = /(^\[\[package\]\]\nname = "tacho-bridge-application"\nversion = ")[^"]+("\n)/m

export function validateApplicationVersion(version) {
    const match = stableVersion.exec(version)
    if (!match || match.slice(1).some((part) => Number(part) > maximumVersionPart)) {
        throw new Error('Application version must be stable x.y.z with bounded components up to 4294967295.')
    }
    return version
}

export async function synchronizeApplicationVersion(root, version) {
    validateApplicationVersion(version)
    const packagePath = join(root, 'package.json')
    const packageLockPath = join(root, 'package-lock.json')
    const tauriPath = join(root, 'src-tauri/tauri.conf.json')
    const cargoPath = join(root, 'src-tauri/Cargo.toml')
    const cargoLockPath = join(root, 'src-tauri/Cargo.lock')

    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
    packageJson.version = version
    const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'))
    packageLock.version = version
    if (packageLock.packages?.['']) packageLock.packages[''].version = version
    const tauriConfig = JSON.parse(await readFile(tauriPath, 'utf8'))
    tauriConfig.version = version

    const cargoManifest = await readFile(cargoPath, 'utf8')
    if (!cargoPackageVersion.test(cargoManifest)) throw new Error('Cargo package version was not found.')
    const updatedCargoManifest = cargoManifest.replace(cargoPackageVersion, `$1${version}$2`)
    const cargoLock = await readFile(cargoLockPath, 'utf8')
    if (!cargoLockApplicationVersion.test(cargoLock)) throw new Error('Cargo.lock application package entry was not found.')
    const updatedCargoLock = cargoLock.replace(cargoLockApplicationVersion, `$1${version}$2`)

    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`)
    await writeFile(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`)
    await writeFile(cargoPath, updatedCargoManifest)
    await writeFile(cargoLockPath, updatedCargoLock)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const version = process.env.BUNDLE_APP_VERSION
    if (!version) throw new Error('Set BUNDLE_APP_VERSION before synchronizing the release version.')
    const root = fileURLToPath(new URL('../', import.meta.url))
    await synchronizeApplicationVersion(root, version)
}
