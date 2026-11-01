<script setup lang="ts">
/**
 * 桌面歌词窗
 * 背景是从屏幕流里实时截取的"本窗口背后那块画面"，模糊后铺在字下面。
 * 播放控制（前后 10 秒 / 上一首 / 播放 / 下一首）常驻，汉堡键在按键上方升起小橱窗。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import { useScreenBackdrop } from '../composables/useScreenBackdrop'
import {
  LYRIC_STYLE_KEY, LYRIC_STYLE_NAMES, readLyricStyle, writeLyricStyle, type LyricStyle,
} from '../stores/lyricWindows'

interface LyricsPayload {
  current: string
  next: string
  playing: boolean
  title: string
}

type PlayerCommand = 'toggle' | 'prev' | 'next' | { type: 'seek'; delta: number }

interface DesktopBridge {
  onLyricsData?: (cb: (p: LyricsPayload) => void) => () => void
  lyricsClose?: () => Promise<unknown>
  lyricsOpenMain?: () => Promise<unknown>
  lyricsNextDisplay?: () => Promise<unknown>
  lyricsRequest?: () => Promise<LyricsPayload | null>
  lyricsControl?: (action: PlayerCommand) => void
  lyricsPanelToggle?: (target: 'desktop' | 'taskbar') => Promise<{ open: boolean }>
  onLyricsPanelState?: (cb: (s: { open: boolean; target: string }) => void) => () => void
  lyricsInteractive?: (on: boolean) => void
}

const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

const STYLE_ORDER: LyricStyle[] = ['classic', 'frosted', 'liquid']
const style = ref<LyricStyle>(readLyricStyle('desktop'))
const styleName = computed(() => LYRIC_STYLE_NAMES[style.value])

const glass = ref<HTMLCanvasElement | null>(null)
useScreenBackdrop(glass, () => style.value)

function cycleStyle() {
  style.value = STYLE_ORDER[(STYLE_ORDER.indexOf(style.value) + 1) % 3]
  writeLyricStyle('desktop', style.value)
}
function onStorage(e: StorageEvent) {
  if (e.key !== LYRIC_STYLE_KEY.desktop) return
  style.value = readLyricStyle('desktop')
}

const currentLine = ref('桌面字幕已就绪')
const nextLine = ref('在播放器中点击"字幕"按钮即可同步')
const songTitle = ref('')
const playing = ref(false)
const hovered = ref(false)
const panelOpen = ref(false)

let offData: (() => void) | undefined
let offPanel: (() => void) | undefined

function applyPayload(p: LyricsPayload) {
  currentLine.value = p.current || '♪'
  nextLine.value = p.next || ''
  songTitle.value = p.title || ''
  playing.value = !!p.playing
}

function togglePlay() { bridge?.lyricsControl?.('toggle') }
function prevTrack() { bridge?.lyricsControl?.('prev') }
function nextTrack() { bridge?.lyricsControl?.('next') }
function seekBy(delta: number) { bridge?.lyricsControl?.({ type: 'seek', delta }) }

async function togglePanel() {
  const r = await bridge?.lyricsPanelToggle?.('desktop')
  if (r) panelOpen.value = !!r.open
}

onMounted(async () => {
  document.documentElement.classList.add('is-lyrics-window')
  document.body.classList.add('is-lyrics-window')
  window.addEventListener('storage', onStorage)
  try {
    const init = await bridge?.lyricsRequest?.()
    if (init) applyPayload(init)
  } catch { /* 忽略 */ }
  offData = bridge?.onLyricsData?.(applyPayload)
  offPanel = bridge?.onLyricsPanelState?.((s) => {
    if (s.target === 'desktop') panelOpen.value = !!s.open
  })
})

onUnmounted(() => {
  offData?.()
  offPanel?.()
  window.removeEventListener('storage', onStorage)
  document.documentElement.classList.remove('is-lyrics-window')
  document.body.classList.remove('is-lyrics-window')
})

function close() { void bridge?.lyricsClose?.() }
function backToApp() { void bridge?.lyricsOpenMain?.() }
function nextDisplay() { void bridge?.lyricsNextDisplay?.() }
</script>

<template>
  <div class="dlw" :class="['style-' + style, { paused: !playing }]" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <canvas ref="glass" class="glass" aria-hidden="true" />

    <div class="dlw-main">
      <span v-if="songTitle" class="dlw-song">{{ songTitle }}</span>
      <div class="dlw-current">{{ currentLine }}</div>
      <div v-if="nextLine" class="dlw-next">{{ nextLine }}</div>
    </div>

    <div class="dlw-side">
      <div class="dlw-tools" :class="{ show: hovered || panelOpen }">
        <button class="dlw-btn chip" :title="`切换样式（当前：${styleName}）`" @click="cycleStyle">{{ styleName }}</button>
        <button class="dlw-btn" title="移到下一块屏幕" @click="nextDisplay"><UiIcon name="swap_horiz" :size="15" /></button>
        <button class="dlw-btn" title="回到播放器" @click="backToApp"><UiIcon name="expand_less" :size="15" /></button>
        <button class="dlw-btn" title="关闭桌面字幕" @click="close"><UiIcon name="close" :size="15" /></button>
      </div>

      <div class="dlw-actions">
        <button class="dlw-btn" title="后退 10 秒" @click="seekBy(-10)">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
            <text x="12" y="16.6" text-anchor="middle" font-size="7.5" font-weight="700">10</text>
          </svg>
        </button>
        <button class="dlw-btn" title="上一首" @click="prevTrack"><UiIcon name="skip_previous" :size="17" /></button>
        <button class="dlw-btn main" :title="playing ? '暂停' : '播放'" @click="togglePlay">
          <UiIcon :name="playing ? 'pause' : 'play_arrow'" :size="21" />
        </button>
        <button class="dlw-btn" title="下一首" @click="nextTrack"><UiIcon name="skip_next" :size="17" /></button>
        <button class="dlw-btn" title="前进 10 秒" @click="seekBy(10)">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <g transform="scale(-1,1) translate(-24,0)">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
            </g>
            <text x="12" y="16.6" text-anchor="middle" font-size="7.5" font-weight="700">10</text>
          </svg>
        </button>
        <span class="dlw-sep" />
        <button class="dlw-btn" :class="{ on: panelOpen }" title="播放列表" @click="togglePanel">
          <UiIcon name="menu" :size="17" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dlw {
  height: 100%;
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px 12px 22px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  position: relative;
  overflow: hidden;
  -webkit-app-region: drag;
  user-select: none;
  transition: opacity 0.25s, border-color 0.25s;
}
.dlw.paused { opacity: 0.74; }

