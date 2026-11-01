<script setup lang="ts">
/**
 * 桌面歌词窗（独立置顶窗口）
 * 显示当前行 + 下一行，可拖动；悬停出现关闭/回主窗按钮。
 */
import { onMounted, onUnmounted, ref } from 'vue'
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
}

const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

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
  <div class="dlw" :class="{ paused: !playing }" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div class="dlw-drag">
      <div class="dlw-current">{{ currentLine }}</div>
      <div v-if="nextLine" class="dlw-next">{{ nextLine }}</div>
    </div>

    <div class="dlw-tools" :class="{ show: hovered }">
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
  background: color-mix(in srgb, #000 58%, transparent);
  backdrop-filter: blur(18px) saturate(1.1);
  -webkit-app-region: drag;
  user-select: none;
  position: relative;
  transition: background-color 0.25s, opacity 0.25s;
}
.dlw:hover { background: color-mix(in srgb, #000 72%, transparent); }
.dlw.paused { opacity: 0.72; }

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
  font-size: 10.5px; color: rgba(255, 255, 255, 0.45);
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dlw-tools {
  position: absolute; right: 10px; top: 8px;
  display: flex; gap: 4px;
  opacity: 0; transition: opacity 0.2s;
  -webkit-app-region: no-drag;
}
.dlw-tools.show, .dlw:hover .dlw-tools { opacity: 1; }
.dlw-btn {
  width: 26px; height: 26px; border-radius: 50%;
  border: none; background: rgba(255, 255, 255, 0.12); color: #fff;
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.18s;
}
.dlw-btn:hover { background: rgba(255, 255, 255, 0.26); }
</style>
