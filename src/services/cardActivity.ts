import {listen, type UnlistenFn} from '@tauri-apps/api/event'

/** Readers whose card is authenticating through MQTT right now. */
const authenticatingReaders = new Set<string>()

/** Whether a card is authenticating, so the app must not restart for an update. */
export const isCardActivityBusy = (): boolean => authenticatingReaders.size > 0

/** Tracks the authentication flag the native side sends with every card sync event. */
export const watchCardActivity = (): Promise<UnlistenFn> => listen('global-cards-sync', (event) => {
    const payload = event.payload as {reader_name: string; authentication?: boolean | null}
    if (payload.authentication) authenticatingReaders.add(payload.reader_name)
    else authenticatingReaders.delete(payload.reader_name)
})
