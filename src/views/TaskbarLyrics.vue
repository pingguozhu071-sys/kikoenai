<script setup lang="ts">
/**
 * 任务栏字幕：屏幕左下角一行歌词，平时鼠标穿透。
 * 背景同样来自屏幕流实时取样；指针进入时才接收点击，五颗按钮 + 汉堡键升起的播放列表橱窗。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import { useScreenBackdrop } from '../composables/useScreenBackdrop'
import { LYRIC_STYLE_KEY, readLyricStyle, type LyricStyle } from '../stores/lyricWindows'

interface LyricsPayload {
  current: string
  next: string
  playing: boolean
  title: string
}

type PlayerCommand = 'toggle' | 'prev' | 'next' | { type: 'seek'; delta: number }

interface Bridge {
  lyricsRequest?: () => Promise<LyricsPayload | null>
  onLyricsData?: (cb: (p: LyricsPayload) => void) => () => void
  taskbarLyricsToggle?: () => Promise<unknown>
  lyricsControl?: (action: PlayerCommand) => void
  lyricsPanelToggle?: (target: 'desktop' | 'taskbar') => Promise<{ open: boolean }>
  onLyricsPanelState?: (cb: (s: { open: boolean; target: string }) => void) => () => void
  lyricsInteractive?: (on: boolean) => void
}

const bridge = (window as unknown as { kikoeru?: Bridge }).kikoeru

const style = ref<LyricStyle>(readLyricStyle('taskbar'))
const glass = ref<HTMLCanvasElement | null>(null)
useScreenBackdrop(glass, () => style.value)

const line = ref('♪')
const playing = ref(true)
const hovered = ref(false)
const panelOpen = ref(false)

const styleClass = computed(() => 'style-' + style.value)

let offData: (() => void) | undefined
let offPanel: (() => void) | undefined

function apply(p: LyricsPayload) {
  line.value = p.current || '♪'
  playing.value = !!p.playing
}

function onStorage(e: StorageEvent) {
  if (e.key !== LYRIC_STYLE_KEY.taskbar) return
  style.value = readLyricStyle('taskbar')
}

function togglePlay() { bridge?.lyricsControl?.('toggle') }
function prevTrack() { bridge?.lyricsControl?.('prev') }
function nextTrack() { bridge?.lyricsControl?.('next') }
function close() { void bridge?.taskbarLyricsToggle?.() }

async function togglePanel() {
  const r = await bridge?.lyricsPanelToggle?.('taskbar')
  if (r) panelOpen.value = !!r.open
}

// ---- 鼠标穿透：指针在窗口内才接收点击，离开后恢复穿透 ----
let interactive = false
let lastMove = 0
function setInteractive(on: boolean) {
  if (on === interactive) return
  interactive = on
  bridge?.lyricsInteractive?.(on)
}
function onMouseMove() {
  const now = Date.now()
  if (!interactive && now - lastMove > 80) {
    lastMove = now
    setInteractive(true)
  }
}
function onMouseLeave() {
  hovered.value = false
  if (panelOpen.value) return
  setInteractive(false)
}
function onMouseEnter() { hovered.value = true }

onMounted(async () => {
  document.documentElement.classList.add('is-lyrics-window')
  document.body.classList.add('is-lyrics-window')
  window.addEventListener('storage', onStorage)
  document.addEventListener('mousemove', onMouseMove, { passive: true })
  document.addEventListener('mouseleave', onMouseLeave)
  try {
    const init = await bridge?.lyricsRequest?.()
    if (init) apply(init)
  } catch { /* 忽略 */ }
  offData = bridge?.onLyricsData?.(apply)
  offPanel = bridge?.onLyricsPanelState?.((s) => {
    if (s.target === 'taskbar') panelOpen.value = !!s.open
  })
})

onUnmounted(() => {
  offData?.()
  offPanel?.()
  window.removeEventListener('storage', onStorage)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseleave', onMouseLeave)
  document.documentElement.classList.remove('is-lyrics-window')
  document.body.classList.remove('is-lyrics-window')
})
</script>

