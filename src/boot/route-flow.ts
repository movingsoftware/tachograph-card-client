import { defineBoot } from '#q-app/wrappers'
import { setupCommunicationEventListeners } from '../communicationEventListeners'
import { routeFlow } from '../services/routeFlow'

export default defineBoot(async () => {
  setupCommunicationEventListeners()

  try {
    await routeFlow.start('launch')
  } catch (error) {
    console.error('[RouteFlow] Failed to start launch flow:', error)
  }
})
