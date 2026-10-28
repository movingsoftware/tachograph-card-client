import { createStepRouteFlow, type RouteFlowStep, type RouteFlow } from 'shared.js'
import { ROUTES } from 'src/enums/routes'
import { replaceRoute } from 'src/services/routerNavigation'
import { checkBundleUpdates } from 'src/boot/bundle-updates'
import type { LaunchRouteFlowOptions } from 'src/services/routeFlow'

export const createLaunchRouteFlow = ({ startChildFlow }: LaunchRouteFlowOptions): RouteFlow<'launch'> => {
    return createStepRouteFlow('launch', [
        {
            id: 'check-bundle-update',
            run: async ({ context, next }) => {
                if (await checkBundleUpdates() !== 'continue') return
                await next(context)
            },
        },
        {
            id: 'auth',
            run: async ({ context, next }) => {
                await startChildFlow('auth', {
                    context,
                    onComplete: async (childContext) => {
                        await next(childContext)
                    },
                })
            },
        },
        {
            id: 'app-entry',
            run: async ({ complete }) => {
                await replaceRoute(ROUTES.HOME)
                await complete()
            },
        },
    ] as RouteFlowStep[])
}
