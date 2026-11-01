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

  // ---- 播放状态（任务栏缩略图按钮 / Windows 媒体面板） ----
  setPlayerState: (state) => ipcRenderer.send('player:state', state),
  smtcState: (state) => ipcRenderer.send('smtc:state', state),
  smtcCoverUrl: (url) => ipcRenderer.send('smtc:cover-url', url),

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
  /** 任务栏字幕（屏幕左下角一行歌词） */
  taskbarLyricsToggle: () => ipcRenderer.invoke('lyrics:taskbar-toggle'),
  /** 显式开关字幕窗：target = desktop | taskbar（两者互斥） */
  lyricsSet: (target, visible) => ipcRenderer.invoke('lyrics:set', target, !!visible),
  lyricsState: () => ipcRenderer.invoke('lyrics:state'),
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
  /** 字幕窗上的播放控制：'toggle' | 'prev' | 'next' | { seekBy } */
  lyricsControl: (action) => ipcRenderer.send('lyrics:control', action),
  /** 从抽屉里点某一首，交给主窗播放 */
  lyricsPlayIndex: (index) => ipcRenderer.send('lyrics:play-index', index),
  /** 播放列表快照（主窗推送 / 字幕窗主动拉取） */
  lyricsQueueUpdate: (queue) => ipcRenderer.send('lyrics:queue-update', queue),
  lyricsQueue: () => ipcRenderer.invoke('lyrics:queue'),
  onLyricsQueue: (cb) => {
    const handler = (_e, q) => cb(q)
    ipcRenderer.on('lyrics:queue', handler)
    return () => ipcRenderer.removeListener('lyrics:queue', handler)
  },
  /** 播放列表小橱窗：独立小窗，贴着汉堡键上方 */
  lyricsPanelToggle: (target) => ipcRenderer.invoke('lyrics:panel-toggle', target),
  lyricsPanelClose: () => ipcRenderer.invoke('lyrics:panel-close'),
  onLyricsPanelState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('lyrics:panel-state', handler)
    return () => ipcRenderer.removeListener('lyrics:panel-state', handler)
  },
  onLyricsPanelTarget: (cb) => {
    const handler = (_e, target) => cb(target)
    ipcRenderer.on('lyrics:panel-target', handler)
    return () => ipcRenderer.removeListener('lyrics:panel-target', handler)
  },
  /** 实时背景取样的来源（桌面流 id + 所在显示器） */
  glassSource: () => ipcRenderer.invoke('glass:source'),
  /** 任务栏字幕的鼠标穿透开关（指针进入时才接收点击） */
  lyricsInteractive: (on) => ipcRenderer.send('lyrics:interactive', !!on),
  /** 主窗接收字幕窗发来的播放指令 */
  onPlayerCommand: (cb) => {
    const handler = (_e, cmd) => cb(cmd)
    ipcRenderer.on('player:command', handler)
    return () => ipcRenderer.removeListener('player:command', handler)
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
