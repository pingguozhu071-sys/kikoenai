/**
 * 通用作品流 — 分页 + IntersectionObserver 哨兵 + 滚动兜底 + 手动加载。
 * 供 首页 / 热门 / 分类作品 复用。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { Work, WorksResponse } from '../api/types'

export type PageLoader = (page: number, pageSize: number) => Promise<WorksResponse>

export function useWorkFeed(loader: PageLoader, pageSize = 60, auto = true) {
  const works = ref<Work[]>([])
  const page = ref(1)
  const total = ref(0)
  const loading = ref(false)
  const firstLoad = ref(true)
  const error = ref('')

  const hasMore = computed(() => works.value.length < total.value)

  const scroller = ref<HTMLElement | null>(null)
  const sentinel = ref<HTMLElement | null>(null)
  let io: IntersectionObserver | null = null
  let currentLoader: PageLoader = loader

  function maybeLoadMore() {
    if (loading.value || !hasMore.value) return
    page.value++
    void load()
  }

  async function load(reset = false, override?: PageLoader) {
    if (loading.value) return
    if (override) currentLoader = override
    loading.value = true
    error.value = ''
    try {
      if (reset) {
        page.value = 1
        works.value = []
        firstLoad.value = true
      }
      const res = await currentLoader(page.value, pageSize)
      const list = res.works ?? []
      works.value = reset ? list : [...works.value, ...list]
      total.value = res.pagination?.totalCount ?? works.value.length
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
      firstLoad.value = false
      await nextTick()
      attach()
    }
  }

  function attach() {
    io?.disconnect()
    if (!sentinel.value || !scroller.value || typeof IntersectionObserver === 'undefined') return
    io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) maybeLoadMore() },
      { root: scroller.value, rootMargin: '700px 0px' },
    )
    io.observe(sentinel.value)
  }

  function onScroll() {
    const el = scroller.value
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) maybeLoadMore()
  }

  /** 切换数据源（排序/分类变化）时调用 */
  function reload(nextLoader?: PageLoader) {
    return load(true, nextLoader)
  }

  /** 清空结果但不发请求（搜索页重置用） */
  function reset() {
    io?.disconnect()
    io = null
    works.value = []
    total.value = 0
    error.value = ''
    firstLoad.value = false
    loading.value = false
  }

  onMounted(() => { if (auto) void load(true) })
  onUnmounted(() => io?.disconnect())

  return {
    works, total, loading, firstLoad, error, hasMore,
    scroller, sentinel, onScroll, load, maybeLoadMore, reload, reset,
  }
}
