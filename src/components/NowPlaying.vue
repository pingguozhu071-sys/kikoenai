<script setup lang="ts">
/**
 * 正在播放页 —— 从底部升起的整页播放视图（参考常见音乐 App 的"播放详情页"原理）。
 * 打开方式：点击底部播放条左侧的封面 / 标题。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from './UiIcon.vue'
import SeekBar from './SeekBar.vue'
import { coverUrl } from '../api/client'
import {
  player, current, toggle, next, prev, setVolume, toggleMute, setRate, seekBy,
  playAt, activeLrcIndex, seek, nudgeLrcOffset, resetLrcOffset, nudgeLrcLine, retryCurrent,
} from '../stores/player'
import { ui } from '../stores/ui'
import { downloadState, downloadSingleItem } from '../stores/downloads'
import { toast } from '../stores/toast'
import { fmtTime } from '../utils/format'

const router = useRouter()
const item = computed(() => current())
const cover = computed(() => (item.value ? coverUrl(item.value.workId, false) : ''))

const activeIdx = computed(() => activeLrcIndex())
const lrcPanel = ref<HTMLElement | null>(null)

watch(activeIdx, async (i) => {
  if (i < 0 || ui.nowPlayingTab !== 'lyrics') return
  await nextTick()
  lrcPanel.value?.querySelector<HTMLElement>(`.np-lrc-line[data-i="${i}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

const isVideo = computed(() => !!item.value?.isVideo)

/** 视频画面由独立的固定尺寸窗口负责（VideoViewer），这里只留入口 */
const volOpen = ref(false)

function openVideo() {
  ui.openVideo()
}
const RATES = [0.75, 1, 1.25, 1.5, 2]
const rateMenu = ref(false)

function close() {
  // 视频全屏时关页面：先退全屏，否则表现为"闪一下"
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  ui.closeNowPlaying()
}

