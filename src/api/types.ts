/** 类型定义 — 对应 Kikoeru 服务端 /api/* 的响应结构 */

export interface Pagination {
  currentPage: number
  pageSize: number
  totalCount: number
}

export interface TagRef {
  id: number
  name: string
  i18n?: Record<string, { name: string }>
}

export interface VaRef {
  id: string
  name: string
}

export interface CircleRef {
  id: number
  name: string
  source_id?: string
}

export interface RankEntry {
  term: 'day' | 'week' | 'month' | string
  category: string
  rank: number
  rank_date: string
}

export interface LanguageEdition {
  lang: string
  label: string
  workno: string
  edition_id: number
  edition_type?: string
}

export interface Work {
  id: number
  /** 社团 / 系列名 */
  name: string
  /** 作品标题 */
  title: string
  circle_id?: number
  circle?: CircleRef
  nsfw?: boolean
  release?: string
  create_date?: string
  dl_count?: number
  price?: number
  review_count?: number
  rate_average_2dp?: number
  rate_count?: number
  /** 总时长（秒） */
  duration?: number
  has_subtitle?: boolean
  samCoverUrl?: string
  mainCoverUrl?: string
  thumbnailCoverUrl?: string
  tags?: TagRef[]
  vas?: VaRef[]
  rank?: RankEntry[]
  age_category_string?: string
  source_type?: string
  language_editions?: LanguageEdition[]
  [k: string]: unknown
}

export interface WorksResponse {
  works: Work[]
  pagination: Pagination
}

export interface TrackNode {
  type: 'folder' | 'audio' | 'text' | 'image'
  title: string
  mediaStreamUrl?: string
  mediaDownloadUrl?: string
  hash?: string
  size?: number
  work?: number
  workTitle?: string
  children?: TrackNode[]
  [k: string]: unknown
}

export interface LoginResult {
  ok: boolean
  token?: string
  error?: string
  errors?: { msg?: string }[]
}

export interface PlaylistMeta {
  id: number | string
  name?: string
  privacy?: string
  description?: string
  works?: Work[]
  workCount?: number
  [k: string]: unknown
}
