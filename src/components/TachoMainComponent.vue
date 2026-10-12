<template>
  <div style="width: 100%">
    <div class="rounded-borders" style="border: 1px solid #666">
      <template v-if="state.readers.length === 0">
        <div class="q-pa-md text-grey text-h6">
          Geen aangesloten smartcardlezers
        </div>
      </template>
      <template v-for="reader in state.readers" :key="reader.name">
        <div class="row reader">
        <q-item class="col-6" style="min-height: 50px" dense>
          <q-item-section avatar>
            <q-icon name="mdi-usb-port" :color="reader.status !== 'UNKNOWN' ? 'green' : 'red'" />
          </q-item-section>
          <q-item-section>
            <q-item-label caption lines="3" class="text-grey text-bold">
              <small>{{ reader.name }}</small>
            </q-item-label>
          </q-item-section>
        </q-item>
        <template v-if="reader.status !== 'UNKNOWN'">
          <q-item class="col-6" style="min-height: 50px" dense>
          <q-item-section avatar>
            <q-icon v-bind="cardConnectedStatus(reader)" />
          </q-item-section>

          <q-item-section>
            <template v-if="!reader.card_number && reader.iccid">
              <q-item-label lines="1">ONBEKENDE KAART</q-item-label>
              <q-item-label lines="1" caption>
                <q-chip dense size="sm" color="grey" class="text-dark text-bold">
                  ICCID: {{ reader.iccid }}
                </q-chip>
              </q-item-label>
            </template>
            <template v-if="reader.card_number">
              <template v-if="state.cards && reader.card_number && state.cards[reader.card_number]">
                <q-item-label lines="1">
                  {{ state.cards[reader.card_number]?.name }}
                </q-item-label>
              </template>
              <q-item-label lines="1">
                <span class="text-weight-medium">{{ reader.card_number }}</span>
              </q-item-label>
            </template>

            <template v-if="!reader.iccid && !reader.card_number">
              <q-item-label lines="1">
                <span class="text-weight-medium text-grey-6">LEGE SLEUF</span>
              </q-item-label>
            </template>
          </q-item-section>
          <template v-if="reader.iccid && !reader.card_number">
            <q-item-section side>
              <div class="text-grey-8 q-gutter-xs">
                <q-btn size="12px" flat dense round icon="mdi-link" @click="linkMode(reader.iccid)" />
              </div>
            </q-item-section>
          </template>
        </q-item>
        </template>
        </div>
      </template>
    </div>
    <SmartCardList
      ref="cardlist"
      :cards="state.cards"
      @add-card="addCard"
      @update-card="updateCard"
      @delete-card="removeCard"
    />
  </div>
</template>

<style scoped>
.reader {
  border-bottom: 1px solid #666;
}
.reader:last-child {
  border-bottom: 0;
}
.blinking-icon {
  animation: blink 1300ms infinite;
}

@keyframes blink {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.37;
  }
  100% {
    opacity: 1;
  }
}
.toolbar-block {
  margin-bottom: 8px;
}
.custom-font-size-reader {
  font-size: 10px;
}
.header-flex-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-right: 16px;
}
.card-number-dialog .q-card {
  height: 160px; /* Window height */
  max-height: 90vh; /* Maximum window height */
}
</style>

<script setup lang="ts">
import SmartCardList from './SmartCardList.vue'
import type { SmartCard, Reader } from './models'
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event'
import { useFleet, type FleetOperation } from '../composables/useFleet'
import { useFleetAuthStore } from '../stores/useFleetAuthStore'

// Blinking status for the card icon during authentication.
const isBlinking = ref(true) // controls the blinking status of the icon

const cardlist = ref<null | { linkMode: (iccid: string) => null; openAddDialog: () => null }>(null)

// reactive state for the readers and cards
const state = reactive({
  readers: [] as Reader[],
  cards: {} as Record<string, SmartCard>,
})

type SyncRun = Readonly<{ generation: number; promise: Promise<void> }>
let syncRun: SyncRun | null = null
const fleet = useFleet()
const fleetAuthStore = useFleetAuthStore()
const authSession = fleetAuthStore.authSession
const bootstrapSnapshot = authSession.snapshot()
let bootstrapOpen = true
let disposed = false
let startupFailed = false
let bootstrapReadyResolve: (() => void) | null = null
const bootstrapReady = new Promise<void>((resolve) => { bootstrapReadyResolve = resolve })
const listenerRegistrations: Array<Promise<UnlistenFn>> = []
const activeUnlisteners = new Set<UnlistenFn>()

const registerListener = (event: string, callback: (event: { payload: unknown }) => void) => {
  const registration = listen(event, callback)
  listenerRegistrations.push(registration)
  void registration.then((unlisten) => {
    if (disposed) {
      void unlisten()
      return
    }
    activeUnlisteners.add(unlisten)
  }).catch((error) => {
    startupFailed = true
    finishBootstrap()
    console.error(`Error listening to ${event}:`, error)
  })
  return registration
}

