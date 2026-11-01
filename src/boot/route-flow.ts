import { defineBoot } from '#q-app/wrappers'
import { setupCommunicationEventListeners } from '../communicationEventListeners'
import { routeFlow } from '../services/routeFlow'
import { confirmWebBundleOnSettledRoutes } from '../services/webBundleTrial'
import { bundleUpdatesCanStartRouteFlow } from './bundle-updates'

export default defineBoot(async ({ router }) => {
  if (!bundleUpdatesCanStartRouteFlow) return

  setupCommunicationEventListeners()
  confirmWebBundleOnSettledRoutes(router)

  try {
    await routeFlow.start('launch')
  } catch (error) {
    console.error('[RouteFlow] Failed to start launch flow:', error)
  }
})
