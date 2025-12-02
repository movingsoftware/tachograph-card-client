<template>
  <div class="window-shell">
    <custom-title-bar />

    <q-layout view="lHh Lpr lFf" class="window-shell__layout">
      <q-header elevated :class="headerClass">
        <q-toolbar class="toolbar">
          <div class="title-text">TransportKlok tachograafbrug</div>
          <q-btn
            :label="isConnected ? 'Verbreek verbinding' : 'Verbind applicatie'"
            :color="isConnected ? 'white' : 'primary'"
            :text-color="isConnected ? 'positive' : 'white'"
            unelevated
            :loading="isCheckingLogin || isRequestingLogin"
            @click="toggleConnection"
            class="connection-btn"
          />
        </q-toolbar>
      </q-header>

      <q-page-container>
        <router-view />
      </q-page-container>
    </q-layout>
  </div>
</template>

<script setup lang="ts">
import { useQuasar, Notify } from 'quasar'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listen } from '@tauri-apps/api/event'
import 'animate.css'
import { transportklokService } from '../services/transportklok'
import { useConnectionManager } from '../services/connectionManager'
import CustomTitleBar from '../components/CustomTitleBar.vue'
import { useTransportklokOutdatedState } from '../services/outdatedApp'

const $q = useQuasar()
const { isConnected, connect, disconnect, isCheckingLogin, isRequestingLogin } = useConnectionManager()
const { isTransportklokOutdated } = useTransportklokOutdatedState()
const router = useRouter()
const route = useRoute()

const headerClass = computed(() =>
  isConnected.value ? 'bg-positive text-white header-border' : 'bg-white text-primary header-border'
)

const toggleConnection = async () => {
  if (isConnected.value) {
    await disconnect()
  } else {
    void connect()
  }
}

watch(
  isTransportklokOutdated,
  (value) => {
    if (value && route.path !== '/outdated') {
      void router.replace('/outdated')
    }
  },
  { immediate: true }
)

const changeTheme = (value: string) => {
  switch (value) {
    case 'Auto':
      $q.dark.set('auto')
      break
    case 'Dark':
      $q.dark.set(true)
      break
    case 'Light':
      $q.dark.set(false)
      break
    default:
      console.log('Unknown theme value:', value)
  }
}

listen('global-config-server', (event) => {
  const payload = event.payload as {
    host: string
    ident: string
    dark_theme: string
  }

  changeTheme(payload.dark_theme)
  transportklokService.setServerConfigFromBackend(payload.host, payload.ident, payload.dark_theme)
  void transportklokService.applyFlespiServerConfig()
}).catch((error) => {
  console.error('Error listening to global-config-server:', error)
})

listen('global-notification', (event) => {
  const payload = event.payload as {
    notification_type: string
    message: string
  }

  const accessMessage =
    "De applicatie kan de map '~/Documents/tba' niet openen en kan daardoor niet doorgaan. Mogelijk is deze map al aangemaakt door een andere versie van het programma en gelden er lokale toegangsbeperkingen. Een mogelijke oplossing: hernoem de huidige map bijvoorbeeld naar tba1 en start de applicatie opnieuw. De applicatie maakt dan een nieuwe map met de juiste toegangsrechten.".trim()

  if (payload.notification_type === 'access') {
    Notify.create({
      message: accessMessage,
      color: 'red',
      position: 'bottom',
      timeout: 999000,
    })
  } else if (payload.notification_type === 'version') {
    Notify.create({
      message: accessMessage,
      color: 'green',
      position: 'bottom',
      timeout: 15000,
      classes: 'animate__animated animate__shakeX',
    })
  } else {
    console.log('global-notification: unknown type:', payload.notification_type)
  }
}).catch((error) => {
  console.error('Error listening to global-notification:', error)
})
</script>

<style scoped>
.window-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.window-shell__layout {
  flex: 1;
  min-height: 0;
}

.title-text {
  font-weight: 700;
  letter-spacing: 0.5px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
}

.connection-btn {
  min-width: 180px;
}

.header-border {
  border-bottom: 1px solid #e5e7eb;
}
</style>
