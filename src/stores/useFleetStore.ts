import { defineStore } from 'pinia'
import { ref } from 'vue'

const TOKEN_KEY = 'fleet_token'
const COMPANY_ID_KEY = 'fleet_company_id'
const CLIENT_NAME_KEY = 'fleet_client_name'
const CLIENT_ID_KEY = 'fleet_client_id'

export const useFleetStore = defineStore('fleet', () => {
    const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
    const companyId = ref<string | null>(localStorage.getItem(COMPANY_ID_KEY))
    const clientId = ref<string | null>(localStorage.getItem(CLIENT_ID_KEY))
    const clientName = ref<string | null>(localStorage.getItem(CLIENT_NAME_KEY))

    const setToken = (value: string | null) => {
        token.value = value

        if (value) {
            localStorage.setItem(TOKEN_KEY, value)
        } else {
            localStorage.removeItem(TOKEN_KEY)
        }
    }

    // Backward-compatible alias used by auth flow.
    const setSessionToken = (value: string | null) => {
        setToken(value)
    }

    const setCompanyId = (value: string | null) => {
        companyId.value = value

        if (value) {
            localStorage.setItem(COMPANY_ID_KEY, value)
        } else {
            localStorage.removeItem(COMPANY_ID_KEY)
        }
    }

    const setClientName = (value: string) => {
        clientName.value = value

        localStorage.setItem(CLIENT_NAME_KEY, value)
    }

    const setClientId = (value: string | null) => {
        clientId.value = value

        if (value) {
            localStorage.setItem(CLIENT_ID_KEY, value)
        } else {
            localStorage.removeItem(CLIENT_ID_KEY)
        }
    }

    const clearAuth = () => {
        setToken(null)
        setCompanyId(null)
        setClientId(null)
    }

    return {
        token,
        companyId,
        clientId,
        clientName,
        setToken,
        setSessionToken,
        setCompanyId,
        setClientId,
        setClientName,
        clearAuth,
    }
})
