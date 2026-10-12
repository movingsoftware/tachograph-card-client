import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createAuthSession, getApiErrorStatus } from 'shared.js'
import type { AuthCredential } from 'shared.js'
import { fleetAuthService } from '../services/fleetAuthService'
import { useFleetStore } from './useFleetStore'

export const useFleetAuthStore = defineStore('fleet-auth', () => {
    const fleetStore = useFleetStore()
    const credential = ref<AuthCredential | null>(null)
    const token = computed(() => credential.value === null ? null : credential.value.token)
    const companyId = computed(() => credential.value === null ? null : credential.value.context)

    // Legacy storage may contain a Platform token; acquire a company credential afresh.
    localStorage.removeItem('fleet_token')
    localStorage.removeItem('fleet_company_id')

    const authSession = createAuthSession({
        getToken: () => token.value,
        getContext: () => companyId.value,
        issue: fleetAuthService.issue,
        store: (value) => {
            fleetStore.useCompany(value.context)
            credential.value = value
        },
        clear: () => { credential.value = null },
        isUnauthorized: (error) => getApiErrorStatus(error) === 401,
    })

    return { token, companyId, authSession }
})