<template>
  <div
    class="tbl"
    :class="[styleClass, { paused: !playing, hover: hovered || panelOpen }]"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <canvas ref="glass" class="glass" aria-hidden="true" />

    <span class="tbl-dot" />
    <span class="tbl-line" :title="line">{{ line }}</span>

    <div class="tbl-actions">
      <button class="tbl-btn" title="上一首" @click="prevTrack"><UiIcon name="skip_previous" :size="16" /></button>
      <button class="tbl-btn main" :title="playing ? '暂停' : '播放'" @click="togglePlay">
        <UiIcon :name="playing ? 'pause' : 'play_arrow'" :size="18" />
      </button>
      <button class="tbl-btn" title="下一首" @click="nextTrack"><UiIcon name="skip_next" :size="16" /></button>
      <button class="tbl-btn" :class="{ on: panelOpen }" title="播放列表" @click="togglePanel">
        <UiIcon name="menu" :size="16" />
      </button>
      <button class="tbl-btn" title="关闭任务栏字幕" @click="close"><UiIcon name="close" :size="15" /></button>
    </div>
  </div>
</template>

<style scoped>
.tbl {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px 0 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #fff;
  overflow: hidden;
  position: relative;
  user-select: none;
  transition: opacity 0.25s, border-color 0.25s;
}
.tbl.paused { opacity: 0.64; }

.glass {
  position: absolute; inset: -28px; z-index: 0;
  pointer-events: none;
  filter: blur(16px) saturate(1.35);
}
.tbl > *:not(.glass) { position: relative; z-index: 1; }

.tbl.style-classic {
  background: linear-gradient(160deg, rgba(24, 22, 29, 0.82), rgba(9, 8, 12, 0.88));
  border-color: rgba(255, 255, 255, 0.09);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 26px rgba(0, 0, 0, 0.40);
}
.tbl.style-classic .glass { opacity: 0.55; filter: blur(10px) brightness(0.75) saturate(1.1); }

.tbl.style-frosted {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04));
  border-color: rgba(255, 255, 255, 0.30);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.40), 0 10px 30px rgba(0, 0, 0, 0.35);
}
.tbl.style-frosted .glass { opacity: 0.95; }

.tbl.style-liquid {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.26);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26), 0 10px 30px rgba(0, 0, 0, 0.34);
}
.tbl.style-liquid .glass { opacity: 0.92; filter: blur(9px) saturate(1.55); }
.tbl.style-liquid::after {
  content: '';
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(108deg, transparent 32%, rgba(255, 255, 255, 0.18) 48%, transparent 62%);
  transform: translateX(-70%);
  animation: tblSheen 6.5s ease-in-out infinite;
}

/* 取样坏帧时退回不透明深色玻璃 */
:global(body.glass-dead) .tbl.style-frosted,
:global(body.glass-dead) .tbl.style-liquid {
  background: linear-gradient(160deg, rgba(30, 27, 36, 0.90), rgba(12, 11, 16, 0.94));
}

@keyframes tblSheen {
  0%, 55% { transform: translateX(-70%); opacity: 0; }
  65% { opacity: 1; }
  100% { transform: translateX(70%); opacity: 0; }
}

.tbl-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--md-primary, #cfbcff);
  box-shadow: 0 0 10px currentColor;
  flex-shrink: 0;
}
.tbl-line {
  flex: 1 1 auto;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.55);
}

.tbl-actions {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 2px;
  opacity: 0.55;
  transition: opacity 0.2s var(--ease-standard);
}
.tbl.hover .tbl-actions { opacity: 1; }
.tbl-btn {
  width: 26px; height: 26px; border-radius: 50%;
  border: none; background: transparent; color: #fff;
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.16s, transform 0.16s var(--ease-standard), color 0.16s;
}
.tbl-btn:hover { background: rgba(255, 255, 255, 0.18); transform: scale(1.08); }
.tbl-btn:active { transform: scale(0.92); }
.tbl-btn.main { width: 30px; height: 30px; background: rgba(255, 255, 255, 0.14); }
.tbl-btn.main:hover { background: rgba(255, 255, 255, 0.26); }
.tbl-btn.on {
  background: rgba(207, 188, 255, 0.28);
  box-shadow: inset 0 0 0 1px rgba(207, 188, 255, 0.52);
}
</style>
