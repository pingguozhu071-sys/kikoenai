/**
 * 任务栏缩略图按钮图标 —— 纯 Node 生成，不需要 Electron。
 * 输出 electron/thumbar/{play,pause,prev,next}.png (16px) 与 *@2x.png (32px)。
 * 白色图形 + 透明背景，Windows 会按系统主题自动着色。
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

// ---------------------------------------------------------------- PNG 编码

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
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
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

// ---------------------------------------------------------------- 形状

/** 点是否在三角形内（逆时针/顺时针都行） */
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

/** 归一化坐标（0..1）判断 */
function inside(kind, x, y) {
  switch (kind) {
    case 'play':
      return inTriangle(x, y, 0.32, 0.20, 0.32, 0.80, 0.78, 0.50)
    case 'pause':
      return inRect(x, y, 0.30, 0.22, 0.43, 0.78) || inRect(x, y, 0.57, 0.22, 0.70, 0.78)
    case 'prev':
      return inRect(x, y, 0.26, 0.22, 0.36, 0.78)
        || inTriangle(x, y, 0.76, 0.20, 0.76, 0.80, 0.38, 0.50)
    case 'next':
      return inRect(x, y, 0.64, 0.22, 0.74, 0.78)
        || inTriangle(x, y, 0.24, 0.20, 0.24, 0.80, 0.62, 0.50)
    default:
      return false
  }
}

/** 4×4 超采样，边缘平滑 */
function render(kind, size) {
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 4
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          if (inside(kind, x, y)) hits++
        }
      }
      const a = Math.round((hits / (SS * SS)) * 255)
      const i = (py * size + px) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = a
    }
  }
  return encodePng(rgba, size)
}

const outDir = path.join(__dirname, '..', 'electron', 'thumbar')
fs.mkdirSync(outDir, { recursive: true })

for (const kind of ['play', 'pause', 'prev', 'next']) {
  fs.writeFileSync(path.join(outDir, `${kind}.png`), render(kind, 16))
  fs.writeFileSync(path.join(outDir, `${kind}@2x.png`), render(kind, 32))
}

console.log('已生成任务栏缩略图图标 →', outDir)
