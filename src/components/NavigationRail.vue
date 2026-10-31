<script setup lang="ts">
/** 左侧导航 — 核心入口 */
import { useRoute, useRouter } from 'vue-router'
import UiIcon from './UiIcon.vue'
import avatarUrl from '../assets/avatar.png'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { downloadState } from '../stores/downloads'

const route = useRoute()
const router = useRouter()
const session = useSession

const items = [
  { path: '/', label: '作品', icon: 'home' },
  { path: '/popular', label: '热门', icon: 'local_fire' },
  { path: '/recommend', label: '推荐', icon: 'recommend' },
  { path: '/search', label: '搜索', icon: 'search' },
  { path: '/browse', label: '分类', icon: 'explore' },
  { path: '/library', label: '收藏', icon: 'subscriptions' },
  { path: '/playlists', label: '播放列表', icon: 'queue_music' },
  { path: '/downloads', label: '下载', icon: 'download' },
]

function goAccount() {
  if (session.loggedIn) router.push('/settings')
  else ui.openLogin()
}
</script>

<template>
  <nav class="nav-rail">
    <img class="rail-logo rail-avatar-img" :src="avatarUrl" title="Kikoenai" alt="" />

    <button
      v-for="it in items" :key="it.path"
      class="rail-item" :class="{ active: route.path === it.path || (it.path !== '/' && route.path.startsWith(it.path)) }"
      @click="router.push(it.path)"
    >
      <UiIcon :name="it.icon" />
      <span>{{ it.label }}</span>
      <span v-if="it.path === '/downloads' && downloadState.active" class="dl-badge rail-badge">{{ downloadState.active }}</span>
    </button>

    <div class="rail-spacer" />

    <button class="rail-item" :class="{ active: route.path === '/settings' }" @click="router.push('/settings')">
      <UiIcon name="settings" />
      <span>设置</span>
    </button>

    <button class="rail-item" :title="session.loggedIn ? session.userName : '未登录'" @click="goAccount">
      <span v-if="session.loggedIn" class="rail-avatar">{{ session.userName.slice(0, 1).toUpperCase() }}</span>
      <UiIcon v-else name="person" />
      <span class="rail-uname">{{ session.loggedIn ? session.userName : '登录' }}</span>
    </button>
  </nav>
</template>
