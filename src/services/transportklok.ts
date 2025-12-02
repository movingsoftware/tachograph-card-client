import { invoke } from '@tauri-apps/api/core'

export type TransportklokUser = {
  id?: string
  email?: string
  first_name?: string
  last_name?: string
  current_role?: string
  currentOrganization?: { name?: string }
}

type DeviceAuthenticationResponse = {
  token: string
  url: string
}

type DeviceTokenResponse = {
  token: string
}

type SessionResponse = {
  token: string
}

type TrackmijnTokenResponse = {
  token: string
  company_id: string
}

export class RoleNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleNotAllowedError'
  }
}

type ServerTheme = 'Auto' | 'Dark' | 'Light'

const DEVICE_TOKEN_KEY = 'transportklok_device_token'
const SESSION_TOKEN_KEY = 'transportklok_session_token'
const TRACKMIJN_TOKEN_KEY = 'transportklok_trackmijn_token'
const TRACKMIJN_COMPANY_KEY = 'transportklok_trackmijn_company'
const TRACKMIJN_CLIENT_KEY = 'transportklok_trackmijn_client_identifier'
const TRACKMIJN_DEVICE_ID_KEY = 'transportklok_trackmijn_device_id'
const TRACKMIJN_IDENTIFIER_PREFIX = 'TBA'
const TRACKMIJN_IDENTIFIER_PATTERN = /^TBA\d{13}$/

// const DEFAULT_TRANSPORTKLOK_DOMAIN = 'https://api.transportklok.nl'
// const DEFAULT_TRACKMIJN_DOMAIN = 'https://api.trackmijn.nl'

const DEFAULT_TRANSPORTKLOK_DOMAIN = 'http://127.0.0.1:8000/api'
const DEFAULT_TRACKMIJN_DOMAIN = 'http://127.0.0.1:8001/api'

function normalizeBaseUrl(url: string | undefined, fallback: string): string {
  const trimmed = url?.trim().replace(/\/?$/, '')
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function buildJsonHeaders(additional: HeadersInit = {}): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...additional,
  }
}

function generateTrackmijnIdentifier() {
  const randomDigits = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('')
  return `${TRACKMIJN_IDENTIFIER_PREFIX}${randomDigits}`
}

function normalizeTrackmijnIdentifier(identifier: string | null) {
  if (identifier && TRACKMIJN_IDENTIFIER_PATTERN.test(identifier)) {
    return identifier
  }

  const numericPortion = (identifier ?? '').replace(/\D/g, '').slice(-13)
  if (numericPortion.length === 0) {
    return generateTrackmijnIdentifier()
  }
  const digits = numericPortion.padStart(13, '0').slice(0, 13)
  return `${TRACKMIJN_IDENTIFIER_PREFIX}${digits}`
}

async function parseJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T
  } catch (error) {
    console.warn('Could not parse JSON response', error)
    return undefined
  }
}

function getAppVersion(): string {
  return (import.meta as { env: Record<string, string> }).env.APP_VERSION || '0.0.0'
}

function getAppKey(): string|null {
  return '747b4beacb8e2f2962d3037cda03b234e8a5fa432cab2df9d7af396d2e5d7ae0'
}

