<script setup lang="ts">
/**
 * 任务栏字幕：屏幕左下角一行当前歌词，窗口鼠标穿透。
 * 数据来自主进程转发的 lyrics:data / lyricsRequest。
 */
import { onMounted, onUnmounted, ref } from 'vue'

interface LyricsPayload {
  current: string
  next: string
  playing: boolean
  title: string
}

interface Bridge {
  lyricsRequest?: () => Promise<LyricsPayload | null>
  onLyricsData?: (cb: (p: LyricsPayload) => void) => () => void
}

const bridge = (window as unknown as { kikoeru?: Bridge }).kikoeru

const line = ref('♪')
const playing = ref(true)
let off: (() => void) | undefined

function apply(p: LyricsPayload) {
  line.value = p.current || '♪'
  playing.value = !!p.playing
}

onMounted(async () => {
  document.body.classList.add('is-lyrics-window')
  try {
    const init = await bridge?.lyricsRequest?.()
    if (init) apply(init)
  } catch { /* 忽略 */ }
  off = bridge?.onLyricsData?.(apply)
})

onUnmounted(() => {
  off?.()
  document.body.classList.remove('is-lyrics-window')
})
</script>

<template>
  <div class="tbl" :class="{ paused: !playing }">
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
  background: color-mix(in srgb, #141218 66%, transparent);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.40);
  color: #fff;
  overflow: hidden;
  user-select: none;
}
.tbl.paused { opacity: 0.62; }
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