const isBootstrapCurrent = () => {
  const current = authSession.snapshot()
  return current.generation === bootstrapSnapshot.generation && (
    bootstrapSnapshot.context === null || current.context === bootstrapSnapshot.context
  )
}

const finishBootstrap = () => {
  if (!bootstrapOpen) return
  bootstrapOpen = false
  bootstrapReadyResolve?.()
  bootstrapReadyResolve = null
}

const assertComponentLive = (operation: FleetOperation) => {
  operation.assertCurrent()
  if (disposed) throw new Error('Component is unmounted')
  if (startupFailed) throw new Error('Component startup failed')
}

watch(() => fleetAuthStore.companyId, (companyId, previousCompanyId) => {
  if (previousCompanyId !== null && companyId !== previousCompanyId) {
    for (const cardNumber of Object.keys(state.cards)) delete state.cards[cardNumber]
  }
}, { flush: 'sync' })

const normalizeCardNumber = (cardNumber: string) => cardNumber.trim().toUpperCase()

const persistCardLocally = async (
  cardNumber: string,
  content: SmartCard,
  operation: FleetOperation,
  syncReader = true,
) => {
  const normalizedNumber = normalizeCardNumber(cardNumber)
  const sanitizedContent = { ...content, iccid: content.iccid ?? '' }

  assertComponentLive(operation)
  await invoke('update_card', {
    cardnumber: normalizedNumber,
    content: sanitizedContent,
  })

  assertComponentLive(operation)
  state.cards[normalizedNumber] = sanitizedContent

  if (!syncReader) return

  const readerIndex = state.readers.findIndex((reader) => reader.iccid === sanitizedContent.iccid)

  if (readerIndex > -1) {
    const reader = state.readers[readerIndex]
    try {
      await invoke('manual_sync_cards', {
        readername: reader?.name,
        restart: false,
      })
      assertComponentLive(operation)
    } catch (error) {
      assertComponentLive(operation)
      console.error('Kon kaart niet synchroniseren met lezer', error)
    }
  }
}

const importTrackmijnCards = async (cards: Record<string, SmartCard>, operation: FleetOperation) => {
  for (const [cardNumber, content] of Object.entries(cards)) {
    try {
      assertComponentLive(operation)
      await persistCardLocally(cardNumber, content, operation, false)
      assertComponentLive(operation)
    } catch (error) {
      assertComponentLive(operation)
      console.error('Failed to import card', error)
    }
  }
}

const syncTrackmijnCards = async (): Promise<void> => {
  if (disposed || startupFailed) return
  const generation = authSession.snapshot().generation
  if (syncRun?.generation === generation) {
    return syncRun.promise
  }

  let promise!: Promise<void>
  // The promise identity is assigned immediately after the async body is created.
  // eslint-disable-next-line prefer-const
  promise = (async (): Promise<void> => {
    try {
      const { missingLocalCards, updatedLocalCards, removedLocalCards, operation } =
        await fleet.syncCards({
        ...state.cards,
      })
      assertComponentLive(operation)

      await importTrackmijnCards(updatedLocalCards, operation)
      assertComponentLive(operation)
      await importTrackmijnCards(missingLocalCards, operation)
      assertComponentLive(operation)

      for (const cardNumber of removedLocalCards) {
        assertComponentLive(operation)
        delete state.cards[cardNumber]
      }
    } catch (error) {
      console.error('Kon kaarten niet synchroniseren', error)
    } finally {
      if (syncRun?.promise === promise) syncRun = null
    }
  })()
  syncRun = { generation, promise }

  return promise
}

////////////////////////// Listening for the event from the backend //////////////////////////
// This is an event listener that will listen for the backend to send an event
void registerListener('global-cards-sync', (event) => {
  if (disposed) return
  console.log('event payload: ', event.payload)
  const payload = event.payload as {
    iccid: string
    reader_name: string
    card_state: string
    card_number: string
    online?: boolean
    authentication?: boolean
  }

  const name = payload.reader_name
  const cardNumber = normalizeCardNumber(payload.card_number)
  const splitted = (payload.card_state?.match(/\((.*)\)/i) ?? [])[1]?.split('|') ?? []
  const status = splitted[1]?.trim() ?? splitted[0] ?? ''

  const iccid = payload.iccid
  const index = state.readers.findIndex((reader) => reader.name === name)
  const updatedReader: Reader = {
    name,
    status,
    iccid,
    card_number: cardNumber,
    online: payload.online,
    authentication: payload.authentication,
  }

  if (index !== -1) {
    state.readers[index] = updatedReader
  } else {
    state.readers.push(updatedReader)
  }
})

///////////////////////////// Dialog window for entering the Card Number value /////////////////////////////

