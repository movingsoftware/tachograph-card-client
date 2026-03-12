import { createAuthService } from 'shared.js'
import api from './api'

export interface DeviceRegistrationPayload {
    device_name: string
    device_platform?: string
    device_model?: string
    os_version?: string
    application_version?: string
    device_manufacturer?: string
}

export interface LoginPayload {
    email: string
    password: string
}

export interface AuthenticationTokenResponse {
    token: string
    '2fa_enabled': boolean
    url?: string
}

export interface AuthResponse {
    token: string
}

export interface SessionResponse {
    token: string
}

export interface UpdateDevicePayload {
    application_version: string
    name: string
    os_version: string
    fcm_token?: string | null
}

export interface TwoFactorChallengePayload {
    token: string
    code?: string | null
    recovery_code?: string | null
}

const applicationKey = (import.meta as { env: Record<string, string> }).env.VITE_APP_KEY || ''

export const authService = createAuthService({
    applicationKey,
    api,
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
