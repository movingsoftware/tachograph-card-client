/** The texts of the update-required screen in one language. */
export interface UpdateRequiredTexts {
    readonly title: string
    readonly message: string
    readonly download: string
    readonly retry: string
}

/** The update-required texts per supported language. */
const TEXTS: Readonly<Record<'nl' | 'en' | 'de' | 'pl', UpdateRequiredTexts>> = {
    nl: {
        title: 'Update vereist',
        message: 'Deze versie van de applicatie is verouderd. Download de nieuwste versie, of neem contact op met je beheerder.',
        download: 'Download nieuwste versie',
        retry: 'Opnieuw controleren',
    },
    en: {
        title: 'Update required',
        message: 'This version of the application is out of date. Download the latest version, or contact your admin.',
        download: 'Download latest version',
        retry: 'Check again',
    },
    de: {
        title: 'Update erforderlich',
        message: 'Diese Version der Anwendung ist veraltet. Laden Sie die neueste Version herunter oder wenden Sie sich an Ihren Administrator.',
        download: 'Neueste Version herunterladen',
        retry: 'Erneut prüfen',
    },
    pl: {
        title: 'Wymagana aktualizacja',
        message: 'Ta wersja aplikacji jest nieaktualna. Pobierz najnowszą wersję lub skontaktuj się z administratorem.',
        download: 'Pobierz najnowszą wersję',
        retry: 'Sprawdź ponownie',
    },
}

/** The update-required texts in the first of `languages` that is supported, Dutch otherwise. */
export const updateRequiredTexts = (languages: readonly string[]): UpdateRequiredTexts => {
    const supported = languages
        .map((language) => language.slice(0, 2).toLowerCase())
        .find((language): language is keyof typeof TEXTS => language in TEXTS)

    return TEXTS[supported ?? 'nl']
}
