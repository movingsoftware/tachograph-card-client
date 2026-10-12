import { invoke } from '@tauri-apps/api/core'
import type { SmartCard } from 'components/models'
import type { TrackMijnCard as Card } from 'shared.js'
import type { AuthSession, AuthSnapshot } from 'shared.js'
import { useFlespiStore } from 'stores/useFlespiStore'
import { useFleetStore } from 'stores/useFleetStore'
import { useFleetAuthStore } from 'stores/useFleetAuthStore'
import {
    createTachographClient,
    createTachographCompanyCard,
    deleteTachographClient,
    deleteTachographCompanyCard,
    getTachographClient,
    listTachographCompanyCards,
    updateTachographCompanyCard,
} from 'src/services/fleet'

export interface FleetOperation {
    readonly authSession: AuthSession
    readonly snapshot: Readonly<AuthSnapshot>
    readonly assertCurrent: () => void
}

const IDENTIFIER_PREFIX = 'TBA'
const IDENTIFIER_PATTERN = /^TBA\d{13}$/

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

const getStatus = (error: unknown): number | undefined => {
    const typed = error as { status?: number; response?: { status?: number } }
    return typed.status ?? typed.response?.status
}

let cards: Record<string, SmartCard> = {}
let cardCacheOwner: FleetOperation | null = null
const getFleetStore = () => useFleetStore()

const startFleetOperation = async (): Promise<FleetOperation> => {
    const authSession = useFleetAuthStore().authSession
    const snapshot: AuthSnapshot = await authSession.ensure()
    authSession.assertCurrent(snapshot)

    return {
        authSession,
        snapshot,
        assertCurrent: () => authSession.assertCurrent(snapshot),
    }
}

