/**
 * 图标生成 —— 满幅方形（铺满，不留白边）+ 圆角。
 *
 * 说明：整张 1193×1800 的竖图直接塞进方框会缩得极小、白边巨大，不适合当图标；
 * 这里取「头部 + 上半身」的方形区域铺满画布（内容实测占比 0.81），再切圆角。
 *
 * 以 Electron 运行：
 *   node_modules\.bin\electron scripts\make-icon.cjs
 */
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const SRC = path.join(root, 'assets', 'icon-source.png')
const OUT_DIR = path.join(root, 'build')
const SIZES = [256, 128, 64, 48, 32, 16]

/** 裁剪区域（原图坐标）：头部 + 上半身，内容占比最高 */
const CROP = { x: 120, y: 520, width: 640, height: 640 }
/** 圆角半径（相对边长的比例），Windows 11 风格 */
const CORNER_RATIO = 0.18

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

// ---------------------------------------------------------------- 合成

function roundedSquare(img, size, radius) {
  const bmp = img.toBitmap() // BGRA
  const rgba = Buffer.alloc(size * size * 4)
  const r = radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角遮罩：角上做 1px 抗锯齿
      let alpha = 255
      const cx = Math.min(x, size - 1 - x)
      const cy = Math.min(y, size - 1 - y)
      if (cx < r && cy < r) {
        const d = Math.hypot(r - cx, r - cy)
        alpha = d <= r ? 255 : Math.max(0, Math.round((1 - (d - r)) * 255))
      }
      const s = (y * size + x) * 4
      const d4 = (y * size + x) * 4
      rgba[d4] = bmp[s + 2]
      rgba[d4 + 1] = bmp[s + 1]
      rgba[d4 + 2] = bmp[s]
      rgba[d4 + 3] = alpha
    }
  }
  return rgba
}

function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count

  entries.forEach((e, i) => {
    const p = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, p + 1)
    dir.writeUInt8(0, p + 2)
    dir.writeUInt8(0, p + 3)
    dir.writeUInt16LE(1, p + 4)
    dir.writeUInt16LE(32, p + 6)
    dir.writeUInt32LE(e.png.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ---------------------------------------------------------------- 主流程

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(SRC)
  if (source.isEmpty()) {
    console.error('无法读取源图:', SRC)
    app.exit(1)
    return
  }

  const { width: W, height: H } = source.getSize()
  const crop = {
    x: Math.max(0, Math.min(W - CROP.width, CROP.x)),
    y: Math.max(0, Math.min(H - CROP.height, CROP.y)),
    width: Math.min(CROP.width, W),
    height: Math.min(CROP.height, H),
  }
  console.log('源图:', `${W}x${H}`, '→ 满幅裁剪:', crop)
  const cropped = source.crop(crop)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const entries = []
  for (const size of SIZES) {
    const resized = cropped.resize({ width: size, height: size, quality: 'best' })
    const radius = Math.round(size * CORNER_RATIO)
    const rgba = roundedSquare(resized, size, radius)
    const png = encodePng(rgba, size)
    entries.push({ size, png })
    if (size === 256) fs.writeFileSync(path.join(OUT_DIR, 'icon-256.png'), png)
    if (size === 32) fs.writeFileSync(path.join(OUT_DIR, 'icon-32.png'), png)
  }

  const ico = buildIco(entries)
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico)
  console.log('已生成 build/icon.ico', `${(ico.length / 1024).toFixed(1)}KB`, `(${SIZES.join('/')})`)

  fs.copyFileSync(path.join(OUT_DIR, 'icon-256.png'), path.join(root, 'electron', 'icon.png'))
  fs.copyFileSync(path.join(OUT_DIR, 'icon-32.png'), path.join(root, 'electron', 'tray.png'))
  fs.copyFileSync(path.join(OUT_DIR, 'icon.ico'), path.join(root, 'electron', 'icon.ico'))
  console.log('已更新 electron/icon.png / tray.png / icon.ico')

  app.exit(0)
})
