<script setup lang="ts">
/**
 * 播放列表小橱窗（独立小窗，悬在歌词栏的汉堡键上方）
 * 实时取样背景 + 紧凑列表；点一行就交给主窗播放，然后自己收起。
 */
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import { useScreenBackdrop } from '../composables/useScreenBackdrop'

interface QueueItem {
  title: string
  workTitle: string
}
interface QueueState {
  items: QueueItem[]
  index: number
  playing: boolean
}

interface Bridge {
  lyricsQueue?: () => Promise<QueueState>
  onLyricsQueue?: (cb: (q: QueueState) => void) => () => void
  lyricsPlayIndex?: (index: number) => void
  lyricsPanelClose?: () => Promise<unknown>
  onLyricsPanelTarget?: (cb: (t: string) => void) => () => void
}

const bridge = (window as unknown as { kikoeru?: Bridge }).kikoeru

const glass = ref<HTMLCanvasElement | null>(null)
useScreenBackdrop(glass, () => 'frosted')

const queue = ref<QueueState>({ items: [], index: -1, playing: false })
const listEl = ref<HTMLElement | null>(null)
let offQueue: (() => void) | undefined

function apply(q: QueueState) {
  if (!q || !Array.isArray(q.items)) return
  queue.value = { items: q.items, index: q.index, playing: !!q.playing }
  void scrollToActive()
}

async function scrollToActive() {
  await nextTick()
  const el = listEl.value?.querySelector<HTMLElement>('.lp-row.active')
  el?.scrollIntoView({ block: 'nearest' })
}

function pick(index: number) {
  bridge?.lyricsPlayIndex?.(index)
  void bridge?.lyricsPanelClose?.()
}
function close() { void bridge?.lyricsPanelClose?.() }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(async () => {
  document.documentElement.classList.add('is-lyrics-window')
  document.body.classList.add('is-lyrics-window')
  window.addEventListener('keydown', onKey)
  try {
    const q = await bridge?.lyricsQueue?.()
    if (q) apply(q)
  } catch { /* 忽略 */ }
  offQueue = bridge?.onLyricsQueue?.(apply)
})

onUnmounted(() => {
  offQueue?.()
  window.removeEventListener('keydown', onKey)
  document.documentElement.classList.remove('is-lyrics-window')
  document.body.classList.remove('is-lyrics-window')
})
</script>

<template>
  <div class="lp">
    <canvas ref="glass" class="lp-glass" aria-hidden="true" />
    <header class="lp-head">
      <span class="lp-title">播放列表</span>
      <span class="lp-count">{{ queue.items.length }}</span>
      <button class="lp-close" title="收起" @click="close"><UiIcon name="close" :size="14" /></button>
    </header>
    <div ref="listEl" class="lp-list">
      <button
        v-for="(it, i) in queue.items"
        :key="i + ':' + it.title"
        class="lp-row"
        :class="{ active: i === queue.index }"
        @click="pick(i)"
      >
        <span class="lp-idx">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="lp-name">{{ it.title }}</span>
        <UiIcon v-if="i === queue.index" name="graphic_eq" :size="13" class="lp-eq" />
      </button>
      <div v-if="!queue.items.length" class="lp-empty">播放器里还没有队列</div>
    </div>
  </div>
</template>

<style scoped>
.lp {
  height: 100%;
  display: flex; flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(170deg, rgba(26, 24, 32, 0.78), rgba(11, 10, 15, 0.84));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 18px 48px rgba(0, 0, 0, 0.46);
  overflow: hidden;
  position: relative;
  animation: lpIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-origin: 85% 100%;
}
@keyframes lpIn {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.lp-glass {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%;
  opacity: 0.85;
  pointer-events: none;
  transform: scale(1.08);
}
.lp > *:not(.lp-glass) { position: relative; z-index: 1; }

.lp-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.lp-title { font-size: 12.5px; font-weight: 700; color: #fff; }
.lp-count { flex: 1; font-size: 10.5px; color: rgba(255, 255, 255, 0.5); }
.lp-close {
  width: 22px; height: 22px; border-radius: 50%;
  border: none; background: rgba(255, 255, 255, 0.10); color: #fff;
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.16s;
}
.lp-close:hover { background: rgba(255, 255, 255, 0.24); }

.lp-list { flex: 1 1 auto; overflow-y: auto; padding: 5px 7px 7px; scrollbar-width: thin; }
.lp-list::-webkit-scrollbar { width: 6px; }
.lp-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 3px; }

.lp-row {
  width: 100%;
  display: flex; align-items: center; gap: 9px;
  padding: 6px 9px;
  border: none; border-radius: 8px;
  background: transparent; color: rgba(255, 255, 255, 0.80);
  font-family: inherit; font-size: 12px; text-align: left; cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s var(--ease-standard);
}
.lp-row:hover { background: rgba(255, 255, 255, 0.09); color: #fff; transform: translateX(2px); }
.lp-row.active { background: rgba(207, 188, 255, 0.15); color: #fff; }
.lp-idx { width: 21px; flex-shrink: 0; font-size: 10px; color: rgba(255, 255, 255, 0.42); font-variant-numeric: tabular-nums; }
.lp-row.active .lp-idx { color: var(--md-primary, #cfbcff); }
.lp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-eq { flex-shrink: 0; color: var(--md-primary, #cfbcff); }
.lp-empty { padding: 18px 12px; font-size: 11.5px; color: rgba(255, 255, 255, 0.45); }
</style>
