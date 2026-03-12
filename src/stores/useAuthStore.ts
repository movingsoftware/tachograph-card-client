import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { Notify } from 'quasar'
import {
    checkAuthenticationToken,
    createDevice,
    createSession,
    deleteDevice,
    getCurrentUser,
    requestAuthenticationTokenByWebLogin,
    updateDevice,
} from '../services/auth'
import { setAuthToken } from '../services/api'
import { useFleet } from '../composables/useFleet'
import { useFlespiStore } from './useFlespiStore'
import { useFleetStore } from './useFleetStore'
import { useCommunicationStore } from 'shared.js'
import { useAppStatusStore } from 'shared.js'
import { useNetworkStore } from './useNetworkStore'
import {
    getCurrentDeviceRegistrationPayload,
    getCurrentDeviceVersionUpdatePayload,
    getCurrentRuntimeVersionSignature,
} from '../services/deviceRuntime'
import { openUrl } from '@tauri-apps/plugin-opener'

type TransportklokUser = {
    id?: string
    email?: string
    first_name?: string
    last_name?: string
    current_role?: string
    currentOrganization?: { name?: string }
}

type StoredConnectionState = {
    pendingToken?: string
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000
const CONNECTION_STATE_KEY = 'transportklok_connection_state'
const DEVICE_TOKEN_KEY = 'transportklok_device_token'
const SESSION_TOKEN_KEY = 'transportklok_session_token'
const DEVICE_RUNTIME_SIGNATURE_KEY = 'transportklok_device_runtime_signature'
const DEVICE_RUNTIME_SIGNATURE_TOKEN_KEY = 'transportklok_device_runtime_signature_device_token'

class RoleNotAllowedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'RoleNotAllowedError'
    }
}

class TransportklokRequestError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'TransportklokRequestError'
    }
}

