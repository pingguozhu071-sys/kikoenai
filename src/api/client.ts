/**
 * API 客户端 — 按 Kikoeru 服务端的公开 REST 接口实现（JWT Bearer 或 ?token= 两种鉴权）。
 *
 * 网络路径：浏览器 → 同源 /kapi/* → (vite 代理 / 桌面壳转发) → 目标服务器 /api/*
 * 鉴权：JSON 走 Authorization: Bearer；媒体 URL 走 ?token=（服务端 getToken 两者都认）
 */
import type {
  LoginResult, PlaylistMeta, TrackNode, Work, WorksResponse,
} from './types'
import { useSession } from '../stores/session'

export type OrderField =
  | 'release' | 'create_date' | 'dl_count' | 'review_count'
  | 'price' | 'rate_average_2dp' | 'nsfw' | 'id' | 'random'

export const UA = 'Kikoenai <kikoenai>'

/** 桌面壳注入的目标服务器地址（浏览器里为空） */
function desktopApiBase(): string {
  const k = (window as unknown as { kikoeru?: { isDesktop?: boolean; apiBase?: string } }).kikoeru
  if (!k || !k.isDesktop || !k.apiBase) return ''
  return String(k.apiBase).replace(/\/+$/, '')
}

/** 桌面模式下把发往 API 服务器的绝对地址改走本地协议代理，避开跨域 */
function normalizeUrl(u: string): string {
  const base = desktopApiBase()
  if (!base) return u
  if (!u.startsWith(base)) return u
  const rest = u.slice(base.length)
  if (rest.startsWith('/api/')) return '/kapi' + rest.slice(4)
  return u
}

/** 需要用 fetch 读取文本/CDN 资源时的地址（桌面模式统一走代理） */
export function textFetchUrl(u: string): string {
  const base = desktopApiBase()
  if (!base) return u
  const norm = normalizeUrl(u)
  if (norm.startsWith('/')) return norm
  return `/kmedia?u=${encodeURIComponent(norm)}`
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = { 'User-Agent': UA }
  if (json) h['Content-Type'] = 'application/json'
  const token = useSession.token
  if (token) h['authorization'] = `Bearer ${token}`
  return h
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

interface FetchOpts {
  /** 401 时是否触发重新登录（公开接口不该触发） */
  authRequired?: boolean
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: FetchOpts = {},
): Promise<T> {
  const res = await fetch(`/kapi${path}`, { ...init, headers: { ...headers(init.body != null), ...(init.headers ?? {}) } })
  if (res.status === 401 && opts.authRequired) {
    useSession.requireRelogin()
    throw new ApiError(401, '登录已过期，请重新登录')
  }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
  return (await res.json()) as T
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function post<T>(path: string, body: unknown, opts?: FetchOpts): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, opts)
}

// ---------- 认证 ----------

export async function login(name: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch('/kapi/auth/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ name, password }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok && typeof data.token === 'string') return { ok: true, token: data.token }
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      errors: (data.errors as LoginResult['errors']) ?? undefined,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
  }
}

/** 服务端是否开放注册 */
export async function regEnabled(): Promise<boolean> {
  try {
    const r = await request<Record<string, unknown>>('/auth/reg')
    return r.reg === true || r.enabled === true || r.regEnabled === true
  } catch {
    return false
  }
}

