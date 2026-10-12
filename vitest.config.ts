import { defineConfig } from 'vite'
import type { UserConfig as VitestUserConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const test: VitestUserConfig['test'] = {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
}

const config = {
    plugins: [vue()],
    test,
    resolve: {
        dedupe: ['vue', 'pinia'],
        alias: {
            src: fileURLToPath(new URL('./src', import.meta.url)),
            stores: fileURLToPath(new URL('./src/stores', import.meta.url)),
        },
    },
}

export default defineConfig(config)
