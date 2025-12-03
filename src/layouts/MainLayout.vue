<template>
  <div class="window-shell">
    <q-layout view="lHh Lpr lFf" class="window-shell__layout">
      <q-header elevated :class="headerClass" data-tauri-drag-region>
        <div class="app-header">
          <div class="control-dots" aria-label="Window controls" data-tauri-drag-region="false">
            <button class="control-dots__button control-dots__button--close" type="button" @click="handleClose" />
            <button class="control-dots__button control-dots__button--minimize" type="button" @click="handleMinimize" />
            <button
              class="control-dots__button control-dots__button--maximize"
              type="button"
              @click="handleToggleMaximize"
            />
          </div>
          <div class="title-text">TransportKlok tachograaf verbinder</div>
          <q-btn
            class="connection-btn"
            :label="isConnected ? 'Verbreek verbinding' : 'Verbind applicatie'"
            :color="isConnected ? 'white' : 'primary'"
            :text-color="isConnected ? 'positive' : 'white'"
            dense
            unelevated
            :loading="isCheckingLogin || isRequestingLogin"
            @click="toggleConnection"
            data-tauri-drag-region="false"
          />
        </div>
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
import { useTransportklokOutdatedState } from '../services/outdatedApp'
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../services/windowControls'

const $q = useQuasar()
const { isConnected, connect, disconnect, isCheckingLogin, isRequestingLogin } = useConnectionManager()
const { isTransportklokOutdated } = useTransportklokOutdatedState()
const router = useRouter()
const route = useRoute()

const headerClass = computed(() => [
  isConnected.value ? 'bg-positive text-white' : 'bg-white text-primary',
  'header-border',
])

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

const handleMinimize = async () => {
  await minimizeWindow()
}

const handleToggleMaximize = async () => {
  await toggleMaximizeWindow()
}

const handleClose = async () => {
  await closeWindow()
}
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

.app-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  -webkit-app-region: drag;
}

.title-text {
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: center;
  white-space: nowrap;
}

.connection-btn {
  min-width: 160px;
  -webkit-app-region: no-drag;
}

.header-border {
  border-bottom: 1px solid #e5e7eb;
}

.control-dots {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.control-dots__button {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: transform 0.15s ease;
  cursor: pointer;
}

.control-dots__button:hover {
  transform: scale(1.05);
}

.control-dots__button:active {
  transform: scale(0.95);
}

.control-dots__button--close {
  background: #ff5f56;
}

.control-dots__button--minimize {
  background: #ffbd2e;
}

.control-dots__button--maximize {
  background: #27c93f;
}

@media (max-width: 600px) {
  .app-header {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    align-items: center;
  }

  .title-text {
    grid-column: 1 / -1;
  }
}
</style>
