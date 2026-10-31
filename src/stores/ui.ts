/** 全局 UI 状态：登录弹窗、正在播放页、侧栏折叠等 */
import { reactive } from 'vue'

export const ui = reactive({
  loginOpen: false,
  loginMode: 'login' as 'login' | 'register',
  loginReason: '',

  /** 图片 / 文档查看器 */
  viewer: {
    open: false,
    kind: 'image' as 'image' | 'text' | 'external',
    url: '',
    title: '',
    text: '',
    /** 同目录图片列表：支持左右翻页；空数组表示单张 */
    images: [] as { url: string; title: string }[],
    index: 0,
  },
  openViewer(p: {
    kind: 'image' | 'text' | 'external'
    url?: string
    title?: string
    text?: string
    images?: { url: string; title: string }[]
    index?: number
  }) {
    const images = p.images ?? []
    const index = Math.max(0, Math.min(p.index ?? 0, Math.max(0, images.length - 1)))
    this.viewer = {
      open: true,
      kind: p.kind,
      url: p.url ?? images[index]?.url ?? '',
      title: p.title ?? images[index]?.title ?? '',
      text: p.text ?? '',
      images,
      index,
    }
  },
  closeViewer() {
    this.viewer = { ...this.viewer, open: false }
  },

  /** 正在播放页（从底部升起）是否展开 */
  nowPlaying: false,
  nowPlayingTab: 'lyrics' as 'lyrics' | 'queue',

  /** 视频窗口：固定尺寸的独立浮层，只能由用户主动切全屏 */
  videoOpen: false,
  openVideo() {
    this.videoOpen = true
  },
  closeVideo() {
    this.videoOpen = false
  },
  toggleVideo() {
    this.videoOpen = !this.videoOpen
  },

  openLogin(reason = '', mode: 'login' | 'register' = 'login') {
    this.loginReason = reason
    this.loginMode = mode
    this.loginOpen = true
  },
  closeLogin() {
    this.loginOpen = false
  },

  openNowPlaying() {
    this.nowPlaying = true
  },
  closeNowPlaying() {
    this.nowPlaying = false
  },
  toggleNowPlaying() {
    this.nowPlaying = !this.nowPlaying
  },
})
