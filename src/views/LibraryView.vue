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
import {
  getDefaultMarkPlaylist, getPlaylistWorks, getReview,
} from '../api/client'
import type { Work } from '../api/types'
import { useSession } from '../stores/session'
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
const loading = ref(false)
const error = ref('')
const total = ref(0)
const playlistName = ref('')

const needLogin = computed(() => !session.loggedIn)

async function loadPlaylist() {
  // 元数据接口只返回 works_count，作品要单独取（分页拉全量）
  const meta = await getDefaultMarkPlaylist()
  const rawName = (meta?.name as string) || ''
  // 服务端默认夹叫 __SYS_PLAYLIST_MARKED，界面上不该露出来
  playlistName.value = !rawName || rawName.startsWith('__SYS') ? '收藏夹' : rawName
  const id = meta?.id
  if (id === undefined || id === null) throw new Error('没有默认收藏夹')

  const all: Work[] = []
  let page = 1
  for (;;) {
    const res = await getPlaylistWorks(id, page, 60)
    all.push(...(res.works ?? []))
    const totalCount = res.pagination?.totalCount ?? all.length
    if (!res.works?.length || all.length >= totalCount || page > 50) break
    page++
  }
  works.value = all
  total.value = all.length
}

async function loadReview(filter: string) {
  const res = await getReview(filter || null, 1, 'id', 'desc', 60)
  works.value = res.works ?? []
  total.value = res.pagination?.totalCount ?? works.value.length
}

async function load() {
  if (!session.loggedIn) { works.value = []; total.value = 0; return }
  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'playlist') {
      try {
        await loadPlaylist()
      } catch {
        // 服务端没有收藏夹接口 / 未创建默认夹 → 回落到「想听」
        tab.value = 'marked'
        return
      }
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

        <div v-else-if="!works.length" class="empty-state">
          <UiIcon name="favorite" :size="38" />
          <div>{{ tab === 'playlist' ? '收藏夹还是空的' : '这个分类下还没有作品' }}</div>
          <button class="chip" @click="router.push('/')">去逛逛</button>
        </div>

        <div v-else class="works-grid">
          <WorkCard v-for="w in works" :key="w.id" :work="w" />
        </div>
      </template>
    </div>
  </div>
</template>
