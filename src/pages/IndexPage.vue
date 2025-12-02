<template>
  <q-page class="simple-page flex column">
    <div class="content-area column flex-1">
      <div v-if="isConnected" class="connected-area flex column items-center justify-center">
        <TachoMainComponent />
      </div>
      <div v-else class="disconnected-area column items-center justify-center">
        <q-spinner color="primary" size="32px" v-if="isCheckingLogin || authState === 'loading'" />
        <div class="text-h6 text-grey-8 q-mt-md">Applicatie niet verbonden</div>
        <div class="text-body2 text-grey-7 q-mt-sm text-center">
          {{ statusMessage }}
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import TachoMainComponent from '../components/TachoMainComponent.vue'
import { useConnectionManager } from '../services/connectionManager'

const { authState, statusMessage, isConnected, isCheckingLogin, initializeConnection, resumePollingIfPending, pausePolling } =
  useConnectionManager()

onMounted(async () => {
  window.addEventListener('focus', resumePollingIfPending)
  window.addEventListener('blur', pausePolling)
  await initializeConnection()
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', resumePollingIfPending)
  window.removeEventListener('blur', pausePolling)
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
