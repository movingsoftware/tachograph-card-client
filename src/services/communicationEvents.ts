import { createCommunicationEvents } from 'shared.js'
import { getCurrentPath } from './routerNavigation'

export const communicationEvents = createCommunicationEvents({
  getCurrentPath,
})
