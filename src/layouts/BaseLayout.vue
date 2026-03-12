<template>
  <div class="window-shell">
    <q-layout view="lHh Lpr lFf" class="window-shell__layout">
      <router-view />
    </q-layout>
  </div>
</template>

<style scoped>
.window-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.window-shell__layout {
  flex: 1;
  min-height: 0;
}
</style>
