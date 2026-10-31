<script setup lang="ts">
/**
 * 作品卡片 — 展示服务端下发的字段：标题/社团/评分/销量/时长/排行/字幕。
 * 悬停浮起；点击进详情（不再放播放按钮）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Work } from '../api/types'
import { coverUrl } from '../api/client'
import { fmtCount, fmtDuration } from '../utils/format'

const props = withDefaults(defineProps<{ work: Work; variant?: 'grid' | 'rail' }>(), { variant: 'grid' })
const router = useRouter()

const title = computed(() => props.work.title || props.work.name || `RJ${props.work.id}`)
const circleName = computed(() => props.work.circle?.name || props.work.name || '')
const cover = computed(() => coverUrl(props.work, true))
const rating = computed(() => {
  const r = props.work.rate_average_2dp
  return typeof r === 'number' && r > 0 ? r.toFixed(1) : ''
})
const dl = computed(() => fmtCount(props.work.dl_count))
const dur = computed(() => fmtDuration(props.work.duration))
const year = computed(() => (props.work.release ?? '').slice(0, 4))

/** 日榜排名（≤20 才显示，避免满屏徽章） */
const rank = computed(() => {
  const list = props.work.rank ?? []
  const day = list.find((r) => r.term === 'day') ?? list.find((r) => r.term === 'week')
  return day && day.rank > 0 && day.rank <= 20 ? { n: day.rank, term: day.term } : null
})

function open() {
  void router.push(`/work/${props.work.id}`)
}
</script>

<template>
  <article class="work-card" :class="variant" @click="open">
    <div class="cover-wrap">
      <img class="cover" :src="cover" loading="lazy" decoding="async" alt="" />

      <div v-if="rank" class="rank-badge" :title="rank.term === 'day' ? '日榜' : '周榜'">
        <span>{{ rank.term === 'day' ? '日' : '周' }}</span>#{{ rank.n }}
      </div>

      <div class="cover-badges">
        <span v-if="work.has_subtitle" class="mini-badge sub">字幕</span>
        <span v-if="work.nsfw" class="mini-badge r18">R18</span>
      </div>

      <div v-if="dur" class="dur-badge">{{ dur }}</div>
    </div>

    <div class="meta">
      <div class="title">{{ title }}</div>
      <div class="sub">
        <span class="circle">{{ circleName }}</span>
        <span v-if="year" class="year">{{ year }}</span>
      </div>
      <div class="stats">
        <span v-if="rating" class="rating">★ {{ rating }}</span>
        <span v-if="dl" class="dl">{{ dl }} 售出</span>
      </div>
    </div>
  </article>
</template>
