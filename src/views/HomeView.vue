<script setup lang="ts">
/**
 * 首页 — 布局：
 *   第 1 页无关键词时，顶部是「为你推荐」「热门」两个横向轨道，下面是全部作品网格。
 *   推荐走 POST /api/recommender/recommend-for-user（匿名可用，本地 uuid 区分画像）。
 *   网格用 IntersectionObserver 哨兵做无限加载，pageSize=60 保证密度。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import WorkRow from '../components/WorkRow.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import SortMenu from '../components/SortMenu.vue'
import { SORT_OPTIONS, DEFAULT_SORT, type SortOption } from '../constants/sort'
import {
  getWorks, postPopular, postRecommendForUser, type OrderField,
} from '../api/client'
import type { Work } from '../api/types'
import { recommenderUuid } from '../stores/recommender'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const router = useRouter()
const session = useSession

const PAGE_SIZE = 60

// ---------- 列表 ----------
const works = ref<Work[]>([])
const page = ref(1)
const totalCount = ref(0)
const loading = ref(false)
const firstLoad = ref(true)
const error = ref('')
const sortKey = ref(DEFAULT_SORT.key)
const sortOpt = ref<SortOption>(DEFAULT_SORT)
const scrolled = ref(false)

const hasMore = computed(() => works.value.length < totalCount.value)

// ---------- 推荐 / 热门 ----------
const popular = ref<Work[]>([])
const recommend = ref<Work[]>([])
const highRated = ref<Work[]>([])
const rowsLoading = ref(true)

const showRecommend = computed(() => {
  if (!recommend.value.length) return false
  // 与热门前三重合度过高就没必要重复展示
  const key = (w: Work) => w.id
  const pTop = popular.value.slice(0, 3).map(key).join(',')
  const rTop = recommend.value.slice(0, 3).map(key).join(',')
  return pTop !== rTop
})

async function loadRows() {
  rowsLoading.value = true
  const [pop, rec, top] = await Promise.all([
    postPopular(1, 12).catch(() => null),
    postRecommendForUser(recommenderUuid(), 1, 12).catch(() => null),
    getWorks(1, 'rate_average_2dp', 'desc', 12).catch(() => null),
  ])
  popular.value = pop?.works ?? []
  recommend.value = rec?.works ?? []
  highRated.value = top?.works ?? []
  rowsLoading.value = false
}

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) {
      page.value = 1
      works.value = []
      firstLoad.value = true
    }
    const o = sortOpt.value
    const res = await getWorks(page.value, o.order as OrderField, o.sort, PAGE_SIZE)
    works.value = reset ? res.works : [...works.value, ...res.works]
    totalCount.value = res.pagination?.totalCount ?? works.value.length
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg
    if (works.value.length) toast(msg, 'error')
  } finally {
    loading.value = false
    firstLoad.value = false
    await nextTick()
    observeSentinel()
  }
}

function onSort(opt: SortOption) {
  sortOpt.value = opt
  void load(true)
}

// ---------- 无限加载（IO + 滚动兜底） ----------
const scroller = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

function maybeLoadMore() {
  if (loading.value || !hasMore.value) return
  page.value++
  void load()
}

function observeSentinel() {
  io?.disconnect()
  if (!sentinel.value || !scroller.value || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadMore()
    },
    { root: scroller.value, rootMargin: '700px 0px' },
  )
  io.observe(sentinel.value)
}

/** 滚动兜底：某些环境（后台窗口 / 旧 WebView）IO 会被节流 */
function onScroll() {
  const el = scroller.value
  if (!el) return
  scrolled.value = el.scrollTop > 6
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) maybeLoadMore()
}

const searchKw = ref('')
/** 中文输入法回车只确认候选词，不触发跳转 */
function onSearchEnter(e: KeyboardEvent) {
  const composing = e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229
  if (composing) return
  const kw = searchKw.value.trim()
  if (kw) void router.push({ path: '/search', query: { kw } })
}

onMounted(async () => {
  await Promise.all([loadRows(), load(true)])
})
onUnmounted(() => io?.disconnect())
</script>

<template>
  <div class="view">
    <header class="app-header" :class="{ scrolled }">
      <div class="header-left">
        <span class="brand">作品</span>
        <span v-if="!firstLoad" class="count">{{ totalCount.toLocaleString() }}</span>
      </div>

      <div class="header-search">
        <UiIcon name="search" :size="17" class="search-ico" />
        <input
          v-model="searchKw" class="search-input" placeholder="搜索 RJ 号 / 标题 / 声优 / 社团…"
          @keydown.enter="onSearchEnter"
        />
      </div>

      <div class="header-right">
        <SortMenu v-model="sortKey" @change="onSort" />

        <button v-if="!session.loggedIn" class="login-btn" @click="ui.openLogin()">
          <UiIcon name="person" :size="17" /> 登录
        </button>
        <button v-else class="user-chip" @click="router.push('/settings')" :title="session.userName">
          <span class="avatar">{{ session.userName.slice(0, 1).toUpperCase() }}</span>
          <span class="uname">{{ session.userName }}</span>
        </button>
      </div>
    </header>

    <div ref="scroller" class="page-scroll" @scroll.passive="onScroll">
      <!-- 推荐 / 热门 -->
      <div class="rows-wrap">
        <WorkRow v-if="showRecommend || rowsLoading" title="为你推荐" subtitle="基于你的浏览画像" :works="recommend" :loading="rowsLoading" />
        <WorkRow v-if="popular.length || rowsLoading" title="热门" subtitle="近期销量与评分" :works="popular" :loading="rowsLoading" />
        <WorkRow v-if="highRated.length || rowsLoading" title="高分精选" subtitle="用户评分最高" :works="highRated" :loading="rowsLoading" />
      </div>

      <div class="section-head">
        <h2>全部作品</h2>
        <span class="section-sub">{{ sortOpt.label }} · 共 {{ totalCount.toLocaleString() }} 部</span>
      </div>

      <SkeletonGrid v-if="firstLoad && loading" :count="18" />

      <div v-else-if="error && !works.length" class="empty-state">
        <UiIcon name="refresh" :size="38" />
        <div>{{ error }}</div>
        <button class="filled-btn" @click="load(true)">重试</button>
      </div>

      <div v-else-if="!loading && !works.length" class="empty-state">
        <UiIcon name="explore" :size="38" />
        <div>该排序下没有数据，换个排序试试</div>
      </div>

      <div v-else class="works-grid">
        <WorkCard v-for="w in works" :key="`${w.id}-${sortKey}`" :work="w" />
      </div>

      <!-- 哨兵：进入视口即加载下一页 -->
      <div ref="sentinel" class="sentinel" />

      <div v-if="works.length && loading" class="load-more">
        <span class="spinner" style="border-color: color-mix(in srgb, var(--md-on-surface) 18%, transparent); border-top-color: var(--md-primary)" />
        加载中
      </div>
      <div v-else-if="works.length && hasMore" class="load-more">
        <button class="filled-btn slim" @click="maybeLoadMore">加载更多</button>
      </div>
      <div v-else-if="works.length" class="load-more done">
        已加载全部 {{ works.length.toLocaleString() }} 部
      </div>
    </div>
  </div>
</template>
