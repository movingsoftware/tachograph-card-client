import {getVersion} from '@tauri-apps/api/app'
import {isTauri} from '@tauri-apps/api/core'
import {arch as getNativeArchitecture, platform as getNativePlatform} from '@tauri-apps/plugin-os'
import type {DeviceRegistrationPayload, UpdateDevicePayload} from './auth'

const BUNDLED_APP_VERSION = import.meta.env.VITE_APP_VERSION

export interface DeviceRuntimeInitializer {
    readonly isNative: boolean
    readonly getNativeVersion: () => Promise<string>
    readonly getPlatform: () => Promise<string>
    readonly getArchitecture: () => Promise<string>
    readonly browserVersion: string
}

interface RuntimeVersionSnapshot {
    applicationVersion: string
    nativeApplicationVersion: string
    platform: string
    target: string
    signature: string
}

const normalizePlatform = (platform: string): string => {
    if (platform === 'macos') return 'darwin'
    if (platform === 'windows') return 'windows'
    if (platform === 'linux') return 'linux'
    return platform
}

const supportedRuntimeTargets = new Set([
    'darwin-aarch64',
    'darwin-x86_64',
    'linux-x86_64',
    'windows-x86_64',
])

const runtimeSnapshot: RuntimeVersionSnapshot = {
    applicationVersion: BUNDLED_APP_VERSION,
    nativeApplicationVersion: BUNDLED_APP_VERSION,
    platform: 'desktop',
    target: 'desktop',
    signature: '',
}

const updateSignature = (): void => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const userAgent = nav?.userAgent || 'unknown'
    runtimeSnapshot.signature = `${runtimeSnapshot.platform}:${runtimeSnapshot.applicationVersion}:${runtimeSnapshot.nativeApplicationVersion}:${userAgent}`
}

export const initializeDeviceRuntime = async (initializer?: DeviceRuntimeInitializer): Promise<void> => {
    const runtime = initializer ?? {
        isNative: isTauri(),
        getNativeVersion: getVersion,
        getPlatform: getNativePlatform,
        getArchitecture: getNativeArchitecture,
        browserVersion: BUNDLED_APP_VERSION,
    }

    if (!runtime.isNative) {
        runtimeSnapshot.applicationVersion = runtime.browserVersion
        runtimeSnapshot.nativeApplicationVersion = runtime.browserVersion
        runtimeSnapshot.platform = 'desktop'
        runtimeSnapshot.target = 'desktop'
        updateSignature()
        return
    }

    const [version, nativePlatform, architecture] = await Promise.all([
        runtime.getNativeVersion(),
        runtime.getPlatform(),
        runtime.getArchitecture(),
    ])
    const platform = nativePlatform
    const resolvedTarget = `${normalizePlatform(nativePlatform)}-${architecture}`
    const target = supportedRuntimeTargets.has(resolvedTarget) ? resolvedTarget : 'unsupported'

    runtimeSnapshot.applicationVersion = version
    runtimeSnapshot.nativeApplicationVersion = version
    runtimeSnapshot.platform = platform
    runtimeSnapshot.target = target
    updateSignature()
}

export const getCurrentDeviceRegistrationPayload = (): DeviceRegistrationPayload => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    return {
        device_manufacturer: nav?.vendor || 'desktop-client',
        device_platform: runtimeSnapshot.platform,
        device_model: nav?.userAgent || 'TransportKlok Desktop',
        device_name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: runtimeSnapshot.platform,
        application_version: runtimeSnapshot.applicationVersion,
    }
}

export const getCurrentDeviceVersionUpdatePayload = (): UpdateDevicePayload => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    return {
        name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: nav?.appVersion || 'unknown',
        application_version: runtimeSnapshot.applicationVersion,
    }
}

export const getCurrentRuntimeVersionSignature = (): string => runtimeSnapshot.signature

export const getCurrentNativeApplicationVersion = (): string => runtimeSnapshot.nativeApplicationVersion

export const getCurrentRuntimeTarget = (): string => runtimeSnapshot.target

export const getDeviceRuntimeInfo = (): {version: string; target: string} => ({
    version: runtimeSnapshot.nativeApplicationVersion,
    target: runtimeSnapshot.target,
})
