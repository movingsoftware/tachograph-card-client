import { invoke } from '@tauri-apps/api/core'
import type { SmartCard } from 'components/models'
import type { TrackmijnCard as Card } from 'shared.js'
import { useFlespiStore } from 'stores/useFlespiStore'
import { useFleetStore } from 'stores/useFleetStore'
import {
    createTachographCardClient,
    createTachographCompanyCard,
    deleteTachographCardClient,
    deleteTachographCompanyCard,
    getTachographCardClient,
    listTachographCompanyCards,
    updateTachographCompanyCard,
} from 'src/services/fleet'
import { logger } from 'src/services/logger'

const IDENTIFIER_PREFIX = 'TBA'
const IDENTIFIER_PATTERN = /^TBA\d{13}$/

type FleetApiError = {
    status?: number
    code?: string
    message?: string
    response?: {
        status?: number
        data?: {
            message?: string
        }
    }
}

const createClientIdentifier = () => {
    const randomDigits = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('')
    return `${IDENTIFIER_PREFIX}${randomDigits}`
}

const toClientIdentifier = (value: string | null) => {
    if (value && IDENTIFIER_PATTERN.test(value)) {
        return value
    }

    const numericPart = (value ?? '').replace(/\D/g, '').slice(-13)
    if (numericPart.length === 0) {
        return createClientIdentifier()
    }

    const digits = numericPart.padStart(13, '0').slice(0, 13)
    return `${IDENTIFIER_PREFIX}${digits}`
}

const toFleetApiError = (error: unknown): FleetApiError =>
    (error && typeof error === 'object' ? error : {}) as FleetApiError

const getErrorStatus = (error: unknown): number | undefined => {
    const apiError = toFleetApiError(error)
    return apiError.response?.status ?? apiError.status
}

const getErrorClientId = (error: unknown): string | undefined =>
    toFleetApiError(error).response?.data?.id

let cards: Record<string, SmartCard> = {}
let fleetStore: ReturnType<typeof useFleetStore> | null = null

const getFleetStore = () => {
    if (!fleetStore) {
        fleetStore = useFleetStore()
    }

    return fleetStore
}

const clearAuth = () => {
    const store = getFleetStore()

    store.clearSession()
}

// Resources: Client
const ensureClientIdentifier = () => {
    const store = getFleetStore()
    const identifier = toClientIdentifier(store.clientName)

    if (store.clientName !== identifier) {
        store.setClientName(identifier)
    }

    return identifier
}

const resetClient = () => {
    const store = getFleetStore()
    store.setClientId(null)
}

const hasClient = async (id: string): Promise<boolean> => {
    try {
        await getTachographCardClient(id)
        return true
    } catch (error) {
        void logger.error(`useFleet.hasClient failed for id=${id}`, error)

        if (getErrorStatus(error) === 404) {
            return false
        }

        throw error
    }
}

const createClient = async (): Promise<string> => {
    const store = getFleetStore()
    const identifier = ensureClientIdentifier()

    try {
        const data = await createTachographCardClient(identifier)

        if (!data?.id) {
            void logger.error(
                'useFleet.createClient throwing missing-client-id',
                new Error('Kan apparaat-ID van client niet bepalen'),
            )
            throw new Error('Kan apparaat-ID van client niet bepalen')
        }

        store.setClientId(data.id)
        return data.id
    } catch (error) {
        void logger.error(`useFleet.createClient failed for identifier=${identifier}`, error)

        if (getErrorStatus(error) === 409) {
            const existingClientId = getErrorClientId(error)
            if (existingClientId) {
                store.setClientId(existingClientId)
                return existingClientId
            }

            void logger.error(
                'useFleet.createClient throwing missing-existing-client-id',
                new Error('Kan apparaat-ID van bestaande client niet bepalen'),
            )
            throw new Error('Kan apparaat-ID van bestaande client niet bepalen')
        }

        throw error
    }
}

const deleteClient = async (id: string): Promise<void> => {
    try {
        await deleteTachographCardClient(id)
        resetClient()
    } catch (error) {
        void logger.error(`useFleet.deleteClient failed for id=${id}`, error)

        if (getErrorStatus(error) === 404) {
            resetClient()
            return
        }

        throw error
    }
}

const setup = async (): Promise<void> => {
    if (! getFleetStore().sessionToken) {
        await getFleetStore().refreshSessionToken()
    }

    const identifier = await ensureClient()

    const flespiStore = useFlespiStore()
    flespiStore.setCachedIdent(identifier)
    await flespiStore.applyFlespiServerConfig()

    await ensureCardsExist()
}

const ensureClient = async (): Promise<string> => {
    const store = getFleetStore()
    const identifier = ensureClientIdentifier()

    if (store.clientId) {
        if (! await hasClient(store.clientId)) {
            resetClient()
        }
    }

    if (! store.clientId) {
        const createdId = await createClient()

        if (! await hasClient(createdId)) {
            void logger.error(
                `useFleet.ensureClient throwing created-client-not-found id=${createdId}`,
                new Error('Kan client niet aanmaken of verifiëren'),
            )
            throw new Error('Kan client niet aanmaken of verifiëren')
        }
    }

    return identifier
}

// Resources: Cards
const mapCardsByNumber = (items: Card[]): Record<string, SmartCard> => {
    return items.reduce<Record<string, SmartCard>>((acc, card) => {
        const number = card.number.toUpperCase()

        if (number) {
            acc[number] = {
                id: card.id,
                name: card.label,
                iccid: '',
            }
        }

        return acc
    }, {})
}

