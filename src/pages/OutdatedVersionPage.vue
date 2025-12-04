<template>
  <q-page class="simple-page flex column items-center justify-center text-center">
    <div class="outdated-card">
      <q-icon name="warning" color="warning" size="56px" />
      <div class="text-h5 text-weight-bold q-mt-md">Update vereist</div>
      <div class="text-body1 text-grey-8 q-mt-sm">
        {{ displayMessage }}
      </div>
      <q-btn
        color="primary"
        icon="open_in_new"
        class="q-mt-lg"
        label="Download nieuwste versie"
        unelevated
        @click="openDownloadPage"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed } from 'vue'
import { useTransportklokOutdatedState } from '../services/outdatedApp'

const { outdatedMessage } = useTransportklokOutdatedState()

const displayMessage = computed(
  () =>
    outdatedMessage.value ||
    'Deze versie van de applicatie is verouderd. Download de nieuwste versie om door te gaan.'
)

const openDownloadPage = async () => {
  await openUrl('https://app.transportklok.nl/management/fleet/telematics')
}
</script>

<style scoped>
.simple-page {
  background: #f9fafc;
  min-height: 100vh;
}

.outdated-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 32px;
  max-width: 520px;
  width: 100%;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
}
</style>
