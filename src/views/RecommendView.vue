<script setup lang="ts">
/** 推荐整页 —— recommend-for-user，按本地画像生成 */
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import { postRecommendForUser } from '../api/client'
import { recommenderUuid } from '../stores/recommender'
import { useWorkFeed } from '../composables/useWorkFeed'

const { works, total, loading, firstLoad, error, hasMore, scroller, sentinel, onScroll, load, maybeLoadMore } =
  useWorkFeed((page, pageSize) => postRecommendForUser(recommenderUuid(), page, pageSize))
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <div class="header-left">
        <span class="brand">推荐</span>
        <span v-if="total" class="count">{{ total.toLocaleString() }}</span>
      </div>
      <div class="header-right">
        <span class="count">按你的浏览画像推荐</span>
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
        <UiIcon name="favorite" :size="38" />
        <div>还没有足够的浏览记录，先去「作品」逛几部再来</div>
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
