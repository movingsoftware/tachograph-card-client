import { defineBoot } from '#q-app/wrappers'
import * as Sentry from '@sentry/vue'

export default defineBoot(({ app }) => {
  Sentry.init({
    app,
    dsn: 'https://8200a38a2da7a84eba6b906387d5b900@o1174671.ingest.us.sentry.io/4511036662939648',
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events.
    sendDefaultPii: true,
  })
})
