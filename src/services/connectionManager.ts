import { openUrl } from '@tauri-apps/plugin-opener'
import { Notify } from 'quasar'
import { computed, ref } from 'vue'
import {
  RoleNotAllowedError,
  TransportklokOutdatedError,
  transportklokService,
  type TransportklokUser,
} from './transportklok'
import { markTransportklokOutdated } from './outdatedApp'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000
const CONNECTION_STATE_KEY = 'transportklok_connection_state'

type StoredConnectionState = {
  pendingToken?: string
}

const authState = ref<'loading' | 'needs-login' | 'ready'>('loading')
const statusMessage = ref('TransportKlok-sessie wordt gecontroleerd...')
const user = ref<TransportklokUser | null>(null)
const pendingToken = ref('')
const pollInterval = ref<number | undefined>(undefined)
const pollStartedAt = ref<number | null>(null)
const isRequestingLogin = ref(false)
const isCheckingLogin = ref(false)

const isConnected = computed(() => authState.value === 'ready')

const persistConnectionState = () => {
  const state: StoredConnectionState = {}
  if (pendingToken.value) {
    state.pendingToken = pendingToken.value
  }

  if (state.pendingToken) {
    localStorage.setItem(CONNECTION_STATE_KEY, JSON.stringify(state))
  } else {
    localStorage.removeItem(CONNECTION_STATE_KEY)
  }
}

const restoreConnectionState = () => {
  const raw = localStorage.getItem(CONNECTION_STATE_KEY)
  if (!raw) {
    return
  }

  try {
    const parsed = JSON.parse(raw) as StoredConnectionState
    if (parsed.pendingToken) {
      pendingToken.value = parsed.pendingToken
      statusMessage.value = 'Eerder aangevraagde authenticatie wordt gecontroleerd...'
      authState.value = 'needs-login'
      beginPolling()
    }
  } catch (error) {
    console.warn('Kon opgeslagen verbindingsstatus niet herstellen', error)
  }
}

const clearPoll = () => {
  if (pollInterval.value) {
    window.clearInterval(pollInterval.value)
    pollInterval.value = undefined
  }
  pollStartedAt.value = null
}

const handleTransportklokOutdated = (error: unknown): error is TransportklokOutdatedError => {
  if (error instanceof TransportklokOutdatedError) {
    markTransportklokOutdated(error.message)
    clearPoll()
    authState.value = 'needs-login'
    statusMessage.value = error.message
    return true
  }
  return false
}

const refreshSession = async () => {
  isCheckingLogin.value = true
  statusMessage.value = 'Opgeslagen TransportKlok-sessie wordt gevalideerd...'

  try {
    const currentUser = await transportklokService.ensureSession()
    user.value = currentUser
    await transportklokService.ensureTrackmijnSetup()
    statusMessage.value = 'Verbonden met TransportKlok en TrackMijn.'
    authState.value = 'ready'
    persistConnectionState()
  } catch (error) {
    if (handleTransportklokOutdated(error)) {
      return
    }
    authState.value = 'needs-login'
    if (error instanceof RoleNotAllowedError) {
      Notify.create({
        message: 'Dit accounttype mag de tachograafbrug niet gebruiken.',
        color: 'negative',
        position: 'bottom',
      })
      statusMessage.value = error.message
      transportklokService.clearAuth()
    } else {
      statusMessage.value = (error as Error).message || 'Meld je aan bij TransportKlok.'
    }
  } finally {
    isCheckingLogin.value = false
  }
}

