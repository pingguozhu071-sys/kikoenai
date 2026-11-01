/**
 * 播放器状态 — 单例媒体元素驱动。
 *
 * 关键设计：
 *  - 用 <video> 而不是 <audio>：mp4/webm 这类作品能直接播，纯音频文件也照样播
 *  - 字幕绑定在播放器内部完成：切歌即自动匹配同名字幕（LRC/SRT/ASS/VTT），
 *    不再依赖详情页，也不用手动选
 *  - 服务端下发的 mediaStreamUrl 是唯一可信地址（只补 token）
 */
import { reactive, watch } from 'vue'
import * as api from '../api/client'
import type { TrackNode } from '../api/types'
import { useSession } from './session'
import { ui } from './ui'
import { toast } from './toast'
import { extOf } from '../utils/format'
import { sniffAudioCodec, UNSUPPORTED_AUDIO } from '../utils/mp4'
import {
  collectSubtitles, collectSubtitlesShallow, decodeText, parseSubtitle,
  rankSubtitles, rankSubtitlesGlobal, subtitleFormat,
} from '../services/lyrics'

export interface PlaylistItem {
  workId: number
  workTitle: string
  title: string
  ext: string
  isVideo: boolean
  /** 服务端下发的原始 URL（未补 token），用于在音轨树里做唯一标识 */
  rawStreamUrl: string
  /** 服务端下发的下载地址（未补 token） */
  rawDownloadUrl?: string
  streamUrl: string
  coverUrl: string
}

export interface LrcLine { time: number; text: string }

/** 单例媒体元素：正在播放页会把它"收养"进 DOM，关闭时再摘回 */
const mediaEl = document.createElement('video')
mediaEl.preload = 'metadata'
mediaEl.playsInline = true
mediaEl.setAttribute('playsinline', '')
export { mediaEl }

const audio = mediaEl

interface PlayerState {
  playlist: PlaylistItem[]
  index: number
  playing: boolean
  loading: boolean
  currentTime: number
  duration: number
  buffered: number
  scrubbing: boolean
  volume: number
  muted: boolean
  rate: number
  error: string
  /** 当前是否在用本地已下载的文件播放 */
  usingLocal: boolean
  /** 音轨编码不受支持等"能播但没声音"的提示 */
  audioWarning: string
  lrc: LrcLine[]
  lrcTitle: string
  lrcFormat: string
  /** 歌词整体偏移（秒）：正值=字幕延后出现 */
  lrcOffset: number
  /** 单行微调（索引 → 秒） */
  lrcLineOffsets: Record<number, number>
  /** 播放模式：off 顺序播完即停 / all 列表循环 / one 单曲循环 */
  repeatMode: 'off' | 'all' | 'one'
  shuffle: boolean
  /** 睡眠定时：到点暂停 */
  sleepAt: number | null
  /** 播完当前曲停止 */
  sleepAfterTrack: boolean
}

const savedVolume = Number(localStorage.getItem('kikoeru-pc/volume'))
const savedRate = Number(localStorage.getItem('kikoeru-pc/rate'))

export const player = reactive<PlayerState>({
  playlist: [],
  index: -1,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  scrubbing: false,
  volume: Number.isFinite(savedVolume) && savedVolume >= 0 ? savedVolume : 1,
  muted: localStorage.getItem('kikoeru-pc/muted') === '1',
  rate: [0.75, 1, 1.25, 1.5, 2].includes(savedRate) ? savedRate : 1,
  error: '',
  usingLocal: false,
  audioWarning: '',
  lrc: [],
  lrcTitle: '',
  lrcFormat: '',
  lrcOffset: Number(localStorage.getItem('kikoeru-pc/lrcOffset') || '0') || 0,
  lrcLineOffsets: {},
  repeatMode: (localStorage.getItem('kikoeru-pc/repeat') as 'off' | 'all' | 'one') || 'off',
  shuffle: localStorage.getItem('kikoeru-pc/shuffle') === '1',
  sleepAt: null,
  sleepAfterTrack: false,
})

export const current = () => (player.index >= 0 ? player.playlist[player.index] : null)

