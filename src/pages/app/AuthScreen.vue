<template>
    <q-page class="bg-gray-50">
        <div class="content-area column flex-1">
            <div class="disconnected-area column items-center justify-center">
                <q-spinner color="primary" size="32px" v-if="isAuthBusy" />
                <div class="text-h6 text-grey-8 q-mt-md">Applicatie niet verbonden</div>
                <div class="text-body2 text-grey-7 q-mt-sm text-center">
                    {{ statusMessage }}
                </div>
                <q-btn
                    class="q-mt-lg"
                    :label="isConnected ? 'Verbreek verbinding' : 'Verbind applicatie'"
                    :color="isConnected ? 'white' : 'primary'"
                    :text-color="isConnected ? 'positive' : 'white'"
                    unelevated
                    :loading="isCheckingLogin || isRequestingLogin"
                    @click="toggleConnection"
                />
            </div>
        </div>
    </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { listen } from '@tauri-apps/api/event'
import { useAuthStore } from 'stores/useAuthStore'
import { useRouteFlow } from 'src/composables/useRouteFlow'

const authStore = useAuthStore()
const { currentFlow, next } = useRouteFlow()
const { authState, statusMessage, pendingToken, isConnected, isCheckingLogin, isRequestingLogin } =
    storeToRefs(authStore)

const isAuthBusy = computed(
    () =>
        isCheckingLogin.value ||
        isRequestingLogin.value ||
        authState.value === 'loading' ||
        Boolean(pendingToken.value),
)

let unlistenTauriFocus: UnlistenFn | null = null

const handleFocus = () => {
    void authStore.checkStatusOnFocus()
}

const toggleConnection = async () => {
    if (isConnected.value) {
        await authStore.disconnect()
        return
    }

    await authStore.connect()
}

const tryCompleteAuthFlow = async () => {
    if (!isConnected.value) {
        return
    }

    if (currentFlow.value?.name !== 'auth') {
        return
    }

    await next()
}

onMounted(async () => {
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', authStore.pausePolling)
    try {
        unlistenTauriFocus = await listen('tauri://focus', handleFocus)
    } catch (error) {
        console.warn('Kon Tauri focus-event niet registreren', error)
    }

    await tryCompleteAuthFlow()
})

onBeforeUnmount(() => {
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('blur', authStore.pausePolling)
    if (unlistenTauriFocus) {
        void unlistenTauriFocus()
    }
    authStore.pausePolling()
})

watch(
    [isConnected, currentFlow],
    async () => {
        await tryCompleteAuthFlow()
    },
    { immediate: true },
)
</script>

<style scoped>
.simple-page {
    background: #f9fafc;
}

.content-area {
    display: flex;
    flex: 1;
    min-height: 0;
    padding: 24px;
}

.disconnected-area {
    flex: 1;
    border: 1px dashed #d3d7df;
    border-radius: 12px;
    background: #ffffff;
    padding: 24px;
    color: #4a5568;
}
</style>
