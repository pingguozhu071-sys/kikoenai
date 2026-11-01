/**
 * 实时背景：从桌面屏幕流里截取"本窗口所在的那块画面"，模糊后画进 canvas。
 * 这样玻璃效果跟随背后真正的内容（其它应用、桌面），而不是写死的渐变。
 */
import { onMounted, onUnmounted, type Ref } from 'vue'

export type GlassMode = 'classic' | 'frosted' | 'liquid'

interface ScreenSource {
  id: string
  display: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

interface GlassBridge {
  glassSource?: () => Promise<ScreenSource | null>
}

export function useScreenBackdrop(canvas: Ref<HTMLCanvasElement | null>, mode: () => GlassMode) {
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null
  let raf = 0
  let running = false
  let last = 0
  let display: ScreenSource['display'] | null = null
  /** 取样结果坏掉（纯绿/洋红这类色度错帧）时的冷却期 */
  let deadUntil = 0
  let lastCheck = 0
  let lastVisibility = ''

  /** 采样点是不是典型的"色度错帧"：大片纯绿或红绿/洋红杂交 */
  function looksCorrupt(ctx: CanvasRenderingContext2D, cw: number, ch: number): boolean {
    const pts: [number, number][] = [
      [0.2, 0.5], [0.5, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8],
    ]
    let bad = 0
    for (const [fx, fy] of pts) {
      const d = ctx.getImageData(Math.floor(cw * fx), Math.floor(ch * fy), 1, 1).data
      const [r, g, b] = [d[0], d[1], d[2]]
      const green = g > 150 && g > r * 1.7 && g > b * 1.7
      const magenta = r > 150 && b > 150 && g < 90
      if (green || magenta) bad++
    }
    return bad >= 4
  }

  function setCanvasVisible(on: boolean) {
    const c = canvas.value
    if (!c) return
    // 用 visibility 而不是 opacity：opacity 由各样式自己定，不能被内联覆盖
    const v = on ? '' : 'hidden'
    if (lastVisibility === v) return
    lastVisibility = v
    c.style.visibility = v
    // 坏帧期间整窗退回不透明深色，文字仍然看得清
    document.body.classList.toggle('glass-dead', !on)
  }

  function draw(now: number) {
    const c = canvas.value
    const v = video
    if (!c || !v || !display || !v.videoWidth) return
    // 视频是物理像素，窗口坐标是 DIP，用显示器逻辑宽度换算
    const k = v.videoWidth / display.width
    const sx = (window.screenX - display.x) * k
    const sy = (window.screenY - display.y) * k
    const sw = window.outerWidth * k
    const sh = window.outerHeight * k

    const cw = Math.max(64, Math.round(window.outerWidth * 0.5))
    const ch = Math.max(24, Math.round(window.outerHeight * 0.5))
    if (c.width !== cw || c.height !== ch) {
      c.width = cw
      c.height = ch
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    const m = mode()

    // 冷却期内不画：避免把损坏帧（纯绿/色度花屏）铺到桌面上
    if (now < deadUntil) {
      ctx.clearRect(0, 0, cw, ch)
      setCanvasVisible(false)
      return
    }

    ctx.clearRect(0, 0, cw, ch)

    // 往外多画一圈，模糊采样不会在边缘吃到透明，整块保持不透明
    const pad = 24
    const kx = sw / cw
    const ky = sh / ch
    const srcX = sx - pad * kx
    const srcY = sy - pad * ky
    const srcW = sw + pad * 2 * kx
    const srcH = sh + pad * 2 * ky

    // 模糊交给 CSS：视频帧经 2D filter 处理在部分显卡上会出绿帧
    try {
      ctx.drawImage(v, srcX, srcY, srcW, srcH, -pad, -pad, cw + pad * 2, ch + pad * 2)
    } catch {
      return
    }
    if (m === 'liquid') {
      // 液态：再叠一层轻微错位的自身，做出折射般的流动，而不是单纯的光斑动画
      const t = now / 1000
      ctx.globalAlpha = 0.4
      const dx = Math.sin(t * 0.9) * 4 * kx
      const dy = Math.cos(t * 0.7) * 3 * ky
      try {
        ctx.drawImage(v, srcX - dx, srcY - dy, srcW, srcH, -pad, -pad, cw + pad * 2, ch + pad * 2)
      } catch { /* 忽略 */ }
      ctx.globalAlpha = 1
    }

    // 每半秒抽查一次；坏帧就藏掉整层，退回 CSS 底色
    if (now - lastCheck > 500) {
      lastCheck = now
      if (looksCorrupt(ctx, cw, ch)) {
        deadUntil = now + 5000
        ctx.clearRect(0, 0, cw, ch)
        setCanvasVisible(false)
      } else {
        setCanvasVisible(true)
      }
    }
  }

  async function start() {
    const bridge = (window as unknown as { kikoeru?: GlassBridge }).kikoeru
    if (!bridge?.glassSource) return
    const src = await bridge.glassSource()
    if (!src) return
    display = src.display
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-expect-error Chromium 的桌面捕获约束未进标准类型
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: src.id,
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: 15,
          },
        },
      })
    } catch {
      return
    }
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    try { await video.play() } catch { /* 无用户手势时可能失败，下一帧再试 */ }
    running = true
    const loop = (t: number) => {
      if (!running) return
      if (t - last >= 90) {
        last = t
        draw(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    video = null
  }

  onMounted(() => { void start() })
  onUnmounted(stop)

  return { stop }
}
