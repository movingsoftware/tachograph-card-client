<template>
    <q-page class="simple-page flex column">
        <div class="content-area column flex-1">
            <TachoMainComponent />
        </div>
    </q-page>
</template>

<script setup lang="ts">
import TachoMainComponent from '../../components/TachoMainComponent.vue'
</script>

<style scoped>
.simple-page {
    background: #f9fafc;
}

.content-area {
    flex: 1;
    min-height: 0;
    padding: 24px;
}
</style>
