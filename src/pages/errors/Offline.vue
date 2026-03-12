<template>
  <q-page class="simple-page flex column items-center justify-center text-center">
    <div class="error-card">
      <q-icon name="wifi_off" color="negative" size="56px" />
      <div class="text-h5 text-weight-bold q-mt-md">Geen internetverbinding</div>
      <div class="text-body1 text-grey-8 q-mt-sm">
        Er is momenteel geen netwerkverbinding. Zodra je online bent, kun je opnieuw proberen.
      </div>
      <q-btn color="primary" class="q-mt-lg" label="Opnieuw controleren" unelevated @click="retryLaunch" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useRouteFlow } from 'src/composables/useRouteFlow'
import { useCommunicationStore } from 'shared.js'

defineOptions({
  name: 'ErrorOfflinePage',
})

const communicationStore = useCommunicationStore()
const { start, currentFlow } = useRouteFlow()

const retryLaunch = async () => {
  if (currentFlow.value?.name === 'offline') {
    return
  }

  communicationStore.clearIssue()
  await start('launch')
}
</script>

<style scoped>
.simple-page {
  background: #f9fafc;
  min-height: 100vh;
}

.error-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 32px;
  max-width: 520px;
  width: 100%;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
}
</style>
