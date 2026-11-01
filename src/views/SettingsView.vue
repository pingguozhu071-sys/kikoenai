<script setup lang="ts">
/** 设置 — 服务器与网络、下载、字幕窗、关闭行为、账号、日志、关于 */
import { onMounted, onUnmounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import { useSession } from '../stores/session'
import { toast } from '../stores/toast'
import { ui } from '../stores/ui'
import { downloadSettings, pickDownloadDir } from '../stores/downloads'
import {
  LYRIC_STYLE_KEY, LYRIC_STYLE_NAMES, readLyricStyle, writeLyricStyle,
  type LyricStyle, type LyricWindowKind,
} from '../stores/lyricWindows'

const session = useSession

interface ServerConfig {
  serverUrl: string
  proxyMode: string
  proxyRules: string
  usingEnvServer: boolean
}

interface LyricsVisibility {
  desktop: boolean
  taskbar: boolean
}

interface DesktopBridge {
  getCloseToTray?: () => Promise<boolean>
  setCloseToTray?: (on: boolean) => Promise<boolean>
  getServerConfig?: () => Promise<ServerConfig>
  setServer?: (url: string) => Promise<{ ok: boolean; error?: string }>
  setProxy?: (patch: { mode: string; rules: string }) => Promise<{ ok: boolean; error?: string }>
  relaunch?: () => Promise<boolean>
  openLogDir?: () => Promise<boolean>
  lyricsSet?: (target: LyricWindowKind, visible: boolean) => Promise<LyricsVisibility>
  lyricsState?: () => Promise<LyricsVisibility>
}
const bridge = (window as unknown as { kikoeru?: DesktopBridge }).kikoeru

/** 关闭窗口的行为：true=收进托盘，false=直接退出 */
const closeToTray = ref(true)

/** 字幕窗：两种形式互斥，样式可选经典/磨砂/液态 */
const LYRIC_STYLES: LyricStyle[] = ['classic', 'frosted', 'liquid']
const lyricWindows = ref<LyricsVisibility>({ desktop: false, taskbar: false })
const lyricStyles = ref<Record<LyricWindowKind, LyricStyle>>({
  desktop: readLyricStyle('desktop'),
  taskbar: readLyricStyle('taskbar'),
})

async function toggleLyricWindow(kind: LyricWindowKind, visible: boolean) {
  try {
    const next = await bridge?.lyricsSet?.(kind, visible)
    if (next) lyricWindows.value = next
  } catch {
    toast('切换失败', 'error')
  }
}

function setLyricStyle(kind: LyricWindowKind, style: LyricStyle) {
  lyricStyles.value = { ...lyricStyles.value, [kind]: style }
  writeLyricStyle(kind, style)
}

/** 在字幕窗里点样式按钮时，设置页同步显示 */
function onLyricStorage(e: StorageEvent) {
  if (e.key === LYRIC_STYLE_KEY.desktop) {
    lyricStyles.value = { ...lyricStyles.value, desktop: readLyricStyle('desktop') }
  } else if (e.key === LYRIC_STYLE_KEY.taskbar) {
    lyricStyles.value = { ...lyricStyles.value, taskbar: readLyricStyle('taskbar') }
  }
}

const server = ref<ServerConfig>({
  serverUrl: '',
  proxyMode: 'auto',
  proxyRules: '',
  usingEnvServer: false,
})
const serverInput = ref('')
const proxyMode = ref('auto')
const proxyRules = ref('')

onMounted(async () => {
  window.addEventListener('storage', onLyricStorage)
  try {
    const v = await bridge?.getCloseToTray?.()
    if (typeof v === 'boolean') closeToTray.value = v
  } catch { /* 网页版没有桌面桥 */ }

  try {
    const st = await bridge?.lyricsState?.()
    if (st) lyricWindows.value = st
  } catch { /* 忽略 */ }

  try {
    const cfg = await bridge?.getServerConfig?.()
    if (cfg) {
      server.value = cfg
      serverInput.value = cfg.serverUrl
      proxyMode.value = cfg.proxyMode || 'auto'
      proxyRules.value = cfg.proxyRules || ''
    }
  } catch { /* 忽略 */ }
})

onUnmounted(() => window.removeEventListener('storage', onLyricStorage))

async function saveNetwork() {
  const url = serverInput.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    toast('服务器地址需要以 http:// 或 https:// 开头', 'error')
    return
  }
  try {
    const a = await bridge?.setServer?.(url)
    if (a && a.ok === false) {
      toast(a.error || '服务器地址保存失败', 'error')
      return
    }
    const b = await bridge?.setProxy?.({ mode: proxyMode.value, rules: proxyRules.value })
    if (b && b.ok === false) {
      toast(b.error || '代理设置保存失败', 'error')
      return
    }
    toast('已保存，重启后生效', 'success')
  } catch {
    toast('保存失败', 'error')
  }
}

async function restartApp() {
  const ok = await bridge?.relaunch?.()
  if (!ok) toast('重启失败，请手动关闭后重新打开', 'error')
}

async function openLogs() {
  const ok = await bridge?.openLogDir?.()
  if (!ok) toast('打不开日志目录', 'error')
}

