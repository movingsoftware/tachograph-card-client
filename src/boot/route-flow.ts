import { defineBoot } from '#q-app/wrappers'
import { setupCommunicationEventListeners } from '../communicationEventListeners'
import { routeFlow } from '../services/routeFlow'
import { bundleUpdatesCanStartRouteFlow } from './bundle-updates'

export default defineBoot(async () => {
  if (!bundleUpdatesCanStartRouteFlow) return

  setupCommunicationEventListeners()

  try {
    await routeFlow.start('launch')
  } catch (error) {
    console.error('[RouteFlow] Failed to start launch flow:', error)
  }
})
