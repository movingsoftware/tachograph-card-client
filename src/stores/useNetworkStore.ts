import { defineStore } from 'pinia'
import { ref } from 'vue'

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
let listenersBound = false

const bindNetworkListeners = () => {
  if (listenersBound || typeof window === 'undefined') {
    return
  }

  listenersBound = true
  window.addEventListener('online', () => {
    online.value = true
  })
  window.addEventListener('offline', () => {
    online.value = false
  })
}

export const useNetworkStore = defineStore('network', () => {
  bindNetworkListeners()
  return {
    isOnline: online,
  }
})
