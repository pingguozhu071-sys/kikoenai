<script setup lang="ts">
/**
 * 桌面歌词窗（独立置顶窗口）
 * 显示当前行 + 下一行，可拖动；悬停出现关闭/回主窗按钮。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'

interface LyricsPayload {
  current: string
  next: string
  playing: boolean
  title: string
}

interface DesktopBridge {
  onLyricsData?: (cb: (p: LyricsPayload) => void) => () => void
  lyricsClose?: () => Promise<unknown>
  lyricsOpenMain?: () => Promise<unknown>
  lyricsNextDisplay?: () => Promise<unknown>
  lyricsRequest?: () => Promise<LyricsPayload | null>
  /** Windows 11 原生亚克力（真实毛玻璃） */
  lyricsSetMaterial?: (m: string) => void
}

const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

/** 三种视觉：经典半透明 / 磨砂毛玻璃 / 液态玻璃 */
type LyricStyle = 'classic' | 'frosted' | 'liquid'
const STYLE_KEY = 'kikoeru-pc/lyricStyle'
const STYLE_ORDER: LyricStyle[] = ['classic', 'frosted', 'liquid']
const STYLE_NAMES: Record<LyricStyle, string> = { classic: '经典', frosted: '磨砂', liquid: '液态' }
const style = ref<LyricStyle>('frosted')
const styleName = computed(() => STYLE_NAMES[style.value])

function applyStyle() {
  localStorage.setItem(STYLE_KEY, style.value)
  bridge?.lyricsSetMaterial?.(style.value === 'classic' ? 'none' : 'acrylic')
}
function cycleStyle() {
  style.value = STYLE_ORDER[(STYLE_ORDER.indexOf(style.value) + 1) % 3]
  applyStyle()
}

const currentLine = ref('桌面字幕已就绪')
const nextLine = ref('在播放器中点击"字幕"按钮即可同步')
const songTitle = ref('')
const playing = ref(false)
const hovered = ref(false)

let off: (() => void) | undefined

function applyPayload(p: LyricsPayload) {
  currentLine.value = p.current || '♪'
  nextLine.value = p.next || ''
  songTitle.value = p.title || ''
  playing.value = !!p.playing
}

onMounted(async () => {
  document.body.classList.add('is-lyrics-window')
  const saved = localStorage.getItem(STYLE_KEY) as LyricStyle | null
  if (saved && STYLE_ORDER.includes(saved)) style.value = saved
  applyStyle()
  // 窗口可能晚于推送创建，主动拉一次当前状态
  try {
    const init = await bridge?.lyricsRequest?.()
    if (init) applyPayload(init)
  } catch { /* 忽略 */ }
  off = bridge?.onLyricsData?.((p) => {
    currentLine.value = p.current || '♪'
    nextLine.value = p.next || ''
    songTitle.value = p.title || ''
    playing.value = !!p.playing
  })
})

onUnmounted(() => {
  off?.()
  document.body.classList.remove('is-lyrics-window')
})

function close() { void bridge?.lyricsClose?.() }
function backToApp() { void bridge?.lyricsOpenMain?.() }
function nextDisplay() { void bridge?.lyricsNextDisplay?.() }
</script>

<template>
  <div class="dlw" :class="['style-' + style, { paused: !playing }]" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div class="dlw-drag">
      <div class="dlw-current">{{ currentLine }}</div>
      <div v-if="nextLine" class="dlw-next">{{ nextLine }}</div>
    </div>

    <div class="dlw-tools" :class="{ show: hovered }">
      <button class="dlw-btn dlw-style" :title="`切换样式（当前：${styleName}）`" @click="cycleStyle">{{ styleName }}</button>
      <button class="dlw-btn" title="移到下一块屏幕" @click="nextDisplay"><UiIcon name="swap_horiz" :size="15" /></button>
      <button class="dlw-btn" title="回到播放器" @click="backToApp"><UiIcon name="expand_less" :size="15" /></button>
      <button class="dlw-btn" title="关闭桌面字幕" @click="close"><UiIcon name="close" :size="15" /></button>
    </div>

    <div v-if="songTitle" class="dlw-song">{{ songTitle }}</div>
  </div>
