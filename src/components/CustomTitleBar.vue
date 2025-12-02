<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="titlebar__drag">
      <div class="titlebar__title">TransportKlok tachograafbrug</div>
    </div>
    <div class="titlebar__controls" aria-label="Window controls">
      <button class="titlebar__button" type="button" @click="handleMinimize" aria-label="Minimize">
        <svg viewBox="0 0 24 24" class="titlebar__icon" aria-hidden="true">
          <rect x="5" y="11" width="14" height="2" rx="1" />
        </svg>
      </button>
      <button class="titlebar__button" type="button" @click="handleToggleMaximize" :aria-label="maximizeLabel">
        <svg v-if="!isMaximized" viewBox="0 0 24 24" class="titlebar__icon" aria-hidden="true">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
        <svg v-else viewBox="0 0 24 24" class="titlebar__icon" aria-hidden="true">
          <path d="M8 8h8v2H10v6H8z" />
          <path d="M10 10h6v6h-2v-4h-4z" />
        </svg>
      </button>
      <button class="titlebar__button titlebar__button--close" type="button" @click="handleClose" aria-label="Close">
        <svg viewBox="0 0 24 24" class="titlebar__icon" aria-hidden="true">
          <path d="M8 8l8 8M16 8l-8 8" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  closeWindow,
  isWindowMaximized,
  listenToWindowResize,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../services/windowControls'

const isMaximized = ref(false)
const maximizeLabel = computed(() => (isMaximized.value ? 'Restore' : 'Maximize'))

let unlistenResize: (() => void) | null = null

const syncMaximizedState = async () => {
  isMaximized.value = await isWindowMaximized()
}

const handleMinimize = async () => {
  await minimizeWindow()
}

const handleToggleMaximize = async () => {
  isMaximized.value = await toggleMaximizeWindow()
}

const handleClose = async () => {
  await closeWindow()
}

onMounted(() => {
  void syncMaximizedState()

  void listenToWindowResize((maximized) => {
    isMaximized.value = maximized
  }).then((unlisten) => {
    unlistenResize = unlisten
  })
})

onBeforeUnmount(() => {
  unlistenResize?.()
})
</script>
