<script setup lang="ts">
/** 作品详情 — 完整元数据 + 音轨树 + 歌词 + 相似作品 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import TrackTree from '../components/TrackTree.vue'
import WorkRow from '../components/WorkRow.vue'
import PlaylistDialog from '../components/PlaylistDialog.vue'
import VoteDialog from '../components/VoteDialog.vue'
import {
  getTracks, getWork, coverUrl, putReview, postItemNeighbors,
  getWorksByCategory, textFetchUrl, resolveMediaUrl, type ProgressValue,
} from '../api/client'
import type { TrackNode, Work } from '../api/types'
import { player, playWorkTree, current, seek, activeLrcIndex, bindSubtitleManually, findTrackLevel } from '../stores/player'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'
import { downloadWork, downloadTrack } from '../stores/downloads'
import { ensureFavorites, isFavorite, toggleFavorite } from '../stores/favorites'
import { fmtBytes, fmtCount, fmtDuration } from '../utils/format'
import { decodeText } from '../services/lyrics'

const route = useRoute()
const router = useRouter()
const session = useSession

const workId = computed(() => Number(route.params.id))
const work = ref<Work | null>(null)
const tracks = ref<TrackNode[]>([])
const similar = ref<Work[]>([])
const similarLoading = ref(false)
const similarLabel = ref('相似作品')
const similarSub = ref('听过这部的人也听了')
const loading = ref(true)
const error = ref('')
const marked = ref<ProgressValue | null>(null)
const favorite = computed(() => isFavorite(workId.value))
const favoriteBusy = ref(false)
const playlistOpen = ref(false)
const voteOpen = ref(false)
const markBusy = ref(false)
const scrolled = ref(false)

const title = computed(() => work.value?.title || work.value?.name || `RJ${workId.value}`)
const circleName = computed(() => work.value?.circle?.name || work.value?.name || '')
const tags = computed(() => work.value?.tags ?? [])
const vas = computed(() => work.value?.vas ?? [])
const rating = computed(() => {
  const r = work.value?.rate_average_2dp
  return typeof r === 'number' && r > 0 ? r.toFixed(2) : ''
})
const duration = computed(() => fmtDuration(work.value?.duration))
const rankBadges = computed(() =>
  (work.value?.rank ?? [])
    .filter((r) => r.rank > 0 && r.rank <= 30)
    .slice(0, 3)
    .map((r) => ({ label: r.term === 'day' ? '日榜' : r.term === 'week' ? '周榜' : '月榜', n: r.rank })),
)
const editions = computed(() => (work.value?.language_editions ?? []).slice(0, 6))

const audioCount = computed(() => {
  let n = 0
  const walk = (list: TrackNode[]) => {
    for (const x of list) {
      if (x.type === 'folder' && x.children) walk(x.children)
      else if (x.type === 'audio') n++
    }
  }
  walk(tracks.value)
  return n
})

/** 可下载的文件数：音频、视频、字幕、图片、PDF 都算 */
const downloadableCount = computed(() => {
  let n = 0
  const walk = (list: TrackNode[]) => {
    for (const x of list) {
      if (x.type === 'folder' && x.children) walk(x.children)
      else if (x.mediaDownloadUrl) n++
    }
  }
  walk(tracks.value)
  return n
})
const totalSize = computed(() => {
  let s = 0
  const walk = (list: TrackNode[]) => {
    for (const x of list) {
      if (x.type === 'folder' && x.children) walk(x.children)
      else if (x.type === 'audio' && typeof x.size === 'number') s += x.size
    }
  }
  walk(tracks.value)
  return s
})

const isCurrentWork = computed(() => current()?.workId === workId.value)