// ---------------------------------------------------------------- 桌面歌词推送

interface LyricsBridge {
  lyricsUpdate?: (p: { current: string; next: string; playing: boolean; title: string }) => void
  resolveLocal?: (opts: { workId: number; fileName: string }) => Promise<string | null>
  setPlayerState?: (p: { playing: boolean; title: string }) => void
}

/** 把播放状态推给主进程：任务栏缩略图按钮用 */
function pushPlayerState() {
  const bridge = (window as unknown as { kikoeru?: LyricsBridge }).kikoeru
  const item = current()
  bridge?.setPlayerState?.({ playing: player.playing, title: item?.title ?? '' })
}

let lastPushedIdx = -2

/** 把当前行推给桌面歌词窗；只在行号变化或状态变化时发 */
function notifyLyrics(force = false) {
  const bridge = (window as unknown as { kikoeru?: LyricsBridge }).kikoeru
  if (!bridge?.lyricsUpdate) return
  const item = current()
  const idx = activeLrcIndex()
  if (!force && idx === lastPushedIdx) return
  lastPushedIdx = idx
  bridge.lyricsUpdate({
    current: idx >= 0 ? (player.lrc[idx]?.text ?? '') : (item?.title ?? ''),
    next: idx + 1 < player.lrc.length ? player.lrc[idx + 1].text : '',
    playing: player.playing,
    title: item?.workTitle ?? '',
  })
}

// ---------------------------------------------------------------- 播放位置记忆

const POS_KEY = 'kikoeru-pc/positions'
let lastItem: PlaylistItem | null = null
let pendingPosition: number | null = null
let lastPositionSave = 0
/** 本地文件失败后只自动回退一次，避免来回切 */
let localFallbackUsed = false

function positionKey(item: PlaylistItem): string {
  return `${item.workId}::${item.title}`
}

function readPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(POS_KEY)
    const all = raw ? JSON.parse(raw) : {}
    return all && typeof all === 'object' ? all : {}
  } catch {
    return {}
  }
}

function writePosition(key: string, seconds: number | null) {
  try {
    const all = readPositions()
    if (seconds === null) delete all[key]
    else all[key] = Math.floor(seconds)
    localStorage.setItem(POS_KEY, JSON.stringify(all))
  } catch { /* 忽略 */ }
}

/** 位置在结尾附近就当作已听完，不留记录 */
function savePositionNow(item: PlaylistItem | null = lastItem) {
  if (!item) return
  const t = audio.currentTime
  if (!Number.isFinite(t) || t < 3) return
  const d = Number.isFinite(audio.duration) ? audio.duration : 0
  writePosition(positionKey(item), d > 0 && t > d - 5 ? null : t)
}

function readPosition(item: PlaylistItem): number | null {
  const saved = readPositions()[positionKey(item)]
  return typeof saved === 'number' && saved > 3 ? saved : null
}

// ---------------------------------------------------------------- 媒体事件

function readBuffered() {
  try {
    const b = audio.buffered
    if (b.length > 0) player.buffered = b.end(b.length - 1)
  } catch { /* 无源时会抛 */ }
}

