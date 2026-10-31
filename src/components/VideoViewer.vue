<script setup lang="ts">
/**
 * 视频窗口 —— 固定尺寸浮层；全屏是浏览器原生全屏（真全屏、无边框），
 * 不再去动 Electron 窗口的尺寸/全屏状态，退出时窗口状态天然保持原样。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import SeekBar from './SeekBar.vue'
import { mediaEl, player, current, toggle, seekBy, toggleMute, setVolume } from '../stores/player'
import { ui } from '../stores/ui'
import { fmtTime } from '../utils/format'

const host = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const item = computed(() => current())
const open = computed(() => ui.videoOpen && !!item.value?.isVideo)

interface DesktopBridge {
  /** 视频全屏期间让主进程别抢 Esc */
  setVideoMode?: (on: boolean) => void
}
const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

const theater = ref(false)
const chromeVisible = ref(true)
let hideTimer = 0
let lastFullscreenChange = 0

const ANIM_MS = 260
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function attach() {
  if (!host.value) return
  if (mediaEl.parentElement !== host.value) {
    mediaEl.className = 'vv-video'
    host.value.appendChild(mediaEl)
  }
}

function detach() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  bridge?.setVideoMode?.(false)
  if (host.value && mediaEl.parentElement === host.value) host.value.removeChild(mediaEl)
}

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    attach()
    pokeChrome()
  } else {
    detach()
  }
})

onMounted(() => {
  if (open.value) attach()
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.clearTimeout(hideTimer)
  detach()
})

/** 状态完全以浏览器的 fullscreenElement 为准，避免自己记一套状态再串位 */
function onFullscreenChange() {
  const el = card.value
  const nowTheater = !!el && document.fullscreenElement === el
  theater.value = nowTheater
  lastFullscreenChange = Date.now()
  bridge?.setVideoMode?.(nowTheater)

  // FLIP 必须在这里同步做：此时全屏布局已生效、但浏览器还没绘制，
  // 反向变换能赶在第一帧之前落地，动画才不会先闪一下再动。
  if (el && pendingFlip) {
    const before = pendingFlip.before
    pendingFlip = null
    applyFlip(el, before)
    if (!nowTheater) fullscreenRect = null
  } else if (el && !nowTheater && fullscreenRect) {
    // 用 Esc 等原生方式退出时没有 pendingFlip，用进入全屏时的矩形补一段收缩动画
    applyFlip(el, fullscreenRect)
    fullscreenRect = null
  }

  if (nowTheater) {
    pokeChrome()
  } else {
    window.clearTimeout(hideTimer)
    chromeVisible.value = true
  }
}

/** 全屏时鼠标不动 2.5 秒就把标题栏和控件收起来 */
function pokeChrome() {
  chromeVisible.value = true
  window.clearTimeout(hideTimer)
  if (!theater.value) return
  hideTimer = window.setTimeout(() => { chromeVisible.value = false }, 2500)
}

function onKey(e: KeyboardEvent) {
  if (!open.value || e.key !== 'Escape') return
  // 全屏里的 Esc 由浏览器自己退出全屏，别顺手把窗口也关了
  if (document.fullscreenElement) return
  if (Date.now() - lastFullscreenChange < 500) return
  e.preventDefault()
  void close()
}

let pendingFlip: { el: HTMLElement; before: DOMRect } | null = null
let fullscreenRect: DOMRect | null = null

/** FLIP：先按切换前的矩形反向缩放，下一帧再过渡回原位 */
function applyFlip(el: HTMLElement, before: DOMRect) {
  const after = el.getBoundingClientRect()
  if (!after.width || !after.height) return
  const dx = before.left - after.left
  const dy = before.top - after.top
  const sx = before.width / after.width
  const sy = before.height / after.height
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
  if (document.fullscreenElement === el) fullscreenRect = after

  el.style.transition = 'none'
  el.style.transformOrigin = 'top left'
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
  void el.offsetWidth

  requestAnimationFrame(() => {
    el.style.transition = `transform ${ANIM_MS}ms ${EASE}`
    el.style.transform = 'none'
    window.setTimeout(() => {
      el.style.transition = ''
      el.style.transform = ''
      el.style.transformOrigin = ''
    }, ANIM_MS + 60)
  })
}

