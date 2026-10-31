<script setup lang="ts">
/**
 * 图片 / 文档查看器
 * 注意：只用应用内的模态浮层，**绝不调用 requestFullscreen**，
 * 所以窗口全屏时打开图片也只是一个居中的浮层，不会把图片变成全屏。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import { ui } from '../stores/ui'

const scale = ref(1)
const bodyEl = ref<HTMLElement | null>(null)

const v = computed(() => ui.viewer)

/** 有图片列表时以 index 为准，支持左右翻页 */
const pics = computed(() => v.value.images ?? [])
const hasGallery = computed(() => pics.value.length > 1)
const current = computed(() => {
  if (pics.value.length) {
    return pics.value[v.value.index] ?? pics.value[0]
  }
  return { url: v.value.url, title: v.value.title }
})

/** 每次打开/翻页都从 100% 和顶部开始 */
watch(
  [() => v.value.open, () => v.value.index],
  async ([open]) => {
    if (!open) return
    scale.value = 1
    await nextTick()
    if (bodyEl.value) bodyEl.value.scrollTop = 0
  },
)

function step(delta: number) {
  if (!hasGallery.value) return
  const n = pics.value.length
  ui.viewer.index = (v.value.index + delta + n) % n
}

function close() { ui.closeViewer() }
function zoom(delta: number) {
  scale.value = Math.max(0.4, Math.min(4, Math.round((scale.value + delta) * 10) / 10))
}
function resetZoom() { scale.value = 1 }

function onWheel(e: WheelEvent) {
  if (v.value.kind !== 'image') return
  e.preventDefault()
  zoom(e.deltaY > 0 ? -0.2 : 0.2)
}

function onKey(e: KeyboardEvent) {
  if (!ui.viewer.open) return
  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  if (v.value.kind !== 'image' || !hasGallery.value) return
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
}

function openExternal() {
  if (v.value.url) window.open(v.value.url, '_blank')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" :duration="{ enter: 180, leave: 150 }">
      <div v-if="v.open" class="viewer-backdrop" @click.self="close">
        <div class="viewer-card" :class="v.kind">
          <header class="viewer-head">
            <UiIcon :name="v.kind === 'image' ? 'image' : 'description'" :size="16" />
            <span class="viewer-title" :title="current.title">{{ current.title }}</span>
            <span v-if="hasGallery" class="viewer-count">{{ v.index + 1 }} / {{ pics.length }}</span>
            <div style="flex: 1" />
            <template v-if="v.kind === 'image'">
              <button v-if="hasGallery" class="icon-btn" title="上一张 (←)" @click="step(-1)">
                <span class="zoom-ico">‹</span>
              </button>
              <button class="icon-btn" title="缩小" @click="zoom(-0.2)"><span class="zoom-ico">−</span></button>
              <button class="viewer-scale" title="点击还原" @click="resetZoom">{{ Math.round(scale * 100) }}%</button>
              <button class="icon-btn" title="放大" @click="zoom(0.2)"><span class="zoom-ico">＋</span></button>
              <button v-if="hasGallery" class="icon-btn" title="下一张 (→)" @click="step(1)">
                <span class="zoom-ico">›</span>
              </button>
            </template>
            <button class="icon-btn" title="关闭 (Esc)" @click="close"><UiIcon name="close" :size="16" /></button>
          </header>

          <div ref="bodyEl" class="viewer-body" @wheel="onWheel">
            <img
              v-if="v.kind === 'image' && current.url"
              class="viewer-img"
              :src="current.url"
              :style="{ transform: `scale(${scale})` }"
              alt=""
            />

            <pre v-else-if="v.kind === 'text'" class="viewer-text">{{ v.text }}</pre>

            <div v-else-if="v.kind === 'external'" class="viewer-external">
              <UiIcon name="description" :size="36" />
              <div>这种格式不能在应用内预览</div>
              <button class="filled-btn slim" @click="openExternal">用系统程序打开</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer-backdrop {
  position: fixed; inset: 0; z-index: 420;
  background: color-mix(in srgb, var(--md-scrim) 62%, transparent);
  backdrop-filter: blur(8px);
  display: grid; place-items: center;
  padding: 40px;
}
.viewer-card {
  display: flex; flex-direction: column;
  background: var(--md-surface-container-high);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 20px 70px color-mix(in srgb, var(--md-scrim) 60%, transparent);
}
/* 大小上限：不占满屏，即使应用窗口是全屏 */
.viewer-card.image { width: min(88vw, 1200px); height: min(84vh, 900px); }
.viewer-card.text { width: min(78vw, 900px); height: min(80vh, 780px); }
.viewer-card.external { width: min(60vw, 480px); height: auto; }

.viewer-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
  flex-shrink: 0;
}
.viewer-title {
  font-size: 12.5px; font-weight: 600;
  max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.zoom-ico { font-size: 16px; line-height: 1; }
.viewer-count {
  font-size: 11px; color: var(--md-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.viewer-scale {
  min-width: 52px; height: 28px; border-radius: 8px; border: none;
  background: color-mix(in srgb, var(--md-on-surface) 10%, transparent);
  color: var(--md-on-surface-variant); font-size: 11.5px;
  font-variant-numeric: tabular-nums; cursor: pointer;
}
.viewer-scale:hover { color: var(--md-on-surface); }

.viewer-body {
  flex: 1; min-height: 0;
  display: grid; place-items: center;
  overflow: auto;
  background: color-mix(in srgb, var(--md-scrim) 30%, var(--md-surface-container-lowest));
}
.viewer-img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  transition: transform 0.15s var(--ease-standard);
  transform-origin: center center;
}
.viewer-text {
  margin: 0; padding: 22px 26px;
  width: 100%; height: 100%;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Segoe UI', system-ui, 'Microsoft YaHei UI', sans-serif;
  font-size: 13.5px; line-height: 1.85;
  color: var(--md-on-surface);
  user-select: text;
}
.viewer-external {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: 36px 24px; font-size: 13px; color: var(--md-on-surface-variant);
}
</style>
