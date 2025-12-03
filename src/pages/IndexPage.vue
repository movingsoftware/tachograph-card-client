<template>
  <q-page class="simple-page flex column">
    <div class="content-area column flex-1">
      <div v-if="isConnected" class="connected-area flex column items-center justify-center">
        <TachoMainComponent />
      </div>
      <div v-else class="disconnected-area column items-center justify-center">
        <q-spinner color="primary" size="32px" v-if="isAuthBusy" />
        <div class="text-h6 text-grey-8 q-mt-md">Applicatie niet verbonden</div>
        <div class="text-body2 text-grey-7 q-mt-sm text-center">
          {{ statusMessage }}
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { listen } from '@tauri-apps/api/event'
import TachoMainComponent from '../components/TachoMainComponent.vue'
import { useConnectionManager } from '../services/connectionManager'

const {
  authState,
  statusMessage,
  pendingToken,
  isConnected,
  isCheckingLogin,
  isRequestingLogin,
  initializeConnection,
  checkStatusOnFocus,
  pausePolling,
} = useConnectionManager()

const isAuthBusy = computed(
  () => isCheckingLogin.value || isRequestingLogin.value || authState.value === 'loading' || Boolean(pendingToken.value)
)

let unlistenTauriFocus: UnlistenFn | null = null

const handleFocus = () => {
  void checkStatusOnFocus()
}

onMounted(async () => {
  window.addEventListener('focus', handleFocus)
  window.addEventListener('blur', pausePolling)
  try {
    unlistenTauriFocus = await listen('tauri://focus', handleFocus)
  } catch (error) {
    console.warn('Kon Tauri focus-event niet registreren', error)
  }
  await initializeConnection()
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
  window.removeEventListener('blur', pausePolling)
  if (unlistenTauriFocus) {
    void unlistenTauriFocus()
  }
  pausePolling()
})
</script>

<style scoped>
.simple-page {
  background: #f9fafc;
  min-height: 100vh;
}

.content-area {
  flex: 1;
  padding: 24px;
}

.connected-area,
.disconnected-area {
  flex: 1;
  border: 1px dashed #d3d7df;
  border-radius: 12px;
  background: #ffffff;
  padding: 24px;
}

.disconnected-area {
  color: #4a5568;
}

.connected-area {
  border-color: #a8e0b2;
}
</style>
