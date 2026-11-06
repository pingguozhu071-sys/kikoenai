/** 收藏按钮的共享行为：登录引导、防连点、结果提示。 */
import { computed } from 'vue'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'
import { isFavorite, isFavoriteBusy, toggleFavorite } from '../stores/favorites'

export function useFavorite(workId: () => number | undefined | null) {
  const session = useSession
  const favorite = computed(() => isFavorite(workId()))
  const busy = computed(() => isFavoriteBusy(workId()))

  /** 返回操作后的状态；未登录/正在请求时返回 null */
  async function toggle(): Promise<boolean | null> {
    const id = workId()
    if (!id) return null
    if (!session.loggedIn) {
      ui.openLogin('收藏需要登录')
      return null
    }
    if (isFavoriteBusy(id)) return null
    try {
      const now = await toggleFavorite(id)
      toast(now ? '已加入收藏夹' : '已移出收藏夹', 'success')
      return now
    } catch (e) {
      toast(`收藏失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      return null
    }
  }

  return { favorite, busy, toggle }
}
