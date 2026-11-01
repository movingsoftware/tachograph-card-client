// @vitest-environment node
import {describe, expect, it} from 'vitest'
import {updateRequiredTexts} from '../updateRequiredTexts'

describe('update-required texts', () => {
    it.each([
        [['nl-NL'], 'Update vereist', 'beheerder'],
        [['en-GB'], 'Update required', 'admin'],
        [['de-DE'], 'Update erforderlich', 'Administrator'],
        [['pl-PL'], 'Wymagana aktualizacja', 'administratorem'],
    ])('tells a %s user to update or contact the admin', (languages, title, admin) => {
        const texts = updateRequiredTexts(languages)

        expect(texts.title).toBe(title)
        expect(texts.message).toContain(admin)
        expect(texts.download.trim()).not.toBe('')
        expect(texts.retry.trim()).not.toBe('')
    })

    it('takes the first supported language and falls back to Dutch', () => {
        expect(updateRequiredTexts(['fr-FR', 'de-AT', 'en-US']).title).toBe('Update erforderlich')
        expect(updateRequiredTexts(['fr-FR']).title).toBe('Update vereist')
        expect(updateRequiredTexts([]).title).toBe('Update vereist')
    })
})
