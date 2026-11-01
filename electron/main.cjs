/**
 * Electron 主进程 —— Kikoenai 桌面版
 *
 * 启动形态：一个可执行文件 + 同目录 app 资源，双击即用：
 *   Kikoenai.exe
 *   resources/app/{package.json, electron/, dist/}
 *
 * 关键点：
 *  - 自定义协议 app://kikoeru/ 提供前端静态资源（同源，避开 file:// 的限制）
 *  - app://kikoeru/kapi/* 在进程内转发到真实服务器（绕开 CORS，可带上游代理）
 *  - 托盘常驻、单实例、全局媒体键
 */
const {
  app, BrowserWindow, protocol, net, session, Tray, Menu, globalShortcut,
  ipcMain, nativeImage, shell, dialog, screen,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { execFileSync, spawn } = require('node:child_process')
/**
 * Electron 把 fs 打成 asar-aware 的：复制 .asar 文件时会把档案当成目录，
 * 报 "ENOENT, not found in xxx.asar"。安装器必须用未打补丁的 fs。
 */
const originalFs = require('original-fs')
const {
  BlockedUrlError, validateRemoteUrl, fetchGuarded, sanitizeFileName, isInsideRoot,
} = require('./guard.cjs')
const { resolveLocalFile } = require('./file-match.cjs')
const { buildRangeHeader, planResume } = require('./resume.cjs')

/**
 * 改名后沿用旧的数据目录：账号、收藏缓存、下载设置、歌词绑定都还在，
 * 不需要因为换了名字重新登录。
 */
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'KikoeruPC'))
} catch { /* 极端情况下忽略，退回默认目录 */ }

function logDir() {
  try { return path.join(app.getPath('userData'), 'logs') } catch { return '' }
}

function localDayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let logDay = ''
let logFile = ''

/**
 * 安全日志：GUI 启动时没有控制台，stdout 管道关闭，
 * 直接 console.log 会抛 EPIPE 并弹出"main process 未捕获异常"。
 * 同时落一份到 userData/logs/YYYY-MM-DD.log，出问题时还能查。
 */
function safeLog(...args) {
  let text = ''
  try {
    text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  } catch {
    text = String(args[0] ?? '')
  }

  try {
    process.stdout.write(text + '\n')
  } catch {
    /* 没有可写的 stdout：忽略 */
  }

  try {
    const dir = logDir()
    if (!dir) return
    const day = localDayKey()
    if (day !== logDay) {
      fs.mkdirSync(dir, { recursive: true })
      logDay = day
      logFile = path.join(dir, `${day}.log`)
    }
    const stamp = new Date().toTimeString().slice(0, 8)
    fs.appendFileSync(logFile, `[${stamp}] ${text}\n`)
  } catch {
    /* 磁盘不可写：只保留 stdout 行为 */
  }
}

const isDev = process.argv.includes('--dev')
/** 安装向导 / 卸载模式：不启动主界面 */
const INSTALL_MODE = process.argv.includes('--install')
const UNINSTALL_MODE = process.argv.includes('--uninstall')
const DEV_URL = 'http://localhost:5173'
const DIST = path.join(__dirname, '..', 'dist')

