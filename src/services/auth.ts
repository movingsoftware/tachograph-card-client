import { createAuthService } from 'shared.js'
import type { DeviceRegistrationPayload as SharedDeviceRegistrationPayload } from 'shared.js'
import api from './api'

/** The device registration body, with the installation id the card reader adds. */
export type DeviceRegistrationPayload = SharedDeviceRegistrationPayload & { installation_id: string }

const applicationKey = (import.meta as { env: Record<string, string> }).env.VITE_APP_KEY || ''

const appOrigin = new URL(
    (import.meta as { env: Record<string, string> }).env.VITE_TRANSPORTKLOK_APP_URL || 'https://app.transportklok.nl',
).origin

/** Tells whether a browser sign-in link opens on the TransportKlok app host. */
export const opensOnAppHost = (url: string): boolean => URL.canParse(url) && new URL(url).origin === appOrigin

export const authService = createAuthService({
    getApplicationKey: () => applicationKey,
    get api() { return api },
})

export const requestAuthenticationTokenByCredentials =
    authService.requestAuthenticationTokenByCredentials
export const requestTwoFactorChallenge = authService.requestTwoFactorChallenge
export const requestAuthenticationTokenByWebLogin = authService.requestAuthenticationTokenByWebLogin
export const checkAuthenticationToken = authService.checkAuthenticationToken
export const createDevice = authService.createDevice
export const createSession = authService.createSession
export const deleteDevice = authService.deleteDevice
export const getCurrentUser = authService.getCurrentUser
export const updateDevice = authService.updateDevice
