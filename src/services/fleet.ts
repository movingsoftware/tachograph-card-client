import { createApiService, createFleetService } from 'shared.js'
import { communicationEvents } from './communicationEvents'
import { useNetworkStore } from 'stores/useNetworkStore'
import { useFleetStore } from 'stores/useFleetStore'

const FLEET_BASE_URL = (import.meta as { env: Record<string, string> }).env.VITE_TRACKMIJN_API_DOMAIN

const { api: fleetApi, setAuthToken: setFleetToken } = createApiService({
    baseURL: FLEET_BASE_URL || 'https://api.trackmijn.nl',
    communicationEvents,
    refreshSession: () => useFleetStore().refreshSessionToken(),
    getSessionToken: () => useFleetStore().sessionToken,
    clearSession: () => useFleetStore().clearSession(),
    isOnline: () => useNetworkStore().isOnline,
    timeoutMs: 27000,
})

const fleetService = createFleetService({
    api: fleetApi,
    getCompanyId: () => useFleetStore().companyId,
})

export { setFleetToken }
export const listTachographCompanyCards = fleetService.listTachographCompanyCards
export const createTachographCompanyCard = fleetService.createTachographCompanyCard
export const updateTachographCompanyCard = fleetService.updateTachographCompanyCard
export const deleteTachographCompanyCard = fleetService.deleteTachographCompanyCard
export const getTachographCardClient = fleetService.getTachographCardClient
export const createTachographCardClient = fleetService.createTachographCardClient
export const deleteTachographCardClient = fleetService.deleteTachographCardClient