/* 实时背景：由 canvas 每 90ms 从屏幕流取一次 */
.glass {
  /* canvas 是替换元素：只写 inset 不会拉伸，必须显式给宽高 */
  position: absolute; inset: -28px; z-index: 0;
  width: calc(100% + 56px); height: calc(100% + 56px);
  pointer-events: none;
  filter: blur(16px) saturate(1.35);
}

.dlw > *:not(.glass) { position: relative; z-index: 1; }

.dlw.style-classic {
  background: linear-gradient(165deg, rgba(24, 22, 29, 0.80), rgba(9, 8, 12, 0.86));
  border-color: rgba(255, 255, 255, 0.09);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 14px 38px rgba(0, 0, 0, 0.42);
}
.dlw.style-classic .glass { opacity: 0.55; filter: blur(11px) brightness(0.75) saturate(1.1); }
.dlw.style-classic:hover { background: linear-gradient(165deg, rgba(30, 27, 36, 0.84), rgba(11, 10, 15, 0.90)); }

.dlw.style-frosted {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04));
  border-color: rgba(255, 255, 255, 0.30);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    inset 0 -1px 0 rgba(255, 255, 255, 0.06),
    0 18px 46px rgba(0, 0, 0, 0.38);
}
.dlw.style-frosted .glass { opacity: 0.95; }
.dlw.style-frosted .dlw-next { color: rgba(255, 255, 255, 0.80); }

.dlw.style-liquid {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.26);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    0 18px 46px rgba(0, 0, 0, 0.36);
}
.dlw.style-liquid .glass { opacity: 0.92; filter: blur(9px) saturate(1.55); }
/* 液态的高光扫过，压在实时画面之上 */
.dlw.style-liquid::after {
  content: '';
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(112deg, transparent 30%, rgba(255, 255, 255, 0.16) 45%, transparent 60%);
  transform: translateX(-70%);
  animation: liquidSheen 7s ease-in-out infinite;
}
.dlw.style-liquid .dlw-current {
  text-shadow: 0 0 22px rgba(190, 160, 255, 0.45), 0 2px 12px rgba(0, 0, 0, 0.55);
}

/* 取样坏帧时（纯绿/洋红花屏）退回不透明深色玻璃，保证可读 */
:global(body.glass-dead) .dlw.style-frosted,
:global(body.glass-dead) .dlw.style-liquid {
  background: linear-gradient(160deg, rgba(30, 27, 36, 0.88), rgba(12, 11, 16, 0.93));
}

@keyframes liquidSheen {
  0%, 55% { transform: translateX(-70%); opacity: 0; }
  65% { opacity: 1; }
  100% { transform: translateX(70%); opacity: 0; }
}

.dlw-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; text-align: center;
}
.dlw-song {
  font-size: 10.5px; color: rgba(255, 255, 255, 0.55);
  display: block; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dlw-current {
  font-size: 26px; font-weight: 700; line-height: 1.35; color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.65);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dlw-next {
  font-size: 15px; color: rgba(255, 255, 255, 0.62);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}

.dlw-side {
  flex: 0 0 auto;
  display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 7px;
  -webkit-app-region: no-drag;
}

.dlw-actions {
  display: flex; align-items: center; gap: 4px;
  padding: 4px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.16);
  opacity: 0.85;
  transition: opacity 0.22s var(--ease-standard), background-color 0.22s;
}
.dlw:hover .dlw-actions { opacity: 1; background: rgba(0, 0, 0, 0.24); }

.dlw-sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.16); margin: 0 2px; }

.dlw-tools {
  display: flex; gap: 4px; align-items: center;
  height: 24px;
  opacity: 0; transform: translateY(-3px);
  transition: opacity 0.2s var(--ease-standard), transform 0.2s var(--ease-standard);
}
.dlw-tools.show { opacity: 1; transform: translateY(0); }

.dlw-btn {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: rgba(255, 255, 255, 0.10); color: #fff;
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.18s, transform 0.16s var(--ease-standard), color 0.18s;
}
.dlw-btn svg { fill: currentColor; }
.dlw-btn svg text { fill: #fff; font-family: inherit; }
.dlw-btn:hover { background: rgba(255, 255, 255, 0.24); transform: scale(1.06); }
.dlw-btn:active { transform: scale(0.94); }
.dlw-btn.main { width: 38px; height: 38px; background: rgba(255, 255, 255, 0.18); }
.dlw-btn.main:hover { background: rgba(255, 255, 255, 0.30); }
.dlw-btn.on {
  background: rgba(207, 188, 255, 0.26);
  box-shadow: inset 0 0 0 1px rgba(207, 188, 255, 0.48);
}
.dlw-btn.chip {
  width: auto; padding: 0 9px; border-radius: 13px;
  height: 24px; font-family: inherit; font-size: 10.5px;
}
</style>
