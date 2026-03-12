import { createRouteFlowService } from 'shared.js'
import type {
  RouteFlow as SharedRouteFlow,
  RouteFlowActions,
  RouteFlowStartOptions as SharedRouteFlowStartOptions,
} from 'shared.js'
import { createAuthRouteFlow } from '../routes/flows/authRouteFlow'
import { createLaunchRouteFlow } from '../routes/flows/launchRouteFlow'
import { createMaintenanceRouteFlow } from '../routes/flows/maintenanceRouteFlow'
import { createOfflineRouteFlow } from '../routes/flows/offlineRouteFlow'
import { createOutdatedRouteFlow } from '../routes/flows/outdatedRouteFlow'

export type RouteFlowName = 'launch' | 'auth' | 'offline' | 'maintenance' | 'outdated'
export type RouteFlow = SharedRouteFlow<RouteFlowName>
export type RouteFlowStartOptions = SharedRouteFlowStartOptions

export type AuthRouteFlowOptions = RouteFlowActions<'auth'>
export type LaunchRouteFlowOptions = RouteFlowActions<'auth'>

export const routeFlow = createRouteFlowService<RouteFlowName>({
  createFlowFactories: (flowActions) => ({
    auth: () => createAuthRouteFlow(flowActions),
    launch: () => createLaunchRouteFlow(flowActions),
    offline: () => createOfflineRouteFlow(),
    maintenance: () => createMaintenanceRouteFlow(),
    outdated: () => createOutdatedRouteFlow(),
  }),
  canStartChildFlow: (parent) => !!parent && parent.name === 'launch',
})