function onKey(e: KeyboardEvent) {
  if (!ui.nowPlaying) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

function openDownloads() {
  void router.push('/downloads')
}

function openWork() {
  if (!item.value) return
  const id = item.value.workId
  close()
  void router.push(`/work/${id}`)
}

function downloadCurrent() {
  const it = item.value
  if (!it) return
  void downloadSingleItem(it)
}

const activeCount = computed(() => downloadState.tasks.filter((t) => t.state === 'running' || t.state === 'queued').length)
</script>

<template>
  <Teleport to="body">
    <Transition name="np" :duration="{ enter: 480, leave: 240 }">
      <section v-if="ui.nowPlaying && item" class="np-sheet" aria-label="正在播放">
        <!-- 背景：封面模糊 + 渐隐 -->
        <div class="np-bg" :style="{ backgroundImage: `url(${cover})` }" />
        <div class="np-bg-mask" />

        <header class="np-head">
          <button class="icon-btn" title="收起 (Esc)" @click="close">
            <UiIcon name="expand_more" :size="24" />
          </button>
          <span class="np-head-title">正在播放</span>
          <div style="flex: 1" />
          <button class="icon-btn" title="下载当前音轨" @click="downloadCurrent">
            <UiIcon name="download" :size="19" />
          </button>
          <button class="icon-btn" title="下载任务" @click="openDownloads">
            <UiIcon name="queue_music" :size="19" />
            <span v-if="activeCount" class="dl-badge">{{ activeCount }}</span>
          </button>
          <button v-if="isVideo" class="icon-btn" title="打开视频窗口" @click="openVideo">
            <UiIcon name="fullscreen" :size="19" />
          </button>
          <button class="icon-btn" title="查看作品" @click="openWork">
            <UiIcon name="explore" :size="19" />
          </button>
        </header>

        <div class="np-body">
          <!-- 左：封面（视频作品点这里打开固定尺寸的视频窗口） -->
          <div class="np-left">
            <div class="np-cover-wrap">
              <img class="np-cover" :src="cover" alt="" />
              <button v-if="isVideo" class="np-video-btn" @click.stop="openVideo">
                <UiIcon name="play_arrow" :size="24" />
                <span>播放视频</span>
              </button>
            </div>
          </div>

          <!-- 右：信息 + 控制 + 歌词/队列 -->
          <div class="np-right">
            <div class="np-work">{{ item.workTitle }}</div>
            <h1 class="np-title">{{ item.title }}</h1>
            <div class="np-sub">
              <span v-if="item.ext" class="np-ext">{{ item.ext }}</span>
              <span v-if="player.usingLocal" class="np-local">本地</span>
              <span>{{ player.index + 1 }} / {{ player.playlist.length }}</span>
            </div>

            <div v-if="player.error" class="np-error">
              <span class="np-error-text">{{ player.error }}</span>
              <button class="pb-retry" @click="retryCurrent">重试</button>
            </div>

            <SeekBar class="np-seek" />

            <div class="np-controls">
              <button class="icon-btn" title="上一首" @click="prev"><UiIcon name="skip_previous" :size="24" /></button>
              <button class="np-play" @click="toggle">
                <span v-if="player.loading" class="spinner" />
                <UiIcon v-else :name="player.playing ? 'pause' : 'play_arrow'" :size="30" />
              </button>
              <button class="icon-btn" title="下一首" @click="next"><UiIcon name="skip_next" :size="24" /></button>

              <div class="np-spacer" />

              <div class="pb-pop" @mouseenter="volOpen = true" @mouseleave="volOpen = false">
                <button class="icon-btn" :title="player.muted ? '取消静音' : '静音'" @click="toggleMute">
                  <UiIcon :name="player.muted || player.volume === 0 ? 'volume_off' : player.volume < 0.5 ? 'volume_down' : 'volume_up'" :size="20" />
                </button>
                <Transition name="fade">
                  <div v-if="volOpen" class="vol-pop" style="bottom: 42px">
                    <input
                      class="vol-range" type="range" min="0" max="1" step="0.01"
                      :value="player.muted ? 0 : player.volume"
                      @input="setVolume(Number(($event.target as HTMLInputElement).value))"
                    />
                  </div>
                </Transition>
              </div>

              <div class="pb-pop">
                <button class="icon-btn rate-btn" title="倍速" @click="rateMenu = !rateMenu">{{ player.rate }}×</button>
                <div v-if="rateMenu" class="menu" style="right: 0; bottom: 44px">
                  <button
                    v-for="r in RATES" :key="r" class="menu-item" :class="{ active: r === player.rate }"
                    @click="setRate(r); rateMenu = false"
                  >{{ r }}×</button>
                </div>
              </div>
            </div>

            <div class="np-subtitle-tools">
              <span>歌词偏移</span>
              <button class="np-off-btn" title="字幕提前 0.5 秒" @click="nudgeLrcOffset(-0.5)">−0.5s</button>
              <span class="np-off-val">{{ player.lrcOffset > 0 ? '+' : '' }}{{ player.lrcOffset.toFixed(1) }}s</span>
              <button class="np-off-btn" title="字幕延后 0.5 秒" @click="nudgeLrcOffset(0.5)">+0.5s</button>
              <button class="np-off-btn" title="恢复 0" @click="resetLrcOffset">归零</button>
            </div>

            <div class="np-tabs">
              <button class="np-tab" :class="{ active: ui.nowPlayingTab === 'lyrics' }" @click="ui.nowPlayingTab = 'lyrics'">歌词</button>
              <button class="np-tab" :class="{ active: ui.nowPlayingTab === 'queue' }" @click="ui.nowPlayingTab = 'queue'">
                播放列表 <span class="np-tab-count">{{ player.playlist.length }}</span>
              </button>
            </div>

            <div v-show="ui.nowPlayingTab === 'lyrics'" ref="lrcPanel" class="np-lrc">
              <template v-if="player.lrc.length">
                <div
                  v-for="(line, i) in player.lrc" :key="i"
                  class="np-lrc-line" :class="{ current: i === activeIdx }" :data-i="i"
                  @click="line.time >= 0 && seek(line.time)"
                >
                  <span class="np-lrc-text">{{ line.text }}</span>
                  <span v-if="line.time >= 0" class="np-lrc-tools" @click.stop>
                    <button class="np-line-btn" title="这句提前 0.1 秒" @click.stop="nudgeLrcLine(i, -0.1)">−</button>
                    <button class="np-line-btn" title="这句延后 0.1 秒" @click.stop="nudgeLrcLine(i, 0.1)">+</button>
                  </span>
                </div>
              </template>
              <div v-else class="np-lrc-empty">
                {{ player.lrcTitle ? '这份歌词没有时间轴' : '当前音轨没有歌词' }}<br />
                <span>在作品详情页可手动绑定同名 .lrc</span>
              </div>
            </div>

            <div v-show="ui.nowPlayingTab === 'queue'" class="np-queue">
              <button
                v-for="(q, i) in player.playlist" :key="i"
                class="np-q-item" :class="{ current: i === player.index }"
                @click="playAt(i)"
              >
                <span class="np-q-index">{{ i === player.index ? '▶' : i + 1 }}</span>
                <span class="np-q-title">{{ q.title }}</span>
                <span v-if="i === player.index" class="np-q-time">{{ fmtTime(player.currentTime) }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>