audio.addEventListener('loadedmetadata', () => {
  player.duration = Number.isFinite(audio.duration) ? audio.duration : 0
  // 上次听到哪就从哪继续（太靠前/太靠后都从头开始）
  if (pendingPosition !== null) {
    const at = pendingPosition
    pendingPosition = null
    if (at > 3 && (!player.duration || at < player.duration - 5)) {
      try {
        audio.currentTime = at
        player.currentTime = at
      } catch { /* 忽略 */ }
    }
  }
})
audio.addEventListener('durationchange', () => {
  player.duration = Number.isFinite(audio.duration) ? audio.duration : 0
})
audio.addEventListener('progress', readBuffered)
audio.addEventListener('timeupdate', () => {
  if (!player.scrubbing) player.currentTime = audio.currentTime
  readBuffered()
  notifyLyrics()
  if (!player.scrubbing && Date.now() - lastPositionSave > 5000) {
    lastPositionSave = Date.now()
    savePositionNow()
  }
  if (player.sleepAt && Date.now() >= player.sleepAt) {
    player.sleepAt = null
    audio.pause()
  }
})
audio.addEventListener('playing', () => {
  player.playing = true
  player.loading = false
  notifyLyrics(true)
  pushPlayerState()
  scheduleAudioProbe()
})
audio.addEventListener('play', () => { player.playing = true; pushPlayerState() })
audio.addEventListener('pause', () => {
  player.playing = false
  savePositionNow()
  notifyLyrics(true)
  pushPlayerState()
})
audio.addEventListener('waiting', () => { player.loading = true })
audio.addEventListener('canplay', () => { player.loading = false })
audio.addEventListener('ended', () => {
  if (lastItem) writePosition(positionKey(lastItem), null)
  if (player.sleepAfterTrack) {
    player.sleepAfterTrack = false
    audio.pause()
    return
  }
  if (player.repeatMode === 'one') {
    seek(0)
    void audio.play()
    return
  }
  next()
})
audio.addEventListener('error', () => {
  player.loading = false
  player.playing = false
  const code = audio.error && audio.error.code
  if (code === 1) return // 换源引起的中断，不算失败

  console.warn('[player] media error', code, player.usingLocal ? 'local' : 'remote', current()?.title)

  // 本地文件坏了/被删了：自动切回在线地址，保留当前位置
  const item = current()
  if (player.usingLocal && !localFallbackUsed && item) {
    localFallbackUsed = true
    player.usingLocal = false
    const at = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    pendingPosition = at > 3 ? at : null
    player.error = ''
    audio.src = item.streamUrl
    void audio.play().catch(() => { player.loading = false })
    toast('本地文件不可用，已切回在线播放', 'info')
    return
  }

  player.error = (code === 3 || code === 4)
    ? '这个文件浏览器内核解不了（常见于 H.265 / MKV），请换支持该格式的播放器'
    : '媒体加载失败，请检查网络或服务器'
  toast(player.error, 'error')
})

/**
 * 音轨解码探测：画面在动、音频解码字节数一直是 0，说明容器里的音轨编码
 * 浏览器内核不支持（典型是 AC-3 / E-AC-3 / DTS）——这时只会有画面没有声音。
 * 2 秒后才判定，避免刚起播时的 0 值误报。
 */
let audioProbeTimer = 0
let probedUrl = ''

function scheduleAudioProbe() {
  window.clearTimeout(audioProbeTimer)
  audioProbeTimer = window.setTimeout(async () => {
    const item = current()
    if (!item || !item.isVideo || probedUrl === item.streamUrl) return
    const el = audio as HTMLVideoElement & {
      webkitAudioDecodedByteCount?: number
      webkitVideoDecodedByteCount?: number
    }
    const videoBytes = el.webkitVideoDecodedByteCount ?? 0
    const audioBytes = el.webkitAudioDecodedByteCount ?? 0
    if (videoBytes <= 0 || audioBytes > 0) return

    probedUrl = item.streamUrl
    let codec = ''
    try { codec = (await sniffAudioCodec(api.textFetchUrl(item.streamUrl))) ?? '' } catch { /* 嗅探失败不影响播放 */ }
    player.audioWarning = codec && UNSUPPORTED_AUDIO.has(codec.toLowerCase())
      ? `音轨是 ${codec.toUpperCase()}（Dolby/DTS），浏览器内核解不了，所以只有画面没有声音`
      : '这条视频的音轨编码浏览器内核解不了（常见于 AC-3/DTS），所以只有画面没有声音'
    toast(player.audioWarning, 'error')
  }, 2000)
}

function updateMediaSession() {
  const item = current()
  if (!item || !('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.title,
    artist: item.workTitle,
    album: 'Kikoeru',
    // Media Session 只接受 http/https/data/blob；app:// 会触发控制台警告，直接省略
    artwork: /^(https?:|data:|blob:)/i.test(item.coverUrl)
      ? [{ src: item.coverUrl, sizes: '256x256' }]
      : [],
  })
  navigator.mediaSession.setActionHandler('play', () => { void audio.play() })
  navigator.mediaSession.setActionHandler('pause', () => audio.pause())
  navigator.mediaSession.setActionHandler('previoustrack', prev)
  navigator.mediaSession.setActionHandler('nexttrack', next)
}

