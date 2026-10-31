/**
 * 搜索语法解析 —— $ns:value$ / 引号短语 / 排除项。
 *
 * 语法：
 *   $tag:舔耳$           完整过滤词（标签）
 *   $va:陽向葵ゅか$      声优
 *   $circle:HONEY NOIR$ 社团
 *   $-tag:舔耳$          排除
 *   $tag:                未闭合 → 提示补全
 *   "hello world"        引号短语
 *   -hello               纯文本排除
 *
 * 服务端接受 $ns:value$ 形式，原样拼进 /api/search/{keyword} 即可。
 */

export type TermType = 'plain' | 'namespace' | 'partial' | 'special'

export interface SearchTerm {
  raw: string
  type: TermType
  namespace: string
  value: string
  isExclude: boolean
}

export const NAMESPACES = [
  { key: 'tag', label: '标签' },
  { key: 'tagw', label: '弱标签' },
  { key: 'va', label: '声优' },
  { key: 'circle', label: '社团' },
] as const

export function parseSingle(raw: string): SearchTerm {
  const isExclude = raw.startsWith('-')
  const body = isExclude ? raw.slice(1) : raw
  const dollars = (body.match(/\$/g) || []).length

  if (dollars === 2 && body.startsWith('$') && body.endsWith('$') && body.includes(':')) {
    const inner = body.slice(1, -1)
    const idx = inner.indexOf(':')
    return {
      raw, type: 'special',
      namespace: inner.slice(0, idx).trim(),
      value: inner.slice(idx + 1).trim(),
      isExclude,
    }
  }

  if (dollars === 1 && body.startsWith('$') && body.includes(':')) {
    const inner = body.slice(1)
    const idx = inner.indexOf(':')
    return {
      raw, type: 'partial',
      namespace: inner.slice(0, idx).trim(),
      value: inner.slice(idx + 1),
      isExclude,
    }
  }

  if (dollars === 1 && body.startsWith('$') && !body.includes(':')) {
    return { raw, type: 'namespace', namespace: body.slice(1).trim(), value: '', isExclude }
  }

  let v = body.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  return {
    raw, type: 'plain', namespace: '',
    value: v.split('"').join('').split("'").join(''),
    isExclude,
  }
}

interface Range { start: number; end: number; raw: string }

const SPECIAL_RE = /-?\$[^$]*\$?/g
const QUOTED_RE = /-?(["'])(?:(?!\1).)*\1/g
const WORD_RE = /[^\s]+/g

/** 拆成词组：$..$ > 引号短语 > 空格分词（按区间切，避免字符串替换） */
export function parseMulti(input: string): SearchTerm[] {
  const text = input ?? ''
  const taken: Range[] = []
  const overlaps = (s: number, e: number) => taken.some((r) => s < r.end && e > r.start)

  const specials: Range[] = []
  for (const m of text.matchAll(SPECIAL_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    const raw = m[0].trim()
    specials.push({ start, end, raw })
    taken.push({ start, end, raw })
  }

  const quoted: Range[] = []
  for (const m of text.matchAll(QUOTED_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    const raw = m[0].trim()
    quoted.push({ start, end, raw })
    taken.push({ start, end, raw })
  }

  const words: Range[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    words.push({ start, end, raw: m[0] })
  }

  const ordered = [...specials, ...quoted, ...words].sort((a, b) => a.start - b.start)
  return ordered.map((r) => parseSingle(r.raw)).filter((t) => t.raw.length > 0)
}

/** 还原成发给服务端的字符串（丢弃未闭合的补全片段） */
export function termsToKeyword(terms: SearchTerm[]): string {
  const parts: string[] = []
  for (const t of terms) {
    if (t.type === 'namespace' || t.type === 'partial') continue
    if (!t.value) continue
    const v = t.isExclude ? `-${t.value}` : t.value
    parts.push(t.type === 'plain' && /\s/.test(v) ? `"${v}"` : v)
  }
  return parts.join(' ')
}

export function termLabel(t: SearchTerm): string {
  if (t.type === 'special') {
    const ns = NAMESPACES.find((n) => n.key === t.namespace)?.label ?? t.namespace
    return `${t.isExclude ? '排除 ' : ''}${ns}：${t.value}`
  }
  if (t.type === 'plain') return `${t.isExclude ? '排除 ' : ''}${t.value}`
  return t.raw
}
