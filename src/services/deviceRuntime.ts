import type { DeviceRegistrationPayload, UpdateDevicePayload } from './auth'
import { getVersion } from '@tauri-apps/api/app'
import { platform } from '@tauri-apps/plugin-os'

const FALLBACK_APP_VERSION = '0.0.1'

const resolveNativeApplicationVersion = async (): Promise<string> => {
    if (import.meta.env.VITE_APP_VERSION) {
        return import.meta.env.VITE_APP_VERSION
    }

    try {
        return await getVersion()
    } catch {
        return FALLBACK_APP_VERSION
    }
}

type RuntimeVersionSnapshot = {
    applicationVersion: string
    nativeApplicationVersion: string
    signature: string
}

const getRuntimeVersionSnapshot = async (): Promise<RuntimeVersionSnapshot> => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const nativeApplicationVersion = await resolveNativeApplicationVersion()
    const applicationVersion = nativeApplicationVersion
    const platform = nav?.platform || 'desktop'
    const userAgent = nav?.userAgent || 'unknown'
    const signature = `${platform}:${applicationVersion}:${nativeApplicationVersion}:${userAgent}`

    return {
        applicationVersion,
        nativeApplicationVersion,
        signature,
    }
}

export const getCurrentDeviceRegistrationPayload = async (): Promise<DeviceRegistrationPayload> => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const runtime = await getRuntimeVersionSnapshot()

    return {
        device_manufacturer: nav?.vendor || 'desktop-client',
        device_platform: platform(),
        device_model: nav?.userAgent || 'TransportKlok Desktop',
        device_name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: platform(),
        application_version: runtime.applicationVersion,
    }
}

export const getCurrentDeviceVersionUpdatePayload = async (): Promise<UpdateDevicePayload> => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const runtime = await getRuntimeVersionSnapshot()

    return {
        name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: nav?.appVersion || 'unknown',
        application_version: runtime.applicationVersion,
    }
}

export const getCurrentRuntimeVersionSignature = async (): Promise<string> => {
    const runtime = await getRuntimeVersionSnapshot()
    return runtime.signature
}