/** 防止连点相似作品时，上一部作品的请求回来覆盖页面 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  work.value = null
  tracks.value = []
  similar.value = []
  marked.value = null
  try {
    const [w, t] = await Promise.all([getWork(workId.value), getTracks(workId.value)])
    if (seq !== loadSeq) return
    work.value = w
    // 作品接口会带当前账号的收听进度
    const p = (w as Work & { progress?: ProgressValue | null }).progress
    marked.value = p ?? null
    tracks.value = Array.isArray(t) ? t : []
    if (session.loggedIn) void ensureFavorites()
  } catch (e) {
    if (seq !== loadSeq) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === loadSeq) loading.value = false
  }

  if (seq !== loadSeq) return

  // 相似作品：先试推荐接口，为空则退回同社团作品（该接口匿名可用）
  similarLoading.value = true
  try {
    const nb = await postItemNeighbors(workId.value)
    if (seq !== loadSeq) return
    let list = (nb.works ?? []).filter((w) => w.id !== workId.value)
    if (list.length) {
      similarLabel.value = '相似作品'
      similarSub.value = '听过这部的人也听了'
    } else if (work.value?.circle_id) {
      const cw = await getWorksByCategory('circle', work.value.circle_id, 1, 'release', 'desc', 12)
      if (seq !== loadSeq) return
      list = (cw.works ?? []).filter((w) => w.id !== workId.value)
      similarLabel.value = '同社团作品'
      similarSub.value = circleName.value
    }
    similar.value = list.slice(0, 12)
  } catch {
    if (seq === loadSeq) similar.value = []
  } finally {
    if (seq === loadSeq) similarLoading.value = false
  }
}

/** 点相似作品时路由参数变了，但组件会被复用，必须手动重新加载 */
watch(workId, (id) => {
  if (!id) return
  similarLabel.value = '相似作品'
  similarSub.value = '听过这部的人也听了'
  scrolled.value = false
  playlistOpen.value = false
  voteOpen.value = false
  if (scroller.value) scroller.value.scrollTop = 0
  void load()
})

// ---------- 字幕 ----------
// 自动绑定由播放器负责（切歌即匹配）；这里只处理手动指定某条音轨用哪个字幕文件

function isSubtitle(n: TrackNode): boolean {
  return n.type === 'text' && /\.(lrc|srt|ass|ssa|vtt)$/i.test(n.title)
}

async function pickSubtitle(node: TrackNode) {
  const cur = current()
  if (!cur || cur.workId !== workId.value) {
    toast('请先播放该作品中的某条音轨，再点字幕文件绑定', 'info')
    return
  }
  await bindSubtitleManually(workId.value, cur.title, node)
  toast(`已为「${cur.title.slice(0, 20)}」绑定字幕：${node.title}`, 'success')
}

// ---------- 交互 ----------

function firstAudioNode(nodes: TrackNode[]): TrackNode | null {
  for (const n of nodes) {
    if (n.type === 'audio') return n
    if (n.type === 'folder' && n.children) {
      const f = firstAudioNode(n.children)
      if (f) return f
    }
  }
  return null
}

function playAll() {
  const first = firstAudioNode(tracks.value)
  if (!first) { toast('该作品没有可播放的音频', 'error'); return }
  playWorkTree(tracks.value, workId.value, title.value, first.title)
}

function onPlay(node: TrackNode) {
  if (node.type === 'audio') {
    // 点哪条就播它所在的那个文件夹，而不是把整部作品（116 条）全塞进列表
    playWorkTree(tracks.value, workId.value, title.value, node.title, 'folder')
    return
  }
  if (isSubtitle(node)) {
    void pickSubtitle(node)
  }
}

