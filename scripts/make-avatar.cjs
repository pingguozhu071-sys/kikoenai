/**
 * 生成侧栏头像（CommonJS，Electron 主进程运行）：
 *   裁剪头部方形 → 缩放到 160 → 从四边泛滥填充去白底 → 输出带透明的 PNG
 */
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const SRC = path.join(root, 'assets', 'icon-source.png')
const OUT = path.join(root, 'src', 'assets', 'avatar.png')
const CROP = { x: 120, y: 520, width: 640, height: 640 }
const SIZE = 160

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(SRC)
  if (img.isEmpty()) { console.error('读不到源图:', SRC); app.exit(1); return }

  const { width: W, height: H } = img.getSize()
  const crop = {
    x: Math.max(0, Math.min(W - CROP.width, CROP.x)),
    y: Math.max(0, Math.min(H - CROP.height, CROP.y)),
    width: Math.min(CROP.width, W),
    height: Math.min(CROP.height, H),
  }
  const resized = img.crop(crop).resize({ width: SIZE, height: SIZE, quality: 'best' })
  const bmp = Buffer.from(resized.toBitmap()) // BGRA

  // 四边泛滥填充：只清除与边缘连通的近白像素（衣服上的白色不会被误伤）
  const TH = 232
  const isWhite = (p) => {
    const i = p * 4
    return bmp[i] > TH && bmp[i + 1] > TH && bmp[i + 2] > TH
  }
  const mask = new Uint8Array(SIZE * SIZE)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const p = y * SIZE + x
    if (mask[p] || !isWhite(p)) return
    mask[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < SIZE; x++) { push(x, 0); push(x, SIZE - 1) }
  for (let y = 0; y < SIZE; y++) { push(0, y); push(SIZE - 1, y) }
  while (stack.length) {
    const p = stack.pop()
    const x = p % SIZE
    const y = (p - x) / SIZE
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }

  const out = Buffer.alloc(SIZE * SIZE * 4)
  let cleared = 0
  for (let p = 0; p < SIZE * SIZE; p++) {
    const i = p * 4
    out[i] = bmp[i + 2]
    out[i + 1] = bmp[i + 1]
    out[i + 2] = bmp[i]
    out[i + 3] = mask[p] ? 0 : 255
    if (mask[p]) cleared++
  }

  // 裁成圆角方形（半径 18%），避免侧栏里出现白角
  const R = Math.round(SIZE * 0.18)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.min(x, SIZE - 1 - x)
      const cy = Math.min(y, SIZE - 1 - y)
      if (cx < R && cy < R) {
        const d = Math.hypot(R - cx, R - cy)
        if (d > R) out[(y * SIZE + x) * 4 + 3] = 0
      }
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, encodePng(out, SIZE))
  console.log('头像已生成:', OUT, `${SIZE}x${SIZE}`, '去白像素', cleared, '文件', fs.statSync(OUT).size + 'B')
  app.exit(0)
})
