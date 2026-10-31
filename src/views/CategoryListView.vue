<script setup lang="ts">
/** 分类作品列表 — /api/{tags|circles|vas}/{id}/works */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import { getWorksByCategory, type CategoryKind } from '../api/client'
import { useWorkFeed } from '../composables/useWorkFeed'
import { SORT_OPTIONS, DEFAULT_SORT, type SortOption } from '../constants/sort'

const route = useRoute()
const router = useRouter()

const kind = computed(() => String(route.params.kind || 'tag') as CategoryKind)
const id = computed(() => String(route.params.id || ''))
const name = computed(() => String(route.query.name || id.value))
const kindLabel = computed(() => (kind.value === 'tag' ? '标签' : kind.value === 'circle' ? '社团' : '声优'))

const sortKey = ref(DEFAULT_SORT.key)

function loader(o: SortOption) {
  return (page: number, pageSize: number) =>
    getWorksByCategory(kind.value, id.value, page, o.order, o.sort, pageSize)
}

const { works, total, loading, firstLoad, error, hasMore, scroller, sentinel, onScroll, load, maybeLoadMore, reload } =
  useWorkFeed(loader(DEFAULT_SORT))

function onSortChange(key: string) {
  sortKey.value = key
  const o = SORT_OPTIONS.find((x) => x.key === key)
  if (o) void reload(loader(o))
}
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <button class="icon-btn" title="返回" @click="router.back()"><UiIcon name="arrow_back" /></button>
      <div class="header-left">
        <span class="brand">{{ name }}</span>
        <span class="count">{{ kindLabel }} · {{ total.toLocaleString() }} 部</span>
      </div>
      <div class="header-right">
        <select class="sort-select" :value="sortKey" @change="onSortChange(($event.target as HTMLSelectElement).value)">
          <option v-for="o in SORT_OPTIONS" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
      </div>
    </header>

    <div ref="scroller" class="page-scroll" @scroll.passive="onScroll">
      <SkeletonGrid v-if="firstLoad && loading" :count="18" />

      <div v-else-if="error && !works.length" class="empty-state">
        <UiIcon name="refresh" :size="38" />
        <div>{{ error }}</div>
        <button class="filled-btn" @click="load(true)">重试</button>
      </div>

      <div v-else-if="!loading && !works.length" class="empty-state">
        <UiIcon name="explore" :size="38" />
        <div>这个{{ kindLabel }}下还没有作品</div>
      </div>

      <div v-else class="works-grid">
        <WorkCard v-for="w in works" :key="w.id" :work="w" />
      </div>

      <div ref="sentinel" class="sentinel" />

      <div v-if="works.length && loading" class="load-more">
        <span class="spinner" style="border-color: color-mix(in srgb, var(--md-on-surface) 18%, transparent); border-top-color: var(--md-primary)" />
        加载中
      </div>
      <div v-else-if="works.length && hasMore" class="load-more">
        <button class="filled-btn slim" @click="maybeLoadMore">加载更多</button>
      </div>
    </div>
  </div>
</template>
