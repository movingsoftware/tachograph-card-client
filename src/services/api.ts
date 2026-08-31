import { createApiService, type SessionRefreshOutcome } from 'shared.js'
import { communicationEvents } from './communicationEvents'
import { useNetworkStore } from 'stores/useNetworkStore'
import { useAuthStore } from 'stores/useAuthStore'

const API_BASE_URL =
    (import.meta as { env: Record<string, string | undefined> }).env.VITE_API_URL ||
    'https://api.transportklok.nl'

const { api, setAuthToken } = createApiService({
    baseURL: API_BASE_URL,
    communicationEvents,
    getSessionToken: () => useAuthStore().sessionToken,
    clearSession: () => useAuthStore().clearSession(),
    isOnline: () => useNetworkStore().isOnline,
    refreshSession: async (): Promise<SessionRefreshOutcome> => {
        const refreshed = await useAuthStore().refreshSessionToken()

        return refreshed ? 'success' : 'unauthorized'
    },
})

export { setAuthToken }
export default api
