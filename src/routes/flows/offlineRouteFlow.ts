import { watch } from 'vue'
import {
    createStepRouteFlow,
    type RouteFlow,
    type RouteFlowStep,
    useCommunicationStore,
} from 'shared.js'
import { ROUTES } from 'src/enums/routes'
import { useNetworkStore } from 'stores/useNetworkStore'
import { getCurrentPath, replaceRoute } from 'src/services/routerNavigation'

export const createOfflineRouteFlow = (): RouteFlow<'offline'> => {
    const networkStore = useNetworkStore()
    const communicationStore = useCommunicationStore()

    const isResolved = () => {
        const issue = communicationStore.issue
        return networkStore.isOnline && issue !== 'offline'
    }

    return createStepRouteFlow('offline', [
        {
            id: 'show-offline',
            run: async ({ next }) => {
                if (isResolved()) {
                    await next()
                    return
                }

                if (getCurrentPath() !== ROUTES.OFFLINE) {
                    await replaceRoute(ROUTES.OFFLINE)
                }

                const stop = watch(
                    [() => networkStore.isOnline, () => communicationStore.issue],
                    async () => {
                        if (!isResolved()) return
                        stop()
                        await next()
                    },
                )
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
