/**
 * 预加载脚本 — 只暴露最小面：目标服务器地址、窗口控制、媒体键回调。
 * contextIsolation 打开，渲染进程拿不到 Node。
 */
const { contextBridge, ipcRenderer } = require('electron')

const apiBase = process.env.KIKOERU_TARGET || 'https://api.asmr.one'

contextBridge.exposeInMainWorld('kikoeru', {
  isDesktop: true,
  apiBase,
  getConfig: () => ipcRenderer.invoke('kikoeru:config'),

  // ---- 关闭窗口行为：收进托盘 / 直接退出 ----
  getCloseToTray: () => ipcRenderer.invoke('app:closeToTray'),
  setCloseToTray: (on) => ipcRenderer.invoke('app:setCloseToTray', !!on),

  // ---- 服务器 / 代理 / 日志 ----
  getServerConfig: () => ipcRenderer.invoke('config:getServer'),
  setServer: (url) => ipcRenderer.invoke('config:setServer', url),
  setProxy: (patch) => ipcRenderer.invoke('config:setProxy', patch),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  openLogDir: () => ipcRenderer.invoke('logs:openDir'),

  // ---- 本地已下载文件 ----
  resolveLocal: (opts) => ipcRenderer.invoke('local:resolve', opts),

  // ---- 播放状态（任务栏缩略图按钮） ----
  setPlayerState: (state) => ipcRenderer.send('player:state', state),

  // ---- 窗口控制（无边框窗口） ----
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  /** 视频全屏期间把 Esc 交给渲染层处理（退出视频全屏，而不是先退窗口） */
  setVideoMode: (on) => ipcRenderer.send('window:video-mode', !!on),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  },

  onResizing: (cb) => {
    const handler = (_e, on) => cb(on)
    ipcRenderer.on('window:resizing', handler)
    return () => ipcRenderer.removeListener('window:resizing', handler)
  },

  // ---- 全局媒体键 ----
  onMediaKey: (cb) => {
    const handler = (_e, action) => cb(action)
    ipcRenderer.on('media-key', handler)
    return () => ipcRenderer.removeListener('media-key', handler)
  },

  // ---- 桌面歌词 ----
  lyricsToggle: () => ipcRenderer.invoke('lyrics:toggle'),
  lyricsUpdate: (payload) => ipcRenderer.send('lyrics:update', payload),
  lyricsRequest: () => ipcRenderer.invoke('lyrics:request'),
  lyricsClose: () => ipcRenderer.invoke('lyrics:close'),
  lyricsOpenMain: () => ipcRenderer.invoke('lyrics:open-main'),
  lyricsNextDisplay: () => ipcRenderer.invoke('lyrics:next-display'),
  onLyricsData: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('lyrics:data', handler)
    return () => ipcRenderer.removeListener('lyrics:data', handler)
  },

  // ---- 下载 ----
  downloadStart: (opts) => ipcRenderer.invoke('download:start', opts),
  downloadCancel: (id) => ipcRenderer.invoke('download:cancel', id),
  downloadPause: (id) => ipcRenderer.invoke('download:pause', id),
  downloadResume: (id) => ipcRenderer.invoke('download:resume', id),
  getDownloadSettings: () => ipcRenderer.invoke('download:settings'),
  listDownloads: () => ipcRenderer.invoke('download:list'),
  setDownloadSettings: (patch) => ipcRenderer.invoke('download:setSettings', patch),
  pickDownloadDir: () => ipcRenderer.invoke('download:pickDir'),
  openInFolder: (target) => ipcRenderer.invoke('download:openFolder', target),
  onDownloadEvent: (cb) => {
    const channels = ['download:progress', 'download:done', 'download:error', 'download:canceled', 'download:paused']
    const handlers = channels.map((ch) => {
      const h = (_e, payload) => cb(ch.replace('download:', ''), payload)
      ipcRenderer.on(ch, h)
      return [ch, h]
    })
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h))
  },
})