</template>

<style scoped>
.dlw {
  height: 100%;
  display: flex; flex-direction: column; justify-content: center; gap: 6px;
  padding: 16px 28px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  position: relative;
  overflow: hidden;
  -webkit-app-region: drag;
  user-select: none;
  transition: background-color 0.25s, opacity 0.25s, border-color 0.25s;
}
.dlw.paused { opacity: 0.72; }

/* 经典：半透明深色，不再是死黑块 */
.dlw.style-classic {
  background: color-mix(in srgb, #141218 62%, transparent);
  backdrop-filter: blur(20px) saturate(1.15);
}
.dlw.style-classic:hover { background: color-mix(in srgb, #141218 74%, transparent); }

/* 磨砂：原生亚克力 + 亮边高光 */
.dlw.style-frosted {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.30);
  backdrop-filter: blur(36px) saturate(1.6);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38), 0 16px 42px rgba(0, 0, 0, 0.35);
}
.dlw.style-frosted:hover { background: rgba(255, 255, 255, 0.14); }
.dlw.style-frosted .dlw-next { color: rgba(255, 255, 255, 0.78); }

/* 液态：流动渐变 + 高光扫过 */
.dlw.style-liquid {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(30px) saturate(1.7);
}
.dlw.style-liquid::before {
  content: '';
  position: absolute; inset: -45%;
  background:
    radial-gradient(circle at 30% 30%, rgba(141, 110, 255, 0.65), transparent 55%),
    radial-gradient(circle at 70% 65%, rgba(255, 120, 200, 0.55), transparent 55%),
    radial-gradient(circle at 50% 85%, rgba(80, 200, 255, 0.50), transparent 55%),
    conic-gradient(from 0deg, rgba(255, 255, 255, 0.16), rgba(160, 120, 255, 0.28), rgba(255, 255, 255, 0.16));
  filter: blur(28px) saturate(1.4);
  animation: liquidSpin 18s linear infinite;
  z-index: 0;
}
.dlw.style-liquid::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(115deg, transparent 32%, rgba(255, 255, 255, 0.28) 46%, transparent 60%);
  transform: translateX(-70%);
  animation: liquidSheen 7s ease-in-out infinite;
  z-index: 0;
}
.dlw > * { position: relative; z-index: 1; }
.dlw.style-liquid .dlw-current {
  text-shadow: 0 0 22px rgba(190, 160, 255, 0.55), 0 2px 12px rgba(0, 0, 0, 0.5);
}

@keyframes liquidSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes liquidSheen {
  0%, 55% { transform: translateX(-70%); opacity: 0; }
  65% { opacity: 1; }
  100% { transform: translateX(70%); opacity: 0; }
}

.dlw-drag { display: flex; flex-direction: column; gap: 4px; align-items: center; text-align: center; }

.dlw-current {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.35;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.65);
  transition: color 0.3s;
}
.dlw-next {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.62);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.dlw-song {
  position: absolute; left: 16px; top: 10px;
  font-size: 10.5px; color: rgba(255, 255, 255, 0.55);
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dlw-tools {
  position: absolute; right: 10px; top: 8px;
  display: flex; gap: 4px; align-items: center;
  opacity: 0; transition: opacity 0.2s;
  -webkit-app-region: no-drag;
}
.dlw-tools.show, .dlw:hover .dlw-tools { opacity: 1; }
.dlw-btn {
  width: 26px; height: 26px; border-radius: 50%;
  border: none; background: rgba(255, 255, 255, 0.14); color: #fff;
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.18s;
}
.dlw-btn:hover { background: rgba(255, 255, 255, 0.28); }
.dlw-btn.dlw-style {
  width: auto; padding: 0 9px; border-radius: 13px;
  font-family: inherit; font-size: 10.5px;
}
</style>
