declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: string
        VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined
        VUE_ROUTER_BASE: string | undefined
        VITE_API_URL?: string
        VITE_TRACKMIJN_API_DOMAIN?: string
        VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_DOMAIN?: string
        VITE_FLESPI_TACHO_CARD_AUTH_CHANNEL_PORT?: string
        VITE_APPLICATION_KEY?: string
        VITE_APP_VERSION?: string
    }
}
