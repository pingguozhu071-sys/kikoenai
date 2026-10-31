<script setup lang="ts">
/**
 * 进度条（可复用）—— 自绘三段：底轨 / 已缓冲 / 已播放。
 * 支持点击跳转、拖拽 scrub（scrub 期间不被 timeupdate 覆盖）、悬停时间气泡。
 */
import { computed, ref } from 'vue'
import { player, beginScrub, scrubTo, endScrub } from '../stores/player'
import { fmtTime } from '../utils/format'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ seeked: [] }>()

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const hoverX = ref<number | null>(null)

const dur = computed(() => player.duration || 0)
const playedPct = computed(() => (dur.value ? Math.min(100, (player.currentTime / dur.value) * 100) : 0))
const bufferedPct = computed(() => (dur.value ? Math.min(100, (player.buffered / dur.value) * 100) : 0))

function pctFromEvent(e: PointerEvent): number {
  const el = trackEl.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

function onDown(e: PointerEvent) {
  if (!dur.value) return
  e.preventDefault()
  dragging.value = true
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 合成事件 */ }
  beginScrub()
  scrubTo(pctFromEvent(e) * dur.value)
}

function onMove(e: PointerEvent) {
  hoverX.value = pctFromEvent(e)
  if (dragging.value && dur.value) scrubTo(hoverX.value * dur.value)
}

function onUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  endScrub()
  emit('seeked')
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* 已释放 */ }
}

const hoverTime = computed(() => (hoverX.value === null || !dur.value ? '' : fmtTime(hoverX.value * dur.value)))
</script>

<template>
  <div class="seek-row" :class="{ compact }">
    <span class="seek-time">{{ fmtTime(player.currentTime) }}</span>
    <div
      ref="trackEl" class="seek-track" :class="{ dragging }"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp"
      @pointercancel="onUp" @pointerleave="() => { if (!dragging) hoverX = null }"
    >
      <div class="seek-rail" />
      <div class="seek-buffered" :style="{ width: bufferedPct + '%' }" />
      <div class="seek-played" :style="{ width: playedPct + '%' }" />
      <div class="seek-thumb" :style="{ left: playedPct + '%' }" />
      <div v-if="hoverX !== null && dur" class="seek-bubble" :style="{ left: Math.min(97, Math.max(3, hoverX * 100)) + '%' }">
        {{ hoverTime }}
      </div>
    </div>
    <span class="seek-time total">{{ fmtTime(player.duration) }}</span>
  </div>
</template>

<style scoped>
.seek-row { display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: var(--md-on-surface-variant); }
.seek-row.compact { gap: 10px; font-size: 11px; }
.seek-time { min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
.seek-time.total { text-align: left; }

.seek-track { position: relative; flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.seek-rail, .seek-buffered, .seek-played {
  position: absolute; left: 0; height: 4px; border-radius: 2px;
  transition: height 0.15s var(--ease-standard);
}
.seek-rail { right: 0; background: color-mix(in srgb, var(--md-on-surface) 16%, transparent); }
.seek-buffered { background: color-mix(in srgb, var(--md-on-surface) 34%, transparent); }
.seek-played {
  background: linear-gradient(90deg, var(--md-primary), color-mix(in srgb, var(--md-primary) 62%, var(--md-tertiary)));
  box-shadow: 0 0 10px color-mix(in srgb, var(--md-primary) 40%, transparent);
}
.seek-track:hover .seek-rail, .seek-track:hover .seek-buffered, .seek-track:hover .seek-played,
.seek-track.dragging .seek-rail, .seek-track.dragging .seek-buffered, .seek-track.dragging .seek-played { height: 6px; }

.seek-thumb {
  position: absolute; top: 50%; width: 12px; height: 12px; margin-left: -6px;
  border-radius: 50%; background: var(--md-primary);
  border: 2px solid var(--md-surface-container);
  transform: translateY(-50%) scale(0);
  transition: transform 0.16s var(--ease-emphasized);
  pointer-events: none;
}
.seek-track:hover .seek-thumb, .seek-track.dragging .seek-thumb { transform: translateY(-50%) scale(1); }

.seek-bubble {
  position: absolute; bottom: 22px; transform: translateX(-50%);
  padding: 3px 8px; border-radius: 6px;
  background: var(--md-inverse-surface); color: var(--md-inverse-on-surface);
  font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
}
</style>
