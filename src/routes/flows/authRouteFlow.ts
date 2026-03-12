import type { RouteFlow } from 'shared.js'
import { createStepRouteFlow, type RouteFlowStep } from 'shared.js'
import { useAuthStore } from 'stores/useAuthStore'
import type { AuthRouteFlowOptions } from 'src/services/routeFlow'
import { ROUTES } from 'src/enums/routes'
import { replaceRoute } from 'src/services/routerNavigation'

export const createAuthRouteFlow = (options: AuthRouteFlowOptions): RouteFlow<'auth'> => {
    void options
    const authStore = useAuthStore()

    return createStepRouteFlow('auth', [
        {
            id: 'restore-session',
            run: async ({ next }) => {
                await authStore.initializeConnection()
                await next()
            },
        },
        {
            id: 'check-authenticated',
            run: async ({ next }) => {
                if (authStore.isConnected) {
                    await next()
                    return
                }

                await replaceRoute(ROUTES.AUTH)
            },
        },
        {
            id: 'complete',
            run: async ({ complete }) => {
                await complete()
            },
        },
    ] as RouteFlowStep[])
}
