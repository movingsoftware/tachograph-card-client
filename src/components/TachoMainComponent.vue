<template>
  <div style="width: 100%">
    <div class="rounded-borders" style="border: 1px solid #666">
      <div v-if="state.readers.length === 0" class="q-pa-md text-grey text-h6">
        Geen aangesloten smartcardlezers
      </div>
      <div v-for="(reader, index) in state.readers" :key="index" class="row reader">
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
        <q-item class="col-6" style="min-height: 50px" dense v-if="reader.status !== 'UNKNOWN'">
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
              <q-item-label
                lines="1"
                v-if="state.cards && reader.card_number && state.cards[reader.card_number]"
              >
                {{ state.cards[reader.card_number]?.name }}
              </q-item-label>
              <q-item-label lines="1">
                <span class="text-weight-medium">{{ reader.card_number }}</span>
              </q-item-label>
            </template>

            <q-item-label lines="1" v-if="!reader.iccid && !reader.card_number">
              <span class="text-weight-medium text-grey-6">LEGE SLEUF</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side v-if="reader.iccid && !reader.card_number">
            <div class="text-grey-8 q-gutter-xs">
              <q-btn size="12px" flat dense round icon="mdi-link" @click="linkMode(reader.iccid)" />
            </div>
          </q-item-section>
        </q-item>
      </div>
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
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event'
import { transportklokService } from '../services/transportklok'

// Blinking status for the card icon during authentication.
const isBlinking = ref(true) // controls the blinking status of the icon

const cardlist = ref<null | { linkMode: (iccid: string) => null; openAddDialog: () => null }>(null)

// reactive state for the readers and cards
const state = reactive({
  readers: [] as Reader[],
  cards: {} as Record<string, SmartCard>,
})

let focusUnlisten: UnlistenFn | null = null
let syncPromise: Promise<void> | null = null

const normalizeCardNumber = (cardNumber: string) => cardNumber.trim().toUpperCase()

const persistCardLocally = async (cardNumber: string, content: SmartCard, syncReader = true) => {
  const normalizedNumber = normalizeCardNumber(cardNumber)
  const sanitizedContent = { ...content, iccid: content.iccid ?? '' }

  await invoke('update_card', {
    cardnumber: normalizedNumber,
    content: sanitizedContent,
  })

  state.cards[normalizedNumber] = sanitizedContent

  if (!syncReader) return

  const readerIndex = state.readers.findIndex((reader) => reader.iccid === sanitizedContent.iccid)

  if (readerIndex > -1) {
    const reader = state.readers[readerIndex]
    try {
      await invoke('manual_sync_cards', {
        readername: reader.name,
        restart: false,
      })
    } catch (error) {
      console.error('Kon kaart niet synchroniseren met lezer', error)
    }
  }
}

const importTrackmijnCards = async (cards: Record<string, SmartCard>) => {
  for (const [cardNumber, content] of Object.entries(cards)) {
    try {
      await persistCardLocally(cardNumber, content, false)
    } catch (error) {
      console.error('Failed to import TrackMijn card', error)
    }
  }
}

const syncTrackmijnCards = async () => {
  if (syncPromise) {
    return syncPromise
  }

  syncPromise = (async () => {
    try {
      const { missingLocalCards, updatedLocalCards } = await transportklokService.syncLocalCardsWithTrackmijn({
        ...state.cards,
      })

      await importTrackmijnCards(updatedLocalCards)
      await importTrackmijnCards(missingLocalCards)
    } catch (error) {
      console.error('Kon TrackMijn-kaarten niet synchroniseren', error)
    } finally {
      syncPromise = null
    }
  })()

  return syncPromise
}

////////////////////////// Listening for the event from the backend //////////////////////////
// This is an event listener that will listen for the backend to send an event
listen('global-cards-sync', (event) => {
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
}).catch((error) => {
  console.error('Error listening to global-cards-sync:', error)
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
    await persistCardLocally(normalizedNumber, sanitizedData)
    await transportklokService.createTrackmijnCard(normalizedNumber, sanitizedData)
    await syncTrackmijnCards()
  } catch (error) {
    console.error('Kon kaart niet toevoegen', error)
  }
}

async function updateCard(number: string, data: SmartCard) {
  const normalizedNumber = normalizeCardNumber(number)
  const sanitizedData = { ...data, iccid: data.iccid ?? '' }

  try {
    await persistCardLocally(normalizedNumber, sanitizedData)
    await syncTrackmijnCards()
  } catch (error) {
    console.error('Kon kaart niet bijwerken', error)
  }
}

// remove card func from the config
const removeCard = async (cardNumber: string) => {
  try {
    const normalizedNumber = normalizeCardNumber(cardNumber)
    await transportklokService.deleteTrackmijnCard(normalizedNumber, state.cards[normalizedNumber]?.id)
    await invoke('remove_card', { cardnumber: normalizedNumber })
    delete state.cards[normalizedNumber]
    console.log('Card removed:', normalizedNumber)
  } catch (error) {
    console.error('Failed to remove card:', error)
  }
}

listen('global-card-config-updated', (event) => {
  console.log('event payload: ', event.payload)
  const payload = event.payload as {
    content: object
    card_number: string
  }
  if (payload.card_number) {
    if (payload.content) {
      const normalizedNumber = normalizeCardNumber(payload.card_number)
      state.cards[normalizedNumber] = { ...(payload.content as SmartCard) }
    } else {
      const normalizedNumber = normalizeCardNumber(payload.card_number)
      delete state.cards[normalizedNumber]
    }
    void syncTrackmijnCards()
  }
}).catch((error) => {
  console.error('Error listening to global-card-config-updated:', error)
})

// Generate an event to inform the back-end that the front-end is loaded.
// To correctly display states in the application.
emit('frontend-loaded', { message: 'Hello from frontend!' }).catch((error) => {
  console.error('Error emitting frontend-loaded event:', error)
})

const handleFocus = () => {
  void syncTrackmijnCards()
}

onMounted(async () => {
  window.addEventListener('focus', handleFocus)
  try {
    focusUnlisten = await listen('tauri://focus', handleFocus)
  } catch (error) {
    console.warn('Kon Tauri focus-event niet registreren', error)
  }
  void syncTrackmijnCards()
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
  if (focusUnlisten) {
    void focusUnlisten()
  }
})
</script>
