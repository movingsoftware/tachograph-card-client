import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

type ServerTheme = 'Auto' | 'Dark' | 'Light'

const TRACKMIJN_CLIENT_KEY = 'transportklok_trackmijn_client_identifier'

export const useFlespiStore = defineStore('flespi', () => {
    const flespiDomain =
        (import.meta as { env: Record<string, string> }).env
            .VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_DOMAIN || ''
    const flespiPort =
        (import.meta as { env: Record<string, string> }).env
            .VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_PORT || ''

    const flespiHost = ref(
        flespiDomain ? `${flespiDomain}${flespiPort ? `:${flespiPort}` : ''}` : '',
    )
    const cachedIdent = ref(localStorage.getItem(TRACKMIJN_CLIENT_KEY) || '')
    const cachedTheme = ref<ServerTheme>('Auto')
    const lastAppliedConfig = ref<{ host: string; ident: string; theme: ServerTheme } | null>(null)

    const setCachedIdent = (ident: string) => {
        if (ident) {
            cachedIdent.value = ident
        }
    }

    const setServerConfigFromBackend = (host: string, ident: string, theme: string) => {
        if (host) {
            flespiHost.value = host
        }

        if (ident) {
            cachedIdent.value = ident
        }

        cachedTheme.value = (theme as ServerTheme) || 'Auto'
    }

    const applyFlespiServerConfig = async () => {
        const host = flespiHost.value || 'ch1330201.flespi.gw:29466'
        const ident = cachedIdent.value
        const theme = cachedTheme.value || 'Auto'

        if (!host || !ident) {
            return
        }

        if (
            lastAppliedConfig.value &&
            lastAppliedConfig.value.host === host &&
            lastAppliedConfig.value.ident === ident &&
            lastAppliedConfig.value.theme === theme
        ) {
            return
        }

        try {
            await invoke('update_server', { host, ident, theme })
            await invoke('manual_sync_cards', { readername: '', restart: true })
            await invoke('app_connection')
            lastAppliedConfig.value = { host, ident, theme }
        } catch (error) {
            console.error('Unable to push Flespi server configuration', error)
        }
    }

    return {
        flespiHost,
        cachedIdent,
        cachedTheme,
        setCachedIdent,
        setServerConfigFromBackend,
        applyFlespiServerConfig,
    }
})
