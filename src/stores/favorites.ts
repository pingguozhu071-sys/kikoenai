/**
 * 收藏夹 —— 服务端的默认 mark playlist。
 *
 * 设计要点（整改后）：
 *  - 只有一个状态机：idle / loading / ready / error；加载失败绝不标记为 ready，
 *    否则一次网络抖动会让后续所有收藏操作永久报“没有默认收藏夹”。
 *  - 同一作品的写操作串行化，连点不会打两次请求。
 *  - 写入采用乐观更新，失败回滚到操作前的集合。
 *  - `rev` 是给界面的版本号：任何增删/加载完成都会自增，依赖它的 computed 会重算。
 */
import { reactive } from 'vue'
import {
  addWorksToPlaylist, getDefaultMarkPlaylist, getPlaylistWorks, removeWorksFromPlaylist,
} from '../api/client'
import { useSession } from './session'

export type FavoriteStatus = 'idle' | 'loading' | 'ready' | 'error'

export const favorites = reactive({
  status: 'idle' as FavoriteStatus,
  error: '',
  playlistId: null as number | string | null,
  ids: new Set<number>(),
  /** 每次变更自增，供界面依赖（Set 的增删不一定触发深度监听） */
  rev: 0,
  /** 只统计“用户真正增删成功”的次数：页面据此重新拉列表，避免加载本身触发刷新 */
  mutations: 0,
})

let loading: Promise<boolean> | null = null
let ownerName: string | null = null
const pending = new Map<number, Promise<boolean>>()

function resetState() {
  favorites.status = 'idle'
  favorites.error = ''
  favorites.mutations = 0
  favorites.playlistId = null
  favorites.ids = new Set<number>()
  favorites.rev++
}

/** 账号变了就作废缓存（切号后不能拿上一个人的收藏夹判断） */
export function syncFavoriteOwner() {
  const name = useSession.currentName
  if (name === ownerName) return
  ownerName = name
  resetState()
}

export function isFavorite(workId: number | undefined | null): boolean {
  if (!workId) return false
  // 读 rev 是为了让依赖方在增删后重新求值
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

/**
 * 拉取默认收藏夹的作品 id 集合。
 * 返回是否成功；失败时 status='error'，调用方可提示重试。
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
      let page = 1
      for (;;) {
        const res = await getPlaylistWorks(meta.id, page, 60)
        for (const w of res.works || []) ids.add(w.id)
        const total = res.pagination?.totalCount ?? 0
        if (!res.works?.length || allFetched(page, ids.size, total) || page > 50) break
        page++
      }

      favorites.ids = ids
      favorites.status = 'ready'
      favorites.rev++
      return true
    } catch (e) {
      // 关键：这里不能把 ready 置为 true，否则后续操作会以为缓存有效
      favorites.status = 'error'
      favorites.error = e instanceof Error ? e.message : '收藏夹加载失败'
      // 落日志：出问题时能从 userData/logs 里看到原因，而不是只有一句 toast
      console.warn('[favorites] load failed:', favorites.error)
      favorites.rev++
      return false
    } finally {
      loading = null
    }
  })()

  return loading
}

function allFetched(page: number, got: number, total: number): boolean {
  if (total <= 0) return true
  return got >= total || page * 60 >= total
}

/** 兼容旧调用名 */
export const ensureFavorites = loadFavorites

/** 强制重新拉取（设置页/错误提示上的“重试”用） */
export function refreshFavorites(): Promise<boolean> {
  return loadFavorites(true)
}

/**
 * 加入 / 移出默认收藏夹，返回操作后的状态（true=已收藏）。
 * 同一作品并发调用会复用同一个 Promise。
 */
export async function toggleFavorite(workId: number): Promise<boolean> {
  if (!useSession.loggedIn) throw new Error('收藏需要登录')

  const existing = pending.get(workId)
  if (existing) return existing

  const run = (async () => {
    let ok = await loadFavorites()
    if (!ok || favorites.playlistId == null) {
      // 首次失败（网络抖动/登录刚恢复）时强制重试一次，而不是直接判死
      ok = await loadFavorites(true)
      if (!ok || favorites.playlistId == null) {
        throw new Error(favorites.error || '收藏夹暂时不可用，请稍后重试')
      }
    }

    const listId = favorites.playlistId
    const before = new Set(favorites.ids)
    const had = before.has(workId)

    // 乐观更新
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
      return !had
    } catch (e) {
      // 回滚到操作前
      favorites.ids = before
      favorites.rev++
      throw e
    }
  })()

  pending.set(workId, run)
  try {
    return await run
  } finally {
    pending.delete(workId)
  }
}