const pollForSession = async () => {
  if (pollStartedAt.value && Date.now() - pollStartedAt.value > MAX_POLL_DURATION_MS) {
    clearPoll()
    statusMessage.value = 'Authenticatie verlopen, probeer opnieuw te verbinden.'
    isRequestingLogin.value = false
    authState.value = 'needs-login'
    pendingToken.value = ''
    persistConnectionState()
    return
  }

  const token = pendingToken.value
  if (!token) {
    clearPoll()
    return
  }

  try {
    const isTokenValid = await transportklokService.checkAuthenticationToken(token)
    if (isTokenValid) {
      clearPoll()
      statusMessage.value = 'Bevestiging ontvangen, sessie wordt aangemaakt...'
      const currentUser = await transportklokService.completeDeviceLogin(token)
      user.value = currentUser
      await transportklokService.ensureTrackmijnSetup()
      statusMessage.value = 'Verbonden met TransportKlok en TrackMijn.'
      authState.value = 'ready'
      pendingToken.value = ''
      persistConnectionState()
    }
  } catch (error) {
    if (handleTransportklokOutdated(error)) {
      return
    }
    statusMessage.value = (error as Error).message || 'Kan authenticatietoken niet controleren.'
  }
}

const beginPolling = () => {
  if (pollInterval.value) {
    return
  }

  pollStartedAt.value = Date.now()
  pollInterval.value = window.setInterval(() => {
    void pollForSession()
  }, POLL_INTERVAL_MS)
}

const startLogin = async () => {
  isRequestingLogin.value = true
  statusMessage.value = 'TransportKlok-authenticatietoken wordt aangevraagd...'
  clearPoll()

  try {
    const response = await transportklokService.requestDeviceAuthentication()
    pendingToken.value = response.token
    persistConnectionState()
    let redirectUrl = response.url

    try {
      const loginUrl = new URL(response.url)
      loginUrl.searchParams.set('redirect', 'transportklok_tachograph_connector://open')
      redirectUrl = loginUrl.toString()
    } catch (error) {
      console.warn('Kon redirect parameter niet toevoegen aan de inlog-URL', error)
    }

    await openUrl(redirectUrl)
    statusMessage.value = 'Voltooi de aanmelding in je browser; wij controleren dit automatisch.'
    beginPolling()
  } catch (error) {
    if (handleTransportklokOutdated(error)) {
      return
    }
    statusMessage.value = (error as Error).message || 'Kan de aanmelding niet starten.'
  } finally {
    isRequestingLogin.value = false
  }
}

const disconnect = async () => {
  clearPoll()
  pendingToken.value = ''
  user.value = null
  persistConnectionState()
  const { deviceId } = transportklokService.getTrackmijnInfo()

  try {
    if (deviceId) {
      statusMessage.value = 'Verbinding wordt verbroken...'
      await transportklokService.deleteTachoBridgeClient(deviceId)
    }
  } catch (error) {
    console.error('Kon TrackMijn-client niet verwijderen', error)
    Notify.create({
      message: (error as Error).message || 'Kon TrackMijn-client niet verwijderen',
      color: 'negative',
      position: 'bottom',
    })
  } finally {
    transportklokService.clearAuth()
    authState.value = 'needs-login'
    statusMessage.value = 'Niet verbonden met TransportKlok.'
    persistConnectionState()
  }
}

const initializeConnection = async () => {
  await transportklokService.applyFlespiServerConfig()
  restoreConnectionState()
  await refreshSession()
}

const resumePollingIfPending = () => {
  if (pendingToken.value && !pollInterval.value) {
    beginPolling()
  }
}

const pausePolling = () => {
  clearPoll()
}

let focusCheckPromise: Promise<void> | null = null

const checkStatusOnFocus = async () => {
  if (focusCheckPromise) {
    return focusCheckPromise
  }

  focusCheckPromise = (async () => {
    try {
      resumePollingIfPending()

      if (pendingToken.value) {
        await pollForSession()
        return
      }

      await refreshSession()
    } finally {
      focusCheckPromise = null
    }
  })()

  return focusCheckPromise
}

export function useConnectionManager() {
  return {
    authState,
    statusMessage,
    pendingToken,
    isCheckingLogin,
    isConnected,
    isRequestingLogin,
    connect: startLogin,
    disconnect,
    initializeConnection,
    refreshSession,
    resumePollingIfPending,
    pausePolling,
    checkStatusOnFocus,
  }
}
