import { createApiService, createFleetService, normalizeApiError } from 'shared.js'
import { communicationEvents } from './communicationEvents'
import { useNetworkStore } from 'stores/useNetworkStore'
import { useFleetAuthStore } from 'stores/useFleetAuthStore'

const FLEET_BASE_URL = (import.meta as { env: Record<string, string> }).env.VITE_TRACKMIJN_API_DOMAIN

export const { api: fleetApi } = createApiService({
    baseURL: FLEET_BASE_URL || 'https://api.trackmijn.nl',
    communicationEvents,
    auth: () => useFleetAuthStore().authSession,
    isOnline: () => useNetworkStore().isOnline,
    timeoutMs: 27000,
    normalizeError: (error, kind) => ({
        ...normalizeApiError(error, kind),
        id: error.response?.data?.id,
    }),
})

const fleetService = createFleetService({
    api: fleetApi,
    getCompanyId: () => useFleetAuthStore().companyId,
})

export const listTachographCompanyCards = fleetService.listTachographCompanyCards
export const createTachographCompanyCard = fleetService.createTachographCompanyCard
export const updateTachographCompanyCard = fleetService.updateTachographCompanyCard
export const deleteTachographCompanyCard = fleetService.deleteTachographCompanyCard
export const getTachographClient = fleetService.getTachographCardClient
export const createTachographClient = fleetService.createTachographCardClient
export const deleteTachographClient = fleetService.deleteTachographCardClient
