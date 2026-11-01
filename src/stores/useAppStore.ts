import { defineStore } from 'pinia'
import { useAppStatusStore } from 'shared.js'

export const useAppStore = defineStore('app', () => {
    const appStatusStore = useAppStatusStore()

    const clearOutdated = () => {
        if (appStatusStore.issue === 'outdated') {
            appStatusStore.clearIssue()
        }
    }

    return {
        clearOutdated,
    }
})
