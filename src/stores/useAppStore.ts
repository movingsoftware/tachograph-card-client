import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useAppStatusStore } from 'shared.js'

const DEFAULT_OUTDATED_MESSAGE =  'Deze versie van de applicatie is verouderd. Download de nieuwste versie om verder te gaan.'

export const useAppStore = defineStore('app', () => {
    const appStatusStore = useAppStatusStore()
    const outdatedMessage = ref('')

    const isOutdated = computed(() => appStatusStore.issue === 'outdated')

    const markOutdated = (message?: string) => {
        outdatedMessage.value = message || DEFAULT_OUTDATED_MESSAGE
        appStatusStore.setIssue('outdated')
    }

    const clearOutdated = () => {
        outdatedMessage.value = ''
        if (appStatusStore.issue === 'outdated') {
            appStatusStore.clearIssue()
        }
    }

    return {
        outdatedMessage,
        isOutdated,
        markOutdated,
        clearOutdated,
    }
})
