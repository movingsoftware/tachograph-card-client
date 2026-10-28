import type {createLiveBundleUpdater} from 'shared.js'

type LiveBundleUpdater = ReturnType<typeof createLiveBundleUpdater>

export type BundleUpdateGateResult = 'continue' | 'relaunching' | 'blocked'

export interface BundleUpdateGateOptions {
    /** Updaters in the order they are checked: native first, then web. */
    readonly updaters: readonly Pick<LiveBundleUpdater, 'start' | 'check' | 'download' | 'apply'>[]
    readonly isBusy: () => boolean
    readonly resumeIntervalMs?: number
    readonly now?: () => number
}

const defaultResumeIntervalMs = 15 * 60 * 1000

/** Runs the bundle updaters at launch and on resume, never applying an update while a card is busy. */
export const createBundleUpdateGate = (options: BundleUpdateGateOptions) => {
    const now = options.now ?? Date.now
    const resumeIntervalMs = options.resumeIntervalMs ?? defaultResumeIntervalMs
    let lastResumeCheck = Number.NEGATIVE_INFINITY
    let resuming = false
    let launch: Promise<BundleUpdateGateResult> | undefined

    /** Checks each updater in turn, installing and applying an update before the user gets in; later launches reuse the result. */
    const atLaunch = (): Promise<BundleUpdateGateResult> => {
        launch ??= startUpdaters()
        return launch
    }

    /** Starts each updater in turn until one relaunches or blocks. */
    const startUpdaters = async (): Promise<BundleUpdateGateResult> => {
        for (const updater of options.updaters) {
            try {
                if (await updater.start() === 'relaunching') return 'relaunching'
            } catch {
                return 'blocked'
            }
        }
        return 'continue'
    }

    /** Checks each updater again after the app comes back, and applies the first update while no card is busy. */
    const onResume = async (): Promise<boolean> => {
        if (resuming || options.isBusy() || now() - lastResumeCheck < resumeIntervalMs) return false
        resuming = true
        lastResumeCheck = now()
        try {
            for (const updater of options.updaters) {
                const result = await updater.check()
                if (result?.status !== 'available') continue
                if (options.isBusy() || !await updater.download() || options.isBusy()) return false
                return await updater.apply() === 'relaunching'
            }
            return false
        } catch {
            // The updater reports a failed install itself and blocks further updates.
            return false
        } finally {
            resuming = false
        }
    }

    return {atLaunch, onResume}
}

export type BundleUpdateGate = ReturnType<typeof createBundleUpdateGate>