/** 注册（部分服务端要求携带本地推荐标识） */
export async function register(name: string, password: string, recommenderUuid: string): Promise<LoginResult> {
  try {
    const res = await fetch('/kapi/auth/reg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ name, password, recommenderUuid }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok && typeof data.token === 'string') return { ok: true, token: data.token }
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      errors: (data.errors as LoginResult['errors']) ?? undefined,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
  }
}

// ---------- 作品 ----------

export function getWorks(
  page: number,
  order: OrderField,
  sort: 'asc' | 'desc',
  pageSize = 60,
): Promise<WorksResponse> {
  return request<WorksResponse>(`/works${qs({ page, order, sort, pageSize, seed: 35, subtitle: 0 })}`)
}

export function searchWorks(
  keyword: string,
  page: number,
  order: OrderField,
  sort: 'asc' | 'desc',
  pageSize = 60,
): Promise<WorksResponse> {
  return request<WorksResponse>(
    `/search/${encodeURIComponent(keyword)}${qs({ page, order, sort, pageSize, seed: 18, subtitle: 0 })}`,
  )
}

/** 首页热门（服务端推荐接口） */
export function postPopular(page = 1, pageSize = 12): Promise<WorksResponse> {
  return post<WorksResponse>('/recommender/popular', {
    keyword: '', page, pageSize, subtitle: 0, localSubtitledWorks: [], withPlaylistStatus: [],
  })
}

/** 个性化推荐（匿名也可用，靠本地持久化的 recommenderUuid 区分） */
export function postRecommendForUser(recommenderUuid: string, page = 1, pageSize = 12): Promise<WorksResponse> {
  return post<WorksResponse>('/recommender/recommend-for-user', {
    keyword: '', recommenderUuid, page, pageSize, subtitle: 0, localSubtitledWorks: [], withPlaylistStatus: [],
  })
}

/** 相似作品（详情页） */
export function postItemNeighbors(itemId: number): Promise<WorksResponse> {
  return post<WorksResponse>('/recommender/item-neighbors', {
    keyword: '', itemId, localSubtitledWorks: [], withPlaylistStatus: [],
  })
}

export function getWork(id: number): Promise<Work> {
  return request<Work>(`/work/${id}`)
}

export type CategoryKind = 'tag' | 'circle' | 'va'

export interface CategoryItem {
  id: string | number
  name: string
  count: number
}

const CATEGORY_PATH: Record<CategoryKind, string> = {
  tag: '/tags/',
  circle: '/circles/',
  va: '/vas/',
}

/** 标签 / 社团 / 声优 全量列表 */
export function getCategories(kind: CategoryKind): Promise<CategoryItem[]> {
  return request<CategoryItem[]>(CATEGORY_PATH[kind])
}

/** 按分类筛作品 */
export function getWorksByCategory(
  kind: CategoryKind,
  id: string | number,
  page = 1,
  order: OrderField = 'release',
  sort: 'asc' | 'desc' = 'desc',
  pageSize = 60,
): Promise<WorksResponse> {
  const seg = kind === 'tag' ? 'tags' : kind === 'circle' ? 'circles' : 'vas'
  return request<WorksResponse>(
    `/${seg}/${encodeURIComponent(String(id))}/works${qs({ page, order, sort, pageSize, seed: 21, subtitle: 0 })}`,
  )
}

export function getTracks(workId: number): Promise<TrackNode[]> {
  const data = request<TrackNode[]>(`/tracks/${workId}?v=2`)
  return data
}

// ---------- 媒体 ----------

/**
 * 封面 URL
 *   sample=true  → 240×180 缩略图（列表用，约 13KB）
 *   sample=false → 560×420 完整封面（详情用）
 * 注意：type=sam 是 100×100 的方形裁剪图，会把封面裁成"只剩头"，不要用于列表。
 */
/** 给地址补 token：已有 query 时用 & 续接，避免拼出 `...?x=1?token=` 这种坏地址 */
function withToken(url: string): string {
  const token = useSession.token
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

export function coverUrl(work: Work | number, sample = true): string {
  if (typeof work !== 'number') {
    const direct = sample
      ? (work.thumbnailCoverUrl || work.mainCoverUrl)
      : (work.mainCoverUrl || work.thumbnailCoverUrl)
    if (direct) return withToken(normalizeUrl(direct))
  }
  const id = typeof work === 'number' ? work : work.id
  return withToken(`/kapi/cover/${id}?type=${sample ? '240x240' : 'main'}`)
}

/** 信任服务端下发的 URL；相对路径补 /kapi 前缀走代理 */
export function resolveMediaUrl(url: string | undefined): string | null {
  if (!url) return null
  const normalized = normalizeUrl(url)
  if (normalized.startsWith('http')) return withToken(normalized)
  return withToken(normalized.replace(/^\/api/, '/kapi'))
}

// ---------- 进度 / 收藏 ----------

export type ProgressValue = 'marked' | 'listening' | 'listened' | 'replay' | 'postponed'

export async function putReview(workId: number, progress: ProgressValue): Promise<void> {
  const name = useSession.userName
  try {
    await fetch('/kapi/review?starOnly=false&progressOnly=true', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ user_name: name, work_id: workId, progress }),
    })
  } catch {
    /* 进度上报失败不影响播放 */
  }
}

export function getReview(
  filter: string | null,
  page: number,
  order: OrderField,
  sort: 'asc' | 'desc',
  pageSize = 60,
): Promise<WorksResponse> {
  const params: Record<string, string | number> = { page: Math.max(1, page), order, sort, pageSize }
  if (filter) params.filter = filter
  return request<WorksResponse>(`/review${qs(params)}`, {}, { authRequired: true })
}

// ---------- 标签投票（需要登录） ----------

/** status: 0 无 / 1 赞成 / 2 反对 */
export function voteWorkTag(workId: number, tagId: number, status: 0 | 1 | 2): Promise<unknown> {
  return post('/vote/vote-work-tag', { workID: workId, tagID: tagId, status }, { authRequired: true })
}

// ---------- 播放列表（需要登录） ----------

export function getDefaultMarkPlaylist(): Promise<PlaylistMeta> {
  return request<PlaylistMeta>('/playlist/get-default-mark-target-playlist', {}, { authRequired: true })
}

export function getPlaylistMetadata(id: number | string): Promise<PlaylistMeta> {
  return request<PlaylistMeta>(`/playlist/get-playlist-metadata${qs({ id })}`, {}, { authRequired: true })
}

export function createPlaylist(name: string, privacy = 'private', works: number[] = []): Promise<PlaylistMeta> {
  return post<PlaylistMeta>('/playlist/create-playlist', {
    name, privacy, locale: 'zh-cn', description: '', works,
  }, { authRequired: true })
}

export function addWorksToPlaylist(playlistId: number | string, works: number[]): Promise<unknown> {
  return post('/playlist/add-works-to-playlist', { playlistId, works }, { authRequired: true })
}

export function removeWorksFromPlaylist(playlistId: number | string, works: number[]): Promise<unknown> {
  return post('/playlist/remove-works-from-playlist', { playlistId, works }, { authRequired: true })
}

/** 我的全部播放列表（不同服务端返回可能是数组或 { playlists }） */
export async function getPlaylists(): Promise<PlaylistMeta[]> {
  const data = await request<PlaylistMeta[] | { playlists?: PlaylistMeta[] }>(
    '/playlist/get-playlists', {}, { authRequired: true },
  )
  if (Array.isArray(data)) return data
  return Array.isArray(data?.playlists) ? data.playlists : []
}

export function deletePlaylist(playlistId: number | string): Promise<unknown> {
  return post('/playlist/delete-playlist', { playlistId }, { authRequired: true })
}
