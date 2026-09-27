<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number; label: string }>()
const filledCount = computed(() => Math.max(0, Math.min(5, Math.round(props.value))))
</script>

<template>
  <span class="star-rating">
    <span class="star-glyphs" aria-hidden="true"><span v-for="n in 5" :key="n" :class="n <= filledCount ? 'star-filled' : 'star-empty'">{{ n <= filledCount ? '★' : '☆' }}</span></span>
    <span class="visually-hidden">{{ label }}</span>
  </span>
</template>
