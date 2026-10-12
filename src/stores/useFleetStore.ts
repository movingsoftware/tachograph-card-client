import { defineStore } from 'pinia'
import { ref } from 'vue'

const CLIENT_COMPANY_ID_KEY = 'fleet_client_company_id'
const CLIENT_NAME_KEY = 'fleet_client_name'
const CLIENT_ID_KEY = 'fleet_client_id'

export const useFleetStore = defineStore('fleet', () => {
    const clientCompanyId = ref<string | null>(
        localStorage.getItem(CLIENT_COMPANY_ID_KEY) || localStorage.getItem('fleet_company_id'),
    )
    const clientId = ref<string | null>(localStorage.getItem(CLIENT_ID_KEY))
    const clientName = ref<string | null>(localStorage.getItem(CLIENT_NAME_KEY))

    const useCompany = (companyId: string) => {
        if (clientCompanyId.value !== companyId) {
            setClientId(null)
        }
        clientCompanyId.value = companyId
        localStorage.setItem(CLIENT_COMPANY_ID_KEY, companyId)
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
        clientCompanyId.value = null
        localStorage.removeItem(CLIENT_COMPANY_ID_KEY)
        setClientId(null)
    }

    return {
        clientCompanyId,
        clientId,
        clientName,
        useCompany,
        setClientId,
        setClientName,
        clearAuth,
    }
})