/** 双击查看图片 / 文档（应用内浮层，不触发全屏） */
async function openLeaf(node: TrackNode) {
  const url = resolveMediaUrl(node.mediaStreamUrl)
  if (!url) { toast('没有可查看的地址', 'error'); return }

  if (node.type === 'image') {
    // 同目录的图片做成一组，查看器里可以左右翻
    const level = findTrackLevel(tracks.value, node.title) ?? []
    const images = level
      .filter((n) => n.type === 'image')
      .map((n) => ({ url: resolveMediaUrl(n.mediaStreamUrl) || '', title: n.title }))
      .filter((n) => !!n.url)
    const index = Math.max(0, images.findIndex((n) => n.title === node.title))
    ui.openViewer({ kind: 'image', url, title: node.title, images, index })
    return
  }

  // 文本类：txt / lrc / srt / ass 直接当文档读；pdf 交给系统
  if (/\.pdf$/i.test(node.title)) {
    ui.openViewer({ kind: 'external', url, title: node.title })
    return
  }
  try {
    const res = await fetch(textFetchUrl(url))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const text = decodeText(buf, res.headers.get('content-type') || '')
    ui.openViewer({ kind: 'text', text, title: node.title })
  } catch (e) {
    toast(`无法读取文档：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

async function openCover() {
  const url = coverUrl(workId.value, false)
  ui.openViewer({ kind: 'image', url, title: title.value })
}

/** 收听进度：只设置，不做反向取消 */
async function mark(p: ProgressValue) {
  if (!session.loggedIn) { ui.openLogin('收藏与进度需要登录'); return }
  if (markBusy.value) return
  markBusy.value = true
  try {
    const ok = await putReview(workId.value, p)
    if (!ok) { toast('标记失败，请检查网络', 'error'); return }
    marked.value = p
    const label: Record<ProgressValue, string> = {
      marked: '已标为想听', listening: '标为在听', listened: '标为听过',
      replay: '标为重听', postponed: '标为搁置',
    }
    toast(label[p], 'success')
  } finally {
    markBusy.value = false
  }
}

/** 收藏 = 默认收藏夹（站点上的「收藏」就是这个），可以再加一次取消 */
async function toggleFav() {
  if (!session.loggedIn) { ui.openLogin('收藏需要登录'); return }
  if (favoriteBusy.value) return
  favoriteBusy.value = true
  try {
    const now = await toggleFavorite(workId.value)
    toast(now ? '已加入收藏夹' : '已移出收藏夹', 'success')
  } catch (e) {
    toast(`收藏失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    favoriteBusy.value = false
  }
}

// 歌词自动滚动
const lrcPanel = ref<HTMLElement | null>(null)
const activeIdx = computed(() => activeLrcIndex())
watch(activeIdx, async (i) => {
  if (i < 0) return
  await nextTick()
  const el = lrcPanel.value?.querySelector<HTMLElement>(`.lrc-line[data-i="${i}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

const scroller = ref<HTMLElement | null>(null)
function onScroll() {
  scrolled.value = (scroller.value?.scrollTop ?? 0) > 6
}

onMounted(load)
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header" :class="{ scrolled }">
      <button class="icon-btn" title="返回" @click="router.back()">
        <UiIcon name="arrow_back" />
      </button>
      <div class="header-left">
        <span class="brand">RJ{{ workId }}</span>
      </div>
      <div class="header-right">
        <span v-if="!loading && !error" class="count">{{ audioCount }} 音轨 · {{ fmtBytes(totalSize) }}</span>
      </div>
    </header>

    <div ref="scroller" class="page-scroll" @scroll.passive="onScroll">
      <div v-if="error" class="empty-state">
        <UiIcon name="refresh" :size="38" />
        <div>{{ error }}</div>
        <button class="filled-btn" @click="load">重试</button>
      </div>

      <div v-else-if="loading" class="empty-state">
        <span class="spinner" style="border-color: color-mix(in srgb, var(--md-on-surface) 18%, transparent); border-top-color: var(--md-primary)" />
      </div>

      <template v-else>
        <div class="detail-head">
          <div class="cover-col">
            <img class="detail-cover" :src="coverUrl(work!, false)" alt="" title="双击查看大图" @dblclick="openCover" />
          </div>

          <div class="detail-info">
            <div class="detail-title">{{ title }}</div>
            <div class="detail-circle">
              <UiIcon name="person" :size="14" />
              <span>{{ circleName }}</span>
            </div>

            <div class="detail-badges">
              <span v-if="rating" class="stat-badge rating">★ {{ rating }}<small>({{ work?.rate_count }})</small></span>
              <span v-if="work?.dl_count" class="stat-badge">{{ fmtCount(work?.dl_count) }} 售出</span>
              <span v-if="duration" class="stat-badge">{{ duration }}</span>
              <span v-if="work?.release" class="stat-badge">{{ work.release.slice(0, 10) }}</span>
              <span v-if="work?.has_subtitle" class="stat-badge accent">含字幕</span>
              <span v-for="r in rankBadges" :key="r.label" class="stat-badge rank">{{ r.label }} #{{ r.n }}</span>
            </div>

            <div v-if="vas.length" class="detail-line">
              <span class="line-label">声优</span>
              <span class="line-value">{{ vas.map((v) => v.name).join('、') }}</span>
            </div>
            <div v-if="editions.length" class="detail-line">
              <span class="line-label">版本</span>
              <span class="line-value">
                <span v-for="e in editions" :key="e.workno" class="edition">{{ e.label }}</span>
              </span>
            </div>

            <div class="tag-row" v-if="tags.length" style="align-items: center">
            <span class="card-sub" style="font-size: 11px">标签</span>
              <button
                v-for="t in tags.slice(0, 14)" :key="t.id" class="chip plain"
                @click="router.push({ path: '/search', query: { kw: t.name } })"
              >{{ t.name }}</button>
            </div>

            <div class="detail-actions">
              <button class="filled-btn" :disabled="!audioCount" @click="playAll">
                <UiIcon name="play_arrow" :size="18" /> 播放全部
              </button>
              <button class="chip" :disabled="!downloadableCount" @click="downloadWork(workId, title)">
                <UiIcon name="download" :size="15" /> 下载全部
              </button>
              <button
                class="chip" :class="{ plain: !favorite }" :disabled="favoriteBusy"
                @click="toggleFav"
              >
                {{ favorite ? '已收藏 · 点此取消' : '收藏' }}
              </button>
              <button class="chip" @click="playlistOpen = true">加入播放列表</button>
              <button class="chip" @click="voteOpen = true">标签纠错</button>
              <button class="chip" :class="{ plain: marked !== 'listening' }" :disabled="markBusy" @click="mark('listening')">在听</button>
              <button class="chip" :class="{ plain: marked !== 'listened' }" :disabled="markBusy" @click="mark('listened')">听过</button>
              <button class="chip" :class="{ plain: marked !== 'postponed' }" :disabled="markBusy" @click="mark('postponed')">搁置</button>
            </div>
          </div>
        </div>

        <div class="detail-columns">
          <div class="m3-card detail-tracks">
            <div class="card-head">
              <UiIcon name="folder_open" :size="18" /> 音轨列表
              <span class="card-sub">{{ audioCount }} 条 · {{ fmtBytes(totalSize) }}</span>
            </div>
            <TrackTree
              :nodes="tracks"
              :current-stream="isCurrentWork ? current()?.rawStreamUrl : ''"
              @play="onPlay"
              @download="(n) => downloadTrack(n, workId, title)"
              @open="openLeaf"
            />
          </div>

          <div class="m3-card detail-lyrics">
            <div class="card-head">
              <UiIcon name="lyrics" :size="18" /> 字幕
              <span v-if="player.lrcTitle" class="card-sub">{{ player.lrcTitle }}</span>
            </div>
            <div ref="lrcPanel" class="lrc-panel">
              <template v-if="player.lrc.length">
                <div
                  v-for="(line, i) in player.lrc" :key="i"
                  class="lrc-line" :class="{ current: i === activeIdx }" :data-i="i"
                  @click="line.time >= 0 && seek(line.time)"
                >{{ line.text }}</div>
              </template>
              <div v-else class="empty-state" style="padding: 44px 0; font-size: 12.5px">
                {{ player.lrcTitle ? '字幕时间轴为空' : '播放后会自动匹配字幕（LRC / SRT / ASS）' }}
              </div>
            </div>
            <div v-if="isCurrentWork && player.error" class="play-error">{{ player.error }}</div>
          </div>
        </div>

        <PlaylistDialog v-model="playlistOpen" :work-id="workId" :work-title="title" />
        <VoteDialog v-model="voteOpen" :work-id="workId" :tags="tags" />

        <WorkRow class="similar-row" :title="similarLabel" :subtitle="similarSub" :works="similar" :loading="similarLoading" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail-columns { display: flex; gap: 16px; align-items: stretch; margin-top: 18px; }
.detail-tracks { flex: 1.25; min-width: 0; max-height: 560px; overflow-y: auto; }
.detail-lyrics { flex: 0.75; min-width: 0; display: flex; flex-direction: column; max-height: 560px; }
.card-head {
  font-weight: 700; margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
  position: sticky; top: 0; z-index: 2;
  background: var(--md-surface-container-low);
  padding: 2px 0 8px;
}
.card-sub { font-weight: 400; font-size: 11.5px; color: var(--md-on-surface-variant); }
.play-error {
  margin-top: 8px; font-size: 12px;
  color: var(--md-on-error-container);
  background: var(--md-error-container);
  border-radius: 8px; padding: 8px 10px;
}
.similar-row { margin-top: 26px; }
</style>
