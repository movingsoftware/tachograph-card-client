import { computed } from 'vue'
import { routeFlow } from '../services/routeFlow'
import type { RouteFlowName, RouteFlowStartOptions } from '../services/routeFlow'

export const useRouteFlow = () => {
  const currentFlow = computed(() => routeFlow.currentFlow.value)

  return {
    currentFlow,
    start: (flowName: RouteFlowName, options?: RouteFlowStartOptions) => routeFlow.start(flowName, options),
    next: (options?: RouteFlowStartOptions['context']) => routeFlow.currentFlow.value?.next(options),
    clear: () => routeFlow.clear(),
  }
}