const findMissingLocalCards = (items: Card[]): Record<string, SmartCard> => {
    const localNumbers = new Set(Object.keys(cards || {}).map((number) => number.toUpperCase()))
    const remoteMap = mapCardsByNumber(items)

    return Object.entries(remoteMap).reduce<Record<string, SmartCard>>((missing, [number, card]) => {
        if (!localNumbers.has(number)) {
            missing[number] = card
        }
        return missing
    }, {})
}

const mergeCards = (items: Card[]): Record<string, SmartCard> => {
    const remoteMap = mapCardsByNumber(items)
    const updated: Record<string, SmartCard> = {}

    for (const [number, cardData] of Object.entries(cards)) {
        const normalizedNumber = number.toUpperCase()
        const remoteCard = remoteMap[normalizedNumber]
        if (!remoteCard) {
            continue
        }

        const mergedCard: SmartCard = {
            ...cardData,
            id: remoteCard.id || cardData.id,
            name: cardData.name || remoteCard.name,
        }

        if (mergedCard.id !== cardData.id || mergedCard.name !== cardData.name) {
            updated[normalizedNumber] = mergedCard
        }

        cards[normalizedNumber] = mergedCard
    }

    return updated
}

const fetchCards = async (): Promise<Card[]> => await listTachographCompanyCards()

const updateCard = async (cardId: string, cardData: SmartCard): Promise<void> => {
    const payload: { name?: string; iccid?: string } = {}

    if (cardData.name !== undefined) {
        payload.name = cardData.name
    }

    if (cardData.iccid !== undefined) {
        payload.iccid = cardData.iccid
    }

    try {
        await updateTachographCompanyCard(cardId, payload)
    } catch (error) {
        void logger.error(`useFleet.updateCard failed for cardId=${cardId}`, error)

        if (getErrorStatus(error) === 404) {
            return
        }

        throw error
    }
}

const updateCards = async (items: Card[]) => {
    for (const item of items) {
        const number = item.number?.toUpperCase()
        if (!number) {
            continue
        }

        const localCard = cards[number]
        if (!localCard?.name || localCard.name === item.name) {
            continue
        }

        await updateCard(item.id, localCard)
    }
}

const createCard = async (number: string, cardData?: SmartCard): Promise<void> => {
    const payload: { number: string; name?: string; iccid?: string } = { number }

    if (cardData?.name !== undefined) {
        payload.name = cardData.name
    }

    if (cardData?.iccid !== undefined) {
        payload.iccid = cardData.iccid
    }

    try {
        await createTachographCompanyCard(payload)
    } catch (error) {
        void logger.error(`useFleet.createCard failed for number=${number}`, error)

        if (getErrorStatus(error) === 409) {
            return
        }

        throw error
    }
}

const ensureCardsExist = async (existingItems?: Card[]) => {
    if (!cards || Object.keys(cards).length === 0) {
        return
    }

    const remoteItems = existingItems ?? (await fetchCards())
    const remoteNumbers = new Set(
        remoteItems
            .map((item) => (item.number ? item.number.toUpperCase() : null))
            .filter(Boolean) as string[],
    )

    for (const [number, cardData] of Object.entries(cards)) {
        const normalizedNumber = number.toUpperCase()
        if (!remoteNumbers.has(normalizedNumber)) {
            await createCard(normalizedNumber, cardData)
        }
    }
}

const deleteCard = async (number: string, cardId?: string): Promise<void> => {
    let resolvedCardId = cardId

    if (!resolvedCardId) {
        const remoteItems = await fetchCards()
        const matchingCard = remoteItems.find((item) => item.number?.toUpperCase() === number.toUpperCase())
        resolvedCardId = matchingCard?.id
    }

    if (!resolvedCardId) {
        void logger.error(
            `useFleet.deleteCard throwing missing-card-id number=${number}`,
            new Error('Kan kaart niet bepalen'),
        )
        throw new Error('Kan kaart niet bepalen')
    }

    try {
        await deleteTachographCompanyCard(resolvedCardId)
    } catch (error) {
        void logger.error(
            `useFleet.deleteCard failed for number=${number} cardId=${resolvedCardId}`,
            error,
        )

        if (getErrorStatus(error) === 404) {
            return
        }

        throw error
    }
}

const syncCards = async (inputCards: Record<string, SmartCard>) => {
    cards = Object.entries(inputCards).reduce<Record<string, SmartCard>>((acc, [number, cardData]) => {
        acc[number.toUpperCase()] = cardData
        return acc
    }, {})

    const remoteItems = await fetchCards()
    const remoteMap = mapCardsByNumber(remoteItems)

    const removed = Object.keys(cards).reduce<string[]>((list, number) => {
        const normalizedNumber = number.toUpperCase()
        if (!remoteMap[normalizedNumber]) {
            list.push(normalizedNumber)
        }
        return list
    }, [])

    for (const number of removed) {
        await invoke('remove_card', { cardnumber: number })
    }

    const updated = mergeCards(remoteItems)
    const missing = findMissingLocalCards(remoteItems)
    await updateCards(remoteItems)

    return {
        missingLocalCards: missing,
        updatedLocalCards: updated,
        removedLocalCards: removed,
    }
}

export function useFleet() {
    ensureClientIdentifier()

    return {
        setup,
        clearAuth,
        ensureClient,
        resetClient,
        deleteClient,
        createCard,
        deleteCard,
        syncCards,
    }
}
