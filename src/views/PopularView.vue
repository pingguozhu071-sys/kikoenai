<script setup lang="ts">
/**
 * 热榜。
 * 服务端没有独立榜单接口：热门来自推荐服务，其余用服务端排序；
 * 作品自带的日/周/月榜名次已在卡片徽章里显示。
 */
import { ref, watch } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import { postPopular, getWorks } from '../api/client'
import { useWorkFeed } from '../composables/useWorkFeed'
import type { WorksResponse } from '../api/types'

type BoardKey = 'popular' | 'dl' | 'rate' | 'review' | 'new'

const BOARDS: { key: BoardKey; label: string; desc: string }[] = [
  { key: 'popular', label: '热门榜', desc: '推荐服务给出的近期热门' },
  { key: 'dl', label: '销量榜', desc: '按售出数排序' },
  { key: 'rate', label: '评分榜', desc: '按平均评分排序' },
  { key: 'review', label: '评论榜', desc: '按评论数排序' },
  { key: 'new', label: '新作榜', desc: '按收录时间排序' },
]

const board = ref<BoardKey>('popular')

function loaderFor(key: BoardKey) {
  return async (page: number, pageSize: number): Promise<WorksResponse> => {
    switch (key) {
      case 'popular': return postPopular(page, pageSize)
      case 'dl': return getWorks(page, 'dl_count', 'desc', pageSize)
      case 'rate': return getWorks(page, 'rate_average_2dp', 'desc', pageSize)
      case 'review': return getWorks(page, 'review_count', 'desc', pageSize)
      case 'new': return getWorks(page, 'create_date', 'desc', pageSize)
    }
  }
}

const { works, total, loading, firstLoad, error, hasMore, scroller, sentinel, onScroll, load, maybeLoadMore, reload } =
  useWorkFeed(loaderFor('popular'))

watch(board, (k) => { void reload(loaderFor(k)) })

const current = () => BOARDS.find((b) => b.key === board.value)!
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <div class="header-left">
        <span class="brand">{{ current().label }}</span>
        <span v-if="total" class="count">{{ total.toLocaleString() }}</span>
      </div>
      <div class="header-right">
        <span class="count">{{ current().desc }}</span>
      </div>
    </header>

    <div ref="scroller" class="page-scroll" @scroll.passive="onScroll">
      <div class="library-tabs">
        <button
          v-for="b in BOARDS" :key="b.key"
          class="lib-tab" :class="{ active: board === b.key }"
          @click="board = b.key"
        >{{ b.label }}</button>
      </div>

      <SkeletonGrid v-if="firstLoad && loading" :count="18" />

      <div v-else-if="error && !works.length" class="empty-state">
        <UiIcon name="refresh" :size="38" />
        <div>{{ error }}</div>
        <button class="filled-btn" @click="load(true)">重试</button>
      </div>

      <div v-else-if="!loading && !works.length" class="empty-state">
        <UiIcon name="explore" :size="38" />
        <div>这个榜单暂时没有数据</div>
      </div>

      <div v-else class="works-grid">
        <WorkCard v-for="w in works" :key="`${w.id}-${board}`" :work="w" />
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
