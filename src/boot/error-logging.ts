import { defineBoot } from '#q-app/wrappers'
import { logger } from 'src/services/logger'

let initialized = false

export default defineBoot(() => {
  if (initialized || typeof window === 'undefined') {
    return
  }

  initialized = true

  window.addEventListener('error', (event) => {
    const error = event.error ?? new Error(event.message || 'Uncaught window error')
    void logger.error(
      `global.window.error filename=${event.filename || 'unknown'} lineno=${event.lineno || 0} colno=${event.colno || 0}`,
      error
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    void logger.error('global.unhandledrejection', event.reason)
  })
})
