import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize()
}

export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close()
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  const maximized = await getCurrentWindow().isMaximized()

  if (maximized) {
    await getCurrentWindow().unmaximize()
    return false
  }

  await getCurrentWindow().maximize()
  return true
}

export function isWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized()
}

export async function listenToWindowResize(
  callback: (isMaximized: boolean) => void
): Promise<UnlistenFn> {
  const unlisten = await getCurrentWindow().onResized(async () => {
    const isMaximized = await getCurrentWindow().isMaximized()
    callback(isMaximized)
  })

  return unlisten
}
