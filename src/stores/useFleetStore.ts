import { defineStore } from 'pinia'
import { ref } from 'vue'
import { requestManagementFleetManagementToken } from 'src/services/auth'

const SESSION_TOKEN_KEY = 'fleet_session_token'
const COMPANY_ID_KEY = 'fleet_company_id'
const CLIENT_NAME_KEY = 'fleet_client_name'
const CLIENT_ID_KEY = 'fleet_client_id'

export const useFleetStore = defineStore('fleet', () => {
    const sessionToken = ref<string | null>(localStorage.getItem(SESSION_TOKEN_KEY))
    const companyId = ref<string | null>(localStorage.getItem(COMPANY_ID_KEY))
    const clientId = ref<string | null>(localStorage.getItem(CLIENT_ID_KEY))
    const clientName = ref<string | null>(localStorage.getItem(CLIENT_NAME_KEY))

    const setSessionToken = (value: string | null) => {
        sessionToken.value = value

        if (value) {
            localStorage.setItem(SESSION_TOKEN_KEY, value)
        } else {
            localStorage.removeItem(SESSION_TOKEN_KEY)
        }
    }

    const refreshSessionToken = async (): Promise<boolean> => {
        const data = await requestManagementFleetManagementToken()

        setSessionToken(data.token);
        setCompanyId(data.company_id);

        return true;
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

    const clearSession = () => {
        setSessionToken(null)
        setCompanyId(null)
        setClientId(null)
    }

    return {
        sessionToken,
        companyId,
        clientId,
        clientName,
        setSessionToken,
        refreshSessionToken,
        setCompanyId,
        setClientId,
        setClientName,
        clearSession,
    }
})
