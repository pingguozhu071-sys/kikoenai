<script setup lang="ts">
/** 骨架屏 — 首屏加载时占位，避免空白闪跳 */
const props = withDefaults(defineProps<{ count?: number }>(), { count: 12 })
const items = Array.from({ length: props.count }, (_, i) => i)
</script>

<template>
  <div class="works-grid">
    <div v-for="i in items" :key="i" class="skeleton-card">
      <div class="skeleton-cover shimmer" />
      <div class="skeleton-meta">
        <div class="skeleton-line shimmer" style="width: 88%" />
        <div class="skeleton-line short shimmer" />
      </div>
    </div>
  </div>
</template>
