interface ImportMetaEnv {
    readonly VITE_APP_VERSION: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: string
        VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined
        VUE_ROUTER_BASE: string | undefined
        VITE_TRANSPORTKLOK_API_DOMAIN?: string
        VITE_TRACKMIJN_API_DOMAIN?: string
        VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_DOMAIN?: string
        VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_PORT?: string
        VITE_APP_KEY?: string
        VITE_APP_VERSION: string
        VITE_BUNDLE_UPDATER_ENABLED?: string
        VITE_BUNDLE_UPDATER_API_BASE_URL?: string
        VITE_BUNDLE_UPDATER_APPLICATION_ID?: string
        VITE_BUNDLE_UPDATER_SIGNING_KEY_ID?: string
    }
}
