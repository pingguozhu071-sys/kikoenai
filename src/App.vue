<script setup lang="ts">
/**
 * 应用骨架 — 左 NavigationRail + 内容区 + 底部播放条 + 登录弹窗 + 全局快捷键。
 */
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavigationRail from './components/NavigationRail.vue'
import PlayerBar from './components/PlayerBar.vue'
import ToastHost from './components/ToastHost.vue'
import LoginDialog from './components/LoginDialog.vue'
import WindowControls from './components/WindowControls.vue'
import NowPlaying from './components/NowPlaying.vue'
import MediaViewer from './components/MediaViewer.vue'
import VideoViewer from './components/VideoViewer.vue'
import { initDownloads } from './stores/downloads'
import { useSession } from './stores/session'
import { applyTheme } from './theme/material'
import { player, current, toggle, next, prev, seekBy, setVolume, toggleMute } from './stores/player'
import { ui } from './stores/ui'

const route = useRoute()
const router = useRouter()
const session = useSession
let offMediaKey: (() => void) | undefined

session.onRelogin(() => {
  ui.openLogin('登录已过期，请重新登录')
})

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (ui.loginOpen) return
  // 查看器开着时方向键归它翻页，不能同时去拖播放进度
  if (ui.viewer.open) return
  if (isTyping(e) || !current()) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  switch (e.code) {
    case 'Space': e.preventDefault(); toggle(); break
    case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -30 : -5); break
    case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 30 : 5); break
    case 'ArrowUp': e.preventDefault(); setVolume(player.volume + 0.05); break
    case 'ArrowDown': e.preventDefault(); setVolume(player.volume - 0.05); break
    case 'KeyM': toggleMute(); break
    case 'KeyN': next(); break
    case 'KeyP': prev(); break
    case 'Slash':
      e.preventDefault()
      void router.push('/search')
      break
  }
}

const isLyricsWindow = computed(() => route.path === '/desktop-lyrics')

/** 点空白处让输入框失焦：否则搜索框的焦点环会一直亮着 */
const FOCUSABLE_TAGS = /^(INPUT|TEXTAREA|SELECT)$/

/**
 * 点到"非输入"区域时收掉输入框焦点，紫框随之消失。
 * 说明：Chromium 里文本框聚焦一定匹配 :focus-visible，所以单纯靠 CSS 收不掉。
 */
function blurActiveInput(e: Event) {
  const t = (e.target as HTMLElement | null) ?? null
  if (t && t.closest) {
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    // 点按钮/链接时一般由它们自己处理，但播放条上的按钮也应收焦点
    if (t.closest('button, a, [role="button"], .menu, .dialog-card, .np-sheet')) {
      if (!t.closest('.player-bar')) return
    }
  }
  const active = document.activeElement as HTMLElement | null
  if (active && FOCUSABLE_TAGS.test(active.tagName)) active.blur()
}

onMounted(() => {
  document.addEventListener('pointerdown', blurActiveInput, true)
  document.addEventListener('click', blurActiveInput, true)
  watch(() => route.path, () => {
    const active = document.activeElement as HTMLElement | null
    if (active && FOCUSABLE_TAGS.test(active.tagName)) active.blur()
  })
  applyTheme()
  window.addEventListener('keydown', onKeydown)
  void initDownloads()
  // 桌面壳的全局媒体键
  const desktop = (window as unknown as { kikoeru?: { onMediaKey?: (cb: (a: string) => void) => () => void } }).kikoeru
  if (desktop?.onMediaKey) {
    offMediaKey = desktop.onMediaKey((action) => {
      if (action === 'toggle') toggle()
      else if (action === 'next') next()
      else if (action === 'prev') prev()
      else if (action === 'stop') { if (player.playing) toggle() }
    })
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', blurActiveInput, true)
  document.removeEventListener('click', blurActiveInput, true)
  offMediaKey?.()
})
</script>

<template>
  <router-view v-if="isLyricsWindow" />
  <div v-else class="app-shell">
    <NavigationRail />
    <div class="main-area">
      <!-- 不做整页 out-in 转场：离开动画在窗口失焦时可能不结束，导致新页面进不来 -->
      <router-view />
      <PlayerBar />
    </div>
  </div>

  <template v-if="!isLyricsWindow">
    <WindowControls />
    <NowPlaying />
  <MediaViewer />
  <VideoViewer />
  </template>
  <LoginDialog />
  <ToastHost />
</template>
