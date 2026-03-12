import { createApiService } from 'shared.js'
import { communicationEvents } from './communicationEvents'
import { useNetworkStore } from 'stores/useNetworkStore'
import { useAuthStore } from 'stores/useAuthStore'

const API_BASE_URL =
    (import.meta as { env: Record<string, string> }).env.VITE_TRANSPORTKLOK_API_DOMAIN ||
    'https://api.transportklok.nl'

const { api, setAuthToken } = createApiService({
    baseURL: API_BASE_URL,
    communicationEvents,
    refreshSession: () => useAuthStore().refreshSessionToken(),
    getSessionToken: () => useAuthStore().sessionToken,
    clearSession: () => useAuthStore().clearSession(),
    isOnline: () => useNetworkStore().isOnline,
})

export { setAuthToken }
export default api
