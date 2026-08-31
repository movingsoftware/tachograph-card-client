import { communicationEvents } from './services/communicationEvents'
import { routeFlow } from './services/routeFlow'
import { getCurrentPath, navigateTo } from './services/routerNavigation'
import { checkAndApplyApplicationUpdate } from './services/applicationUpdate'
import { useAppStatusStore } from 'shared.js'
import { useAuthStore } from './stores/useAuthStore'

let initialized = false
let teardownHandlers: Array<() => void> = []
let outdatedFlowStarted = false

export const setupCommunicationEventListeners = () => {
  if (initialized) return
  initialized = true

  const offOffline = communicationEvents.on('offline', async () => {
    routeFlow.clear()
    await routeFlow.start('offline', {
      onComplete: async () => {
        await routeFlow.start('launch')
      },
    })
  })

  const offMaintenance = communicationEvents.on('maintenance', async () => {
    routeFlow.clear()
    await routeFlow.start('maintenance', {
      onComplete: async () => {
        await routeFlow.start('launch')
      },
    })
  })

  const offOutdated = communicationEvents.on('outdated', async (payload) => {
    const { onRecovered } = payload
    const updateResult = await checkAndApplyApplicationUpdate()

    if (updateResult.status === 'updated') {
      await useAuthStore().syncDeviceVersion()
      useAppStatusStore().clearIssue()
      await onRecovered?.()
      return
    }

    if (outdatedFlowStarted) {
      return
    }

    outdatedFlowStarted = true
    routeFlow.clear()
    await routeFlow.start('outdated', {
      onComplete: async () => {
        await routeFlow.start('launch')
      },
    })
  })

  const offUnauthorized = communicationEvents.on('unauthorized', async ({ returnPath, onAuthorized }) => {
    if (routeFlow.isFlowActive('auth')) {
      return
    }

    const targetPath = returnPath ?? getCurrentPath()

    routeFlow.clear()
    await routeFlow.start('auth', {
      onComplete: async () => {
        if (onAuthorized) {
          await onAuthorized()
          return
        }

        if (targetPath && getCurrentPath() !== targetPath) {
          await navigateTo(targetPath)
        }
      },
    })
  })

  const offForbidden = communicationEvents.on('forbidden', async () => {
    routeFlow.clear()
    await routeFlow.start('launch')
  })

  teardownHandlers = [offOffline, offMaintenance, offOutdated, offUnauthorized, offForbidden]
}

export const teardownCommunicationEventListeners = () => {
  teardownHandlers.forEach((teardown) => teardown())
  teardownHandlers = []
  initialized = false
  outdatedFlowStarted = false
}
