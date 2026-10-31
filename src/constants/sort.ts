/** 排序选项。
 *  说明：部分服务端没有 rating 列，按评分排序会返回空列表，故未提供。 */
import type { OrderField } from '../api/client'

export interface SortOption {
  key: string
  label: string
  order: OrderField
  sort: 'asc' | 'desc'
}

export const SORT_OPTIONS: SortOption[] = [
  { key: 'new', label: '最新收录', order: 'create_date', sort: 'desc' },
  { key: 'release_desc', label: '发售日 新→旧', order: 'release', sort: 'desc' },
  { key: 'release_asc', label: '发售日 旧→新', order: 'release', sort: 'asc' },
  { key: 'dl', label: '售出数最多', order: 'dl_count', sort: 'desc' },
  { key: 'rate', label: '平均评分最高', order: 'rate_average_2dp', sort: 'desc' },
  { key: 'review', label: '评论数最多', order: 'review_count', sort: 'desc' },
  { key: 'price_asc', label: '价格 低→高', order: 'price', sort: 'asc' },
  { key: 'price_desc', label: '价格 高→低', order: 'price', sort: 'desc' },
  { key: 'id_desc', label: 'ID 降序', order: 'id', sort: 'desc' },
  { key: 'id_asc', label: 'ID 升序', order: 'id', sort: 'asc' },
  { key: 'sfw', label: '仅全年龄', order: 'nsfw', sort: 'asc' },
  { key: 'random', label: '随机', order: 'random', sort: 'desc' },
]

export const DEFAULT_SORT = SORT_OPTIONS[1]
