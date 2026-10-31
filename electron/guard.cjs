/**
 * 网络与文件名的边界校验 —— 纯 Node，不依赖 Electron，便于单元测试。
 *
 * 两道规矩（整机统一，不许各处各写一份）：
 *  1. 只允许 http/https；拒绝 localhost、环回、私有、链路本地、保留地址。
 *    例外：用户自己配置的服务器主机（自建服务器通常在局域网）。
 *  2. 重定向必须逐跳校验 —— 公网地址 302 到 127.0.0.1 同样要被挡住。
 */
const path = require('node:path')

class BlockedUrlError extends Error {
  constructor(message, url) {
    super(message)
    this.name = 'BlockedUrlError'
    this.url = url
  }
}

/** 私有 / 环回 / 保留地址判定 */
function isPrivateHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (!h) return true
  if (h === 'localhost') return true
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true
  if (/^127\./.test(h)) return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true
  return false
}

/**
 * 校验服务端/界面给过来的地址。
 * @param {string} raw
 * @param {{ allowHosts?: string[] }} [opts] 允许的私有主机（用户自配服务器）
 * @returns {string|null} 规范化后的地址；不允许时返回 null
 */
function validateRemoteUrl(raw, opts = {}) {
  const allowHosts = (opts.allowHosts || [])
    .map((h) => String(h || '').toLowerCase())
    .filter(Boolean)
  let u
  try {
    u = new URL(String(raw))
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (isPrivateHost(u.hostname) && !allowHosts.includes(u.hostname.toLowerCase())) return null
  return u.toString()
}

/**
 * 带校验的转发。
 *
 * 首跳地址先校验；重定向交给 Chromium 自己跟随（媒体流/ Range 请求只有跟随模式才可靠，
 * 手动模式在 Electron 的 net.fetch 上对 302 到静态目录的行为不一致，会直接让音视频不出声），
 * 拿到响应后再检查最终地址，落在环回/私有地址上的响应一律丢弃，不交给渲染层。
 *
 * 残余风险：被跟随的那次请求本身已经发出（盲请求），但响应内容读取不到。
 * fetchImpl 由调用方注入（主进程传 net.fetch，测试传假实现）。
 */
async function fetchGuarded(rawUrl, init = {}, opts = {}) {
  const { fetch: fetchImpl, allowHosts = [] } = opts
  if (typeof fetchImpl !== 'function') throw new Error('fetchGuarded 需要注入 fetch 实现')

  const first = validateRemoteUrl(rawUrl, { allowHosts })
  if (!first) throw new BlockedUrlError('地址不被允许（仅公网 http/https）', String(rawUrl))

  const res = await fetchImpl(first, { ...init, redirect: 'follow' })

  if (res && res.redirected) {
    const finalUrl = typeof res.url === 'string' ? res.url : ''
    if (!finalUrl || !validateRemoteUrl(finalUrl, { allowHosts })) {
      throw new BlockedUrlError('重定向目标不被允许', finalUrl || first)
    }
  }
  return res
}

/** Windows 保留名 + 非法字符 + 结尾的点/空格 */
function sanitizeFileName(name) {
  let s = String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
  if (!s) return 'file'
  const base = s.split('.')[0]
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) s = '_' + s
  return s.slice(0, 180) || 'file'
}

/** target 是否在 root 之内（含 root 自身） */
function isInsideRoot(root, target) {
  if (!root || !target) return false
  const r = path.resolve(String(root))
  const t = path.resolve(String(target))
  if (r === t) return true
  const rel = path.relative(r, t)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

module.exports = {
  BlockedUrlError,
  isPrivateHost,
  validateRemoteUrl,
  fetchGuarded,
  sanitizeFileName,
  isInsideRoot,
}
