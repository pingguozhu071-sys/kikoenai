/**
 * 下载管理 —— 主进程负责真正的写盘，这里只维护状态与进度。
 * 目标目录默认系统"下载"文件夹，可按 RJ 号建子文件夹（设置里可改）。
 */
import { reactive } from 'vue'
import { getTracks, resolveMediaUrl } from '../api/client'
import type { TrackNode } from '../api/types'
import { toast } from './toast'

interface DesktopBridge {
  isDesktop?: boolean
  downloadStart?: (opts: {
    url: string
    workId: number
    workTitle: string
    fileName: string
  }) => Promise<{ id?: string; error?: string; targetDir?: string }>
  downloadCancel?: (id: string) => Promise<boolean>
  downloadPause?: (id: string) => Promise<boolean>
  downloadResume?: (id: string) => Promise<boolean>
  getDownloadSettings?: () => Promise<{ dir: string; autoClassify: boolean; concurrency?: number }>
  setDownloadSettings?: (patch: { dir?: string; autoClassify?: boolean; concurrency?: number }) => Promise<unknown>
  pickDownloadDir?: () => Promise<string | null>
  openInFolder?: (target: string) => Promise<boolean>
  listDownloads?: () => Promise<DownloadTask[]>
  onDownloadEvent?: (cb: (kind: string, payload: Record<string, unknown>) => void) => () => void
}

const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

export const isDesktop = !!bridge?.isDesktop && typeof bridge.downloadStart === 'function'

export interface DownloadTask {
  id: string
  workId: number
  workTitle: string
  fileName: string
  /** 来源地址，失败可重试 */
  url: string
  received: number
  total: number
  state: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled'
  message?: string
  path?: string
}

const DIR_KEY = 'kikoeru-pc/downloadDir'
const CLASSIFY_KEY = 'kikoeru-pc/downloadClassify'

const CONCURRENCY_KEY = 'kikoeru-pc/downloadConcurrency'

export const downloadSettings = reactive({
  dir: localStorage.getItem(DIR_KEY) ?? '',
  autoClassify: localStorage.getItem(CLASSIFY_KEY) !== '0',
  concurrency: Math.min(5, Math.max(1, Number(localStorage.getItem(CONCURRENCY_KEY) || '3'))),
  persist() {
    localStorage.setItem(DIR_KEY, this.dir)
    localStorage.setItem(CLASSIFY_KEY, this.autoClassify ? '1' : '0')
    localStorage.setItem(CONCURRENCY_KEY, String(this.concurrency))
    void bridge?.setDownloadSettings?.({ dir: this.dir, autoClassify: this.autoClassify, concurrency: this.concurrency })
  },
})

export const downloadState = reactive({
  tasks: [] as DownloadTask[],
  get active() {
    return this.tasks.filter((t) => t.state === 'running' || t.state === 'queued').length
  },
  get finished() {
    return this.tasks.filter((t) => t.state === 'done').length
  },
})

let inited = false

/** 启动时调用一次：同步主进程设置并订阅事件 */
export async function initDownloads() {
  if (inited) return
  inited = true
  if (!bridge) return

  try {
    const s = await bridge.getDownloadSettings?.()
    if (s) {
      // 主进程为准（用户可能在设置里改过，且已落盘）
      if (s.dir) downloadSettings.dir = s.dir
      downloadSettings.autoClassify = s.autoClassify !== false
      if (Number.isFinite(Number(s.concurrency))) {
        downloadSettings.concurrency = Math.min(5, Math.max(1, Math.floor(Number(s.concurrency))))
      }
      localStorage.setItem(DIR_KEY, downloadSettings.dir)
      localStorage.setItem(CLASSIFY_KEY, downloadSettings.autoClassify ? '1' : '0')
      localStorage.setItem(CONCURRENCY_KEY, String(downloadSettings.concurrency))
    }
  } catch { /* 忽略 */ }

  // 恢复上次的任务列表（未完成的已在主进程重新排队）
  try {
    const list = await bridge.listDownloads?.()
    if (Array.isArray(list) && list.length) {
      const known = new Set(downloadState.tasks.map((t) => t.id))
      for (const t of list) {
        if (!t || !t.id || known.has(t.id)) continue
        downloadState.tasks.push({ ...t, state: t.state === 'running' ? 'queued' : t.state })
      }
    }
  } catch { /* 忽略 */ }

  bridge.onDownloadEvent?.((kind, payload) => {
    const id = String(payload.id ?? '')
    const task = downloadState.tasks.find((t) => t.id === id)
    if (kind === 'progress') {
      if (!task) return
      // 第一次收到进度说明已经真正开始（之前可能一直在排队）
      if (task.state === 'queued') task.state = 'running'
      task.received = Number(payload.received ?? 0)
      task.total = Number(payload.total ?? 0)
    } else if (kind === 'done') {
      if (task) {
        task.state = 'done'
        task.received = Number(payload.received ?? task.received)
        task.path = String(payload.path ?? '')
      }
      maybeAllDone()
    } else if (kind === 'error') {
      if (task) {
        task.state = 'error'
        task.message = String(payload.message ?? '下载失败')
      }
      toast(`下载失败：${String(payload.fileName ?? '')} ${String(payload.message ?? '')}`, 'error')
      maybeAllDone()
    } else if (kind === 'canceled') {
      if (task) task.state = 'canceled'
      maybeAllDone()
    } else if (kind === 'paused') {
      if (task) {
        task.state = 'paused'
        if (payload.received != null) task.received = Number(payload.received)
        if (payload.total != null) task.total = Number(payload.total)
      }
    }
  })
}

