/**
 * 收藏夹 —— 服务端默认 mark playlist 的唯一数据源。
 *
 * 约束（一次网络抖动不能让功能永久失效）：
 *  - 状态机 idle/loading/ready/error，失败绝不标记 ready；
 *  - 加载失败带可读原因，界面可重试；
 *  - 同一作品写入串行，连点只发一次；
 *  - 乐观更新，失败回滚；
 *  - works + ids 一起缓存，收藏页不再单独重复拉一遍。
 */
import { reactive } from 'vue'
import {
  addWorksToPlaylist, getDefaultMarkPlaylist, getPlaylistWorks, removeWorksFromPlaylist,
} from '../api/client'
import type { Work } from '../api/types'
import { useSession } from './session'

export type FavoriteStatus = 'idle' | 'loading' | 'ready' | 'error'

export const favorites = reactive({
  status: 'idle' as FavoriteStatus,
  error: '',
  playlistId: null as number | string | null,
  ids: new Set<number>(),
  /** 与 ids 同一次加载拿到的作品对象，收藏页直接复用 */
  works: [] as Work[],
  /** 增删/加载完成都自增，供 computed 依赖 */
  rev: 0,
  /** 只统计用户真正增删成功的次数（页面据此刷新，避免加载自触发） */
  mutations: 0,
})

let loading: Promise<boolean> | null = null
let ownerName: string | null = null
const pending = new Map<number, Promise<boolean>>()

function resetState() {
  favorites.status = 'idle'
  favorites.error = ''
  favorites.playlistId = null
  favorites.ids = new Set<number>()
  favorites.works = []
  favorites.mutations = 0
  favorites.rev++
}

export function syncFavoriteOwner() {
  const name = useSession.currentName
  if (name === ownerName) return
  ownerName = name
  resetState()
}

export function isFavorite(workId: number | undefined | null): boolean {
  if (!workId) return false
  void favorites.rev
  return favorites.ids.has(workId)
}

export function isFavoriteBusy(workId: number | undefined | null): boolean {
  return !!workId && pending.has(workId)
}

export function favoriteCount(): number {
  void favorites.rev
  return favorites.ids.size
}

/** 把底层错误转成人话（HTTP 码对用户没意义） */
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/HTTP 401/.test(msg)) return '登录已过期，请重新登录'
  if (/HTTP 403/.test(msg)) return '没有权限访问收藏夹'
  if (/HTTP 5\d\d/.test(msg)) return '服务器暂时不可用，请稍后重试'
  if (/Failed to fetch|NetworkError|ECONN/i.test(msg)) return '网络连接失败，请检查网络或代理'
  return msg || '收藏夹加载失败'
}

/**
 * 拉取默认收藏夹（ids 与作品列表一起）。
 * @returns 是否成功
 */
export async function loadFavorites(force = false): Promise<boolean> {
  syncFavoriteOwner()
  if (!useSession.loggedIn) {
    favorites.status = 'idle'
    favorites.error = ''
    return false
  }
  if (!force && favorites.status === 'ready' && favorites.playlistId != null) return true
  if (loading) return loading

  favorites.status = 'loading'
  favorites.error = ''

  loading = (async () => {
    try {
      const meta = await getDefaultMarkPlaylist()
      if (meta?.id === undefined || meta?.id === null) throw new Error('服务端没有返回默认收藏夹')
      favorites.playlistId = meta.id

      const ids = new Set<number>()
      const works: Work[] = []
      let page = 1
      for (;;) {
        const res = await getPlaylistWorks(meta.id, page, 60)
        for (const w of res.works || []) {
          if (ids.has(w.id)) continue
          ids.add(w.id)
          works.push(w)
        }
        const total = res.pagination?.totalCount ?? 0
        if (!res.works?.length || gotAll(page, ids.size, total) || page > 50) break
        page++
      }

      favorites.ids = ids
      favorites.works = works
      favorites.status = 'ready'
      favorites.rev++
      return true
    } catch (e) {
      favorites.status = 'error'
      favorites.error = friendlyError(e)
      console.warn('[favorites] load failed:', favorites.error)
      favorites.rev++
      return false
    } finally {
      loading = null
    }
  })()

  return loading
}

function gotAll(page: number, got: number, total: number): boolean {
  if (total <= 0) return true
  return got >= total || page * 60 >= total
}

/** 兼容旧调用名 */
export const ensureFavorites = loadFavorites

export function refreshFavorites(): Promise<boolean> {
  return loadFavorites(true)
}

/**
 * 加入 / 移出默认收藏夹，返回操作后的状态（true=已收藏）。
 * 同一作品并发调用复用同一个 Promise。
 */
export async function toggleFavorite(workId: number): Promise<boolean> {
  if (!useSession.loggedIn) throw new Error('收藏需要登录')

  const existing = pending.get(workId)
  if (existing) return existing

  const run = (async () => {
    let ok = await loadFavorites()
    if (!ok || favorites.playlistId == null) {
      // 首次失败（网络抖动/登录刚恢复）强制重试一次
      ok = await loadFavorites(true)
      if (!ok || favorites.playlistId == null) {
        throw new Error(favorites.error || '收藏夹暂时不可用，请稍后重试')
      }
    }

    const listId = favorites.playlistId
    const before = new Set(favorites.ids)
    const had = before.has(workId)

    const optimistic = new Set(before)
    if (had) optimistic.delete(workId)
    else optimistic.add(workId)
    favorites.ids = optimistic
    favorites.rev++

    try {
      if (had) await removeWorksFromPlaylist(listId, [workId])
      else await addWorksToPlaylist(listId, [workId])
      favorites.status = 'ready'
      favorites.error = ''
      favorites.mutations++
      // 作品对象列表失效：收藏页据 mutations 重新拉一次
      favorites.works = []
      favorites.rev++
      return !had
    } catch (e) {
      favorites.ids = before
      favorites.rev++
      throw new Error(friendlyError(e))
    }
  })()

  pending.set(workId, run)
  try {
    return await run
  } finally {
    pending.delete(workId)
  }
}