// Function to change the color of the icon depending on the card status
const cardConnectedStatus = (reader: Reader) => {
  if (reader.iccid && reader.online) {
    // If the card is connected and online

    if (reader.authentication) {
      // If the card is in the authentication process
      return {
        name: 'mdi-smart-card',
        color: 'green',
        size: '25px',
        class: isBlinking.value ? 'blinking-icon' : '', // blinking status
      }
    } else {
      // If the card is not in the authentication process
      return {
        name: 'mdi-smart-card',
        color: 'green',
        size: '25px',
      }
    }
  } else if (reader.iccid) {
    // If the card is connected to the app but not online
    if (reader.card_number) {
      // Known card
      return {
        name: 'mdi-smart-card-outline',
        color: 'grey',
        size: '25px',
      }
    } else {
      // unknown card
      return {
        name: 'mdi-card-plus-outline',
        color: 'orange',
        size: '25px',
      }
    }
  } else {
    // If the card is disconnected
    return {
      name: 'mdi-smart-card-off-outline',
      color: 'grey',
      size: '25px',
    }
  }
}

// SmartCardList handlers
function linkMode(iccid: string) {
  cardlist.value?.linkMode(iccid)
  if (Object.values(state.cards)?.filter((card) => !card.iccid).length === 0) {
    cardlist.value?.openAddDialog()
  }
}
async function addCard(number: string, data: SmartCard) {
  const normalizedNumber = normalizeCardNumber(number)
  const sanitizedData = { ...data, iccid: data.iccid ?? '' }

  try {
    if (disposed || startupFailed) return
    const operation = await fleet.startOperation()
    assertComponentLive(operation)
    await bootstrapReady
    assertComponentLive(operation)
    await persistCardLocally(normalizedNumber, sanitizedData, operation)
    assertComponentLive(operation)
    await fleet.createCard(normalizedNumber, sanitizedData, operation)
    assertComponentLive(operation)
    await syncTrackmijnCards()
    assertComponentLive(operation)
  } catch (error) {
    console.error('Kon kaart niet toevoegen', error)
  }
}

async function updateCard(number: string, data: SmartCard) {
  const normalizedNumber = normalizeCardNumber(number)
  const sanitizedData = { ...data, iccid: data.iccid ?? '' }

  try {
    if (disposed || startupFailed) return
    const operation = await fleet.startOperation()
    assertComponentLive(operation)
    await bootstrapReady
    assertComponentLive(operation)
    await persistCardLocally(normalizedNumber, sanitizedData, operation)
    assertComponentLive(operation)
    await syncTrackmijnCards()
    assertComponentLive(operation)
  } catch (error) {
    console.error('Kon kaart niet bijwerken', error)
  }
}

// remove card func from the config
const removeCard = async (cardNumber: string) => {
  try {
    if (disposed || startupFailed) return
    const normalizedNumber = normalizeCardNumber(cardNumber)
    const parentOperation = await fleet.startOperation()
    assertComponentLive(parentOperation)
    await bootstrapReady
    assertComponentLive(parentOperation)
    const operation = await fleet.deleteCard(normalizedNumber, state.cards[normalizedNumber]?.id)
    assertComponentLive(parentOperation)
    assertComponentLive(operation)
    await invoke('remove_card', { cardnumber: normalizedNumber })
    assertComponentLive(operation)
    delete state.cards[normalizedNumber]
    console.log('Card removed:', normalizedNumber)
  } catch (error) {
    console.error('Failed to remove card:', error)
  }
}

void registerListener('global-card-config-updated', (event) => {
  if (!bootstrapOpen || disposed || !isBootstrapCurrent()) return
  console.log('event payload: ', event.payload)
  const payload = event.payload as {
    content: { iccid: string; name: string | null; expire: number | null } | null
    card_number: string
  }
  if (payload.card_number) {
    if (payload.content) {
      const normalizedNumber = normalizeCardNumber(payload.card_number)
      const { name, ...cardConfig } = payload.content
      state.cards[normalizedNumber] = name === null ? cardConfig : { ...cardConfig, name }
    } else {
      const normalizedNumber = normalizeCardNumber(payload.card_number)
      delete state.cards[normalizedNumber]
    }
  }
})

void registerListener('global-config-server', () => {
  finishBootstrap()
})

const handleFocus = () => {
  if (bootstrapOpen || disposed) return
  void syncTrackmijnCards()
}

onMounted(async () => {
  window.addEventListener('focus', handleFocus)
  void registerListener('tauri://focus', handleFocus)
  const registrations = await Promise.allSettled(listenerRegistrations)
  if (disposed) return
  if (registrations.some((result) => result.status === 'rejected')) {
    startupFailed = true
    finishBootstrap()
    return
  }
  try {
    await emit('frontend-loaded', { message: 'Hello from frontend!' })
  } catch (error) {
    startupFailed = true
    finishBootstrap()
    console.error('Error emitting frontend-loaded event:', error)
  }
  await bootstrapReady
  if (!disposed && isBootstrapCurrent()) void syncTrackmijnCards()
})

onBeforeUnmount(() => {
  disposed = true
  finishBootstrap()
  window.removeEventListener('focus', handleFocus)
  for (const unlisten of activeUnlisteners) {
    void unlisten()
  }
  activeUnlisteners.clear()
})
</script>
