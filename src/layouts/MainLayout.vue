<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-white text-primary">
      <q-toolbar>
        <q-toolbar-title class="q-ml-md title-text">
          TransportKlok tachograph bridge
          <q-icon name="mdi-record-circle-outline" class="q-ml-md" color="orange-8" />
        </q-toolbar-title>
        <div class="q-mr-md text-caption text-grey-8">Server: {{ host || 'configuring...' }}</div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { useQuasar, Notify } from 'quasar'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import 'animate.css'
import { transportklokService } from '../services/transportklok'

const host = ref('')
const $q = useQuasar()

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

  host.value = payload.host
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

  if (payload.notification_type === 'access') {
    Notify.create({
      message:
        "The application cannot access the directory '~/Documents/tba' and cannot continue to operate. Perhaps such a directory has already been created by another version of the program, therefore it has local access restrictions. A possible solution may be: rename the current directory, for example, to tba1 and restart the application. It will create a new directory with the necessary access rights.",
      color: 'red',
      position: 'bottom',
      timeout: 999000,
    })
  } else if (payload.notification_type === 'version') {
    Notify.create({
      message:
        "The application cannot access the directory '~/Documents/tba' and cannot continue to operate. Perhaps such a directory has already been created by another version of the program, therefore it has local access restrictions. A possible solution may be: rename the current directory, for example, to tba1 and restart the application. It will create a new directory with the necessary access rights.",
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
.title-text {
  font-weight: 700;
  letter-spacing: 0.5px;
}
</style>
