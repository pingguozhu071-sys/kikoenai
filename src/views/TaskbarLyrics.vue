<script setup lang="ts">
/**
 * 任务栏字幕：屏幕左下角一行当前歌词，窗口鼠标穿透。
 * 三种视觉与桌面字幕共用设置（kikoeru-pc/lyricStyleTaskbar）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { LYRIC_STYLE_KEY, materialFor, readLyricStyle, type LyricStyle } from '../stores/lyricWindows'

interface LyricsPayload {
  current: string
  next: string
  playing: boolean
  title: string
}

interface Bridge {
  lyricsRequest?: () => Promise<LyricsPayload | null>
  onLyricsData?: (cb: (p: LyricsPayload) => void) => () => void
  lyricsSetMaterial?: (target: 'desktop' | 'taskbar', m: string) => void
}

const bridge = (window as unknown as { kikoeru?: Bridge }).kikoeru

const style = ref<LyricStyle>(readLyricStyle('taskbar'))
const line = ref('♪')
const playing = ref(true)
let off: (() => void) | undefined

function syncMaterial() {
  bridge?.lyricsSetMaterial?.('taskbar', materialFor(style.value))
}

function apply(p: LyricsPayload) {
  line.value = p.current || '♪'
  playing.value = !!p.playing
}

/** 设置页改样式时，本窗口通过 storage 事件实时更新 */
function onStorage(e: StorageEvent) {
  if (e.key !== LYRIC_STYLE_KEY.taskbar) return
  const next = readLyricStyle('taskbar')
  if (next === style.value) return
  style.value = next
  syncMaterial()
}

onMounted(async () => {
  document.body.classList.add('is-lyrics-window')
  syncMaterial()
  window.addEventListener('storage', onStorage)
  try {
    const init = await bridge?.lyricsRequest?.()
    if (init) apply(init)
  } catch { /* 忽略 */ }
  off = bridge?.onLyricsData?.(apply)
})

onUnmounted(() => {
  off?.()
  window.removeEventListener('storage', onStorage)
  document.body.classList.remove('is-lyrics-window')
})
</script>

<template>
  <div class="tbl" :class="['style-' + style, { paused: !playing }]">
    <span class="tbl-dot" />
    <span class="tbl-line" :title="line">{{ line }}</span>
  </div>
</template>

<style scoped>
.tbl {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #fff;
  overflow: hidden;
  position: relative;
  user-select: none;
  transition: background-color 0.25s, border-color 0.25s, opacity 0.25s;
}
.tbl.paused { opacity: 0.62; }

.tbl.style-classic {
  background: color-mix(in srgb, #141218 66%, transparent);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.40);
}
.tbl.style-frosted {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.30);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 10px 30px rgba(0, 0, 0, 0.35);
}
.tbl.style-liquid {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(26px) saturate(1.7);
}
.tbl.style-liquid::before {
  content: '';
  position: absolute; inset: -60%;
  background:
    radial-gradient(circle at 30% 35%, rgba(141, 110, 255, 0.75), transparent 55%),
    radial-gradient(circle at 72% 60%, rgba(255, 120, 200, 0.60), transparent 55%),
    radial-gradient(circle at 50% 85%, rgba(80, 200, 255, 0.55), transparent 55%);
  filter: blur(22px);
  animation: tblSpin 16s linear infinite;
  z-index: 0;
}
.tbl.style-liquid::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 34%, rgba(255, 255, 255, 0.26) 48%, transparent 62%);
  transform: translateX(-70%);
  animation: tblSheen 6.5s ease-in-out infinite;
  z-index: 0;
}
.tbl > * { position: relative; z-index: 1; }

@keyframes tblSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.55);
}
</style>