// ---------------------------------------------------------------- 播放列表

const VIDEO_EXT = new Set(['mp4', 'webm', 'mkv', 'm4v', 'mov'])

/** 把一条音轨节点转成播放项；没有可播地址时返回 null */
function toPlaylistItem(n: TrackNode, workId: number, workTitle: string): PlaylistItem | null {
  const url = api.resolveMediaUrl(n.mediaStreamUrl)
  if (!url) return null
  const ext = extOf(n.title).replace('.', '').toUpperCase()
  return {
    workId,
    workTitle,
    title: n.title,
    ext,
    isVideo: VIDEO_EXT.has(ext.toLowerCase()),
    rawStreamUrl: n.mediaStreamUrl ?? '',
    rawDownloadUrl: n.mediaDownloadUrl ?? '',
    streamUrl: url,
    coverUrl: api.coverUrl(workId, true),
  }
}

/** 扁平化音轨树中的可播放叶子（音频 + 视频，全部递归） */
export function flattenAudioLeaves(nodes: TrackNode[], workId: number, workTitle: string): PlaylistItem[] {
  const out: PlaylistItem[] = []
  const walk = (list: TrackNode[]) => {
    for (const n of list) {
      if (n.type === 'folder' && n.children) walk(n.children)
      else if (n.type === 'audio') {
        const item = toPlaylistItem(n, workId, workTitle)
        if (item) out.push(item)
      }
    }
  }
  walk(nodes)
  return out
}

/** 只取这一层里直接可播的文件（不递归），用于"点哪条就播它所在的那个文件夹" */
function levelPlaylist(level: TrackNode[], workId: number, workTitle: string): PlaylistItem[] {
  const out: PlaylistItem[] = []
  for (const n of level) {
    if (n.type !== 'audio') continue
    const item = toPlaylistItem(n, workId, workTitle)
    if (item) out.push(item)
  }
  return out
}

/** 找出某条音轨所在的那一层（父文件夹的直接子节点） */
export function findTrackLevel(nodes: TrackNode[], title: string): TrackNode[] | null {
  if (nodes.some((n) => n.type === 'audio' && n.title === title)) return nodes
  for (const n of nodes) {
    if (n.type === 'folder' && n.children) {
      const hit = findTrackLevel(n.children, title)
      if (hit) return hit
    }
  }
  return null
}

export function playList(list: PlaylistItem[], index: number) {
  player.playlist = list
  player.index = index
  loadCurrent()
}

/**
 * 播放音轨树。
 * scope='folder'：只把点中的那条所在的文件夹排进播放列表（默认"点哪条播哪个文件夹"）；
 * scope='all'：整部作品的所有可播文件（"全部播放"按钮用）。
 * 不按扩展名过滤 —— 同文件夹里的 mp4/flac/wav 一样进列表。
 */
export function playWorkTree(
  nodes: TrackNode[],
  workId: number,
  workTitle: string,
  startTitle?: string,
  scope: 'all' | 'folder' = 'all',
): void {
  let list: PlaylistItem[]
  if (scope === 'folder' && startTitle) {
    const level = findTrackLevel(nodes, startTitle)
    list = level ? levelPlaylist(level, workId, workTitle) : []
  } else {
    list = flattenAudioLeaves(nodes, workId, workTitle)
  }
  if (!list.length) return
  let idx = 0
  if (startTitle) {
    const found = list.findIndex((i) => i.title === startTitle)
    if (found >= 0) idx = found
  }
  playList(list, idx)
}

export function playAt(index: number) {
  if (index < 0 || index >= player.playlist.length) return
  if (index === player.index) { toggle(); return }
  player.index = index
  loadCurrent()
}

let loadSeq = 0

/** 本地文件走同源的自定义协议，才能被 CSP 与 <video> 接受 */
function localMediaUrl(absPath: string): string {
  return `app://kikoeru/local?p=${encodeURIComponent(absPath)}`
}

