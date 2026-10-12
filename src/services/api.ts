import { createApiService } from 'shared.js'
import { communicationEvents } from './communicationEvents'
import { useNetworkStore } from 'stores/useNetworkStore'
import { useAuthStore } from 'stores/useAuthStore'

const API_BASE_URL =
    (import.meta as { env: Record<string, string> }).env.VITE_TRANSPORTKLOK_API_DOMAIN ||
    'https://api.transportklok.nl'

const { api } = createApiService({
    baseURL: API_BASE_URL,
    communicationEvents,
    auth: () => useAuthStore().authSession,
    onUnauthorized: () => { void communicationEvents.emitUnauthorized() },
    isOnline: () => useNetworkStore().isOnline,
})

export default api
