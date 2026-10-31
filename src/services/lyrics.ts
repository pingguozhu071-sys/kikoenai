/**
 * 字幕/歌词 —— 解析与智能匹配。
 *
 * 点播放就自动挂字幕，不需要手动选。
 * 支持 LRC / SRT / ASS / VTT / 无时间轴 TXT。
 */
import type { TrackNode } from '../api/types'
import type { LrcLine } from '../stores/player'

// ---------------------------------------------------------------- 编码

/**
 * 字幕文件常见编码：UTF-8 / Shift-JIS（日文台本）/ GBK（中文）/ Big5。
 * 服务端有时不带 charset，直接按 UTF-8 解就会变成一堆方块。
 */
export function decodeText(buffer: ArrayBuffer, contentType = ''): string {
  const m = contentType.match(/charset=([\w-]+)/i)
  const declared = m ? m[1].toLowerCase() : ''

  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try { return new TextDecoder(declared).decode(buffer) } catch { /* 继续尝试 */ }
  }

  // 先试严格 UTF-8
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch { /* 不是 UTF-8 */ }

  for (const enc of ['shift_jis', 'gbk', 'big5', 'euc-kr']) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(buffer)
      if (text) return text
    } catch { /* 换下一个 */ }
  }
  return new TextDecoder('utf-8').decode(buffer)
}

// ---------------------------------------------------------------- 解析

function toSeconds(stamp: string): number {
  // 00:01:02.500 / 00:01:02,500 / 0:01:02.5
  const clean = stamp.replace(',', '.').trim()
  const parts = clean.split(':').map((x) => parseFloat(x))
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}

