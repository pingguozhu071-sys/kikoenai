/** 推荐标识 — 本地持久化的匿名 uuid，用于区分推荐画像 */
const KEY = 'kikoeru-pc/recommenderUuid'

function makeUuid(): string {
  // 仅用于区分匿名推荐画像，不是安全凭据；优先用平台 CSPRNG
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const rnd = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(rnd)
  } else {
    // 无 CSPRNG 的环境（极老 WebView）：退化为时间戳派生的稳定标识，仍有唯一性
    const t = Date.now()
    for (let i = 0; i < 16; i++) rnd[i] = (t >> (i % 6) * 8) & 0xff
  }
  rnd[6] = (rnd[6] & 0x0f) | 0x40
  rnd[8] = (rnd[8] & 0x3f) | 0x80
  const hex = [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let cached: string | null = null

export function recommenderUuid(): string {
  if (cached) return cached
  let v = localStorage.getItem(KEY)
  if (!v) {
    v = makeUuid()
    localStorage.setItem(KEY, v)
  }
  cached = v
  return v
}
