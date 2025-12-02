import { openUrl } from '@tauri-apps/plugin-opener'
import { Notify } from 'quasar'
import { computed, ref } from 'vue'
import { RoleNotAllowedError, transportklokService, type TransportklokUser } from './transportklok'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000

const authState = ref<'loading' | 'needs-login' | 'ready'>('loading')
const statusMessage = ref('TransportKlok-sessie wordt gecontroleerd...')
const user = ref<TransportklokUser | null>(null)
const pendingToken = ref('')
const pollInterval = ref<number | undefined>(undefined)
const pollStartedAt = ref<number | null>(null)
const isRequestingLogin = ref(false)
const isCheckingLogin = ref(false)

const isConnected = computed(() => authState.value === 'ready')

const clearPoll = () => {
  if (pollInterval.value) {
    window.clearInterval(pollInterval.value)
    pollInterval.value = undefined
  }
  pollStartedAt.value = null
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
  } catch (error) {
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
    }
  } catch (error) {
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
    await openUrl(response.url)
    statusMessage.value = 'Voltooi de aanmelding in je browser; wij controleren dit automatisch.'
    beginPolling()
  } catch (error) {
    statusMessage.value = (error as Error).message || 'Kan de aanmelding niet starten.'
  } finally {
    isRequestingLogin.value = false
  }
}

const disconnect = () => {
  clearPoll()
  pendingToken.value = ''
  user.value = null
  transportklokService.clearAuth()
  authState.value = 'needs-login'
  statusMessage.value = 'Niet verbonden met TransportKlok.'
}

const initializeConnection = async () => {
  await transportklokService.applyFlespiServerConfig()
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
  }
}
