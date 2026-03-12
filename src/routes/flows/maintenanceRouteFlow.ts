import { watch } from 'vue'
import { createStepRouteFlow, type RouteFlow, type RouteFlowStep, useAppStatusStore } from 'shared.js'
import { ROUTES } from '../../enums/routes'
import { getCurrentPath, replaceRoute } from '../../services/routerNavigation'

export const createMaintenanceRouteFlow = (): RouteFlow<'maintenance'> => {
  const appStatusStore = useAppStatusStore()

  const isResolved = () => appStatusStore.issue !== 'maintenance'

  return createStepRouteFlow('maintenance', [
    {
      id: 'show-maintenance',
      run: async ({ next }) => {
        if (isResolved()) {
          await next()
          return
        }

        if (getCurrentPath() !== ROUTES.ERROR_MAINTENANCE) {
          await replaceRoute(ROUTES.ERROR_MAINTENANCE)
        }

        const stop = watch(
          () => appStatusStore.issue,
          async () => {
            if (!isResolved()) return
            stop()
            await next()
          }
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
