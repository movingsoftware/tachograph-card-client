import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createAuthSession, getApiErrorStatus } from 'shared.js'
import type { AuthCredential } from 'shared.js'
import { fleetAuthService } from '../services/fleetAuthService'
import { persistSecret, readSecret } from '../services/secureStore'
import { useFleetStore } from './useFleetStore'

const FLEET_CREDENTIAL_KEY = 'transportklok_fleet_credential'

/** Tells whether a stored value is a complete company credential. */
const isFleetCredential = (value: unknown): value is AuthCredential =>
    typeof value === 'object' && value !== null
    && 'token' in value && typeof value.token === 'string' && value.token !== ''
    && 'context' in value && typeof value.context === 'string' && value.context !== ''

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
            persistSecret(FLEET_CREDENTIAL_KEY, JSON.stringify(value))
        },
        clear: () => {
            credential.value = null
            persistSecret(FLEET_CREDENTIAL_KEY, null)
        },
        isUnauthorized: (error) => getApiErrorStatus(error) === 401,
    })

    /** Restores the company credential kept in the OS credential store. */
    const restore = async (): Promise<void> => {
        const raw = await readSecret(FLEET_CREDENTIAL_KEY)

        if (raw === null) {
            return
        }

        const stored: unknown = JSON.parse(raw)

        if (!isFleetCredential(stored)) {
            persistSecret(FLEET_CREDENTIAL_KEY, null)
            return
        }

        fleetStore.useCompany(stored.context)
        credential.value = stored
    }

    return { token, companyId, authSession, restore }
})