const LRC_TIME = /\[(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g
const SRT_TIME = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/
const ASS_TIME = /Dialogue:\s*[^,]*,\s*([\d:.]+)\s*,\s*([\d:.]+)\s*,([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/
const VTT_TIME = /^\s*(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)/

/** 去掉 ASS 样式标签 {\i1} 之类与 HTML 标签 */
function stripMarkup(s: string): string {
  return s
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/g, ' ')
    .replace(/\\n/g, ' ')
    .trim()
}

export function parseSubtitle(text: string, ext: string): LrcLine[] {
  const e = ext.toLowerCase()
  const src = text.replace(/^\uFEFF/, '')

  if (e === '.srt') {
    const lines: LrcLine[] = []
    for (const block of src.split(/\r?\n\r?\n/)) {
      const m = block.match(SRT_TIME)
      if (!m) continue
      const body = block
        .split(/\r?\n/)
        .filter((l) => l.trim() && !SRT_TIME.test(l) && !/^\d+$/.test(l.trim()))
        .map(stripMarkup)
        .join(' ')
        .trim()
      if (body) lines.push({ time: toSeconds(m[1]), text: body })
    }
    return lines.sort((a, b) => a.time - b.time)
  }

  if (e === '.ass' || e === '.ssa') {
    const lines: LrcLine[] = []
    for (const raw of src.split(/\r?\n/)) {
      const m = raw.match(ASS_TIME)
      if (!m) continue
      const body = stripMarkup(m[8] || '')
      if (body) lines.push({ time: toSeconds(m[1]), text: body })
    }
    return lines.sort((a, b) => a.time - b.time)
  }

  if (e === '.vtt') {
    const lines: LrcLine[] = []
    for (const raw of src.split(/\r?\n/)) {
      const m = raw.match(VTT_TIME)
      if (!m) continue
      const body = stripMarkup(raw.replace(VTT_TIME, ''))
      if (body) lines.push({ time: toSeconds(m[1]), text: body })
    }
    return lines.sort((a, b) => a.time - b.time)
  }

  // 默认按 LRC 解析
  const lines: LrcLine[] = []
  for (const raw of src.split(/\r?\n/)) {
    const stamps: number[] = []
    for (const m of raw.matchAll(LRC_TIME)) stamps.push(toSeconds(m[1]))
    const body = stripMarkup(raw.replace(LRC_TIME, ''))
    if (stamps.length && body) {
      for (const t of stamps) lines.push({ time: t, text: body })
    }
  }
  if (lines.length) return lines.sort((a, b) => a.time - b.time)

  // 没有时间轴：退化成"整段文本，按行等分"，至少能看
  const plain = src.split(/\r?\n/).map((l) => stripMarkup(l)).filter(Boolean)
  return plain.map((text) => ({ time: -1, text }))
}

// ---------------------------------------------------------------- 匹配

const TEXT_EXT = /\.(lrc|srt|ass|ssa|vtt|txt)$/i
const TIMED_EXT = /\.(lrc|srt|ass|ssa|vtt)$/i

/** 作品简介 / 说明文档：绝不能当字幕 */
export function isReadmeLike(title: string): boolean {
  const t = baseName(title).trim()
  return /^(read\s*me|readme|はじめに|お読み|ご一読|説明|せつめい|介绍|介紹|说明|說明|info|information|instructions?|track\s*list|トラックリスト|収録|收錄|目录|目次)/i.test(t)
}

/** 是否自带时间轴（这类才允许"同下标/唯一文件"兜底） */
export function isTimedFormat(title: string): boolean {
  return TIMED_EXT.test(title)
}

export function isSubtitleNode(n: TrackNode): boolean {
  return n.type === 'text' && TEXT_EXT.test(n.title)
}

function baseName(title: string): string {
  return title.replace(/\.[^.]+$/, '')
}

/** 归一化：去标点/空格/下划线，全角转半角，小写 */
function normalize(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.\s（）()【】\[\]「」~～・、,，]/g, '')
    .toLowerCase()
}

/** 提取开头的轨号，如 01 / track02 / 第3 */
function trackNo(s: string): string {
  const m = s.match(/(?:^|[^0-9])(\d{1,3})(?:[^0-9]|$)/)
  return m ? String(parseInt(m[1], 10)) : ''
}

/** 去掉左右/両耳 之类的声道后缀，便于跨命名匹配 */
function stripChannel(s: string): string {
  return s.replace(/([_\-\s]?(右|左|両|两|both|l|r|left|right))$/i, '')
}

export interface MatchResult {
  node: TrackNode
  score: number
}

/**
 * 给某条音频挑最合适的字幕文件（只在传入的这批字幕里挑）：
 *  100 完全同名 → 80 去声道/归一化同名 → 60 同轨号
 *
 * 这里**没有**"同下标"和"唯一字幕文件"兜底：那些猜测会把特典/闹铃音频
 * 硬绑到正片字幕上。调用方负责先把范围缩到同一个文件夹。
 */
export function matchSubtitle(audioTitle: string, subs: TrackNode[]): MatchResult | null {
  if (!subs.length) return null
  const base = baseName(audioTitle)
  const normBase = normalize(stripChannel(base))
  const no = trackNo(base)

  let best: MatchResult | null = null
  const consider = (node: TrackNode, score: number) => {
    if (!best || score > best.score) best = { node, score }
  }

  for (const s of subs) {
    if (isReadmeLike(s.title)) continue
    const sBase = baseName(s.title)
    if (sBase === base) { consider(s, 100); continue }

    const sNorm = normalize(stripChannel(sBase))
    if (sNorm && sNorm === normBase) { consider(s, 80); continue }

    if (no && trackNo(sBase) === no) consider(s, 60)
  }
  return best
}

/** 同一层（同一个文件夹）里的字幕；不做递归，避免串到别的文件夹 */
export function collectSubtitlesShallow(nodes: TrackNode[]): TrackNode[] {
  return nodes.filter((n) => isSubtitleNode(n) && !isReadmeLike(n.title))
}

/**
 * 跨文件夹兜底：只接受"全树唯一一个同名文件"。
 * 不做轨号、下标、"唯一字幕"这类猜测 —— 那些正是串台的来源。
 */
export function matchSubtitleGlobal(audioTitle: string, subs: TrackNode[]): MatchResult | null {
  const base = baseName(audioTitle)
  const norm = normalize(stripChannel(base))

  const sameName = subs.filter((s) => baseName(s.title) === base)
  if (sameName.length === 1) return { node: sameName[0], score: 100 }

  const sameNorm = subs.filter((s) => {
    const n = normalize(stripChannel(baseName(s.title)))
    return !!n && n === norm
  })
  if (sameNorm.length === 1) return { node: sameNorm[0], score: 80 }
  return null
}

/** 收集树中所有字幕文件（保持顺序） */
export function collectSubtitles(nodes: TrackNode[]): TrackNode[] {
  const out: TrackNode[] = []
  const walk = (list: TrackNode[]) => {
    for (const n of list) {
      if (n.type === 'folder' && n.children) walk(n.children)
      else if (isSubtitleNode(n) && !isReadmeLike(n.title)) out.push(n)
    }
  }
  walk(nodes)
  return out
}

export function subtitleFormat(title: string): string {
  const m = title.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}
