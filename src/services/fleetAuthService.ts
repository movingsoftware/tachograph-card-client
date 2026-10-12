import { AuthSessionInvalidatedError } from 'shared.js'
import type { AuthCredential } from 'shared.js'
import { authService } from './auth'
import { useAuthStore } from '../stores/useAuthStore'

export const fleetAuthService = {
    issue: async (): Promise<AuthCredential> => {
        if (useAuthStore().isDisconnecting) {
            throw new AuthSessionInvalidatedError()
        }
        const response = await authService.requestManagementTrackMijnToken()
        return { token: response.token, context: response.company_id }
    },
}
