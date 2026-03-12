import type { DeviceRegistrationPayload, UpdateDevicePayload } from './auth'
import { platform } from '@tauri-apps/plugin-os'

const BUNDLED_APP_VERSION = import.meta.env.VITE_APP_VERSION

type RuntimeVersionSnapshot = {
    applicationVersion: string
    nativeApplicationVersion: string
    signature: string
}

const getRuntimeVersionSnapshot = (): RuntimeVersionSnapshot => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const nativeApplicationVersion = BUNDLED_APP_VERSION
    const applicationVersion = BUNDLED_APP_VERSION || nativeApplicationVersion
    const platform = nav?.platform || 'desktop'
    const userAgent = nav?.userAgent || 'unknown'
    const signature = `${platform}:${applicationVersion}:${nativeApplicationVersion}:${userAgent}`

    return {
        applicationVersion,
        nativeApplicationVersion,
        signature,
    }
}

export const getCurrentDeviceRegistrationPayload = (): DeviceRegistrationPayload => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const runtime = getRuntimeVersionSnapshot()

    return {
        device_manufacturer: nav?.vendor || 'desktop-client',
        device_platform: platform(),
        device_model: nav?.userAgent || 'TransportKlok Desktop',
        device_name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: platform(),
        application_version: runtime.applicationVersion,
    }
}

export const getCurrentDeviceVersionUpdatePayload = (): UpdateDevicePayload => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const runtime = getRuntimeVersionSnapshot()

    return {
        name: nav?.userAgent || 'TransportKlok Desktop',
        os_version: nav?.appVersion || 'unknown',
        application_version: runtime.applicationVersion,
    }
}

export const getCurrentRuntimeVersionSignature = () => {
    const runtime = getRuntimeVersionSnapshot()
    return runtime.signature
}
