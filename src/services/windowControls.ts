import type { UnlistenFn } from '@tauri-apps/api/event'
import { appWindow } from '@tauri-apps/api/window'

export async function minimizeWindow(): Promise<void> {
  await appWindow.minimize()
}

export async function closeWindow(): Promise<void> {
  await appWindow.close()
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  const maximized = await appWindow.isMaximized()

  if (maximized) {
    await appWindow.unmaximize()
    return false
  }

  await appWindow.maximize()
  return true
}

export function isWindowMaximized(): Promise<boolean> {
  return appWindow.isMaximized()
}

export async function listenToWindowResize(
  callback: (isMaximized: boolean) => void
): Promise<UnlistenFn> {
  const unlisten = await appWindow.onResized(async () => {
    callback(await appWindow.isMaximized())
  })

  return unlisten
}
