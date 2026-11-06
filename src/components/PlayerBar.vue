<script setup lang="ts">
/**
 * 底部播放条 —— 只放常用操作，其余收进最右侧「⋮」菜单（酷狗/网易云的做法）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from './UiIcon.vue'
import SeekBar from './SeekBar.vue'
import {
  player, current, toggle, next, prev, setVolume, toggleMute, setRate, playAt,
  cycleRepeat, toggleShuffle, seekBy, retryCurrent,
} from '../stores/player'
import { downloadState, downloadSingleItem, isDesktop as downloadsAvailable } from '../stores/downloads'
import { ensureFavorites } from '../stores/favorites'
import { useFavorite } from '../composables/useFavorite'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const session = useSession
const router = useRouter()
const item = computed(() => current())
const isVideo = computed(() => !!item.value?.isVideo)

const { favorite: liked, busy: likeBusy, toggle: likeCurrent } = useFavorite(() => item.value?.workId)

/** 切歌 / 登录状态变化时刷新收藏夹缓存（登录恢复时强制刷新一次） */
watch(
  [() => item.value?.workId, () => session.loggedIn],
  ([, loggedIn], prev) => {
    if (!loggedIn) return
    const justLoggedIn = prev && !prev[1] && loggedIn
    void ensureFavorites(justLoggedIn)
  },
  { immediate: true },
)

const modeIcon = computed(() => {
  if (player.shuffle) return 'shuffle'
  return player.repeatMode === 'one' ? 'repeat_one' : 'repeat'
})
const modeLabel = computed(() => {
  if (player.shuffle) return '随机播放'
  if (player.repeatMode === 'one') return '单曲循环'
  if (player.repeatMode === 'all') return '列表循环'
  return '顺序播放'
})
const modeDim = computed(() => !player.shuffle && player.repeatMode === 'off')
function cycleMode() {
  if (player.shuffle) { toggleShuffle(); player.repeatMode = 'off'; return }
  if (player.repeatMode === 'off') { cycleRepeat(); return }
  if (player.repeatMode === 'all') { cycleRepeat(); return }
  toggleShuffle()
}

const queueOpen = ref(false)
const moreOpen = ref(false)
const volOpen = ref(false)
const RATES = [0.75, 1, 1.25, 1.5, 2]

const sleepLabel = computed(() => {
  if (player.sleepAfterTrack) return '播完当前曲停止'
  if (player.sleepAt) {
    const left = Math.max(0, player.sleepAt - nowTick.value)
    const m = Math.floor(left / 60000)
    const s = Math.floor((left % 60000) / 1000)
    return `睡眠定时 · ${m}:${String(s).padStart(2, '0')}`
  }
  return '睡眠定时'
})

