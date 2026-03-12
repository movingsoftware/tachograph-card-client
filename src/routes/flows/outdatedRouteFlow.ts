import { watch } from 'vue'
import { createStepRouteFlow, type RouteFlow, type RouteFlowStep, useAppStatusStore } from 'shared.js'
import { ROUTES } from '../../enums/routes'
import { getCurrentPath, replaceRoute } from '../../services/routerNavigation'

export const createOutdatedRouteFlow = (): RouteFlow<'outdated'> => {
  const appStatusStore = useAppStatusStore()

  const isResolved = () => appStatusStore.issue !== 'outdated'

  return createStepRouteFlow('outdated', [
    {
      id: 'show-outdated',
      run: async ({ next }) => {
        if (isResolved()) {
          await next()
          return
        }

        if (getCurrentPath() !== ROUTES.ERROR_OUTDATED) {
          await replaceRoute(ROUTES.ERROR_OUTDATED)
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
