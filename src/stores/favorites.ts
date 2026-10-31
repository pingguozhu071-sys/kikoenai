/**
 * 收藏夹 —— 服务端的默认 mark playlist。
 *
 * 播放条那颗心必须和「收藏夹」页面是同一份数据：站点上收藏就是往这个列表加作品，
 * 而 review.progress='marked' 是另一套「想听」标记，且在播放时会被自动改成 listening。
 */
import { reactive } from 'vue'
import {
  addWorksToPlaylist, getDefaultMarkPlaylist, getPlaylistMetadata, removeWorksFromPlaylist,
} from '../api/client'
import { useSession } from './session'

export const favorites = reactive({
  ready: false,
  playlistId: null as number | string | null,
  ids: new Set<number>(),
  /** 每次变更自增，供界面依赖（Set 的增删不一定触发深度监听） */
  rev: 0,
})

let loading: Promise<void> | null = null
let ownerName: string | null = null

/** 账号变了就作废缓存（切号后不能拿上一个人的收藏夹判断） */
export function syncFavoriteOwner() {
  const name = useSession.currentName
  if (name === ownerName) return
  ownerName = name
  favorites.ready = false
  favorites.playlistId = null
  favorites.ids = new Set<number>()
  favorites.rev++
}

export function isFavorite(workId: number | undefined | null): boolean {
  if (!workId) return false
  // 读 rev 是为了让依赖方在增删后重新求值
  void favorites.rev
  return favorites.ids.has(workId)
}

/** 拉取一次默认收藏夹里的作品 id 集合 */
export async function ensureFavorites(force = false): Promise<void> {
  syncFavoriteOwner()
  if (!useSession.loggedIn) {
    favorites.ready = true
    return
  }
  if (!force && favorites.ready) return
  if (!force && loading) return loading

  loading = (async () => {
    try {
      const meta = await getDefaultMarkPlaylist()
      favorites.playlistId = meta.id
      const full = await getPlaylistMetadata(meta.id)
      const ids = new Set<number>()
      for (const w of full.works || []) ids.add(w.id)
      favorites.ids = ids
    } catch {
      // 拿不到就维持"未知"，不打断播放；下次切歌/登录再试
      favorites.ready = false
    } finally {
      favorites.ready = true
      loading = null
      favorites.rev++
    }
  })()
  return loading
}

/** 加入 / 移出默认收藏夹，返回操作后的状态 */
export async function toggleFavorite(workId: number): Promise<boolean> {
  await ensureFavorites()
  const listId = favorites.playlistId
  if (listId == null) throw new Error('没有找到默认收藏夹')

  const had = favorites.ids.has(workId)
  if (had) await removeWorksFromPlaylist(listId, [workId])
  else await addWorksToPlaylist(listId, [workId])

  const next = new Set(favorites.ids)
  if (had) next.delete(workId)
  else next.add(workId)
  favorites.ids = next
  favorites.rev++
  return !had
}
