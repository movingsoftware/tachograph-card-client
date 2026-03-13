<template>
    <div class="flex items-center justify-center h-screen bg-white w-full">
        <img
            :src="splashImageUrl"
            alt="TransportKlok Logo"
            class="object-cover w-full h-full"
        />
    </div>
</template>

<script setup lang="ts">
import splashImageUrl from 'src/assets/splash.png'
</script>

<style scoped>
.launch-page {
    min-height: 100vh;
    background: #f9fafc;
}
</style>