/** 每批只提示一次：上一批结束后没有新任务时不再重复报数 */
let idleReported = false

function maybeAllDone() {
  const pending = downloadState.tasks.filter(
    (t) => t.state === 'running' || t.state === 'queued' || t.state === 'paused',
  ).length
  if (pending > 0) {
    idleReported = false
    return
  }
  if (idleReported) return
  idleReported = true
  const ok = downloadState.tasks.filter((t) => t.state === 'done').length
  if (ok > 0) toast(`下载完成：${ok} 个文件`, 'success')
}

/**
 * 作品文件夹里所有可下载的叶子：音频、视频、字幕/台本、图片、PDF 都算。
 * 只要服务端给了 mediaDownloadUrl 就能下，不按类型挑。
 */
export function downloadableLeaves(nodes: TrackNode[]): TrackNode[] {
  const out: TrackNode[] = []
  const walk = (list: TrackNode[]) => {
    for (const n of list) {
      if (n.type === 'folder' && n.children) walk(n.children)
      else if (n.mediaDownloadUrl) out.push(n)
    }
  }
  walk(nodes)
  return out
}

async function startOne(opts: {
  url: string
  workId: number
  workTitle: string
  fileName: string
}): Promise<DownloadTask | null> {
  if (!bridge?.downloadStart) return null
  const res = await bridge.downloadStart(opts)
  if (!res || res.error || !res.id) {
    toast(`下载失败：${res?.error ?? '未知错误'}`, 'error')
    return null
  }
  idleReported = false
  const task: DownloadTask = {
    id: res.id,
    workId: opts.workId,
    workTitle: opts.workTitle,
    fileName: opts.fileName,
    url: opts.url,
    received: 0,
    total: 0,
    // 真正开始由主进程的 progress 事件确认（并发槽位可能还没轮到）
    state: 'queued',
  }
  downloadState.tasks.unshift(task)
  if (downloadState.tasks.length > 200) downloadState.tasks.length = 200
  return task
}

/** 只下当前播放的这一轨（播放条 / 正在播放页用；打包下载只在详情页） */
export async function downloadSingleItem(item: {
  title: string
  workId: number
  workTitle: string
  rawDownloadUrl?: string
  rawStreamUrl?: string
}) {
  if (!isDesktop) {
    toast('下载功能需要桌面版', 'info')
    return
  }
  const raw = item.rawDownloadUrl || item.rawStreamUrl
  if (!raw) {
    toast('这一轨没有下载地址', 'error')
    return
  }
  const url = resolveMediaUrl(raw)
  if (!url) {
    toast('下载地址无效', 'error')
    return
  }
  const t = await startOne({ url, workId: item.workId, workTitle: item.workTitle, fileName: item.title })
  if (t) toast(`开始下载：${item.title.slice(0, 24)}`, 'success')
}

/** 下载整部作品（文件夹里所有可下文件：音频/视频/字幕/图片/PDF） */
export async function downloadWork(workId: number, workTitle: string) {
  if (!isDesktop) {
    toast('下载功能需要桌面版（Kikoenai 客户端）', 'info')
    return
  }
  try {
    const tracks = await getTracks(workId)
    const leaves = downloadableLeaves(tracks)
    if (!leaves.length) {
      toast('这部作品没有可下载的文件', 'info')
      return
    }
    // 并发由主进程的队列控制，这里只负责一次性入队
    let started = 0
    for (const leaf of leaves) {
      const url = resolveMediaUrl(leaf.mediaDownloadUrl)
      if (!url) continue
      const t = await startOne({ url, workId, workTitle, fileName: leaf.title })
      if (t) started++
    }
    if (started) toast(`已加入下载队列：${started} 个文件`, 'success')
  } catch (e) {
    toast(`下载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 下载单个文件（音轨 / 视频 / 字幕 / 图片 / PDF 都走这里） */
export async function downloadTrack(node: TrackNode, workId: number, workTitle: string) {
  if (!isDesktop) {
    toast('下载功能需要桌面版', 'info')
    return
  }
  const url = resolveMediaUrl(node.mediaDownloadUrl)
  if (!url) {
    toast('该文件没有下载地址', 'error')
    return
  }
  await startOne({ url, workId, workTitle, fileName: node.title })
}

export async function retryDownload(task: DownloadTask) {
  if (!bridge?.downloadStart) return
  const idx = downloadState.tasks.findIndex((t) => t.id === task.id)
  if (idx >= 0) downloadState.tasks.splice(idx, 1)
  await startOne({ url: task.url, workId: task.workId, workTitle: task.workTitle, fileName: task.fileName })
}

export async function revealDownload(task: DownloadTask) {
  const target = task.path || downloadSettings.dir
  if (!target) { toast('还没有可打开的位置', 'info'); return }
  const ok = await bridge?.openInFolder?.(target)
  if (!ok) toast('无法打开该位置', 'error')
}

export async function cancelDownload(id: string) {
  await bridge?.downloadCancel?.(id)
}

/** 暂停：保留已下字节，之后可继续 */
export async function pauseDownload(id: string) {
  await bridge?.downloadPause?.(id)
}

/** 继续：从已下字节处续传 */
export async function resumeDownload(id: string) {
  await bridge?.downloadResume?.(id)
}

export function clearFinished() {
  downloadState.tasks = downloadState.tasks.filter((t) => t.state === 'running' || t.state === 'queued')
}

export async function pickDownloadDir(): Promise<string | null> {
  if (!bridge?.pickDownloadDir) return null
  return bridge.pickDownloadDir()
}
