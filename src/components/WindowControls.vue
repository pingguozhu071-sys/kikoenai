<script setup lang="ts">
/**
 * 窗口控制按钮（无边框窗口）—— 极简样式：
 * 全屏 / 最小化 / 最大化(还原) / 关闭，只有 hover 时才出现底色。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'

interface DesktopBridge {
  isDesktop?: boolean
  windowAction?: (a: 'minimize' | 'toggle-maximize' | 'toggle-fullscreen' | 'close') => Promise<{ maximized: boolean; fullscreen: boolean } | null>
  getWindowState?: () => Promise<{ maximized: boolean; fullscreen: boolean }>
  onWindowState?: (cb: (s: { maximized: boolean; fullscreen: boolean }) => void) => () => void
}

const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru
const available = !!bridge?.isDesktop && typeof bridge.windowAction === 'function'

const maximized = ref(false)
const fullscreen = ref(false)
let off: (() => void) | undefined

function apply(state: { maximized?: boolean; fullscreen?: boolean } | null | undefined) {
  if (!state) return
  maximized.value = !!state.maximized
  fullscreen.value = !!state.fullscreen
  document.body.classList.toggle('is-fullscreen', fullscreen.value)
}

/**
 * 注意：不要用 windowAction 的返回值直接覆盖状态。
 * 全屏/最大化在 Electron 里是异步完成的，返回值往往是动手之前的旧状态，
 * 会把随后的事件推送覆盖回去（表现为退出全屏后按钮仍然消失）。
 * 这里只发动作，状态一律以事件为准，并做一次延迟回读兜底。
 */
async function act(action: 'minimize' | 'toggle-maximize' | 'toggle-fullscreen' | 'close') {
  if (!bridge?.windowAction) return
  void bridge.windowAction(action)
  if (action === 'toggle-fullscreen' || action === 'toggle-maximize') {
    // 状态事件可能滞后，分几次回读，确保按钮显隐最终正确
    for (const ms of [200, 500, 900, 1400]) {
      window.setTimeout(async () => {
        if (bridge?.getWindowState) apply(await bridge.getWindowState())
      }, ms)
    }
  }
}

onMounted(async () => {
  if (!available) return
  document.body.classList.add('is-desktop')
  if (bridge?.getWindowState) apply(await bridge.getWindowState())
  off = bridge?.onWindowState?.(apply)
  // 拖动缩放时关闭重特效，避免黑边/撕裂
  const offResize = (bridge as unknown as { onResizing?: (cb: (on: boolean) => void) => () => void })
    .onResizing?.((on) => document.body.classList.toggle('is-resizing', !!on))
  if (offResize) {
    const prevOff = off
    off = () => { prevOff?.(); offResize() }
  }
})

onUnmounted(() => {
  off?.()
  document.body.classList.remove('is-desktop')
  document.body.classList.remove('is-fullscreen')
})
</script>

<template>
  <div v-if="available" class="window-controls" :class="{ hidden: fullscreen }">
    <button class="wc-btn" title="全屏 (F11)" @click="act('toggle-fullscreen')">
      <UiIcon name="fullscreen" :size="16" />
    </button>
    <button class="wc-btn" title="最小化" @click="act('minimize')">
      <UiIcon name="minimize" :size="16" />
    </button>
    <button class="wc-btn" :title="maximized ? '还原' : '最大化'" @click="act('toggle-maximize')">
      <UiIcon :name="maximized ? 'restore' : 'maximize'" :size="14" />
    </button>
    <button class="wc-btn close" title="关闭" @click="act('close')">
      <UiIcon name="close" :size="16" />
    </button>
  </div>
</template>