async function loadCurrent() {
  const item = current()
  if (!item) return
  // 切歌前把上一首听到的位置存下来（此时 audio 还指向旧源）
  if (lastItem) savePositionNow(lastItem)
  lastItem = item
  const seq = ++loadSeq
  window.clearTimeout(audioProbeTimer)
  probedUrl = ''
  player.loading = true
  player.error = ''
  player.audioWarning = ''
  player.currentTime = 0
  player.buffered = 0
  player.lrc = []
  player.lrcTitle = ''
  player.lrcFormat = ''
  player.lrcLineOffsets = readLineOffsets(item.workId, item.title)

  audio.playbackRate = player.rate
  audio.volume = player.volume
  audio.muted = player.muted

  // 先看本地下载过没有：有就用本地（离线可听），没有走在线地址
  let localPath: string | null = null
  const bridge = (window as unknown as { kikoeru?: LyricsBridge }).kikoeru
  if (bridge?.resolveLocal) {
    try {
      localPath = await bridge.resolveLocal({ workId: item.workId, fileName: item.title })
    } catch {
      localPath = null
    }
  }
  if (seq !== loadSeq) return

  player.usingLocal = !!localPath
  localFallbackUsed = false
  pendingPosition = readPosition(item)
  audio.src = localPath ? localMediaUrl(localPath) : item.streamUrl
  audio.play().catch(() => { player.loading = false })

  // 视频作品自动开固定尺寸的视频窗口；切回音频时收起
  if (item.isVideo) ui.openVideo()
  else if (ui.videoOpen) ui.closeVideo()
  updateMediaSession()
  if (useSession.loggedIn) void api.putReview(item.workId, 'listening')

  lastPushedIdx = -2
  notifyLyrics(true)
  pushPlayerState()
  void autoBindLyrics(item)
}

/** 失败后重试当前曲目（界面上的"重试"按钮用） */
export function retryCurrent() {
  if (!current()) return
  player.error = ''
  loadCurrent()
}

// ---------------------------------------------------------------- 字幕

const treeCache = new Map<number, TrackNode[]>()
const lrcSeq = { v: 0 }

async function ensureTree(workId: number): Promise<TrackNode[]> {
  const hit = treeCache.get(workId)
  if (hit) return hit
  const tree = await api.getTracks(workId)
  treeCache.set(workId, tree)
  return tree
}

