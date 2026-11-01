<script setup lang="ts">
/** 睡眠定时 —— 预设 + 自定义分钟数 + 播完当前曲停止 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'
import { player, setSleepMinutes, sleepAfterTrack, clearSleep } from '../stores/player'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const PRESETS = [10, 15, 30, 45, 60, 90, 120]
const custom = ref('')
const now = ref(Date.now())
let timer = 0

const remaining = computed(() => {
  if (!player.sleepAt) return ''
  const ms = Math.max(0, player.sleepAt - now.value)
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
})

onMounted(() => {
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => window.clearInterval(timer))

function set(n: number) {
  setSleepMinutes(n)
  toast(`已设置睡眠定时：${n} 分钟后暂停`, 'success')
  ui.closeSleep()
}

function runCustom() {
  const n = Math.floor(Number(custom.value))
  if (!Number.isFinite(n) || n < 1 || n > 600) {
    toast('请输入 1–600 之间的分钟数', 'info')
    return
  }
  set(n)
}

function afterTrack() {
  sleepAfterTrack()
  toast('当前曲播完后停止', 'success')
  ui.closeSleep()
}

function off() {
  clearSleep()
  toast('已关闭睡眠定时', 'info')
  ui.closeSleep()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" :duration="{ enter: 160, leave: 140 }">
      <div v-if="ui.sleepOpen" class="sleep-backdrop" @click.self="ui.closeSleep()">
        <div class="sleep-card">
          <header class="sleep-head">
            <UiIcon name="schedule" :size="18" />
            <span>睡眠定时</span>
            <div style="flex: 1" />
            <button class="icon-btn" title="关闭" @click="ui.closeSleep()">
              <UiIcon name="close" :size="16" />
            </button>
          </header>

          <div v-if="player.sleepAt || player.sleepAfterTrack" class="sleep-now">
            <span v-if="player.sleepAt">剩余 <b>{{ remaining }}</b> 后暂停</span>
            <span v-else>当前曲播完自动停止</span>
            <button class="chip plain" @click="off">关闭定时</button>
          </div>

          <div class="sleep-presets">
            <button v-for="n in PRESETS" :key="n" class="chip" @click="set(n)">{{ n }} 分钟</button>
          </div>

          <div class="sleep-custom">
            <input
              v-model="custom" class="text-field" type="number"
              min="1" max="600" placeholder="自定义分钟数（1–600）"
              @keydown.enter="runCustom"
            />
            <button class="filled-btn slim" @click="runCustom">开始</button>
          </div>

          <button class="sleep-row" @click="afterTrack">
            <span>播完当前曲停止</span>
            <span class="sleep-row-hint">选它</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sleep-backdrop {
  position: fixed; inset: 0; z-index: 430;
  background: color-mix(in srgb, var(--md-scrim) 60%, transparent);
  backdrop-filter: blur(6px);
  display: grid; place-items: center;
  padding: 24px;
}
.sleep-card {
  width: min(92vw, 480px);
  background: var(--md-surface-container-high);
  border-radius: 22px;
  padding: 18px 20px 20px;
  box-shadow: 0 22px 60px color-mix(in srgb, var(--md-scrim) 55%, transparent);
}
.sleep-head { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
.sleep-now {
  margin-top: 14px; padding: 10px 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border-radius: 12px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  font-size: 12.5px;
}
.sleep-now b { font-variant-numeric: tabular-nums; }
.sleep-presets {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 16px;
}
.sleep-custom {
  display: flex; gap: 10px; margin-top: 16px; align-items: center;
}
.sleep-custom .text-field { width: auto; flex: 1; height: 40px; font-size: 13px; }
.sleep-row {
  width: 100%; margin-top: 14px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border: none; border-radius: 12px; cursor: pointer;
  background: color-mix(in srgb, var(--md-on-surface) 8%, transparent);
  color: var(--md-on-surface); font-family: inherit; font-size: 13px;
}
.sleep-row:hover { background: color-mix(in srgb, var(--md-on-surface) 13%, transparent); }
.sleep-row-hint { font-size: 11.5px; color: var(--md-on-surface-variant); }
</style>
