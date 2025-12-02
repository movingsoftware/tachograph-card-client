import { ref } from 'vue'

const isTransportklokOutdated = ref(false)
const outdatedMessage = ref('')

export function markTransportklokOutdated(message?: string) {
  isTransportklokOutdated.value = true
  outdatedMessage.value =
    message || 'Deze versie van de applicatie is verouderd. Download de nieuwste versie om verder te gaan.'
}

export function useTransportklokOutdatedState() {
  return {
    isTransportklokOutdated,
    outdatedMessage,
  }
}
