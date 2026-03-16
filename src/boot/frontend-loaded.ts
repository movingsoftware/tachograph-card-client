import { defineBoot } from '#q-app/wrappers'
import { emit } from '@tauri-apps/api/event'

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export default defineBoot(async () => {
  if (!isTauriRuntime()) {
    return
  }

  try {
    await emit('frontend-loaded', { message: 'Frontend boot loaded' })
  } catch (error) {
    console.warn('Error emitting frontend-loaded event:', error)
  }
})