/** 手动绑定：key = `${workId}::${audioTitle}` → 字幕文件名 */
const BIND_KEY = 'kikoeru-pc/lrcBinds'
function readBinds(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BIND_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function writeBind(key: string, subtitleTitle: string | null) {
  const map = readBinds()
  if (subtitleTitle) map[key] = subtitleTitle
  else delete map[key]
  localStorage.setItem(BIND_KEY, JSON.stringify(map))
}

export function bindKey(workId: number, audioTitle: string) {
  return `${workId}::${audioTitle}`
}

/** 手动指定某条音轨的字幕（详情页点字幕文件时用），会记住 */
export async function bindSubtitleManually(workId: number, audioTitle: string, subtitle: TrackNode) {
  writeBind(bindKey(workId, audioTitle), subtitle.title)
  const item = current()
  if (!item || item.workId !== workId) return
  if (!await applySubtitle(subtitle)) {
    toast('这个字幕文件解析不出内容', 'error')
  }
}

async function applySubtitle(sub: TrackNode, ownerSeq?: number): Promise<boolean> {
  const seq = ownerSeq ?? ++lrcSeq.v
  const url = api.resolveMediaUrl(sub.mediaStreamUrl)
  if (!url) return false
  try {
    const res = await fetch(api.textFetchUrl(url))
    if (!res.ok) {
      console.warn('[subtitle] http', res.status, sub.title)
      return false
    }
    const buf = await res.arrayBuffer()
    const text = decodeText(buf, res.headers.get('content-type') || '')
    if (seq !== lrcSeq.v) return false
    const fmt = subtitleFormat(sub.title)
    const lines = parseSubtitle(text, '.' + fmt)
    if (!lines.length) {
      console.warn('[subtitle] empty', sub.title, fmt, text.length)
      return false
    }
    player.lrc = lines
    player.lrcTitle = sub.title
    player.lrcFormat = fmt
    lastPushedIdx = -2
    notifyLyrics(true)
    return true
  } catch (e) {
    console.warn('[subtitle] fail', sub.title, e instanceof Error ? e.message : String(e))
    return false
  }
}

/**
 * 自动为当前曲目找字幕，顺序：
 *   手动绑定 → 同一文件夹内匹配 → 全树唯一同名文件
 * 绝不跨文件夹按"轨号/下标/唯一字幕"猜 —— 特典、闹铃这类赠品音轨没有字幕时
 * 就该空着，不能把正片字幕挂上去。
 */
async function autoBindLyrics(item: PlaylistItem) {
  const seq = ++lrcSeq.v
  let tree: TrackNode[]
  try {
    tree = await ensureTree(item.workId)
  } catch {
    return
  }
  if (seq !== lrcSeq.v) return

  const all = collectSubtitles(tree)
  const tried = new Set<string>()

  /** 按顺序尝试候选，直到某个文件真的能解析出内容 */
  const attempt = async (nodes: TrackNode[]): Promise<boolean> => {
    for (const node of nodes) {
      if (seq !== lrcSeq.v) return false
      if (tried.has(node.title)) continue
      tried.add(node.title)
      if (await applySubtitle(node, seq)) return true
      if (seq !== lrcSeq.v) return false
    }
    return false
  }

  const manualName = readBinds()[bindKey(item.workId, item.title)]
  if (manualName) {
    const manual = all.find((s) => s.title === manualName)
    if (manual && await applySubtitle(manual, seq)) return
  }

  // 1) 同一个文件夹：同名 / 去声道同名 / 同轨号，带时间轴的优先
  const level = findTrackLevel(tree, item.title)
  if (level && await attempt(rankSubtitles(item.title, collectSubtitlesShallow(level)))) return

  // 2) 跨文件夹兜底：只认同名（含归一化同名），不按位置猜
  if (await attempt(rankSubtitlesGlobal(item.title, all))) return

  // 全部失败：留空，界面显示"会自动匹配"，不要绑一个空时间轴
}

/** 当前应高亮的歌词行下标（-1 表示还没到第一句） */
export function activeLrcIndex(): number {
  const lines = player.lrc
  if (!lines.length) return -1

  // 纯文本台本（没有时间轴）：按播放进度均分，至少能跟着走
  if (lines[0].time < 0) {
    const d = player.duration || 0
    if (!d) return 0
    const shifted = player.currentTime - player.lrcOffset
    const ratio = Math.min(0.9999, Math.max(0, shifted / d))
    return Math.floor(ratio * lines.length)
  }

  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time < 0) continue
    const lineOff = player.lrcLineOffsets[i] || 0
    // 逐行微调叠加后时间不再保证有序，不能用 break 提前收尾
    if (lines[i].time + player.lrcOffset + lineOff <= player.currentTime + 0.15) idx = i
  }
  return idx
}

// ---------------------------------------------------------------- 传输控制

export function toggle() {
  if (!current()) return
  if (audio.paused) audio.play().catch(() => {})
  else audio.pause()
}

export function seek(t: number) {
  const d = player.duration
  if (!d || !Number.isFinite(t)) return
  const target = Math.min(Math.max(0, t), d)
  try {
    audio.currentTime = target
    player.currentTime = target
  } catch {
    player.currentTime = target
  }
}

export function seekBy(delta: number) {
  seek(player.currentTime + delta)
}

export function beginScrub() { player.scrubbing = true }

export function scrubTo(t: number) {
  const d = player.duration
  if (!d) return
  player.currentTime = Math.min(Math.max(0, t), d)
}

export function endScrub() {
  player.scrubbing = false
  seek(player.currentTime)
}

function randomIndex(): number {
  const n = player.playlist.length
  if (n <= 1) return 0
  let i = Math.floor(Math.random() * n)
  if (i === player.index) i = (i + 1) % n
  return i
}

export function next() {
  if (!player.playlist.length) return
  if (player.shuffle) { player.index = randomIndex(); loadCurrent(); return }
  if (player.index < player.playlist.length - 1) {
    player.index++
    loadCurrent()
    return
  }
  if (player.repeatMode === 'all') {
    player.index = 0
    loadCurrent()
  } else {
    audio.pause()
  }
}

