import type { Router } from 'vue-router'

let routerRef: Router | null = null

export const setRouter = (router: Router) => {
  routerRef = router
}

export const getCurrentPath = (): string | undefined => {
  return routerRef?.currentRoute.value.path
}

export const replaceRoute = async (route: string): Promise<void> => {
  if (!routerRef) {
    console.warn('[routerNavigation] replaceRoute called before router is ready:', route)
    return
  }

  const target = routerRef.resolve(route)
  if (!target.matched.length) {
    console.error('[routerNavigation] replaceRoute target does not match any route:', route)
    return
  }

  try {
    await routerRef.replace(route)
  } catch (error: unknown) {
    console.error('[routerNavigation] Failed to replace route:', route, error)
  }
}

export const navigateTo = async (route: string): Promise<void> => {
  if (!routerRef) {
    console.warn('[routerNavigation] navigateTo called before router is ready:', route)
    return
  }

  const target = routerRef.resolve(route)
  if (!target.matched.length) {
    console.error('[routerNavigation] navigateTo target does not match any route:', route)
    return
  }

  try {
    await routerRef.push(route)
  } catch (error: unknown) {
    console.error('[routerNavigation] Failed to navigate to route:', route, error)
  }
}
