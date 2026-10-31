/**
 * 从 mp4 的 moov 里读音频 sample entry 的 fourcc，用来解释"有画面没声音"。
 * 只做只读嗅探：拉文件头（不够再拉文件尾），解析 box 树，不解码。
 */

interface Box {
  type: string
  start: number
  end: number
  headerSize: number
}

const ascii = (bytes: Uint8Array, at: number, len: number): string => {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[at + i] ?? 0)
  return s
}

function readBoxes(view: DataView, bytes: Uint8Array, start: number, limit: number): Box[] {
  const out: Box[] = []
  let o = start
  while (o + 8 <= limit) {
    let size = view.getUint32(o)
    const type = ascii(bytes, o + 4, 4)
    let headerSize = 8
    if (size === 1) {
      size = Number(view.getBigUint64(o + 8))
      headerSize = 16
    } else if (size === 0) {
      size = limit - o
    }
    if (size < headerSize || o + size > limit) break
    out.push({ type, start: o, end: o + size, headerSize })
    o += size
  }
  return out
}

function codecFromMoov(view: DataView, bytes: Uint8Array, moov: Box): string | null {
  const moovChildren = readBoxes(view, bytes, moov.start + moov.headerSize, moov.end)
  for (const trak of moovChildren.filter((b) => b.type === 'trak')) {
    const trakChildren = readBoxes(view, bytes, trak.start + trak.headerSize, trak.end)
    const mdia = trakChildren.find((b) => b.type === 'mdia')
    if (!mdia) continue
    const mdiaChildren = readBoxes(view, bytes, mdia.start + mdia.headerSize, mdia.end)
    const hdlr = mdiaChildren.find((b) => b.type === 'hdlr')
    if (!hdlr) continue
    // version+flags(4) + pre_defined(4) + handler_type(4)
    if (ascii(bytes, hdlr.start + hdlr.headerSize + 8, 4) !== 'soun') continue

    const minf = mdiaChildren.find((b) => b.type === 'minf')
    if (!minf) continue
    const minfChildren = readBoxes(view, bytes, minf.start + minf.headerSize, minf.end)
    const stbl = minfChildren.find((b) => b.type === 'stbl')
    if (!stbl) continue
    const stblChildren = readBoxes(view, bytes, stbl.start + stbl.headerSize, stbl.end)
    const stsd = stblChildren.find((b) => b.type === 'stsd')
    if (!stsd) continue

    // version+flags(4) + entry_count(4)，随后每条 entry: size(4) + format(4)
    const count = view.getUint32(stsd.start + stsd.headerSize + 4)
    if (!count) return null
    const entry = stsd.start + stsd.headerSize + 8
    if (entry + 8 > stsd.end) return null
    return ascii(bytes, entry + 4, 4)
  }
  return null
}

function audioCodecIn(buf: ArrayBuffer): string | null {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  const moov = readBoxes(view, bytes, 0, buf.byteLength).find((b) => b.type === 'moov')
  if (moov) {
    const codec = codecFromMoov(view, bytes, moov)
    if (codec) return codec
  }

  // 文件尾切片里 moov 不一定从头开始：扫一遍 'moov' 再按它自己的 size 解析
  for (let i = 4; i + 8 <= buf.byteLength; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x6f || bytes[i + 2] !== 0x6f || bytes[i + 3] !== 0x76) continue
    const start = i - 4
    const size = view.getUint32(start)
    if (size < 8 || start + size > buf.byteLength) continue
    const codec = codecFromMoov(view, bytes, { type: 'moov', start, end: start + size, headerSize: 8 })
    if (codec) return codec
  }
  return null
}

async function range(url: string, spec: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${spec}` } })
    if (!res.ok && res.status !== 206) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

/** 返回音频编码的 fourcc（如 'ac-3' / 'mp4a'），取不到返回 null */
export async function sniffAudioCodec(url: string): Promise<string | null> {
  const head = await range(url, '0-1048575')
  if (head) {
    const codec = audioCodecIn(head)
    if (codec) return codec
  }
  // moov 在文件尾的容器
  const tail = await range(url, '-1048576')
  return tail ? audioCodecIn(tail) : null
}

/** 浏览器内核（Chromium）确定解不了的音轨编码 */
export const UNSUPPORTED_AUDIO = new Set([
  'ac-3', 'ec-3', 'dtsc', 'dtse', 'dtsh', 'dtsl', 'mlpa', 'truehd', 'samr',
])