/** 让剩余时间每秒刷新一次；依赖 nowTick 触发重算 */
const nowTick = ref(Date.now())
let tickTimer = 0
onMounted(() => {
  tickTimer = window.setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => window.clearInterval(tickTimer))

/** 任务栏字幕（底部一行歌词） */
function toggleTaskbarLyrics() {
  const bridge = (window as unknown as { kikoeru?: { taskbarLyricsToggle?: () => Promise<unknown> } }).kikoeru
  if (bridge?.taskbarLyricsToggle) void bridge.taskbarLyricsToggle()
}

const dlBusy = ref(false)
async function downloadCurrent() {
  const it = item.value
  if (!it) return
  if (!downloadsAvailable) { toast('下载需要桌面版', 'info'); return }
  dlBusy.value = true
  try { await downloadSingleItem(it) } finally { dlBusy.value = false }
}

function openDownloads() {
  void router.push('/downloads')
}
const activeCount = computed(() => downloadState.tasks.filter((t) => t.state === 'running').length)

function openNowPlaying() { ui.openNowPlaying() }
function desktopLyrics() {
  const bridge = (window as unknown as { kikoeru?: { lyricsToggle?: () => Promise<unknown> } }).kikoeru
  if (bridge?.lyricsToggle) void bridge.lyricsToggle()
  else toast('桌面字幕需要桌面版', 'info')
}
</script>

<template>
  <div v-if="item" class="player-bar">
    <div class="pb-left">
      <div class="pb-cover-wrap" title="打开正在播放" @click="openNowPlaying">
        <img class="pb-cover" :src="item.coverUrl" alt="" />
        <span v-if="isVideo" class="pb-video-tag">视频</span>
      </div>
      <div class="pb-info" title="打开正在播放" @click="openNowPlaying">
        <div class="pb-title">
          {{ item.title }}
          <span v-if="player.usingLocal" class="pb-local">本地</span>
        </div>
        <div v-if="player.error" class="pb-error" :title="player.error">
          <span class="pb-error-text">{{ player.error }}</span>
          <button class="pb-retry" @click.stop="retryCurrent">重试</button>
        </div>
        <div v-else class="pb-artist">{{ item.workTitle }}</div>
      </div>
      <button class="icon-btn pb-expand" title="展开正在播放" @click="openNowPlaying">
        <UiIcon name="expand_less" :size="16" />
      </button>
    </div>

    <div class="pb-transport">
      <button class="icon-btn" title="上一首" @click="prev"><UiIcon name="skip_previous" :size="22" /></button>
      <button class="play-fab" :class="{ loading: player.loading }" @click="toggle">
        <span v-if="player.loading" class="spinner" />
        <UiIcon v-else :name="player.playing ? 'pause' : 'play_arrow'" :size="24" />
      </button>
      <button class="icon-btn" title="下一首" @click="next"><UiIcon name="skip_next" :size="22" /></button>
    </div>

    <div class="pb-progress"><SeekBar compact /></div>

    <div class="pb-right">
        <button class="icon-btn" :class="{ active: liked }" :title="liked ? '从收藏夹移除' : '加入收藏夹'" @click="likeCurrent">
        <UiIcon name="favorite" :size="19" />
      </button>

      <button class="icon-btn" :class="{ active: !modeDim }" :title="modeLabel" @click="cycleMode">
        <UiIcon :name="modeIcon" :size="19" />
      </button>

      <div class="pb-pop">
        <button class="icon-btn" :class="{ active: queueOpen }" title="播放队列" @click="queueOpen = !queueOpen">
          <UiIcon name="queue_music" :size="19" />
        </button>
        <Transition name="menu">
          <div v-if="queueOpen" class="pb-queue menu">
            <div class="pb-queue-head">播放队列 · {{ player.playlist.length }} 首</div>
            <button v-for="(q, i) in player.playlist" :key="i" class="pb-queue-item" :class="{ current: i === player.index }" @click="playAt(i)">
              <span class="idx">{{ i === player.index ? '▶' : i + 1 }}</span>
              <span class="t">{{ q.title }}</span>
              <span v-if="q.isVideo" class="v">视频</span>
            </button>
          </div>
        </Transition>
      </div>

      <div class="pb-pop" @mouseenter="volOpen = true" @mouseleave="volOpen = false">
        <button class="icon-btn" :title="player.muted ? '取消静音' : '静音'" @click="toggleMute">
          <UiIcon :name="player.muted || player.volume === 0 ? 'volume_off' : player.volume < 0.5 ? 'volume_down' : 'volume_up'" :size="19" />
        </button>
        <Transition name="fade">
          <div v-if="volOpen" class="vol-pop">
            <input class="vol-range" type="range" min="0" max="1" step="0.01" :value="player.muted ? 0 : player.volume" @input="setVolume(Number(($event.target as HTMLInputElement).value))" />
          </div>
        </Transition>
      </div>

      <!-- 更多：收不常用功能 -->
      <div class="pb-pop">
        <button class="icon-btn" :class="{ active: moreOpen }" title="更多" @click="moreOpen = !moreOpen">
          <UiIcon name="more_vert" :size="19" />
        </button>
        <Transition name="menu">
          <div v-if="moreOpen" class="menu pb-more" @click.stop>
            <button class="menu-item" @click="desktopLyrics(); moreOpen = false">
              <UiIcon name="lyrics" :size="16" /><span>桌面字幕</span>
            </button>
            <button class="menu-item" @click="toggleTaskbarLyrics(); moreOpen = false">
              <UiIcon name="lyrics" :size="16" /><span>任务栏字幕</span>
            </button>
            <button class="menu-item" @click="ui.openSleep(); moreOpen = false">
              <UiIcon name="schedule" :size="16" /><span>{{ sleepLabel }}</span>
            </button>
            <button class="menu-item" @click="setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length]); moreOpen = false">
              <UiIcon name="speed" :size="16" /><span>倍速 {{ player.rate }}×</span>
            </button>
            <button v-if="isVideo" class="menu-item" @click="ui.openVideo(); moreOpen = false">
              <UiIcon name="fullscreen" :size="16" /><span>视频窗口</span>
            </button>
            <div class="menu-sep" />
            <button class="menu-item" :disabled="dlBusy" @click="downloadCurrent(); moreOpen = false">
              <UiIcon name="download" :size="16" /><span>下载当前音轨</span>
            </button>
            <button class="menu-item" @click="openDownloads(); moreOpen = false">
              <UiIcon name="description" :size="16" /><span>下载任务{{ activeCount ? `（${activeCount}）` : '' }}</span>
            </button>
            <div class="menu-sep" />
            <button class="menu-item" @click="seekBy(-5); moreOpen = false">
              <UiIcon name="replay_5" :size="16" /><span>后退 5 秒</span>
            </button>
            <button class="menu-item" @click="seekBy(5); moreOpen = false">
              <UiIcon name="forward_5" :size="16" /><span>前进 5 秒</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