const clearAuth = () => {
    const store = getFleetStore()

    store.clearAuth()
    cards = {}
    cardCacheOwner = null
    useFleetAuthStore().authSession.invalidate()
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

const hasClient = async (id: string, assertCurrent: () => void): Promise<boolean> => {
    try {
        await getTachographClient(id)
        assertCurrent()
        return true
    } catch (error) {
        const status = getStatus(error)

        if (status === 404) {
            assertCurrent()
            return false
        }

        throw error
    }
}

const createClient = async (assertCurrent: () => void): Promise<string> => {
    const store = getFleetStore()
    const identifier = ensureClientIdentifier()

    try {
        const data = await createTachographClient(identifier)
        assertCurrent()

        if (!data?.id) {
            throw new Error('Kan apparaat-ID van client niet bepalen')
        }

        assertCurrent()
        store.setClientId(data.id)
        return data.id
    } catch (error) {
        assertCurrent()
        const status = getStatus(error)

        if (status === 409) {
            const existingId = (error as { id?: unknown }).id
            if (typeof existingId === 'string' && existingId.length > 0) {
                assertCurrent()
                store.setClientId(existingId)
                return existingId
            }

            throw new Error('Kan apparaat-ID van bestaande client niet bepalen')
        }

        throw error
    }
}

const deleteClient = async (id: string): Promise<void> => {
    const authSession = useFleetAuthStore().authSession
    const snapshot = authSession.snapshot()
    const assertCurrent = (): void => authSession.assertCurrent(snapshot)

    try {
        await deleteTachographClient(id)
        assertCurrent()
        resetClient()
    } catch (error) {
        const status = getStatus(error)

        if (status === 404) {
            assertCurrent()
            resetClient()
            return
        }

        throw error
    }
}

const ensureClient = async (): Promise<void> => {
    const operation = await startFleetOperation()
    const assertCurrent = operation.assertCurrent
    assertCurrent()
    const store = getFleetStore()
    const identifier = ensureClientIdentifier()

    if (!store.clientId) {
        const createdId = await createClient(assertCurrent)
        assertCurrent()
        const exists = await hasClient(createdId, assertCurrent)

        if (!exists) {
            assertCurrent()
            resetClient()
            throw new Error('Kan client niet aanmaken of verifiëren')
        }
    }

    if (store.clientId) {
        const exists = await hasClient(store.clientId, assertCurrent)

        if (! exists) {
            assertCurrent()
            resetClient()

            const createdId = await createClient(assertCurrent)
            assertCurrent()
            const exists = await hasClient(createdId, assertCurrent)

            if (! exists) {
                assertCurrent()
                resetClient()

                throw new Error('Kan client niet aanmaken of verifiëren')
            }
        }
    }

    assertCurrent()
    const cachedCards = cardCacheOwner !== null && (
        cardCacheOwner.authSession === operation.authSession &&
        cardCacheOwner.snapshot.generation === operation.snapshot.generation &&
        cardCacheOwner.snapshot.context === operation.snapshot.context
    ) ? cards : {}
    await ensureCardsExist(undefined, cachedCards, operation)
    assertCurrent()
    const flespiStore = useFlespiStore()
    assertCurrent()
    flespiStore.setCachedIdent(identifier)
    await flespiStore.applyFlespiServerConfig(operation.assertCurrent)
    assertCurrent()
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

const findMissingLocalCards = (items: Card[], localCards: Record<string, SmartCard>): Record<string, SmartCard> => {
    const localNumbers = new Set(Object.keys(localCards).map((number) => number.toUpperCase()))
    const remoteMap = mapCardsByNumber(items)

    return Object.entries(remoteMap).reduce<Record<string, SmartCard>>((missing, [number, card]) => {
        if (!localNumbers.has(number)) {
            missing[number] = card
        }
        return missing
    }, {})
}

const mergeCards = (items: Card[], localCards: Record<string, SmartCard>): Record<string, SmartCard> => {
    const remoteMap = mapCardsByNumber(items)
    const updated: Record<string, SmartCard> = {}

    for (const [number, cardData] of Object.entries(localCards)) {
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

        localCards[normalizedNumber] = mergedCard
    }

    return updated
}

const fetchCards = async (): Promise<Card[]> => await listTachographCompanyCards()

const updateCard = async (cardId: string, cardData: SmartCard, operation: FleetOperation): Promise<void> => {
    const payload: { name?: string; iccid?: string } = {}

    if (cardData.name !== undefined) {
        payload.name = cardData.name
    }

    if (cardData.iccid !== undefined) {
        payload.iccid = cardData.iccid
    }

    try {
        operation.assertCurrent()
        await updateTachographCompanyCard(cardId, payload)
        operation.assertCurrent()
    } catch (error) {
        const status = getStatus(error)

        if (status === 404) {
            operation.assertCurrent()
            return
        }

        throw error
    }
}

const updateCards = async (
    items: Card[],
    localCards: Record<string, SmartCard>,
    operation: FleetOperation,
) => {
    for (const item of items) {
        const number = item.number?.toUpperCase()
        if (!number) {
            continue
        }

        const localCard = localCards[number]
        if (!localCard?.name || localCard.name === item.name) {
            continue
        }

        await updateCard(item.id, localCard, operation)
        operation.assertCurrent()
    }
}

const createCard = async (number: string, cardData: SmartCard | undefined, operation: FleetOperation): Promise<void> => {
    const payload: { number: string; name?: string; iccid?: string } = { number }

    if (cardData?.name !== undefined) {
        payload.name = cardData.name
    }

    if (cardData?.iccid !== undefined) {
        payload.iccid = cardData.iccid
    }

    try {
        operation.assertCurrent()
        await createTachographCompanyCard(payload)
        operation.assertCurrent()
    } catch (error) {
        operation.assertCurrent()
        const status = getStatus(error)

        if (status === 409) {
            return
        }

        throw error
    }
}

const ensureCardsExist = async (
    existingItems: Card[] | undefined,
    localCards: Record<string, SmartCard>,
    operation: FleetOperation,
) => {
    if (Object.keys(localCards).length === 0) {
        return
    }

    const remoteItems = existingItems ?? (await fetchCards())
    operation.assertCurrent()
    const remoteNumbers = new Set(
        remoteItems
            .map((item) => (item.number ? item.number.toUpperCase() : null))
            .filter(Boolean) as string[],
    )

    for (const [number, cardData] of Object.entries(localCards)) {
        const normalizedNumber = number.toUpperCase()
        if (!remoteNumbers.has(normalizedNumber)) {
            await createCard(normalizedNumber, cardData, operation)
            operation.assertCurrent()
        }
    }
}

const deleteCard = async (number: string, cardId?: string): Promise<FleetOperation> => {
    const operation = await startFleetOperation()
    operation.assertCurrent()
    let resolvedCardId = cardId

    if (!resolvedCardId) {
        const remoteItems = await fetchCards()
        operation.assertCurrent()
        const matchingCard = remoteItems.find((item) => item.number?.toUpperCase() === number.toUpperCase())
        resolvedCardId = matchingCard?.id
    }

    if (!resolvedCardId) {
        throw new Error('Kan kaart niet bepalen')
    }

    try {
        operation.assertCurrent()
        await deleteTachographCompanyCard(resolvedCardId)
        operation.assertCurrent()
    } catch (error) {
        const status = getStatus(error)

        if (status === 404) {
            operation.assertCurrent()
            return operation
        }

        throw error
    }

    return operation
}

const syncCards = async (inputCards: Record<string, SmartCard>) => {
    const operation = await startFleetOperation()
    operation.assertCurrent()
    const localCards = Object.entries(inputCards).reduce<Record<string, SmartCard>>((acc, [number, cardData]) => {
        acc[number.toUpperCase()] = cardData
        return acc
    }, {})

    const remoteItems = await fetchCards()
    operation.assertCurrent()
    const remoteMap = mapCardsByNumber(remoteItems)

    const removed = Object.keys(localCards).reduce<string[]>((list, number) => {
        const normalizedNumber = number.toUpperCase()
        if (!remoteMap[normalizedNumber]) {
            list.push(normalizedNumber)
        }
        return list
    }, [])

    for (const number of removed) {
        await invoke('remove_card', { cardnumber: number })
        operation.assertCurrent()
    }

    operation.assertCurrent()
    const updated = mergeCards(remoteItems, localCards)
    const missing = findMissingLocalCards(remoteItems, localCards)
    await updateCards(remoteItems, localCards, operation)
    operation.assertCurrent()
    cards = localCards
    cardCacheOwner = operation

    return {
        operation,
        missingLocalCards: missing,
        updatedLocalCards: updated,
        removedLocalCards: removed,
    }
}

export function useFleet() {
    ensureClientIdentifier()

    return {
        clearAuth,
        ensureSetup: ensureClient,
        ensureClient,
        resetClient,
        deleteClient,
        createCard,
        startOperation: startFleetOperation,
        deleteCard,
        syncCards,
    }
}
