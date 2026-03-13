<template>
    <q-header class="bg-white text-dark q-py-sm q-px-md">
        <div class="title-text">TransportKlok Tachograafkaart Verbinder</div>
    </q-header>

    <q-page-container class="fit">
        <router-view />
    </q-page-container>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar'
import { listen } from '@tauri-apps/api/event'
import { useFlespiStore } from 'stores/useFlespiStore'
import 'animate.css'

const $q = useQuasar()
const flespiStore = useFlespiStore()

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
    flespiStore.setServerConfigFromBackend(payload.host, payload.ident, payload.dark_theme)
}).catch((error) => {
    console.error('Error listening to global-config-server:', error)
})

// // eslint-disable-next-line @typescript-eslint/no-misused-promises
// listen('global-notification', async (event) => {
//     // const payload = event.payload as {
//     //     notification_type: string
//     //     message: string
//     // }
//     //
//     // const accessMessage =
//     //     "De applicatie kan de map '~/Documents/TransportKlok/TachoConnect' niet openen en kan daardoor niet doorgaan. Mogelijk is deze map al aangemaakt door een andere versie van het programma en gelden er lokale toegangsbeperkingen. Een mogelijke oplossing: hernoem de huidige map bijvoorbeeld naar tba1 en start de applicatie opnieuw. De applicatie maakt dan een nieuwe map met de juiste toegangsrechten.".trim()
//
//     // if (payload.notification_type === 'access') {
//     //     Notify.create({
//     //         message: accessMessage,
//     //         color: 'red',
//     //         position: 'bottom',
//     //         timeout: 999000,
//     //     })
//     // } else if (payload.notification_type === 'version') {
//     //     Notify.create({
//     //         message: accessMessage,
//     //         color: 'green',
//     //         position: 'bottom',
//     //         timeout: 15000,
//     //         classes: 'animate__animated animate__shakeX',
//     //     })
//     // } else {
//     //     console.log('global-notification: unknown type:', payload.notification_type)
//     // }
// }).catch((error) => {
//     console.error('Error listening to global-notification:', error)
// })
</script>

<style scoped>
.title-text {
    font-weight: 700;
    letter-spacing: 0.5px;
    text-align: center;
    white-space: nowrap;
}

@media (max-width: 600px) {
    .title-text {
        white-space: normal;
        text-align: center;
    }
}
</style>