function buildDeviceDetails() {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  return {
    device_name: nav?.userAgent ?? 'TransportKlok Desktop',
    device_platform: (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform ?? 'web',
    device_model: nav?.vendor ?? 'browser',
    os_version: nav?.appVersion ?? 'unknown',
    application_version: getAppVersion(),
    device_manufacturer: 'TransportKlok',
  }
}

export class TransportklokService {
  private transportklokBase: string
  private trackmijnBase: string
  private flespiHost: string
  private cachedIdent = ''
  private cachedTheme: ServerTheme = 'Auto'
  private cachedServerHost = ''
  private hasAppliedEnvHost = false

  private deviceToken: string | null
  private sessionToken: string | null
  private trackmijnToken: string | null
  private trackmijnCompanyId: string | null
  private trackmijnClientIdentifier: string
  private trackmijnDeviceId: string | null

  constructor() {
    this.transportklokBase = normalizeBaseUrl(
      (import.meta as { env: Record<string, string> }).env.VITE_TRANSPORTKLOK_API_DOMAIN,
      DEFAULT_TRANSPORTKLOK_DOMAIN
    )
    this.trackmijnBase = normalizeBaseUrl(
      (import.meta as { env: Record<string, string> }).env.VITE_TRACKMIJN_API_DOMAIN,
      DEFAULT_TRACKMIJN_DOMAIN
    )
    const flespiDomain = (import.meta as { env: Record<string, string> }).env.VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_DOMAIN || ''
    const flespiPort = (import.meta as { env: Record<string, string> }).env.VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_PORT || ''
    this.flespiHost = flespiDomain ? `${flespiDomain}${flespiPort ? `:${flespiPort}` : ''}` : ''

    this.deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY)
    this.sessionToken = localStorage.getItem(SESSION_TOKEN_KEY)
    this.trackmijnToken = localStorage.getItem(TRACKMIJN_TOKEN_KEY)
    this.trackmijnCompanyId = localStorage.getItem(TRACKMIJN_COMPANY_KEY)
    this.trackmijnClientIdentifier = normalizeTrackmijnIdentifier(localStorage.getItem(TRACKMIJN_CLIENT_KEY))
    this.trackmijnDeviceId = localStorage.getItem(TRACKMIJN_DEVICE_ID_KEY)
  }

  setServerConfigFromBackend(host: string, ident: string, theme: string) {
    this.cachedServerHost = host
    this.cachedIdent = ident
    this.cachedTheme = theme as ServerTheme || 'Auto'
  }

  async applyFlespiServerConfig() {
    if (!this.flespiHost) return
    if (this.cachedServerHost === this.flespiHost && this.hasAppliedEnvHost) {
      return
    }

    try {
      await invoke('update_server', {
        host: this.flespiHost,
        ident: this.cachedIdent,
        theme: this.cachedTheme,
      })
      await invoke('manual_sync_cards', { readername: '', restart: true })
      await invoke('app_connection')
      this.cachedServerHost = this.flespiHost
      this.hasAppliedEnvHost = true
    } catch (error) {
      console.error('Unable to push Flespi server configuration', error)
    }
  }

  private persistTokens() {
    if (this.deviceToken) {
      localStorage.setItem(DEVICE_TOKEN_KEY, this.deviceToken)
    }
    if (this.sessionToken) {
      localStorage.setItem(SESSION_TOKEN_KEY, this.sessionToken)
    }
    if (this.trackmijnToken) {
      localStorage.setItem(TRACKMIJN_TOKEN_KEY, this.trackmijnToken)
    }
    if (this.trackmijnCompanyId) {
      localStorage.setItem(TRACKMIJN_COMPANY_KEY, this.trackmijnCompanyId)
    }
    localStorage.setItem(TRACKMIJN_CLIENT_KEY, this.trackmijnClientIdentifier)
    if (this.trackmijnDeviceId) {
      localStorage.setItem(TRACKMIJN_DEVICE_ID_KEY, this.trackmijnDeviceId)
    }
  }

  clearAuth() {
    this.deviceToken = null
    this.sessionToken = null
    this.trackmijnToken = null
    this.trackmijnCompanyId = null
    this.trackmijnDeviceId = null
    localStorage.removeItem(DEVICE_TOKEN_KEY)
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(TRACKMIJN_TOKEN_KEY)
    localStorage.removeItem(TRACKMIJN_COMPANY_KEY)
    localStorage.removeItem(TRACKMIJN_DEVICE_ID_KEY)
  }

  async requestDeviceAuthentication(): Promise<DeviceAuthenticationResponse> {
    const response = await fetch(`${this.transportklokBase}/auth/device/authentication-token`, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({
        mode: 'web',
        application_key: getAppKey()
      }),
    })

    if (!response.ok) {
      throw new Error('Kon TransportKlok-apparatauthenticatie niet starten')
    }

    const data = await parseJson<DeviceAuthenticationResponse>(response)
    if (!data?.token || !data?.url) {
      throw new Error('Onverwachte reactie tijdens het starten van authenticatie')
    }

    return data
  }

  async checkAuthenticationToken(token: string): Promise<boolean> {
    const response = await fetch(
      `${this.transportklokBase}/auth/device/authentication-token/check?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
      }
    )

    if (response.status === 404) {
      return false
    }

    if (response.status === 200) {
      const payload = await parseJson<{ success?: boolean }>(response)
      return payload?.success === true
    }

    throw new Error('Kan authenticatietoken niet verifiëren')
  }

  async completeDeviceLogin(token: string): Promise<TransportklokUser> {
    await this.registerDevice(token)
    await this.createSessionFromDevice()
    const user = await this.fetchCurrentUser()
    this.persistAfterUserValidation(user)
    return user
  }

  private async registerDevice(token: string) {
    const response = await fetch(`${this.transportklokBase}/auth/device`, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ token, ...buildDeviceDetails() }),
    })

    if (!response.ok) {
      throw new Error('Registreren van apparaat mislukt')
    }

    const data = await parseJson<DeviceTokenResponse>(response)
    if (!data?.token) {
      throw new Error('Apparaattoken ontbreekt in de respons')
    }

    this.deviceToken = data.token
    this.persistTokens()
  }

  private async createSessionFromDevice(): Promise<string> {
    if (!this.deviceToken) {
      throw new Error('Apparaattoken ontbreekt, log opnieuw in')
    }

    const response = await fetch(`${this.transportklokBase}/auth/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deviceToken}`,
      },
    })

    if (!response.ok) {
      throw new Error('Maken van sessie uit apparaattoken mislukt')
    }

    const data = await parseJson<SessionResponse>(response)
    if (!data?.token) {
      throw new Error('Sessietoken ontbreekt in de respons')
    }

    this.sessionToken = data.token
    this.persistTokens()
    return data.token
  }

  private async transportklokRequest<T>(path: string, init: RequestInit = {}, retrySession = true): Promise<T> {
    if (!this.sessionToken && this.deviceToken) {
      await this.createSessionFromDevice()
    }
    if (!this.sessionToken) {
      throw new Error('Niet geauthenticeerd bij TransportKlok')
    }

    const response = await fetch(`${this.transportklokBase}${path}`, {
      ...init,
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        ...(init.headers || {}),
      },
    })

    if (response.status === 401 && retrySession && this.deviceToken) {
      await this.createSessionFromDevice()
      return this.transportklokRequest<T>(path, {}, false)
    }

    if (!response.ok) {
      const data = await parseJson(response)
      console.error('TransportKlok request failed', data)
      throw new Error('TransportKlok-verzoek mislukt')
    }

    const data = await parseJson<T>(response)
    if (!data) {
      throw new Error('Ongeldige TransportKlok-respons')
    }

    return data
  }

  async fetchCurrentUser(): Promise<TransportklokUser> {
    const user = await this.transportklokRequest<TransportklokUser>(
      '/rest/me?relations[]=currentOrganization.name&relations[]=current_role'
    )
    return user
  }

  private persistAfterUserValidation(user: TransportklokUser) {
    if (user.current_role === 'employee') {
      this.clearAuth()
      throw new RoleNotAllowedError('Medewerkersaccounts zijn niet toegestaan voor tachograafauthenticatie.')
    }
    this.persistTokens()
  }

  async ensureSession(): Promise<TransportklokUser> {
    if (!this.sessionToken && this.deviceToken) {
      await this.createSessionFromDevice()
    }

    const user = await this.fetchCurrentUser()
    this.persistAfterUserValidation(user)
    return user
  }

  private async createTrackmijnToken(force = false): Promise<TrackmijnTokenResponse> {
    if (!force && this.trackmijnToken && this.trackmijnCompanyId) {
      return { token: this.trackmijnToken, company_id: this.trackmijnCompanyId }
    }

    const payload = await this.transportklokRequest<TrackmijnTokenResponse>(
      '/actions/management/fleet/tokens',
      { method: 'POST' }
    )
    if (!payload?.token || !payload?.company_id) {
      throw new Error('Kan TrackMijn-token niet aanmaken')
    }

    this.trackmijnToken = payload.token
    this.trackmijnCompanyId = payload.company_id
    this.persistTokens()
    return payload
  }

  private async trackmijnRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    if (!this.trackmijnToken || !this.trackmijnCompanyId) {
      await this.createTrackmijnToken()
    }

    if (!this.trackmijnToken) {
      throw new Error('TrackMijn-token ontbreekt')
    }

    const response = await fetch(`${this.trackmijnBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.trackmijnToken}`,
        ...init.headers,
      },
    })

    if (response.status === 401 && retry) {
      await this.createTrackmijnToken(true)
      return this.trackmijnRequest<T>(path, init, false)
    }

    if (!response.ok) {
      const data = await parseJson(response)
      console.error('TrackMijn request failed', data)
      throw new Error('TrackMijn-verzoek mislukt')
    }

    const data = await parseJson<T>(response)
    return data as T
  }

  private resetTrackmijnDeviceId() {
    this.trackmijnDeviceId = null
    localStorage.removeItem(TRACKMIJN_DEVICE_ID_KEY)
  }

  private async trackmijnClientExists(deviceId: string, retry = true): Promise<boolean> {
    if (!this.trackmijnCompanyId) {
      return false
    }

    const path = `/v1/companies/${this.trackmijnCompanyId}/tachograph-company-card-clients/${deviceId}`
    const response = await fetch(`${this.trackmijnBase}${path}`, {
      method: 'GET',
      headers: buildJsonHeaders({ Authorization: `Bearer ${this.trackmijnToken ?? ''}` }),
    })

    if (response.status === 401 && retry) {
      await this.createTrackmijnToken(true)
      return this.trackmijnClientExists(deviceId, false)
    }

    if (response.status === 404) {
      return false
    }

    if (!response.ok) {
      const data = await parseJson(response)
      console.error('Unable to verify TrackMijn tacho bridge client', data)
      throw new Error('Kan TrackMijn-tachobridgeclient niet verifiëren')
    }

    return true
  }

  private async createTachoBridgeClient(): Promise<string> {
    if (!this.trackmijnCompanyId) {
      await this.createTrackmijnToken(true)
    }
    if (!this.trackmijnCompanyId) {
      throw new Error('Kan TrackMijn-bedrijfs-ID niet bepalen')
    }

    const path = `/v1/companies/${this.trackmijnCompanyId}/tachograph-company-card-clients`
    const response = await fetch(`${this.trackmijnBase}${path}`, {
      method: 'POST',
      headers: buildJsonHeaders({ Authorization: `Bearer ${this.trackmijnToken ?? ''}` }),
      body: JSON.stringify({ client_identifier: this.trackmijnClientIdentifier }),
    })

    if (response.status === 401) {
      await this.createTrackmijnToken(true)
      return this.createTachoBridgeClient()
    }

    if (!response.ok && response.status !== 409) {
      const data = await parseJson(response)
      console.error('Unable to create TrackMijn tacho bridge client', data)
      throw new Error('Kan TrackMijn-tachobridgeclient niet aanmaken')
    }

    const data = await parseJson<{ device_id?: string }>(response)
    if (data?.device_id) {
      this.trackmijnDeviceId = data.device_id
      this.persistTokens()
      return data.device_id
    }

    if (response.status === 409 && this.trackmijnDeviceId) {
      return this.trackmijnDeviceId
    }

    throw new Error('Kan apparaat-ID van TrackMijn-tachobridgeclient niet bepalen')
  }

  async ensureTrackmijnSetup() {
    await this.createTrackmijnToken()
    await this.ensureTachoBridgeClient()
  }

  async ensureTachoBridgeClient(): Promise<void> {
    if (!this.trackmijnCompanyId) {
      await this.createTrackmijnToken(true)
    }
    if (!this.trackmijnCompanyId) {
      throw new Error('Kan TrackMijn-bedrijfs-ID niet bepalen')
    }

    for (let attempts = 0; attempts < 2; attempts++) {
      if (this.trackmijnDeviceId) {
        const exists = await this.trackmijnClientExists(this.trackmijnDeviceId)
        if (exists) {
          return
        }
        this.resetTrackmijnDeviceId()
      }

      const deviceId = await this.createTachoBridgeClient()
      const exists = await this.trackmijnClientExists(deviceId)

      if (exists) {
        return
      }

      this.resetTrackmijnDeviceId()
    }

    throw new Error('Kan TrackMijn-tachobridgeclient niet aanmaken of verifiëren')
  }

  getSessionToken(): string | null {
    return this.sessionToken
  }

  getTrackmijnInfo() {
    return {
      token: this.trackmijnToken,
      companyId: this.trackmijnCompanyId,
      clientIdentifier: this.trackmijnClientIdentifier,
      deviceId: this.trackmijnDeviceId,
    }
  }

  getTransportklokBase() {
    return this.transportklokBase
  }

  getFlespiHost() {
    return this.flespiHost
  }
}

export const transportklokService = new TransportklokService()
