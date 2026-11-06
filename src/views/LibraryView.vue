<script setup lang="ts">
/**
 * 我的收藏 — 两个来源：
 *   1) 默认收藏夹：/api/playlist/get-default-mark-target-playlist + get-playlist-metadata
 *   2) 收听进度：/api/review?filter=marked|listening|listened|replay|postponed
 * 两者都需要登录（匿名 401）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import { getReview } from '../api/client'
import type { Work } from '../api/types'
import { useSession } from '../stores/session'
import { favorites, loadFavorites, refreshFavorites } from '../stores/favorites'
import { ui } from '../stores/ui'

const router = useRouter()
const session = useSession

type TabKey = 'playlist' | 'marked' | 'listening' | 'listened' | 'replay' | 'postponed'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'playlist', label: '收藏夹' },
  { key: 'marked', label: '想听' },
  { key: 'listening', label: '在听' },
  { key: 'listened', label: '听过' },
  { key: 'replay', label: '重听' },
  { key: 'postponed', label: '搁置' },
]

const tab = ref<TabKey>('playlist')
const works = ref<Work[]>([])
/** 旧客户端的“收藏”实际记在 listening 进度里；这里作为历史收藏一起展示 */
const legacy = ref<Work[]>([])
const legacyTotal = ref(0)
const loading = ref(false)
const error = ref('')
const total = ref(0)
const playlistName = ref('')

const needLogin = computed(() => !session.loggedIn)

async function loadPlaylist() {
  // 统一走收藏 store：ids 与作品列表一次取回；增删后 works 被清空，这里强制重拉
  const ok = await loadFavorites(favorites.works.length === 0)
  if (!ok || favorites.playlistId == null) {
    throw new Error(favorites.error || '收藏夹加载失败')
  }
  playlistName.value = '收藏夹'
  const all = favorites.works
  works.value = all
  total.value = all.length

  // 旧客户端把“收藏”记成了 listening 进度：只读取展示，不往服务器写
  const favIds = new Set(all.map((w) => w.id))
  const olds: Work[] = []
  const seen = new Set<number>()
  let lp = 1
  for (;;) {
    const res = await getReview('listening', lp, 'id', 'desc', 60)
    const list = res.works ?? []
    for (const w of list) {
      if (favIds.has(w.id) || seen.has(w.id)) continue
      seen.add(w.id)
      olds.push(w)
    }
    const totalCount = res.pagination?.totalCount ?? 0
    if (!list.length || lp * 60 >= totalCount || lp > 10) break
    lp++
  }
  legacy.value = olds
  legacyTotal.value = olds.length
}

async function loadReview(filter: string) {
  const res = await getReview(filter || null, 1, 'id', 'desc', 60)
  works.value = res.works ?? []
  total.value = res.pagination?.totalCount ?? works.value.length
  legacy.value = []
  legacyTotal.value = 0
}

/** 手动刷新：绕过缓存重新拉收藏夹（别处改动/多端同步后使用） */
async function refresh() {
  if (loading.value) return
  await refreshFavorites()
  await load()
}

async function load() {
  if (!session.loggedIn) { works.value = []; total.value = 0; return }
  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'playlist') {
      // 失败不再偷偷跳到「想听」：明确报错，让用户看到原因并重试
      await loadPlaylist()
    } else {
      await loadReview(tab.value)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(tab, load)
watch(() => session.currentName, load)
// 详情页/播放条收藏成功后，收藏夹页立刻刷新（mutations 只在真正写成功后自增）
watch(() => favorites.mutations, () => {
  if (tab.value === 'playlist' && !loading.value) void load()
})
onMounted(load)

const heading = computed(() => {
  if (needLogin.value) return '我的收藏'
  if (tab.value === 'playlist') return playlistName.value || '收藏夹'
  return TABS.find((t) => t.key === tab.value)?.label ?? '收藏'
})
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <div class="header-left">
        <span class="brand">{{ heading }}</span>
        <span v-if="session.loggedIn && total" class="count">{{ total }}</span>
      </div>
      <div class="header-right">
        <button
          v-if="session.loggedIn && tab === 'playlist'"
          class="icon-btn" title="刷新收藏夹" :disabled="loading"
          @click="refresh"
        >
          <UiIcon name="refresh" :size="17" />
        </button>
        <span v-if="session.loggedIn" class="user-chip" style="cursor: default">
          <span class="avatar">{{ session.userName.slice(0, 1).toUpperCase() }}</span>
          <span class="uname">{{ session.userName }}</span>
        </span>
        <button v-else class="login-btn" @click="ui.openLogin('收藏夹需要登录')">
          <UiIcon name="person" :size="17" /> 登录
        </button>
      </div>
    </header>

    <div class="page-scroll">
      <!-- 未登录 -->
      <div v-if="needLogin" class="empty-state">
        <UiIcon name="favorite" :size="44" />
        <div style="max-width: 420px; line-height: 1.8">
          收藏夹与收听进度需要登录账号。<br />
          服务端的 <code>/api/review</code>、<code>/api/playlist</code> 都不接受匿名访问。
        </div>
        <button class="filled-btn" @click="ui.openLogin('收藏夹需要登录')">登录</button>
      </div>

      <template v-else>
        <div class="library-tabs">
          <button
            v-for="t in TABS" :key="t.key"
            class="lib-tab" :class="{ active: tab === t.key }"
            @click="tab = t.key"
          >{{ t.label }}</button>
        </div>

        <SkeletonGrid v-if="loading" :count="12" />

        <div v-else-if="error" class="empty-state">
          <UiIcon name="refresh" :size="36" />
          <div>{{ error }}</div>
          <button class="filled-btn" @click="load">重试</button>
        </div>

        <div v-else-if="!works.length && !legacy.length" class="empty-state">
          <UiIcon name="favorite" :size="38" />
          <div>{{ tab === 'playlist' ? '收藏夹还是空的' : '这个分类下还没有作品' }}</div>
          <button class="chip" @click="router.push('/')">去逛逛</button>
        </div>

        <div v-else class="works-grid">
          <WorkCard v-for="w in works" :key="w.id" :work="w" />
        </div>

        <template v-if="tab === 'playlist' && legacy.length">
          <div class="lib-legacy-title">
            历史收藏 · {{ legacyTotal }} 部<span>（旧客户端记在「在听」，这里只做展示）</span>
          </div>
          <div class="works-grid">
            <WorkCard v-for="w in legacy" :key="'old-' + w.id" :work="w" />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