export function prev() {
  if (player.currentTime > 3) { seek(0); return }
  if (player.shuffle) { player.index = randomIndex(); loadCurrent(); return }
  if (player.index > 0) {
    player.index--
    loadCurrent()
  } else if (player.repeatMode === 'all' && player.playlist.length > 1) {
    player.index = player.playlist.length - 1
    loadCurrent()
  } else {
    seek(0)
  }
}

export function setVolume(v: number) {
  player.volume = Math.min(1, Math.max(0, v))
  audio.volume = player.volume
  if (player.volume > 0) {
    player.muted = false
    audio.muted = false
  }
  localStorage.setItem('kikoeru-pc/volume', String(player.volume))
  localStorage.setItem('kikoeru-pc/muted', player.muted ? '1' : '0')
}

export function toggleMute() {
  const willUnmute = player.muted
  player.muted = !player.muted
  if (willUnmute && player.volume === 0) {
    player.volume = 0.5
    audio.volume = 0.5
    localStorage.setItem('kikoeru-pc/volume', '0.5')
  }
  audio.muted = player.muted
  localStorage.setItem('kikoeru-pc/muted', player.muted ? '1' : '0')
}

const LINE_KEY = 'kikoeru-pc/lrcLineOffsets'
function readLineOffsets(workId: number, title: string): Record<number, number> {
  try {
    const raw = localStorage.getItem(LINE_KEY)
    const all = raw ? JSON.parse(raw) : {}
    return all[`${workId}::${title}`] || {}
  } catch { return {} }
}

export function nudgeLrcLine(index: number, delta: number) {
  const cur = player.lrcLineOffsets[index] || 0
  const next = Math.round((cur + delta) * 10) / 10
  player.lrcLineOffsets = { ...player.lrcLineOffsets, [index]: Math.max(-10, Math.min(10, next)) }
  persistLineOffsets()
  notifyLyrics(true)
}

export function resetLrcLines() {
  player.lrcLineOffsets = {}
  persistLineOffsets()
  notifyLyrics(true)
}

function persistLineOffsets() {
  const item = current()
  if (!item) return
  try {
    const raw = localStorage.getItem(LINE_KEY)
    const all = raw ? JSON.parse(raw) : {}
    all[`${item.workId}::${item.title}`] = player.lrcLineOffsets
    localStorage.setItem(LINE_KEY, JSON.stringify(all))
  } catch { /* 忽略 */ }
}

export function nudgeLrcOffset(delta: number) {
  const next = Math.round((player.lrcOffset + delta) * 10) / 10
  player.lrcOffset = Math.max(-10, Math.min(10, next))
  localStorage.setItem('kikoeru-pc/lrcOffset', String(player.lrcOffset))
  notifyLyrics(true)
}

export function resetLrcOffset() {
  player.lrcOffset = 0
  localStorage.setItem('kikoeru-pc/lrcOffset', '0')
  notifyLyrics(true)
}

export function setSleepMinutes(minutes: number) {
  player.sleepAfterTrack = false
  player.sleepAt = Date.now() + minutes * 60 * 1000
}

export function sleepAfterTrack() {
  player.sleepAt = null
  player.sleepAfterTrack = true
}

export function clearSleep() {
  player.sleepAt = null
  player.sleepAfterTrack = false
}

export function cycleRepeat() {
  const order: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']
  const i = order.indexOf(player.repeatMode)
  player.repeatMode = order[(i + 1) % order.length]
  localStorage.setItem('kikoeru-pc/repeat', player.repeatMode)
}

export function toggleShuffle() {
  player.shuffle = !player.shuffle
  localStorage.setItem('kikoeru-pc/shuffle', player.shuffle ? '1' : '0')
}

export function setRate(r: number) {
  player.rate = r
  audio.playbackRate = r
  localStorage.setItem('kikoeru-pc/rate', String(r))
}

watch(() => player.index, () => { /* 字幕由 loadCurrent 驱动 */ })
