<script setup lang="ts">
/** 横向作品轨道 */
import { ref } from 'vue'
import type { Work } from '../api/types'
import WorkCard from './WorkCard.vue'
import UiIcon from './UiIcon.vue'

const props = defineProps<{
  title: string
  subtitle?: string
  works: Work[]
  loading?: boolean
}>()

const scroller = ref<HTMLElement | null>(null)

function scrollByPage(dir: 1 | -1) {
  const el = scroller.value
  if (!el) return
  el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
}
</script>

<template>
  <section v-if="loading || works.length" class="row-section">
    <div class="row-head">
      <div class="row-title">
        {{ title }}
        <span v-if="subtitle" class="row-sub">{{ subtitle }}</span>
      </div>
      <div class="row-actions">
        <button class="icon-btn small" title="向左" @click="scrollByPage(-1)"><UiIcon name="chevron_left" :size="18" /></button>
        <button class="icon-btn small" title="向右" @click="scrollByPage(1)"><UiIcon name="chevron_right" :size="18" /></button>
      </div>
    </div>

    <div ref="scroller" class="row-scroller">
      <template v-if="loading">
        <div v-for="i in 8" :key="i" class="skeleton-card rail-skeleton">
          <div class="skeleton-cover shimmer" />
          <div class="skeleton-meta">
            <div class="skeleton-line shimmer" />
            <div class="skeleton-line short shimmer" />
          </div>
        </div>
      </template>
      <WorkCard v-for="w in works" v-else :key="w.id" :work="w" variant="rail" />
    </div>
  </section>
</template>