async function setCloseBehavior(toTray: boolean) {
  closeToTray.value = toTray
  try {
    await bridge?.setCloseToTray?.(toTray)
    toast(toTray ? '关闭窗口后将收进托盘' : '关闭窗口将直接退出', 'success')
  } catch {
    toast('设置未保存', 'error')
  }
}

function removeAccount(name: string) {
  session.logout(name)
  toast(`已移除账号 ${name}`, 'info')
}

async function chooseDir() {
  const dir = await pickDownloadDir()
  if (!dir) return
  downloadSettings.dir = dir
  downloadSettings.persist()
  toast('下载目录已更新', 'success')
}
</script>

<template>
  <div class="view">
    <div class="app-header">
      <div class="header-left"><span class="brand">设置</span></div>
    </div>

    <div class="page-scroll" style="max-width: 760px">
      <!-- 下载 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head">
          <UiIcon name="download" :size="18" /> 下载
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>保存目录</div>
            <div class="card-sub">留空则使用系统「下载」文件夹</div>
          </div>
          <div class="set-value dir-value" :title="downloadSettings.dir || '（系统下载文件夹）'">
            {{ downloadSettings.dir || '（系统下载文件夹）' }}
          </div>
          <button class="chip" @click="chooseDir">选择…</button>
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>按 RJ 号自动分类</div>
            <div class="card-sub">在保存目录下为每部作品创建 <code>RJxxxxxxx</code> 子文件夹</div>
          </div>
          <button
            class="switch" :class="{ on: downloadSettings.autoClassify }"
            role="switch" :aria-checked="downloadSettings.autoClassify"
            @click="downloadSettings.autoClassify = !downloadSettings.autoClassify; downloadSettings.persist()"
          >
            <span class="knob" />
          </button>
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>同时下载数量</div>
            <div class="card-sub">整部下载时的并发文件数（1–5）</div>
          </div>
          <select
            class="sort-select"
            :value="String(downloadSettings.concurrency)"
            @change="(e) => { downloadSettings.concurrency = Number((e.target as HTMLSelectElement).value); downloadSettings.persist() }"
          >
            <option v-for="n in [1, 2, 3, 4, 5]" :key="n" :value="String(n)">{{ n }}</option>
          </select>
        </div>

        <div class="card-sub" style="margin-top: 8px">
          下载地址来自服务端下发的 mediaDownloadUrl；桌面端会校验为公网 http/https，拒绝环回与私有地址。
        </div>
      </div>

      <!-- 服务器与网络 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head">
          <UiIcon name="explore" :size="18" /> 服务器与网络
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>服务器地址</div>
            <div class="card-sub">
              默认公共站；自建 kikoeru-express 填 http://局域网IP:端口
              <template v-if="server.usingEnvServer"><br />当前由环境变量 KIKOERU_TARGET 指定</template>
            </div>
          </div>
          <input class="text-field" v-model="serverInput" placeholder="https://api.asmr.one" spellcheck="false" />
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>上游代理</div>
            <div class="card-sub">自动 = 依次尝试缓存、本机常见端口、系统代理</div>
          </div>
          <select class="sort-select" v-model="proxyMode">
            <option value="auto">自动</option>
            <option value="system">系统代理</option>
            <option value="direct">直连</option>
            <option value="rules">自定义</option>
          </select>
        </div>

        <div v-if="proxyMode === 'rules'" class="set-row">
          <div class="set-label">
            <div>代理规则</div>
            <div class="card-sub">例如 http://127.0.0.1:7897 或 socks5://127.0.0.1:1080</div>
          </div>
          <input class="text-field" v-model="proxyRules" placeholder="http://127.0.0.1:7897" spellcheck="false" />
        </div>

        <div class="tag-row" style="margin-top: 6px">
          <button class="filled-btn slim" @click="saveNetwork">保存</button>
          <button class="chip" @click="restartApp">重启生效</button>
        </div>
      </div>

      <!-- 关闭窗口行为 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head">
          <UiIcon name="close" :size="18" /> 关闭窗口时
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>行为</div>
            <div class="card-sub">点右上角关闭按钮或任务栏关闭时的处理方式</div>
          </div>
          <div class="tag-row" style="margin: 0">
            <button class="chip" :class="{ plain: !closeToTray }" @click="setCloseBehavior(true)">最小化到托盘</button>
            <button class="chip" :class="{ plain: closeToTray }" @click="setCloseBehavior(false)">直接退出</button>
          </div>
        </div>
      </div>

      <!-- 账号 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head">
          <UiIcon name="person" :size="18" /> 账号
          <span class="card-sub">{{ session.accounts.length }} 个</span>
        </div>

        <div v-if="!session.accounts.length" class="empty-state" style="padding: 22px 0; font-size: 13px">
          未登录任何账号
        </div>

        <TransitionGroup name="list">
          <div v-for="a in session.accounts" :key="a.name" class="account-row">
            <UiIcon name="person" :size="18" />
            <div style="flex: 1; min-width: 0">
              <div class="acc-name">{{ a.name }}</div>
              <div class="acc-meta">{{ a.serverLabel }} · {{ new Date(a.savedAt).toLocaleString() }}</div>
            </div>
            <button v-if="!session.currentIs(a.name)" class="chip" @click="session.switchTo(a.name); toast(`已切换到 ${a.name}`, 'success')">切换</button>
            <span v-else class="chip" style="background: var(--md-primary-container); color: var(--md-on-primary-container)">当前</span>
            <button class="icon-btn" title="移除" @click="removeAccount(a.name)">
              <UiIcon name="close" :size="16" />
            </button>
          </div>
        </TransitionGroup>

        <div class="tag-row">
          <button class="filled-btn" @click="ui.openLogin()">添加账号</button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head"><UiIcon name="queue_music" :size="18" /> 快捷键</div>
        <div class="kbd-list">
          <div><kbd>空格</kbd> 播放 / 暂停</div>
          <div><kbd>←</kbd> <kbd>→</kbd> 后退 / 前进 5 秒（<kbd>Shift</kbd> 为 30 秒）</div>
          <div><kbd>↑</kbd> <kbd>↓</kbd> 音量</div>
          <div><kbd>M</kbd> 静音</div>
          <div><kbd>N</kbd> / <kbd>P</kbd> 下一首 / 上一首</div>
        </div>
      </div>

      <!-- 字幕窗 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head">
          <UiIcon name="lyrics" :size="18" /> 字幕窗
          <span class="card-sub">两种形式只能同时存在一个</span>
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>桌面字幕</div>
            <div class="card-sub">独立置顶窗口，可拖到任意位置；显示当前行与下一行</div>
          </div>
          <button
            class="switch" :class="{ on: lyricWindows.desktop }"
            role="switch" :aria-checked="lyricWindows.desktop"
            @click="toggleLyricWindow('desktop', !lyricWindows.desktop)"
          >
            <span class="knob" />
          </button>
        </div>
        <div class="tag-row" style="margin: 2px 0 8px">
          <button
            v-for="s in LYRIC_STYLES" :key="s"
            class="chip" :class="{ plain: lyricStyles.desktop !== s }"
            @click="setLyricStyle('desktop', s)"
          >{{ LYRIC_STYLE_NAMES[s] }}</button>
        </div>

        <div class="set-row">
          <div class="set-label">
            <div>任务栏字幕</div>
            <div class="card-sub">屏幕左下角一行歌词，鼠标可直接穿透，不挡操作</div>
          </div>
          <button
            class="switch" :class="{ on: lyricWindows.taskbar }"
            role="switch" :aria-checked="lyricWindows.taskbar"
            @click="toggleLyricWindow('taskbar', !lyricWindows.taskbar)"
          >
            <span class="knob" />
          </button>
        </div>
        <div class="tag-row" style="margin: 2px 0 8px">
          <button
            v-for="s in LYRIC_STYLES" :key="s"
            class="chip" :class="{ plain: lyricStyles.taskbar !== s }"
            @click="setLyricStyle('taskbar', s)"
          >{{ LYRIC_STYLE_NAMES[s] }}</button>
        </div>

        <div class="card-sub">
          样式：经典半透明 / 磨砂（Windows 11 原生亚克力）/ 液态（流动渐变 + 高光）。改动会实时应用到已打开的窗口。
        </div>
      </div>

      <!-- 日志 -->
      <div class="m3-card" style="margin-bottom: 16px">
        <div class="card-head"><UiIcon name="description" :size="18" /> 日志</div>
        <div class="set-row">
          <div class="set-label">
            <div>运行日志</div>
            <div class="card-sub">主进程与渲染层错误按天保存在 userData/logs</div>
          </div>
          <button class="chip" @click="openLogs">打开目录</button>
        </div>
      </div>

      <!-- 关于 -->
      <div class="m3-card">
        <div class="card-head">关于</div>
        <div class="hint" style="text-align: left">
          Kikoenai — 第三方、非官方桌面客户端（Vue 3 + Material 3）。<br />
          本程序不包含、也不分发任何音声内容；所有数据都来自你自行配置的服务器。<br />
          界面遵循 Material 3 设计规范，与任何站点或上游项目无隶属关系。<br />
          请遵守所在地区法律与所连服务器的使用条款。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-head {
  font-weight: 700; margin-bottom: 12px;
  display: flex; align-items: center; gap: 8px;
}
.card-sub { font-weight: 400; font-size: 11.5px; color: var(--md-on-surface-variant); }
.hint {
  font-size: 12px; line-height: 1.75; text-align: center;
  color: var(--md-on-surface-variant);
}
.account-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 0;
}
.acc-name { font-size: 13.5px; font-weight: 600; }
.acc-meta { font-size: 11.5px; color: var(--md-on-surface-variant); }
.kbd-list { display: grid; gap: 8px; font-size: 12.5px; color: var(--md-on-surface-variant); }
kbd {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 5px;
  border: 1px solid var(--md-outline-variant);
  background: var(--md-surface-container-high);
  color: var(--md-on-surface);
  font-family: inherit; font-size: 11.5px;
}
</style>