async function toggleFullscreen() {
  const el = card.value
  if (!el) return
  pendingFlip = { el, before: el.getBoundingClientRect() }
  try {
    if (document.fullscreenElement === el) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch {
    pendingFlip = null
  }
}

async function close() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen() } catch { /* 忽略 */ }
  }
  ui.closeVideo()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" :duration="{ enter: 160, leave: 140 }">
      <div v-if="open" class="vv-backdrop" @click.self="close">
        <div ref="card" class="vv-card" @mousemove="pokeChrome">
          <header v-show="!theater || chromeVisible" class="vv-head">
            <UiIcon name="music_note" :size="15" />
            <span class="vv-title" :title="item?.title">{{ item?.title }}</span>
            <div style="flex: 1" />
            <button class="icon-btn" :title="theater ? '退出全屏 (Esc)' : '全屏'" @click="toggleFullscreen">
              <UiIcon :name="theater ? 'restore' : 'fullscreen'" :size="17" />
            </button>
            <button class="icon-btn" title="关闭" @click="close">
              <UiIcon name="close" :size="16" />
            </button>
          </header>

          <div class="vv-stage" @click="toggle">
            <div ref="host" class="vv-host" />
            <div v-if="player.audioWarning" class="vv-warn">{{ player.audioWarning }}</div>
            <div v-else-if="player.error" class="vv-note error">{{ player.error }}</div>
            <div v-else-if="player.loading" class="vv-note">
              <span class="spinner" />
            </div>
          </div>

          <footer v-show="!theater || chromeVisible" class="vv-foot">
            <SeekBar class="vv-seek" />
            <div class="vv-ctrl">
              <button class="icon-btn" title="后退 5 秒" @click="seekBy(-5)">
                <UiIcon name="replay_5" :size="18" />
              </button>
              <button class="vv-play" @click="toggle">
                <UiIcon :name="player.playing ? 'pause' : 'play_arrow'" :size="20" />
              </button>
              <button class="icon-btn" title="前进 5 秒" @click="seekBy(5)">
                <UiIcon name="forward_5" :size="18" />
              </button>
              <span class="vv-time">{{ fmtTime(player.currentTime) }} / {{ fmtTime(player.duration) }}</span>
              <div style="flex: 1" />
              <button class="icon-btn" :title="player.muted ? '取消静音' : '静音'" @click="toggleMute">
                <UiIcon :name="player.muted || player.volume === 0 ? 'volume_off' : 'volume_up'" :size="18" />
              </button>
              <input
                class="vv-vol" type="range" min="0" max="1" step="0.01"
                :value="player.muted ? 0 : player.volume"
                @input="setVolume(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vv-backdrop {
  position: fixed; inset: 0; z-index: 430;
  background: color-mix(in srgb, var(--md-scrim) 66%, transparent);
  backdrop-filter: blur(8px);
  display: grid; place-items: center;
  padding: 36px;
}
/* 固定尺寸：不随内容缩放，也没有缩放控件 */
.vv-card {
  display: flex; flex-direction: column;
  width: min(86vw, 1180px);
  height: min(82vh, 664px);
  background: #000;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 22px 70px color-mix(in srgb, var(--md-scrim) 62%, transparent);
}
/* 真全屏：由浏览器接管，铺满、无圆角、无外边距 */
.vv-card:fullscreen {
  width: 100vw; height: 100vh; border-radius: 0; box-shadow: none;
}

.vv-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--md-surface-container-high) 92%, transparent);
  flex-shrink: 0;
}
.vv-title {
  font-size: 12.5px; font-weight: 600;
  max-width: 56%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--md-on-surface);
}

.vv-stage {
  position: relative;
  flex: 1; min-height: 0;
  background: #000;
  cursor: pointer;
  overflow: hidden;
}
.vv-host { position: absolute; inset: 0; }
.vv-host :deep(.vv-video) {
  width: 100%; height: 100%;
  object-fit: contain;
  background: #000;
  display: block;
}
.vv-note {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  color: #fff; font-size: 12.5px;
  pointer-events: none;
  text-align: center; padding: 0 24px;
}
.vv-note.error { color: #ffb4ab; }
.vv-warn {
  position: absolute; left: 12px; right: 12px; bottom: 12px;
  padding: 8px 12px; border-radius: 10px;
  background: color-mix(in srgb, #000 72%, transparent);
  border: 1px solid color-mix(in srgb, #ffb4ab 40%, transparent);
  color: #ffb4ab; font-size: 11.5px; line-height: 1.5;
  pointer-events: none;
}

.vv-foot {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 14px 10px;
  background: color-mix(in srgb, var(--md-surface-container-high) 92%, transparent);
  flex-shrink: 0;
}
.vv-seek { width: 100%; }
.vv-ctrl { display: flex; align-items: center; gap: 6px; }
.vv-play {
  width: 36px; height: 36px; border-radius: 50%; border: none;
  display: grid; place-items: center;
  background: var(--md-primary); color: var(--md-on-primary);
  cursor: pointer;
}
.vv-time {
  font-size: 11.5px; color: var(--md-on-surface-variant);
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.vv-vol { width: 84px; accent-color: var(--md-primary); }
</style>