export const useAuthStore = defineStore('auth', () => {
    const appStatusStore = useAppStatusStore()
    const communicationStore = useCommunicationStore()
    const networkStore = useNetworkStore()
    const fleet = useFleet()
    const fleetStore = useFleetStore()
    const flespiStore = useFlespiStore()

    const authState = ref<'loading' | 'needs-login' | 'ready'>('loading')
    const statusMessage = ref('Sessie wordt gecontroleerd...')
    const user = ref<TransportklokUser | null>(null)
    const deviceToken = ref<string | null>(localStorage.getItem(DEVICE_TOKEN_KEY))
    const sessionToken = ref<string | null>(localStorage.getItem(SESSION_TOKEN_KEY))
    const pendingToken = ref<string | null>(null)
    const pollInterval = ref<number | undefined>(undefined)
    const pollStartedAt = ref<number | null>(null)
    const isRequestingLogin = ref(false)
    const isCheckingLogin = ref(false)
    const isConnected = computed(() => authState.value === 'ready')

    let focusCheckPromise: Promise<void> | null = null

    setAuthToken(sessionToken.value)

    // Session token state
    const setDeviceToken = (token: string | null) => {
        deviceToken.value = token

        if (token) {
            localStorage.setItem(DEVICE_TOKEN_KEY, token)
            return
        }

        localStorage.removeItem(DEVICE_TOKEN_KEY)
        localStorage.removeItem(DEVICE_RUNTIME_SIGNATURE_KEY)
        localStorage.removeItem(DEVICE_RUNTIME_SIGNATURE_TOKEN_KEY)
    }

    const setSessionToken = (token: string | null) => {
        sessionToken.value = token
        setAuthToken(token)

        if (token) {
            localStorage.setItem(SESSION_TOKEN_KEY, token)
            return
        }

        localStorage.removeItem(SESSION_TOKEN_KEY)
    }

    const clearSession = () => {
        setSessionToken(null)
        user.value = null
    }

    // Connection state
    const persistConnectionState = () => {
        console.log('persist', pendingToken.value)
        const state: StoredConnectionState = {}

        if (pendingToken.value) {
            state.pendingToken = pendingToken.value
        }

        if (state.pendingToken) {
            localStorage.setItem(CONNECTION_STATE_KEY, JSON.stringify(state))
            return
        }

        localStorage.removeItem(CONNECTION_STATE_KEY)
    }

    const restoreConnectionState = () => {
        const raw = localStorage.getItem(CONNECTION_STATE_KEY)

        if (!raw) {
            return
        }

        try {
            const parsed = JSON.parse(raw) as StoredConnectionState

            if (!parsed.pendingToken) {
                return
            }

            pendingToken.value = parsed.pendingToken
            statusMessage.value = 'Eerder aangevraagde authenticatie wordt gecontroleerd...'
            authState.value = 'needs-login'
            beginPolling()
        } catch (error) {
            console.warn('Kon opgeslagen verbindingsstatus niet herstellen', error)
        }
    }

    // Communication / status
    const markIssueOffline = () => {
        communicationStore.setIssue('offline')
        statusMessage.value = 'Geen internetverbinding.'
    }

    const clearCommunicationIssue = () => {
        communicationStore.clearIssue()

        if (appStatusStore.issue === 'maintenance') {
            appStatusStore.clearIssue()
        }
    }

    // Polling
    const clearPoll = () => {
        if (pollInterval.value) {
            window.clearInterval(pollInterval.value)
            pollInterval.value = undefined
        }

        pollStartedAt.value = null
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

    const resumePollingIfPending = () => {
        if (pendingToken.value && !pollInterval.value) {
            beginPolling()
        }
    }

    const pausePolling = () => {
        clearPoll()
    }

    // Auth primitives
    const requireDeviceToken = (): string => {
        if (!deviceToken.value) {
            throw new TransportklokRequestError('Niet geauthenticeerd', 401)
        }

        return deviceToken.value
    }

    const createSessionFromDevice = async (): Promise<string> => {
        const token = requireDeviceToken()

        try {
            const createdSessionToken = await createSession(token)

            if (!createdSessionToken) {
                throw new Error('Sessietoken ontbreekt in de respons')
            }

            setSessionToken(createdSessionToken)
            return createdSessionToken
        } catch {
            throw new Error('Maken van sessie uit apparaattoken mislukt')
        }
    }

    const ensureAuthenticatedSession = async () => {
        if (!sessionToken.value && deviceToken.value) {
            await createSessionFromDevice()
        }

        if (!sessionToken.value) {
            throw new TransportklokRequestError('Niet geauthenticeerd', 401)
        }
    }

    const refreshSessionToken = async (): Promise<boolean> => {
        if (!deviceToken.value) {
            return false
        }

        try {
            await createSessionFromDevice()
            return true
        } catch {
            return false
        }
    }

    const syncDeviceVersion = async () => {
        if (!deviceToken.value) {
            return false
        }

        const [runtimeSignature, updatePayload] = await Promise.all([
            getCurrentRuntimeVersionSignature(),
            getCurrentDeviceVersionUpdatePayload(),
        ])

        const storedRuntimeSignature = localStorage.getItem(DEVICE_RUNTIME_SIGNATURE_KEY)
        const storedRuntimeToken = localStorage.getItem(DEVICE_RUNTIME_SIGNATURE_TOKEN_KEY)
        const tokenChanged = storedRuntimeToken !== deviceToken.value
        const signatureChanged = storedRuntimeSignature !== runtimeSignature

        if (!tokenChanged && !signatureChanged) {
            return false
        }

        await updateDevice(deviceToken.value, updatePayload)
        localStorage.setItem(DEVICE_RUNTIME_SIGNATURE_KEY, runtimeSignature)
        localStorage.setItem(DEVICE_RUNTIME_SIGNATURE_TOKEN_KEY, deviceToken.value)

        return true
    }

    const fetchUser = async (): Promise<TransportklokUser> => {
        try {
            const currentUser = (await getCurrentUser()) as TransportklokUser | null

            if (!currentUser) {
                throw new Error('Ongeldige resultaat')
            }

            return currentUser
        } catch (error) {
            const status = (error as { status?: number }).status
            throw new TransportklokRequestError('Verzoek mislukt', status || 500)
        }
    }

    const clearAuth = async () => {
        const token = deviceToken.value

        if (token) {
            try {
                await deleteDevice(token)
            } catch (error) {
                const status = (error as { status?: number }).status

                if (status && status !== 404) {
                    console.warn('Kon apparaat niet verwijderen', error)
                }
            }
        }

        setDeviceToken(null)
        setSessionToken(null)
        fleet.clearAuth()
    }

    const validateUserRole = async (currentUser: TransportklokUser) => {
        if (currentUser.current_role !== 'employee') {
            return
        }

        await clearAuth()
        throw new RoleNotAllowedError(
            'Medewerkersaccounts zijn niet toegestaan voor tachograafauthenticatie.',
        )
    }

    // Flows
    const refreshSession = async () => {
        isCheckingLogin.value = true
        statusMessage.value = 'Opgeslagen sessie wordt gevalideerd...'

        try {
            await ensureAuthenticatedSession()

            clearPoll()
            pendingToken.value = null
            persistConnectionState()

            const currentUser = await fetchUser()
            await validateUserRole(currentUser)
            user.value = currentUser

            await syncDeviceVersion()

            await fleet.ensureSetup()

            clearCommunicationIssue()

            statusMessage.value = 'Verbonden.'
            authState.value = 'ready'
        } catch (error) {
            authState.value = 'needs-login'

            if (!networkStore.isOnline) {
                markIssueOffline()
            }

            if (error instanceof RoleNotAllowedError) {
                Notify.create({
                    message: 'Dit accounttype mag de tachograafbrug niet gebruiken.',
                    color: 'negative',
                    position: 'bottom',
                })
                statusMessage.value = error.message
            } else if (error instanceof TransportklokRequestError && error.status === 401) {
                statusMessage.value = 'Meld je aan bij TransportKlok.'
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

            isRequestingLogin.value = false

            pendingToken.value = null
            persistConnectionState()

            statusMessage.value = 'Authenticatie verlopen, probeer opnieuw te verbinden.'
            authState.value = 'needs-login'
            return
        }

        const token = pendingToken.value

        if (!token) {
            clearPoll()
            return
        }

        try {
            const result = await checkAuthenticationToken(token)

            if (result.error) {
                if (result.status === 404) {
                    return
                }

                throw new Error(result.message || 'Kan authenticatietoken niet controleren.')
            }

            if (!result.success) {
                return
            }

            clearPoll()
            statusMessage.value = 'Bevestiging ontvangen, sessie wordt aangemaakt...'

            const createdDevicePayload = getCurrentDeviceRegistrationPayload()
            const createdDeviceToken = await createDevice(createdDevicePayload, token)

            if (!createdDeviceToken) {
                throw new Error('Apparaattoken ontbreekt in de respons')
            }

            setDeviceToken(createdDeviceToken)
            await createSessionFromDevice()

            pendingToken.value = null
            persistConnectionState()

            const currentUser = await fetchUser()
            await validateUserRole(currentUser)
            user.value = currentUser

            await syncDeviceVersion()
            await fleet.ensureSetup()

            clearCommunicationIssue()

            statusMessage.value = 'Verbonden.'
            authState.value = 'ready'
        } catch (error) {
            statusMessage.value =
                (error as Error).message || 'Kan authenticatietoken niet controleren.'
        }
    }

    const connect = async () => {
        isRequestingLogin.value = true
        statusMessage.value = 'Authenticatie wordt aangevraagd...'
        clearPoll()

        try {
            const response = await requestAuthenticationTokenByWebLogin()

            if (response.error || !response.authenticationToken || !response.url) {
                throw new Error(response.message || 'Kan de aanmelding niet starten.')
            }

            pendingToken.value = response.authenticationToken
            persistConnectionState()

            await openUrl(response.url)

            statusMessage.value = 'Voltooi de aanmelding in je browser; wij controleren dit automatisch.'
            beginPolling()
        } catch (error) {
            statusMessage.value = (error as Error).message || 'Kan de aanmelding niet starten.'
        } finally {
            isRequestingLogin.value = false
        }
    }

    const disconnect = async () => {
        clearPoll()
        user.value = null
        pendingToken.value = null
        persistConnectionState()

        try {
            if (fleetStore.clientId) {
                statusMessage.value = 'Verbinding wordt verbroken...'
                await fleet.deleteClient(fleetStore.clientId)
            }
        } catch (error) {
            console.error('Kon client niet verwijderen', error)
            Notify.create({
                message: (error as Error).message || 'Kon client niet verwijderen',
                color: 'negative',
                position: 'bottom',
            })
        } finally {
            await clearAuth()
            communicationStore.clearIssue()
            persistConnectionState()

            authState.value = 'needs-login'
            statusMessage.value = 'Niet verbonden.'
        }
    }

    const initializeConnection = async () => {
        restoreConnectionState()
        await refreshSession()
    }

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

    return {
        authState,
        deviceToken,
        sessionToken,
        statusMessage,
        user,
        pendingToken,
        isConnected,
        isRequestingLogin,
        isCheckingLogin,
        connect,
        disconnect,
        initializeConnection,
        clearSession,
        clearAuth,
        refreshSession,
        refreshSessionToken,
        syncDeviceVersion,
        resumePollingIfPending,
        pausePolling,
        checkStatusOnFocus,
        setServerConfigFromBackend: flespiStore.setServerConfigFromBackend,
        applyFlespiServerConfig: flespiStore.applyFlespiServerConfig,
    }
})