/** 只接受 http/https；允许局域网地址（自建服务器） */
function normalizeServerUrl(raw) {
  try {
    const u = new URL(String(raw).trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/** 启动配置只读一次：环境变量 > config.json > 公共站 */
const STARTUP_CONFIG = readConfig()
const API_TARGET = normalizeServerUrl(process.env.KIKOERU_TARGET)
  || normalizeServerUrl(STARTUP_CONFIG.serverUrl)
  || 'https://api.asmr.one'
/** 上游代理：显式指定则不再自动探测 */
const UPSTREAM_PROXY = process.env.KIKOERU_PROXY || ''
/** 用户在设置里选的代理模式：auto / system / direct / rules */
const PROXY_MODE = ['auto', 'system', 'direct', 'rules'].includes(STARTUP_CONFIG.proxyMode)
  ? STARTUP_CONFIG.proxyMode
  : 'auto'
const PROXY_RULES = typeof STARTUP_CONFIG.proxyRules === 'string' ? STARTUP_CONFIG.proxyRules : ''
/** 常见本地代理端口（Clash / v2rayN / V2RayNG …） */
const PROXY_CANDIDATES = [7897, 7890, 7891, 10809, 10808, 2080, 20171, 1080]

/** 运行时实际使用的代理，供 UI 展示 */
let activeProxy = ''

process.env.KIKOERU_TARGET = API_TARGET

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
])

let mainWindow = null
let lyricWin = null
let lastLyricsPayload = null
let lyricDisplayId = null
let broadcastWindowState = null
let tray = null
let quitting = false
/** 视频全屏由渲染层接管（含 Esc 的语义），主进程的"Esc 退全屏"要暂时让路 */
let videoFullscreenMode = false
/** 渲染层推送的播放状态，用于任务栏缩略图按钮 */
let playerState = { playing: false, title: '' }

// ---------------------------------------------------------------- 代理选择

function configPath() {
  try { return path.join(app.getPath('userData'), 'config.json') } catch { return '' }
}

function readSavedProxy() {
  const cfg = readConfig()
  return typeof cfg.proxy === 'string' ? cfg.proxy : ''
}

function saveProxy(proxy) {
  patchConfig({ proxy })
}

// ---------------------------------------------------------------- 配置读写

function readConfig() {
  try {
    const p = configPath()
    if (!p || !fs.existsSync(p)) return {}
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {}
  } catch {
    return {}
  }
}

function patchConfig(patch) {
  try {
    const p = configPath()
    if (!p) return {}
    const next = { ...readConfig(), ...patch, savedAt: Date.now() }
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(next, null, 2))
    return next
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------- 安装 / 卸载

/** 便携目录本身就是要安装的源（exe 所在目录） */
function installerSourceDir() {
  return path.dirname(process.execPath)
}

function defaultInstallDir() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(base, 'Programs', 'Kikoenai')
}

/** 递归列出文件，跳过目标目录（避免把自己复制进自己） */
function listFilesForInstall(srcDir, skipDir, out = []) {
  for (const entry of originalFs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name)
    if (skipDir && (full === skipDir || full.startsWith(skipDir + path.sep))) continue
    if (entry.isDirectory()) listFilesForInstall(full, skipDir, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function createShortcut(lnkPath, target, workDir) {
  try {
    shell.writeShortcutLink(lnkPath, 'create', {
      target,
      cwd: workDir,
      icon: target,
      iconIndex: 0,
      description: 'Kikoenai — ASMR 桌面客户端',
    })
    return true
  } catch {
    return false
  }
}

function registerUninstallEntry(installDir) {
  try {
    const exe = path.join(installDir, 'Kikoenai.exe')
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Kikoenai'
    // reg add 一次只能写一个值，必须逐条写
    const values = [
      ['DisplayName', 'REG_SZ', 'Kikoenai'],
      ['DisplayVersion', 'REG_SZ', app.getVersion()],
      ['Publisher', 'REG_SZ', 'Kikoenai'],
      ['InstallLocation', 'REG_SZ', installDir],
      ['DisplayIcon', 'REG_SZ', exe],
      ['UninstallString', 'REG_SZ', `"${exe}" --uninstall`],
      ['NoModify', 'REG_DWORD', '1'],
      ['NoRepair', 'REG_DWORD', '1'],
    ]
    execFileSync('reg', ['add', key, '/f'], { stdio: 'ignore' })
    for (const [name, type, data] of values) {
      execFileSync('reg', ['add', key, '/v', name, '/t', type, '/d', data, '/f'], { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

function createInstallerWindow() {
  const win = new BrowserWindow({
    width: 780,
    height: 580,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#141218',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'installer-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, 'installer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  // 安装器关掉窗口就退出整个进程（主程序的托盘逻辑不参与）
  win.on('closed', () => app.exit(0))

  const sourceDir = installerSourceDir()

  ipcMain.handle('installer:info', () => ({
    version: app.getVersion(),
    defaultDir: defaultInstallDir(),
    sourceDir,
  }))

  ipcMain.handle('installer:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择安装位置',
      defaultPath: defaultInstallDir(),
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle('installer:minimize', () => win.minimize())
  ipcMain.handle('installer:close', () => win.close())

  ipcMain.handle('installer:install', async (_e, opts) => {
    const target = path.resolve(String(opts?.dir || defaultInstallDir()))
    const source = path.resolve(sourceDir)

    if (target === source) {
      return { ok: false, error: '安装位置不能是当前运行目录，请换一个目录' }
    }
    if (target.toLowerCase().startsWith(source.toLowerCase() + path.sep)) {
      return { ok: false, error: '安装位置不能放在安装包内部' }
    }

    try {
      const files = listFilesForInstall(source, target)
      let done = 0
      for (const file of files) {
        const rel = path.relative(source, file)
        const dest = path.join(target, rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        try {
          originalFs.copyFileSync(file, dest)
        } catch (first) {
          // 杀软/资源管理器偶尔会短暂占用刚写出的文件，重试一次
          await new Promise((r) => setTimeout(r, 250))
          try {
            originalFs.copyFileSync(file, dest)
          } catch (e2) {
            const code = e2 && e2.code ? e2.code : ''
            throw new Error(
              `${rel}（${code || 'ERR'}）`
              + (code === 'EBUSY' || code === 'EPERM' ? '文件被占用，请先退出正在运行的 Kikoenai' : (e2 && e2.message) || ''),
            )
          }
        }
        done++
        if (done % 12 === 0 || done === files.length) {
          win.webContents.send('installer:progress', {
            done, total: files.length, name: rel,
          })
        }
      }

      const exe = path.join(target, 'Kikoenai.exe')
      if (opts?.desktopShortcut !== false) {
        createShortcut(path.join(app.getPath('desktop'), 'Kikoenai.lnk'), exe, target)
      }
      createShortcut(
        path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Kikoenai.lnk'),
        exe, target,
      )
      registerUninstallEntry(target)

      return { ok: true, target, files: files.length }
    } catch (e) {
      return {
        ok: false,
        error: `复制失败：${e && e.code ? e.code : ''} ${e && e.syscall ? e.syscall : ''} ${e && e.path ? e.path : ''} — ${e && e.message ? e.message : String(e)}（如果 Kikoenai 正在运行，请先退出）`,
      }
    }
  })

  ipcMain.handle('installer:finish', (_e, opts) => {
    const target = String(opts?.dir || '')
    if (opts?.launch && target) {
      try {
        spawn(path.join(target, 'Kikoenai.exe'), [], { detached: true, stdio: 'ignore' }).unref()
      } catch { /* 忽略 */ }
    }
    win.close()
    return true
  })
}

/** 卸载：只删程序目录与快捷方式，作品与账号数据保留 */
function runUninstall() {
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['取消', '卸载'],
    defaultId: 0,
    cancelId: 0,
    title: '卸载 Kikoenai',
    message: '确定要卸载 Kikoenai 吗？',
    detail: '只会删除程序文件、快捷方式与卸载项。\n已下载的作品、账号与设置都会保留。',
  })
  if (choice !== 1) {
    app.exit(0)
    return
  }

  const dir = path.dirname(process.execPath)
  const exeName = path.basename(process.execPath)
  const bat = path.join(app.getPath('temp'), 'kikoenai-uninstall.bat')
  const lines = [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    `taskkill /IM "${exeName}" /F >nul 2>&1`,
    'timeout /t 1 /nobreak >nul',
    'del "%USERPROFILE%\\Desktop\\Kikoenai.lnk" >nul 2>&1',
    'del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Kikoenai.lnk" >nul 2>&1',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Kikoenai" /f >nul 2>&1',
    'cd /d "%TEMP%"',
    `rmdir /s /q "${dir}"`,
    'del "%~f0"',
  ]
  try {
    fs.writeFileSync(bat, lines.join('\r\n'), 'utf8')
    spawn('cmd.exe', ['/c', 'start', '', bat], { detached: true, stdio: 'ignore' }).unref()
  } catch { /* 忽略 */ }
  app.exit(0)
}

// ---------------------------------------------------------------- 下载

/** 关闭窗口时收进托盘（默认），还是直接退出 */
function closeToTray() {
  return readConfig().closeToTray !== false
}

/** 用户自配服务器的主机：允许它是私有地址（自建服务器通常在局域网） */
function apiHosts() {
  try { return [new URL(API_TARGET).hostname] } catch { return [] }
}

/** 同名文件自动加 (n) */
function uniquePath(target) {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  for (let i = 1; i < 999; i++) {
    const p = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(p)) return p
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`)
}

function downloadSettings() {
  const cfg = readConfig()
  const dl = cfg.download || {}
  return {
    dir: typeof dl.dir === 'string' && dl.dir ? dl.dir : '',
    autoClassify: dl.autoClassify !== false,
    concurrency: Math.min(5, Math.max(1, Math.floor(Number(dl.concurrency)) || 3)),
  }
}

/** 下载根目录：用户设定优先，否则系统"下载" */
function downloadRoot() {
  return downloadSettings().dir || app.getPath('downloads')
}

const activeDownloads = new Map() // id -> { abort }
const downloadQueue = [] // 还没拿到并发槽位的任务
let pumpScheduled = false

// ---------------------------------------------------------------- 任务持久化

/** 任务记录与 config.json 分开存：下载进度写得很频繁，不能和配置互相覆盖 */
function downloadsPath() {
  try { return path.join(app.getPath('userData'), 'downloads.json') } catch { return '' }
}

let downloadRecords = []
let persistTimer = null

function readDownloadRecords() {
  try {
    const p = downloadsPath()
    if (!p || !fs.existsSync(p)) return []
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(data) ? data.filter((t) => t && typeof t === 'object') : []
  } catch {
    return []
  }
}

function writeDownloadRecords() {
  try {
    const p = downloadsPath()
    if (!p) return
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(downloadRecords.slice(0, 500), null, 2))
  } catch { /* 写不了就只在内存里维护 */ }
}

function persistSoon(delay = 1000) {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeDownloadRecords()
  }, delay)
}

function flushDownloads() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeDownloadRecords()
}

function upsertRecord(patch) {
  const i = downloadRecords.findIndex((t) => t.id === patch.id)
  if (i >= 0) downloadRecords[i] = { ...downloadRecords[i], ...patch, updatedAt: Date.now() }
  else downloadRecords.unshift({ ...patch, createdAt: Date.now(), updatedAt: Date.now() })
}

function dropRecord(id) {
  downloadRecords = downloadRecords.filter((t) => t.id !== id)
}

function sendDownload(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/** 并发闸门：有空位就按配置启动排队任务（真正的限流在主进程，渲染层只管入队） */
function pumpDownloads() {
  if (pumpScheduled) return
  pumpScheduled = true
  queueMicrotask(() => {
    pumpScheduled = false
    const limit = downloadSettings().concurrency
    while (activeDownloads.size < limit && downloadQueue.length) {
      void runDownload(downloadQueue.shift())
    }
  })
}

/** 启动时把未完成的任务重新排队；文件已有大小就按续传处理 */
function bootDownloads() {
  downloadRecords = readDownloadRecords()
  let resumed = 0
  for (const rec of downloadRecords) {
    if (rec.state !== 'running' && rec.state !== 'queued') continue
    if (!rec.url || !rec.targetPath || !rec.fileName) continue
    if (!validateRemoteUrl(rec.url, { allowHosts: apiHosts() })) continue

    let received = Number(rec.received) || 0
    let total = Number(rec.total) || 0
    try {
      const size = fs.statSync(rec.targetPath).size
      if (size > 0) received = size
    } catch {
      received = 0
    }
    if (total > 0 && received >= total) {
      upsertRecord({ id: rec.id, state: 'done', received, total })
      continue
    }

    const abort = new AbortController()
    downloadQueue.push({
      id: rec.id,
      url: rec.url,
      workId: rec.workId,
      workTitle: rec.workTitle || '',
      fileName: rec.fileName,
      targetDir: rec.targetDir || '',
      targetPath: rec.targetPath,
      received,
      total,
      etag: rec.etag || '',
      abort,
      resumed: received > 0,
    })
    upsertRecord({ id: rec.id, state: 'queued', received, total })
    resumed++
  }
  if (resumed) {
    safeLog('[download] 恢复未完成任务', resumed)
    flushDownloads()
    pumpDownloads()
  }
}

async function startDownload(opts) {
  const { url, workId, workTitle, fileName } = opts || {}
  const safeUrl = validateRemoteUrl(url, { allowHosts: apiHosts() })
  if (!safeUrl) throw new Error('下载地址不被允许（仅接受公网 http/https）')

  const safeWorkId = Number.isInteger(workId) && workId > 0 ? workId : null
  const settings = downloadSettings()
  const baseDir = settings.dir || app.getPath('downloads')
  const targetDir = settings.autoClassify && safeWorkId ? path.join(baseDir, `RJ${safeWorkId}`) : baseDir
  fs.mkdirSync(targetDir, { recursive: true })

  const safeName = sanitizeFileName(fileName || `RJ${safeWorkId || 'work'}.audio`)
  const targetPath = uniquePath(path.join(targetDir, safeName))
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const abort = new AbortController()

  const task = {
    id, url: safeUrl, workId: safeWorkId, workTitle, fileName: safeName,
    targetDir, targetPath, received: 0, total: 0, etag: '', abort, resumed: false,
  }
  downloadQueue.push(task)
  // targetPath 一旦分配就落盘，恢复时绝不重算（否则会变成 "名字 (1).mp3"）
  upsertRecord({ ...task, abort: undefined, state: 'queued' })
  persistSoon(0)
  pumpDownloads()
  return { id, targetDir, targetPath, queued: true }
}

/** 真正下载一个任务：支持 Range 续传；pipeline 统一处理背压、写错误与取消 */
async function runDownload(task) {
  const { id, url, targetPath, workTitle, fileName, abort } = task
  activeDownloads.set(id, {
    abort,
    pause: () => { task.pauseRequested = true; abort.abort() },
  })
  task.state = 'running'
  upsertRecord({ id, state: 'running', received: task.received, total: task.total })
  persistSoon(0)

  try {
    const doFetch = (useRange) => {
      const range = useRange ? buildRangeHeader(task.received) : null
      return net.fetch(url, {
        signal: abort.signal,
        headers: {
          'User-Agent': 'Kikoenai <kikoenai>',
          ...(range ? { Range: range } : {}),
        },
      })
    }

    let res = await doFetch(true)
    let etag = res.headers.get('etag') || ''
    if (task.etag && etag && task.etag !== etag) {
      // 远端文件变了，续传会拼出坏文件：从头重下
      task.received = 0
    }

    let plan = planResume({
      status: res.status,
      received: task.received,
      total: Number(res.headers.get('content-length') || 0),
      contentRange: res.headers.get('content-range') || '',
    })
    // 416 + 本地不足：服务端不认这段 Range，清空后按普通请求重来一次
    if (res.status === 416 && plan.mode === 'restart') {
      task.received = 0
      try { fs.truncateSync(targetPath, 0) } catch { /* 文件还不存在 */ }
      try { await res.body?.cancel() } catch { /* 忽略 */ }
      res = await doFetch(false)
      etag = res.headers.get('etag') || ''
      plan = planResume({
        status: res.status,
        received: 0,
        total: Number(res.headers.get('content-length') || 0),
        contentRange: res.headers.get('content-range') || '',
      })
    }
    if (plan.mode === 'done') {
      const doneSize = plan.total || task.received
      upsertRecord({ id, state: 'done', received: doneSize, total: doneSize })
      persistSoon(0)
      sendDownload('download:done', { id, path: targetPath, received: doneSize, workTitle, fileName })
      return
    }
    if (plan.mode === 'restart') {
      task.received = 0
      try { fs.truncateSync(targetPath, 0) } catch { /* 文件还不存在 */ }
    }
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    if (plan.total) task.total = plan.total
    if (etag) task.etag = etag

    let lastTick = 0
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        task.received += chunk.length
        const now = Date.now()
        if (now - lastTick > 300) {
          lastTick = now
          sendDownload('download:progress', {
            id, received: task.received, total: task.total, workTitle, fileName,
            resumed: task.resumed,
          })
          persistSoon()
        }
        cb(null, chunk)
      },
    })

    // 注意：不要退回手写 write + 等 drain —— 写错误时 drain 永不到来，任务会永远卡在进行中
    const append = task.received > 0
    const out = fs.createWriteStream(targetPath, { flags: append ? 'a' : 'w' })
    await pipeline(Readable.fromWeb(res.body), counter, out, { signal: abort.signal })

    upsertRecord({ id, state: 'done', received: task.received, total: task.total || task.received })
    persistSoon(0)
    sendDownload('download:progress', {
      id, received: task.received, total: task.total, workTitle, fileName,
    })
    sendDownload('download:done', { id, path: targetPath, received: task.received, workTitle, fileName })
  } catch (e) {
    const aborted = abort.signal.aborted
    if (aborted && task.pauseRequested) {
      // 暂停：保留已下字节，等用户点继续
      upsertRecord({ id, state: 'paused', received: task.received, total: task.total })
      persistSoon(0)
      sendDownload('download:paused', {
        id, received: task.received, total: task.total, workTitle, fileName,
      })
    } else if (aborted) {
      // 用户主动取消：文件与记录一起删
      await fs.promises.rm(targetPath, { force: true, maxRetries: 3, retryDelay: 60 }).catch(() => {})
      dropRecord(id)
      persistSoon(0)
      sendDownload('download:canceled', { id, workTitle, fileName })
    } else {
      // 失败（网络/磁盘）：保留已下字节，重启后可以续传
      upsertRecord({ id, state: 'error', received: task.received, total: task.total })
      persistSoon(0)
      sendDownload('download:error', {
        id, workTitle, fileName, message: e && e.message ? e.message : String(e),
      })
    }
  } finally {
    activeDownloads.delete(id)
    pumpDownloads()
  }
}


/**
 * 切换代理。
 * Chromium 会沿用旧的连接池与 DNS 缓存，切换后必须主动清理，
 * 否则下一次探测仍按旧配置走（表现为"明明代理可用却探测失败"）。
 */
async function applyProxy(cfg) {
  // 只设置一次，不主动断连：频繁切换代理会让 Chromium 的 network service 崩溃
  await session.defaultSession.setProxy(cfg)
}

/** TCP 探测本机端口是否有服务监听（代理软件） */
function portOpen(port, timeoutMs = 350) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* 忽略 */ }
      resolve(v)
    }
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 用默认会话做一次健康检查（仅在已设好代理后调用） */
async function healthOk(timeoutMs = 3000) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await net.fetch(API_TARGET + '/api/health', { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

/** 代理规则只接受 http(s)://host:port 或 PROXY/SOCKS 前缀，避免把整串乱码塞给 Chromium */
function normalizeProxyRules(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^(https?|socks[45]?):\/\/[^\s]+$/i.test(s)) return s
  return ''
}

/**
 * 选择上游代理（只设置一次主会话，避免 network service 崩溃）：
 *   1) 环境变量
 *   2) 设置里的显式模式
 *   3) 上次成功过的配置
 *   4) 扫描常见本地代理端口（TCP）
 *   5) 系统代理 → 直连
 */
async function setupProxy() {
  const setOnce = async (cfg, label) => {
    await session.defaultSession.setProxy(cfg)
    activeProxy = label
  }

  if (UPSTREAM_PROXY) { await setOnce({ proxyRules: UPSTREAM_PROXY }, UPSTREAM_PROXY); return }

  // 用户在设置里显式选了模式，就按它来（自动探测不再覆盖）
  if (PROXY_MODE === 'direct') {
    await setOnce({ mode: 'direct' }, 'direct')
    return
  }
  if (PROXY_MODE === 'system') {
    await setOnce({ mode: 'system' }, 'system')
    return
  }
  if (PROXY_MODE === 'rules' && normalizeProxyRules(PROXY_RULES)) {
    const rule = normalizeProxyRules(PROXY_RULES)
    await setOnce({ proxyRules: rule }, rule)
    safeLog('[proxy] 使用自定义规则', rule)
    return
  }

  // 1) 缓存过的配置
  const saved = readSavedProxy()
  if (saved && saved !== 'direct') {
    await setOnce(saved === 'system' ? { mode: 'system' } : { proxyRules: saved }, saved)
    if (await healthOk()) return
  }

  // 2) 扫端口（本机 Clash/v2ray 常见端口）
  for (const port of PROXY_CANDIDATES) {
    if (!(await portOpen(port))) continue
    const rule = 'http://127.0.0.1:' + port
    await setOnce({ proxyRules: rule }, rule)
    if (await healthOk()) {
      saveProxy(rule)
      safeLog('[proxy] 使用本地代理', rule)
      return
    }
  }

  // 3) 系统代理
  await setOnce({ mode: 'system' }, 'system')
  if (await healthOk()) { saveProxy('system'); return }

  // 4) 直连
  await setOnce({ mode: 'direct' }, 'direct')
  safeLog('[proxy] 未找到可用代理，直连可能无法访问', API_TARGET)
}

// ---------------------------------------------------------------- API 代理

const HOP_BY_HOP = new Set([
  'host', 'connection', 'origin', 'referer', 'accept-encoding',
  'content-length', 'transfer-encoding', 'keep-alive', 'upgrade',
])

function forwardHeaders(req) {
  const headers = {}
  for (const [k, v] of req.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
  }
  return headers
}

const jsonError = (message, status) =>
  new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  })

async function proxyApi(req, url) {
  const suffix = url.pathname.slice('/kapi'.length)
  const targetUrl = `${API_TARGET}/api${suffix}${url.search}`
  // 双保险：URL 规范化已经挡掉 ../，这里再断言一次目标确实落在 /api/ 下
  if (!suffix.startsWith('/') || !targetUrl.startsWith(`${API_TARGET}/api/`)) {
    return jsonError('bad path', 400)
  }
  return forward(req, targetUrl)
}

/**
 * 通用转发 — 供文本类资源（歌词等）使用：
 *   /kmedia?u=<绝对 URL>
 * 这样从 app:// 发起的 fetch 不会撞到第三方站点的 CORS 白名单。
 * 地址必须过 validateRemoteUrl：服务端可以下发任意字符串，不能让它当跳板打内网。
 */
async function proxyMedia(req, url) {
  const raw = url.searchParams.get('u') || ''
  try {
    return await fetchGuarded(raw, { method: 'GET', headers: forwardHeaders(req) }, {
      fetch: (u, init) => net.fetch(u, init),
      allowHosts: apiHosts(),
    })
  } catch (e) {
    return jsonError(e.message, e instanceof BlockedUrlError ? 403 : 502)
  }
}

async function forward(req, targetUrl) {
  const init = { method: req.method, headers: forwardHeaders(req) }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // 请求体很小（JSON），直接缓冲，避免流式 duplex 的兼容问题
    const buf = await req.arrayBuffer()
    if (buf.byteLength > 0) init.body = Buffer.from(buf)
  }

  try {
    // net.fetch 走 Chromium 网络栈：自动使用 session 代理、支持 Range 与大文件流式返回。
    // 重定向逐跳校验：保留服务端 302 到静态目录的能力，但不允许跳到环回/私有地址
    return await fetchGuarded(targetUrl, init, {
      fetch: (u, i) => net.fetch(u, i),
      allowHosts: apiHosts(),
    })
  } catch (e) {
    return jsonError(
      `代理请求失败: ${e && e.message ? e.message : e}`,
      e instanceof BlockedUrlError ? 403 : 502,
    )
  }
}

// ---------------------------------------------------------------- 静态资源

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.ssa': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
}

/** 本地播放允许的根：用户设定的下载目录 + 系统下载目录 */
function localRoots() {
  const roots = [downloadRoot()]
  try { roots.push(app.getPath('downloads')) } catch { /* 忽略 */ }
  return roots
}

function realOrRaw(p) {
  try { return fs.realpathSync(p) } catch { return '' }
}

/**
 * 本地文件：app://kikoeru/local?p=<encoded abs path>
 * 只允许下载根目录内的文件；必须支持 Range，否则本地大文件拖进度会失效。
 */
async function serveLocal(req, url) {
  let file = ''
  try {
    file = path.resolve(decodeURIComponent(url.searchParams.get('p') || ''))
  } catch {
    return new Response('bad path', { status: 400 })
  }
  if (!file) return new Response('bad path', { status: 400 })

  const real = realOrRaw(file)
  if (!real) return new Response('not found', { status: 404 })
  const roots = localRoots().map((r) => realOrRaw(r) || path.resolve(r))
  if (!roots.some((root) => isInsideRoot(root, real))) {
    return new Response('forbidden', { status: 403 })
  }

  let stat
  try { stat = fs.statSync(real) } catch { return new Response('not found', { status: 404 }) }
  if (!stat.isFile()) return new Response('forbidden', { status: 403 })

  const type = MIME[path.extname(real).toLowerCase()] || 'application/octet-stream'
  const total = stat.size
  const range = req.headers.get('range') || ''
  const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())

  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? total - Number(m[2]) : Number(m[1])
    let end = m[1] === '' || m[2] === '' ? total - 1 : Number(m[2])
    start = Math.max(0, Math.min(start, total - 1))
    end = Math.max(start, Math.min(end, total - 1))
    if (total === 0 || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      })
    }
    const body = req.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(real, { start, end }))
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const body = req.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(real))
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
    },
  })
}

/** 只给 HTML 加 CSP：脚本/连接限定同源，媒体与图片允许服务端直给的 https 地址 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function withCsp(res, isHtml) {
  if (!isHtml) return res
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', CSP)
  return new Response(res.body, { status: res.status, headers })
}

async function serveStatic(url) {
  let p
  try {
    p = decodeURIComponent(url.pathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (p === '/' || p === '') p = '/index.html'

  const file = path.normalize(path.join(DIST, p))
  // 用相对路径判断边界：前缀匹配会被同级目录（dist2 / dist-backup）骗过
  if (!isInsideRoot(DIST, file)) return new Response('forbidden', { status: 403 })

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  try {
    const res = await net.fetch(pathToFileURL(file).toString())
    return withCsp(
      new Response(res.body, { status: 200, headers: { 'Content-Type': type } }),
      type.startsWith('text/html'),
    )
  } catch {
    // SPA 回退
    try {
      const res = await net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString())
      return withCsp(
        new Response(res.body, { status: 200, headers: { 'Content-Type': MIME['.html'] } }),
        true,
      )
    } catch {
      return new Response('前端资源缺失，请先执行 npm run build', { status: 500 })
    }
  }
}

// ---------------------------------------------------------------- 窗口动画

let savedBounds = null
let boundsTimer = null

/** 五次缓出：起步快、收尾极缓，全屏拉伸更有"惯性" */
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5)

/** 逐帧改窗口尺寸，让进/出全屏表现为自然放大缩小，而不是瞬间闪 */
function animateBounds(from, to, ms = 260) {
  return new Promise((resolve) => {
    const start = Date.now()
    // 跟随显示器刷新率（60/120/144Hz），固定 16ms 在 120Hz 屏上会显得卡
    let frameMs = 16
    try {
      const disp = screen.getDisplayMatching({ x: from.x, y: from.y, width: from.width, height: from.height })
      const hz = disp.displayFrequency || 60
      frameMs = Math.max(4, Math.round(1000 / hz))
    } catch { /* 保底 60Hz */ }
    if (boundsTimer) clearInterval(boundsTimer)
    boundsTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearInterval(boundsTimer)
        boundsTimer = null
        resolve()
        return
      }
      const t = Math.min(1, (Date.now() - start) / ms)
      const e = easeOutQuint(t)
      mainWindow.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.round(from.width + (to.width - from.width) * e),
        height: Math.round(from.height + (to.height - from.height) * e),
      })
      if (t >= 1) {
        clearInterval(boundsTimer)
        boundsTimer = null
        resolve()
      }
    }, frameMs)
  })
}

async function toggleFullscreenSmooth() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const win = mainWindow
  const disp = screen.getDisplayMatching(win.getBounds())

  if (win.isFullScreen()) {
    win.setFullScreen(false)
    await new Promise((r) => setTimeout(r, 80))
    if (win.isDestroyed()) return
    const target = savedBounds || {
      x: disp.workArea.x + 80,
      y: disp.workArea.y + 80,
      width: Math.round(disp.workArea.width * 0.8),
      height: Math.round(disp.workArea.height * 0.8),
    }
    win.setBounds(disp.bounds)
    await animateBounds(disp.bounds, target, 280)
  } else {
    savedBounds = win.getBounds()
    await animateBounds(savedBounds, disp.bounds, 280)
    if (!win.isDestroyed()) win.setFullScreen(true)
  }
  // 主动校准：事件推送可能滞后或顺序错乱，这里在动画结束后再报两次真实状态
  setTimeout(() => broadcastWindowState && broadcastWindowState(), 120)
  setTimeout(() => broadcastWindowState && broadcastWindowState(), 700)
}

// ---------------------------------------------------------------- 窗口

/**
 * 桌面歌词窗：无边框透明、置顶、不进任务栏，底部居中。
 * 与主窗同步通过 IPC 推送当前歌词行（只在换行时推，避免高频）。
 */
function createLyricWindow() {
  if (lyricWin && !lyricWin.isDestroyed()) {
    lyricWin.show()
    return lyricWin
  }

  // 优先上次使用的显示器，其次鼠标所在显示器（多屏时更符合直觉）
  const displays = screen.getAllDisplays()
  const savedDisp = lyricDisplayId != null ? displays.find((d) => d.id === lyricDisplayId) : null
  const cursorDisp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const disp = savedDisp || cursorDisp || screen.getPrimaryDisplay()
  lyricDisplayId = disp.id
  const width = Math.min(1000, Math.round(disp.workArea.width * 0.7))
  const height = 150
  const x = Math.round(disp.workArea.x + (disp.workArea.width - width) / 2)
  const y = Math.round(disp.workArea.y + disp.workArea.height - height - 40)

  lyricWin = new BrowserWindow({
    width, height, x, y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  lyricWin.setAlwaysOnTop(true, 'screen-saver')
  lyricWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (isDev) lyricWin.loadURL(DEV_URL + '#/desktop-lyrics')
  else lyricWin.loadURL('app://kikoeru/index.html#/desktop-lyrics')

  lyricWin.webContents.once('did-finish-load', () => {
    if (lastLyricsPayload && lyricWin && !lyricWin.isDestroyed()) {
      lyricWin.webContents.send('lyrics:data', lastLyricsPayload)
    }
  })
  lyricWin.on('closed', () => { lyricWin = null })
  patchConfig({ lyricDisplayId })
  return lyricWin
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#1c1b1e',
    show: false,
    // 无边框：去掉标题栏与最大化时的系统描边，窗口按钮由界面自绘
    frame: false,
    roundedCorners: true,
    hasShadow: true,
    autoHideMenuBar: true,
    title: 'Kikoenai',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // 把窗口状态推给渲染进程，用于切换最大化/全屏图标
  const pushState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    broadcastWindowState = pushState
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    })
  }
  mainWindow.on('maximize', pushState)
  mainWindow.on('unmaximize', pushState)
  // 拖动缩放时通知界面降级特效（blur/transition 会造成撕裂与黑边）
  let resizeTimer = null
  const pushResizing = (on) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:resizing', on)
  }
  mainWindow.on('resize', () => {
    pushResizing(true)
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => pushResizing(false), 180)
  })
  mainWindow.on('focus', pushState)
  mainWindow.on('enter-full-screen', pushState)
  mainWindow.on('leave-full-screen', pushState)

  // F11 全屏 / Esc 退出全屏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      event.preventDefault()
      void toggleFullscreenSmooth()
    } else if (input.key === 'Escape' && mainWindow.isFullScreen() && !videoFullscreenMode) {
      // 视频全屏时 Esc 归渲染层管：它要一次性退出视频和窗口，别在这里抢先退窗口
      event.preventDefault()
      void toggleFullscreenSmooth()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    refreshThumbar()
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  // 自检只在未打包的运行里执行（npm run app / app:dev）；正式包内这些分支一律不跑
  if (!app.isPackaged) {
  // 自检：图片 / 文档查看器
  if (process.argv.includes('--selfcheck-viewer')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)
        await js("location.hash = '#/work/1699648'")
        await delay(3200)

        // 双击封面
        await js("document.querySelector('.detail-cover')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
        await delay(900)
        const cover = await js(`(() => {
          const card = document.querySelector('.viewer-card')
          const img = document.querySelector('.viewer-img')
          return {
            open: !!card,
            kind: card ? card.className : null,
            fullscreen: !!document.fullscreenElement,
            cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
            winW: window.innerWidth,
            imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
            imgSize: img ? [img.naturalWidth, img.naturalHeight] : null,
          }
        })()`)
        safeLog('VIEWER_IMAGE ' + JSON.stringify(cover))

        // Esc 关闭
        await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        await delay(500)
        safeLog('VIEWER_CLOSE ' + JSON.stringify(await js("({ closed: !document.querySelector('.viewer-card') })")))

        // 双击音轨树里的文档
        await js(`(() => {
          const rows = Array.from(document.querySelectorAll('.tree-track'))
          const doc = rows.find((r) => /\.(txt|lrc|srt|ass)/i.test(r.textContent || ''))
          if (doc) doc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          return !!doc
        })()`)
        await delay(1600)
        const doc = await js(`(() => {
          const card = document.querySelector('.viewer-card')
          const text = document.querySelector('.viewer-text')
          return {
            open: !!card,
            kind: card ? card.className : null,
            chars: text ? text.textContent.length : 0,
            head: text ? text.textContent.trim().slice(0, 20) : null,
            fullscreen: !!document.fullscreenElement,
          }
        })()`)
        safeLog('VIEWER_TEXT ' + JSON.stringify(doc))
      } catch (e) {
        safeLog('VIEWER_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：搜索框焦点环是否随点击空白消失
  if (process.argv.includes('--selfcheck-focus')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)
        safeLog('FOCUS_SET ' + JSON.stringify(await js(`(() => {
          const i = document.querySelector('.search-input')
          if (!i) return { err: 'no input' }
          i.focus()
          return { hasFocus: i === document.activeElement }
        })()`)))

        await js(`(() => {
          const host = document.querySelector('.page-scroll') || document.body
          const r = host.getBoundingClientRect()
          const x = r.left + r.width - 40
          const y = r.top + 40
          const el = document.elementFromPoint(x, y) || host
          const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }
          el.dispatchEvent(new PointerEvent('pointerdown', opts))
          el.dispatchEvent(new MouseEvent('click', opts))
          return el.tagName
        })()`)
        await delay(400)

        safeLog('FOCUS_PROBE ' + JSON.stringify(await js('window.__blurProbe ?? null')))
        safeLog('FOCUS_AFTER ' + JSON.stringify(await js(`(() => {
          const i = document.querySelector('.search-input')
          return {
            active: document.activeElement ? document.activeElement.tagName : null,
            stillFocused: i ? i === document.activeElement : null,
            outline: i ? getComputedStyle(i).outlineStyle : null,
            shadow: i ? getComputedStyle(i).boxShadow.slice(0, 30) : null,
          }
        })()`)))
      } catch (e) {
        safeLog('FOCUS_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：专业播放条（分区/模式/队列）+ 加入播放列表
  if (process.argv.includes('--selfcheck-bar')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)
        await js("location.hash = '#/work/1699648'")
        await delay(3200)
        await js("Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '播放全部')?.click()")
        await delay(2600)

        const bar = await js(`(() => {
          const q = (sel) => !!document.querySelector(sel)
          const modeBtn = Array.from(document.querySelectorAll('.pb-right .icon-btn')).find((b) => (b.title || '').includes('播放') || (b.title || '').includes('循环') || (b.title || '').includes('随机'))
          return {
            left: q('.pb-left'), transport: q('.pb-transport'), progress: q('.pb-progress'), right: q('.pb-right'),
            like: !!Array.from(document.querySelectorAll('.pb-right .icon-btn')).find((b) => b.title === '收藏'),
            mode: modeBtn ? modeBtn.title : null,
            lyricBtn: !!Array.from(document.querySelectorAll('.pb-right .icon-btn')).find((b) => b.title === '桌面歌词'),
          }
        })()`)
        safeLog('BAR ' + JSON.stringify(bar))

        // 播放队列
        await js("Array.from(document.querySelectorAll('.pb-right .icon-btn')).find((b) => (b.title || '').includes('播放队列'))?.click()")
        await delay(500)
        const queue = await js("({ open: !!document.querySelector('.pb-queue'), items: document.querySelectorAll('.pb-queue-item').length })")
        safeLog('BAR_QUEUE ' + JSON.stringify(queue))

        // 更多菜单
        await js("Array.from(document.querySelectorAll('.pb-right .icon-btn')).find((b) => b.title === '更多')?.click()")
        await delay(500)
        const more = await js("({ open: !!document.querySelector('.pb-more'), items: document.querySelectorAll('.pb-more .menu-item').length })")
        safeLog('BAR_MORE ' + JSON.stringify(more))
        await js("document.querySelector('.pb-more') && document.body.click()")
        await delay(300)

        // 正在播放页的歌词偏移控件
        await js("document.querySelector('.pb-info')?.click()")
        await delay(900)
        await js("Array.from(document.querySelectorAll('.np-tab')).find((t) => t.textContent.includes('歌词'))?.click()")
        await delay(400)
        const off = await js("({ buttons: document.querySelectorAll('.np-off-btn').length, value: document.querySelector('.np-off-val')?.textContent?.trim() ?? null })")
        safeLog('BAR_OFFSET ' + JSON.stringify(off))
        await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        await delay(600)

        // 详情页加入播放列表
        await js("location.hash = '#/work/1699648'")
        await delay(2200)
        await js("Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '加入播放列表')?.click()")
        await delay(700)
        const pl = await js("({ open: !!document.querySelector('.pl-dialog'), work: document.querySelector('.pl-work')?.textContent?.trim().slice(0, 20) ?? null })")
        safeLog('BAR_PLAYLIST ' + JSON.stringify(pl))
      } catch (e) {
        safeLog('BAR_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：字幕自动绑定 + 点歌词跳转 + 桌面歌词窗
  if (process.argv.includes('--selfcheck-lyrics')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)
        await js("location.hash = '#/work/1699648'")
        await delay(3200)
        await js("Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '播放全部')?.click()")
        await delay(4500)

        const bound = await js("(() => ({ lines: document.querySelectorAll('.lrc-line').length, first: document.querySelector('.lrc-line')?.textContent?.trim().slice(0, 24) ?? null, title: document.querySelector('.detail-lyrics .card-sub')?.textContent?.trim() ?? null }))()")
        safeLog('LYRIC_AUTO ' + JSON.stringify(bound))

        // 只有 READ ME.txt 的作品：不应被绑成字幕
        await js("location.hash = '#/work/1700554'")
        await delay(3000)
        await js("Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '播放全部')?.click()")
        await delay(4000)
        const readme = await js("(() => ({ lines: document.querySelectorAll('.lrc-line').length, empty: document.querySelector('.detail-lyrics .empty-state')?.textContent?.trim().slice(0, 30) ?? null, title: document.querySelector('.detail-lyrics .card-sub')?.textContent?.trim() ?? null }))()")
        safeLog('LYRIC_README ' + JSON.stringify(readme))

        // 点第 6 行歌词跳转
        const before = await js("document.querySelector('.pb-time')?.textContent?.trim() ?? null")
        await js("document.querySelectorAll('.lrc-line')[5]?.click()")
        await delay(1200)
        const after = await js("(() => ({ time: document.querySelector('.pb-time')?.textContent?.trim() ?? null, err: document.querySelector('.play-error')?.textContent ?? null }))()")
        safeLog('LYRIC_SEEK ' + JSON.stringify({ before, ...after }))

        // 桌面歌词窗
        const toggled = await js("window.kikoeru.lyricsToggle()")
        await delay(2200)
        const lw = lyricWin
        const lyricInfo = lw && !lw.isDestroyed()
          ? await lw.webContents.executeJavaScript("(() => ({ text: document.querySelector('.dlw-current')?.textContent?.trim() ?? null, hasBody: !!document.querySelector('.dlw') }))()")
          : null
        safeLog('LYRIC_WINDOW ' + JSON.stringify({ toggled, visible: !!(lw && !lw.isDestroyed() && lw.isVisible()), lyricInfo, payload: lastLyricsPayload }))
      } catch (e) {
        safeLog('LYRIC_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：单轨下载只能下一轨
  if (process.argv.includes('--selfcheck-dl-scope')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)
        await js("location.hash = '#/work/1699648'")
        await delay(3200)
        // 单条音轨下载
        await js("document.querySelector('.tree-dl')?.click()")
        await delay(1600)
        await js("document.querySelector('.dl-toggle')?.click()")
        await delay(500)
        const single = await js("(() => { const items = Array.from(document.querySelectorAll('.dl-panel .dl-item')); return { count: items.length, first: items[0]?.querySelector('.dl-name')?.textContent?.trim() ?? null } })()")
        safeLog('DLSCOPE_SINGLE ' + JSON.stringify(single))
        // 取消，避免真的下完
        await js("Array.from(document.querySelectorAll('.dl-panel .dl-item .chip')).forEach((b) => b.textContent.includes('取消') && b.click())")
        await delay(600)
      } catch (e) {
        safeLog('DLSCOPE_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：全屏进出后窗口按钮是否还在
  if (process.argv.includes('--selfcheck-window-state')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      const read = () => js(`(() => {
        const wc = document.querySelector('.window-controls')
        const cs = wc ? getComputedStyle(wc) : null
        return {
          bodyClass: document.body.className,
          visible: cs ? cs.display !== 'none' : false,
          buttons: document.querySelectorAll('.wc-btn').length,
          isFullScreen: window.kikoeru ? (window.__lastFs ?? null) : null,
        }
      })()`)
      try {
        await delay(3000)
        safeLog('WS_INIT ' + JSON.stringify(await read()))

        await js(`window.kikoeru.windowAction('toggle-fullscreen')`)
        await delay(1400)
        safeLog('WS_ENTER ' + JSON.stringify({ ...(await read()), fs: mainWindow.isFullScreen() }))

        await js(`window.kikoeru.windowAction('toggle-fullscreen')`)
        await delay(1400)
        safeLog('WS_EXIT ' + JSON.stringify({ ...(await read()), fs: mainWindow.isFullScreen() }))

        await js(`window.kikoeru.windowAction('toggle-maximize')`)
        await delay(900)
        safeLog('WS_MAX ' + JSON.stringify({ ...(await read()), max: mainWindow.isMaximized() }))

        await js(`window.kikoeru.windowAction('toggle-maximize')`)
        await delay(900)
        safeLog('WS_UNMAX ' + JSON.stringify({ ...(await read()), max: mainWindow.isMaximized() }))
      } catch (e) {
        safeLog('WS_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：正在播放页 + 下载面板的交互链路
  if (process.argv.includes('--selfcheck-ui')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const js = (code) => mainWindow.webContents.executeJavaScript(code)
      try {
        await delay(3000)

        // 1) 进作品页并播放全部
        await js(`location.hash = '#/work/1699648'`)
        await delay(3200)
        await js(`Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '播放全部')?.click()`)
        await delay(2500)
        const bar = await js(`({
          bar: !!document.querySelector('.player-bar'),
          clickableTitle: !!document.querySelector('.pb-title-row.clickable'),
          clickableCover: !!document.querySelector('.pb-cover.clickable'),
        })`)
        safeLog('UI_PLAYER ' + JSON.stringify(bar))

        // 2) 点标题 → 正在播放页升起
        await js(`document.querySelector('.pb-title-row.clickable')?.click()`)
        await delay(900)
        const sheet = await js(`(() => {
          const s = document.querySelector('.np-sheet')
          if (!s) return { open: false }
          const cs = getComputedStyle(s)
          return {
            open: true,
            transform: cs.transform,
            cover: !!document.querySelector('.np-cover'),
            lrcLines: document.querySelectorAll('.np-lrc-line').length,
            tabs: Array.from(document.querySelectorAll('.np-tab')).map((t) => t.textContent.trim().split(' ')[0]),
            playBtn: !!document.querySelector('.np-play'),
            seek: !!document.querySelector('.seek-track'),
          }
        })()`)
        safeLog('UI_NOWPLAYING ' + JSON.stringify(sheet))

        // 3) 切到播放列表
        await js(`Array.from(document.querySelectorAll('.np-tab')).find((t) => t.textContent.includes('播放列表'))?.click()`)
        await delay(500)
        const queue = await js(`({
          items: document.querySelectorAll('.np-q-item').length,
          current: document.querySelectorAll('.np-q-item.current').length,
        })`)
        safeLog('UI_QUEUE ' + JSON.stringify(queue))

        // 4) Esc 关闭
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        await delay(700)
        const closed = await js(`!document.querySelector('.np-sheet')`)
        safeLog('UI_CLOSE ' + JSON.stringify({ closed }))

        // 5) 下载面板
        await js(`document.querySelector('.dl-toggle')?.click()`)
        await delay(600)
        const panel = await js(`({
          open: !!document.querySelector('.dl-panel'),
          header: document.querySelector('.dl-head')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 30) ?? null,
        })`)
        safeLog('UI_DLPANEL ' + JSON.stringify(panel))

        // 6) 设置页下载分区
        await js(`document.querySelector('.dl-panel') && (document.querySelector('.dl-head .icon-btn')?.click())`)
        await js(`location.hash = '#/settings'`)
        await delay(1200)
        const settings = await js(`({
          downloadCard: Array.from(document.querySelectorAll('.m3-card')).some((c) => c.textContent.includes('保存目录')),
          classifySwitch: !!document.querySelector('.switch'),
          dirValue: document.querySelector('.dir-value')?.textContent?.trim().slice(0, 40) ?? null,
        })`)
        safeLog('UI_SETTINGS ' + JSON.stringify(settings))
      } catch (e) {
        safeLog('UI_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：真实下载一集最小音轨，并验证 URL 校验策略
  if (process.argv.includes('--selfcheck-download')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      try {
        await delay(3000)

        // 1) 非法地址必须被拒（环回 / file:）
        const bad = await startDownload({ url: 'http://127.0.0.1:9/x', workId: 1, workTitle: 't', fileName: 't.bin' })
          .then(() => 'ALLOWED').catch((e) => 'REJECTED:' + (e.message || '').slice(0, 30))
        safeLog('DL_GUARD ' + JSON.stringify({ loopback: bad }))

        // 2) 取一部作品里最小的音频音轨
        const pick = await mainWindow.webContents.executeJavaScript(`
          fetch('/kapi/tracks/1699648').then((r) => r.json()).then((tree) => {
            const out = []
            const walk = (ns) => ns.forEach((n) => {
              if (n.type === 'folder' && n.children) walk(n.children)
              else if (n.type === 'audio' && n.mediaDownloadUrl) out.push(n)
            })
            walk(tree)
            out.sort((a, b) => (a.size || 0) - (b.size || 0))
            const t = out[0] || null
            return t ? { url: t.mediaDownloadUrl, title: t.title, size: t.size || 0 } : null
          })
        `)
        if (!pick) {
          safeLog('DL_ERROR 没有找到可下载的音轨')
        } else {
          const started = Date.now()
          const res = await startDownload({
            url: pick.url,
            workId: 1699648,
            workTitle: 'SELFTEST',
            fileName: 'selftest_' + pick.title,
          })
          const target = res.targetPath
          // 等到任务真正从活跃表移除（下载结束），再比对大小
          for (let i = 0; i < 180; i++) {
            await delay(500)
            if (!activeDownloads.has(res.id)) break
          }
          await delay(300)
          const size = fs.existsSync(target) ? fs.statSync(target).size : 0
          const ok = size > 0 && (pick.size ? size === pick.size : true)
          safeLog('DL_RESULT ' + JSON.stringify({
            ok,
            expected: pick.size,
            actual: size,
            dir: res.targetDir,
            file: path.basename(target),
            elapsedMs: Date.now() - started,
          }))
          try { fs.rmSync(target, { force: true }) } catch { /* 清理测试文件 */ }
          try {
            const dir = res.targetDir
            if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
          } catch { /* 目录非空则保留 */ }
        }
      } catch (e) {
        safeLog('DL_ERROR ' + (e && e.message ? e.message : String(e)))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：加载完成后抓一组结构指标并退出（用于打包后验证，不需要截图）
  if (process.argv.includes('--selfcheck-theme')) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) safeLog('CONSOLE_ERROR ' + String(message).slice(0, 200))
    })
    mainWindow.webContents.once('did-finish-load', async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const combos = [['light', '0'], ['dark', '0'], ['dark', '1'], ['auto', '0']]
      try {
        await delay(2500)
        for (const [mode, amoled] of combos) {
          await mainWindow.webContents.executeJavaScript(`
            localStorage.setItem('kikoeru-pc/darkMode', ${JSON.stringify(mode)})
            localStorage.setItem('kikoeru-pc/amoled', ${JSON.stringify(amoled)})
            location.reload()
          `)
          await delay(2600)
          const info = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const cs = getComputedStyle(document.documentElement)
              const v = (n) => cs.getPropertyValue('--md-' + n).trim()
              const hex2rgb = (h) => {
                const m = h.replace('#','')
                return m.length === 3
                  ? [parseInt(m[0]+m[0],16), parseInt(m[1]+m[1],16), parseInt(m[2]+m[2],16)]
                  : [parseInt(m.slice(0,2),16), parseInt(m.slice(2,4),16), parseInt(m.slice(4,6),16)]
              }
              const lum = (h) => {
                const [r,g,b] = hex2rgb(h).map((x) => {
                  const c = x / 255
                  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
                })
                return 0.2126*r + 0.7152*g + 0.0722*b
              }
              const contrast = (a, b) => {
                try {
                  const la = lum(a), lb = lum(b)
                  return +(((Math.max(la,lb) + 0.05) / (Math.min(la,lb) + 0.05))).toFixed(2)
                } catch { return null }
              }
              const sw = Array.from(document.querySelectorAll('.swatch')).map(s => getComputedStyle(s).backgroundColor)
              return {
                scheme: document.documentElement.dataset.scheme,
                background: v('background'),
                surface: v('surface'),
                containerLowest: v('surface-container-lowest'),
                containerHigh: v('surface-container-high'),
                primary: v('primary'),
                onSurface: v('on-surface'),
                onPrimary: v('on-primary'),
                bodyColor: getComputedStyle(document.body).color,
                bodyBg: getComputedStyle(document.body).backgroundColor,
                contrastTextOnBg: contrast(v('on-surface'), v('background')),
                contrastPrimaryOnBg: contrast(v('primary'), v('background')),
                swatchCount: sw.length,
                swatchSample: sw.slice(0, 4),
              }
            })()
          `)
          safeLog('THEME ' + JSON.stringify({ mode, amoled, ...info }))
        }

        // 真实点击按钮的验证（不经过 localStorage 直写）
        await mainWindow.webContents.executeJavaScript(`location.hash = '#/settings'`)
        await delay(1500)
        const readState = () => mainWindow.webContents.executeJavaScript(`
          (() => {
            const cs = getComputedStyle(document.documentElement)
            return {
              scheme: document.documentElement.dataset.scheme,
              bg: cs.getPropertyValue('--md-background').trim(),
              card: cs.getPropertyValue('--md-surface-container-high').trim(),
              active: Array.from(document.querySelectorAll('.m3-card .chip'))
                .filter((b) => !b.className.includes('plain'))
                .map((b) => b.textContent.trim()),
            }
          })()
        `)
        const clicks = []
        for (const label of ['浅色', '深色', '跟随系统', 'AMOLED 纯黑']) {
          const before = await readState()
          await mainWindow.webContents.executeJavaScript(`
            Array.from(document.querySelectorAll('.m3-card button'))
              .find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()
          `)
          await delay(700)
          const after = await readState()
          clicks.push({ label, before: { scheme: before.scheme, bg: before.bg, card: before.card }, after: { scheme: after.scheme, bg: after.bg, card: after.card } })
        }
        safeLog('THEME_CLICK ' + JSON.stringify(clicks))

        // 对比度审计：找出"文字看不清"的元素（真正的可用性问题）
        const audit = []
        for (const [mode, amoled] of combos) {
          await mainWindow.webContents.executeJavaScript(`
            localStorage.setItem('kikoeru-pc/darkMode', ${JSON.stringify(mode)})
            localStorage.setItem('kikoeru-pc/amoled', ${JSON.stringify(amoled)})
            location.hash = '#/'
            location.reload()
          `)
          await delay(2600)
          const worst = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const parse = (c) => {
                const m = c.match(/rgba?\\(([^)]+)\\)/)
                if (!m) return null
                const p = m[1].split(',').map((x) => parseFloat(x))
                return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
              }
              const blend = (fg, bg) => ({
                r: fg.r * fg.a + bg.r * (1 - fg.a),
                g: fg.g * fg.a + bg.g * (1 - fg.a),
                b: fg.b * fg.a + bg.b * (1 - fg.a),
                a: 1,
              })
              const lum = (c) => {
                const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
                return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
              }
              const eff = (el) => {
                let bg = { r: 0, g: 0, b: 0, a: 0 }
                let node = el
                const stack = []
                while (node && node !== document.documentElement) {
                  const c = parse(getComputedStyle(node).backgroundColor)
                  if (c && c.a > 0) stack.push(c)
                  if (c && c.a >= 0.999) break
                  node = node.parentElement
                }
                const root = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
                bg = root
                for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg)
                return bg
              }
              const ratio = (a, b) => {
                const la = lum(a), lb = lum(b)
                return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
              }
              const results = []
              const els = Array.from(document.querySelectorAll('body *')).slice(0, 900)
              for (const el of els) {
                const txt = (el.childNodes[0]?.nodeType === 3 ? el.textContent || '' : '').trim()
                if (!txt) continue
                const cs = getComputedStyle(el)
                if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
                const rect = el.getBoundingClientRect()
                if (rect.width < 2 || rect.height < 2) continue
                const fgRaw = parse(cs.color)
                if (!fgRaw) continue
                const bg = eff(el)
                const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw
                const r = ratio(fg, bg)
                if (r < 2.6) {
                  results.push({
                    cls: (el.className || el.tagName).toString().slice(0, 28),
                    text: txt.slice(0, 16),
                    ratio: +r.toFixed(2),
                  })
                }
              }
              results.sort((a, b) => a.ratio - b.ratio)
              return results.slice(0, 6)
            })()
          `)
          audit.push({ mode, amoled, worst })
        }
        safeLog('THEME_AUDIT ' + JSON.stringify(audit))
      } catch (e) {
        safeLog('THEME_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }

  // 自检：加载完成后抓一组结构指标并退出（用于打包后验证，不需要截图）
  if (process.argv.includes('--selfcheck')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 6000))
        const metrics = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const cards = document.querySelectorAll('.works-grid .work-card').length
            const rows = Array.from(document.querySelectorAll('.row-title')).map(e => e.textContent.trim().split(' ')[0])
            const img = document.querySelector('.works-grid .cover')
            const rail = Array.from(document.querySelectorAll('.rail-item')).map(e => e.textContent.trim())
            const hdr = document.querySelector('.app-header')
            return {
              protocol: location.protocol,
              hash: location.hash,
              cards, rows, rail,
              coverSrc: img ? img.src : null,
              desktopBridge: !!(window.kikoeru && window.kikoeru.isDesktop),
              apiBase: window.kikoeru ? window.kikoeru.apiBase : null,
              windowButtons: document.querySelectorAll('.wc-btn').length,
              dragRegion: hdr ? getComputedStyle(hdr).webkitAppRegion : null,
              isDesktopClass: document.body.classList.contains('is-desktop'),
              // 窗口按钮与右侧操作区是否重叠（布局回归检查）
              overlapPx: (() => {
                const wc = document.querySelector('.window-controls')
                const right = document.querySelector('.header-right')
                if (!wc || !right) return null
                return Math.round(right.getBoundingClientRect().right - wc.getBoundingClientRect().left)
              })(),
            }
          })()
        `)
        safeLog('SELFCHECK ' + JSON.stringify(metrics))

        // 窗口能力自检：最大化 / 全屏 是否真的生效
        const delay = (ms) => new Promise((r) => setTimeout(r, ms))
        mainWindow.maximize()
        await delay(600)
        const maximized = mainWindow.isMaximized()
        mainWindow.unmaximize()
        await delay(300)
        mainWindow.setFullScreen(true)
        await delay(700)
        const fullscreen = mainWindow.isFullScreen()
        mainWindow.setFullScreen(false)
        await delay(300)
        safeLog('SELFCHECK_WINDOW ' + JSON.stringify({
          maximized,
          fullscreen,
          frameless: !mainWindow.isMenuBarVisible() ? true : undefined,
          restored: !mainWindow.isFullScreen() && !mainWindow.isMaximized(),
        }))

        // 全量路由巡检：逐页切换并抓关键指标
        if (process.argv.includes('--deep')) {
          const routes = ['#/', '#/popular', '#/search', '#/browse', '#/library', '#/settings', '#/work/1699648']
          for (const r of routes) {
            await mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify(r)}`)
            await delay(2600)
            const info = await mainWindow.webContents.executeJavaScript(`
              (() => ({
                hash: location.hash,
                brand: document.querySelector('.brand')?.textContent?.trim() ?? null,
                cards: document.querySelectorAll('.works-grid .work-card').length,
                rows: document.querySelectorAll('.row-section').length,
                tabs: document.querySelectorAll('.lib-tab').length,
                cats: document.querySelectorAll('.cat-item').length,
                tracks: document.querySelectorAll('.tree-track, .tree-folder').length,
                empty: document.querySelector('.empty-state')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 40) ?? null,
                hasHeader: !!document.querySelector('.app-header'),
              }))()
            `)
            safeLog('SELFCHECK_ROUTE ' + JSON.stringify(info))
          }
        }
      } catch (e) {
        safeLog('SELFCHECK_ERROR ' + (e && e.message))
      } finally {
        quitting = true
        app.exit(0)
      }
    })
  }
  }

  // 外链交给系统浏览器，站内不跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 关窗行为：默认收进托盘；用户选"直接退出"时真正结束进程
  mainWindow.on('close', (e) => {
    if (quitting) return
    if (closeToTray()) {
      e.preventDefault()
      mainWindow.hide()
      return
    }
    quitting = true
    app.quit()
  })

  if (isDev) mainWindow.loadURL(DEV_URL)
  else mainWindow.loadURL('app://kikoeru/index.html')

  return mainWindow
}

// ---------------------------------------------------------------- 托盘 / 快捷键

/** 桌面字幕窗开关：托盘、任务栏按钮、菜单共用 */
function toggleLyricsWindow() {
  if (lyricWin && !lyricWin.isDestroyed() && lyricWin.isVisible()) {
    lyricWin.hide()
    return false
  }
  createLyricWindow()
  return true
}

/** 任务栏缩略图按钮（仅 Windows）：上一首 / 播放暂停 / 下一首 / 桌面字幕 */
function refreshThumbar() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return

  const icon = (name) => nativeImage.createFromPath(path.join(__dirname, 'thumbar', `${name}.png`))
  // 没在播放时也保留"桌面字幕"入口，否则用户找不到这个功能
  const lyricButton = {
    tooltip: '桌面字幕',
    icon: icon('lyrics'),
    click: () => { toggleLyricsWindow() },
  }

  const buttons = playerState.title
    ? [
        {
          tooltip: '上一首',
          icon: icon('prev'),
          click: () => mainWindow?.webContents.send('media-key', 'prev'),
        },
        {
          tooltip: playerState.playing ? '暂停' : '播放',
          icon: icon(playerState.playing ? 'pause' : 'play'),
          click: () => mainWindow?.webContents.send('media-key', 'toggle'),
        },
        {
          tooltip: '下一首',
          icon: icon('next'),
          click: () => mainWindow?.webContents.send('media-key', 'next'),
        },
        lyricButton,
      ]
    : [lyricButton]

  // 图标缺失时宁可不显示，也不要塞空图标让 Windows 画出白块
  if (buttons.some((b) => b.icon.isEmpty())) {
    try { mainWindow.setThumbarButtons([]) } catch { /* 忽略 */ }
    return
  }
  try { mainWindow.setThumbarButtons(buttons) } catch { /* 忽略 */ }
}

function buildTray() {
  const iconPath = path.join(__dirname, 'tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) image = nativeImage.createEmpty()

  tray = new Tray(image)
  tray.setToolTip('Kikoenai')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => { mainWindow?.show(); mainWindow?.focus() },
    },
    { type: 'separator' },
    {
      label: '播放 / 暂停',
      click: () => mainWindow?.webContents.send('media-key', 'toggle'),
    },
    { label: '上一首', click: () => mainWindow?.webContents.send('media-key', 'prev') },
    { label: '下一首', click: () => mainWindow?.webContents.send('media-key', 'next') },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { quitting = true; app.quit() },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
}

function registerMediaKeys() {
  const send = (action) => () => mainWindow?.webContents.send('media-key', action)
  const binds = {
    MediaPlayPause: 'toggle',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  }
  for (const [key, action] of Object.entries(binds)) {
    try { globalShortcut.register(key, send(action)) } catch { /* 该键被系统占用时忽略 */ }
  }
}

// ---------------------------------------------------------------- 生命周期

// 安装/卸载模式不参与主程序的单实例锁，否则应用开着就装不了
const gotLock = (INSTALL_MODE || UNINSTALL_MODE) ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    if (INSTALL_MODE) {
      createInstallerWindow()
      return
    }
    if (UNINSTALL_MODE) {
      runUninstall()
      return
    }

    try { lyricDisplayId = readConfig().lyricDisplayId ?? null } catch { /* 忽略 */ }
    // 代理：环境变量 → 直连 → 缓存 → 系统 → 本地端口探测
    await setupProxy()
    safeLog(`[boot] Kikoenai ${app.getVersion()} server=${API_TARGET} proxy=${activeProxy || '(none)'} mode=${PROXY_MODE}`)

    protocol.handle('app', async (req) => {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/kapi/')) return proxyApi(req, url)
      if (url.pathname === '/kmedia') return proxyMedia(req, url)
      if (url.pathname === '/local') return serveLocal(req, url)
      return serveStatic(url)
    })

    createWindow()
    buildTray()
    registerMediaKeys()
    bootDownloads()

    // 渲染层报错也进日志：GUI 下没有控制台，否则出问题完全查不到
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level < 2) return
      safeLog(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })

    // 任务栏缩略图按钮（Windows）
    ipcMain.on('player:state', (_e, state) => {
      playerState = {
        playing: !!state?.playing,
        title: typeof state?.title === 'string' ? state.title : '',
      }
      refreshThumbar()
    })

    ipcMain.handle('kikoeru:config', () => ({
      apiBase: API_TARGET,
      proxy: activeProxy,
      version: app.getVersion(),
      platform: process.platform,
      serverUrl: API_TARGET,
      proxyMode: PROXY_MODE,
      proxyRules: PROXY_RULES,
      logDir: logDir(),
    }))

    // ---- 服务器 / 代理：写配置后需要重启生效 ----
    ipcMain.handle('config:getServer', () => ({
      serverUrl: API_TARGET,
      proxyMode: PROXY_MODE,
      proxyRules: PROXY_RULES,
      usingEnvServer: !!normalizeServerUrl(process.env.KIKOERU_TARGET),
    }))

    ipcMain.handle('config:setServer', (_e, raw) => {
      const url = normalizeServerUrl(raw)
      if (!url) return { ok: false, error: '只支持 http:// 或 https:// 地址' }
      patchConfig({ serverUrl: url })
      return { ok: true, serverUrl: url }
    })

    ipcMain.handle('config:setProxy', (_e, patch) => {
      const mode = ['auto', 'system', 'direct', 'rules'].includes(patch?.mode) ? patch.mode : 'auto'
      const rules = typeof patch?.rules === 'string' ? patch.rules.trim() : ''
      if (mode === 'rules' && !normalizeProxyRules(rules)) {
        return { ok: false, error: '代理规则格式应为 http://host:port 或 socks5://host:port' }
      }
      patchConfig({ proxyMode: mode, proxyRules: rules })
      return { ok: true }
    })

    ipcMain.handle('app:relaunch', () => {
      quitting = true
      flushDownloads()
      app.relaunch()
      app.exit(0)
      return true
    })

    ipcMain.handle('logs:openDir', () => {
      const dir = logDir()
      if (!dir) return false
      try {
        fs.mkdirSync(dir, { recursive: true })
        void shell.openPath(dir)
        return true
      } catch { return false }
    })

    // 关闭窗口时的行为：true=收进托盘，false=直接退出
    ipcMain.handle('app:closeToTray', () => closeToTray())
    ipcMain.handle('app:setCloseToTray', (_e, on) => {
      const next = on !== false
      patchConfig({ closeToTray: next })
      return next
    })

    // 窗口控制（无边框窗口由界面按钮驱动）
    ipcMain.on('window:video-mode', (_e, on) => { videoFullscreenMode = !!on })

    ipcMain.handle('window:action', (_e, action) => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      switch (action) {
        case 'minimize':
          mainWindow.minimize()
          break
        case 'toggle-maximize':
          if (mainWindow.isMaximized()) mainWindow.unmaximize()
          else mainWindow.maximize()
          break
        case 'toggle-fullscreen':
          void toggleFullscreenSmooth()
          return null
        case 'close':
          mainWindow.close()
          break
      }
      return {
        maximized: mainWindow.isMaximized(),
        fullscreen: mainWindow.isFullScreen(),
      }
    })

    ipcMain.handle('window:state', () => ({
      maximized: mainWindow ? mainWindow.isMaximized() : false,
      fullscreen: mainWindow ? mainWindow.isFullScreen() : false,
    }))

    // ---- 桌面字幕 ----
    ipcMain.handle('lyrics:toggle', () => ({ visible: toggleLyricsWindow() }))

    ipcMain.on('lyrics:update', (_e, payload) => {
      lastLyricsPayload = payload
      if (lyricWin && !lyricWin.isDestroyed()) lyricWin.webContents.send('lyrics:data', payload)
    })

    ipcMain.handle('lyrics:request', () => lastLyricsPayload)

    ipcMain.handle('lyrics:next-display', () => {
      const displays = screen.getAllDisplays()
      if (!lyricWin || lyricWin.isDestroyed() || displays.length < 2) return { moved: false }
      const cur = displays.findIndex((d) => d.id === lyricDisplayId)
      const next = displays[(cur + 1) % displays.length]
      lyricDisplayId = next.id
      patchConfig({ lyricDisplayId })
      const b = lyricWin.getBounds()
      lyricWin.setBounds({
        x: Math.round(next.workArea.x + (next.workArea.width - b.width) / 2),
        y: Math.round(next.workArea.y + next.workArea.height - b.height - 40),
        width: b.width,
        height: b.height,
      })
      return { moved: true, display: next.id }
    })

    ipcMain.handle('lyrics:close', () => {
      if (lyricWin && !lyricWin.isDestroyed()) lyricWin.hide()
      return { visible: false }
    })

    ipcMain.handle('lyrics:open-main', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus() }
      return true
    })

    // ---- 下载 ----
    ipcMain.handle('download:start', async (_e, opts) => {
      try {
        return await startDownload(opts)
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) }
      }
    })

    ipcMain.handle('download:cancel', (_e, id) => {
      // 还在排队的：直接摘掉并告知界面
      const idx = downloadQueue.findIndex((t) => t.id === id)
      if (idx >= 0) {
        downloadQueue.splice(idx, 1)
        dropRecord(id)
        persistSoon(0)
        sendDownload('download:canceled', { id })
        return true
      }
      const task = activeDownloads.get(id)
      if (task) {
        task.abort.abort()
        return true
      }
      // 已暂停的任务：删文件与记录
      const rec = downloadRecords.find((t) => t.id === id && t.state === 'paused')
      if (rec) {
        try { fs.rmSync(rec.targetPath, { force: true }) } catch { /* 忽略 */ }
        dropRecord(id)
        persistSoon(0)
        sendDownload('download:canceled', { id })
        return true
      }
      return false
    })

    ipcMain.handle('download:pause', (_e, id) => {
      // 排队中的：移出队列，状态记为 paused
      const idx = downloadQueue.findIndex((t) => t.id === id)
      if (idx >= 0) {
        const [t] = downloadQueue.splice(idx, 1)
        upsertRecord({ id, state: 'paused', received: t.received, total: t.total })
        persistSoon(0)
        sendDownload('download:paused', { id, received: t.received, total: t.total })
        return true
      }
      const task = activeDownloads.get(id)
      if (task && typeof task.pause === 'function') {
        task.pause()
        return true
      }
      return false
    })

    ipcMain.handle('download:resume', (_e, id) => {
      const rec = downloadRecords.find((t) => t.id === id)
      if (!rec || !rec.url || !rec.targetPath) return false
      if (!validateRemoteUrl(rec.url, { allowHosts: apiHosts() })) return false
      // 有下载记录的文件也可能是暂停后重启的情况，按磁盘实际大小续传
      let received = Number(rec.received) || 0
      try { received = fs.statSync(rec.targetPath).size } catch { received = 0 }

      const abort = new AbortController()
      downloadQueue.push({
        id: rec.id,
        url: rec.url,
        workId: rec.workId,
        workTitle: rec.workTitle || '',
        fileName: rec.fileName,
        targetDir: rec.targetDir || '',
        targetPath: rec.targetPath,
        received,
        total: Number(rec.total) || 0,
        etag: rec.etag || '',
        abort,
        resumed: received > 0,
      })
      upsertRecord({ id: rec.id, state: 'queued', received })
      persistSoon(0)
      pumpDownloads()
      return true
    })

    /** 渲染层启动时拉一次：恢复历史任务列表 */
    ipcMain.handle('download:list', () => downloadRecords.slice(0, 100).map((t) => ({
      id: t.id,
      workId: t.workId,
      workTitle: t.workTitle || '',
      fileName: t.fileName || '',
      url: t.url || '',
      received: Number(t.received) || 0,
      total: Number(t.total) || 0,
      state: t.state === 'done' ? 'done'
        : t.state === 'error' ? 'error'
          : t.state === 'paused' ? 'paused'
            : 'queued',
      path: t.state === 'done' ? t.targetPath : '',
      message: t.error || '',
    })))

    ipcMain.handle('download:settings', () => downloadSettings())

    ipcMain.handle('download:setSettings', (_e, patch) => {
      const cur = downloadSettings()
      const next = {
        dir: typeof patch?.dir === 'string' ? patch.dir : cur.dir,
        autoClassify: typeof patch?.autoClassify === 'boolean' ? patch.autoClassify : cur.autoClassify,
        concurrency: Number.isFinite(Number(patch?.concurrency))
          ? Math.min(5, Math.max(1, Math.floor(Number(patch.concurrency))))
          : cur.concurrency,
      }
      patchConfig({ download: next })
      pumpDownloads()
      return next
    })

    ipcMain.handle('local:resolve', (_e, opts) => {
      const workId = Number(opts?.workId)
      const fileName = String(opts?.fileName || '')
      if (!fileName) return null
      // 还没下完的任务不要拿半截文件去播（会表现成"解析不了"）
      const rec = downloadRecords.find((t) =>
        t.workId === workId
        && t.fileName === sanitizeFileName(fileName))
      if (rec && rec.state !== 'done') return null

      const known = rec && rec.state === 'done' && typeof rec.targetPath === 'string' ? rec.targetPath : undefined
      const settings = downloadSettings()
      try {
        const hit = resolveLocalFile({
          roots: localRoots(),
          workId,
          fileName,
          knownPath: known,
          // 默认按 RJ 号分类；只有用户关掉分类时才去根目录扫，避免同名曲目串到别的作品
          includeRoot: settings.autoClassify === false,
        })
        if (!hit) return null
        // 命中路径也必须在下载根之内（用户改过目录后旧记录可能已经越界）
        const real = realOrRaw(hit) || path.resolve(hit)
        const inside = localRoots().some((root) => isInsideRoot(realOrRaw(root) || path.resolve(root), real))
        return inside ? hit : null
      } catch {
        return null
      }
    })

    ipcMain.handle('download:openFolder', (_e, target) => {
      try {
        const p = String(target || '')
        if (!p) return false
        // 只允许打开下载目录 / 日志目录之内的东西：渲染层给什么就开什么等于把磁盘交出去
        const roots = [downloadRoot(), app.getPath('downloads'), logDir()]
        if (!roots.some((root) => isInsideRoot(root, p))) return false
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) shell.openPath(p)
        else if (fs.existsSync(p)) shell.showItemInFolder(p)
        else return false
        return true
      } catch { return false }
    })

    ipcMain.handle('download:pickDir', async () => {
      if (!mainWindow) return null
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择下载目录',
        defaultPath: downloadSettings().dir || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      })
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
    })
  })

  app.on('window-all-closed', () => {
    // 常驻托盘，不随窗口关闭退出（macOS 同）
    if (process.platform === 'darwin') return
  })

  app.on('before-quit', () => {
    quitting = true
    // 安装/卸载模式没有加载任务列表，别用空数组覆盖真实记录
    if (!INSTALL_MODE && !UNINSTALL_MODE) flushDownloads()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('activate', () => {
    if (mainWindow) mainWindow.show()
    else createWindow()
  })
}
