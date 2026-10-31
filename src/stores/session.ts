/**
 * 会话状态 — 多账号，持久化到 localStorage。
 * 服务端协议：POST /api/auth/me {name,password} → {token}，JWT HS256 30 天有效。
 * 注意：/api/review（收藏/进度）需要鉴权，匿名会被 401。
 */
import { reactive, computed } from 'vue'
import * as api from '../api/client'

export interface Account {
  name: string
  token: string
  serverLabel: string
  savedAt: number
}

const STORAGE_KEY = 'kikoeru-pc/session'

interface Persisted {
  accounts: Account[]
  currentName: string | null
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted
      if (Array.isArray(parsed.accounts)) return parsed
    }
  } catch { /* 损坏则重置 */ }
  return { accounts: [], currentName: null }
}

const state = reactive<Persisted>(load())

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const useSession = reactive({
  get accounts(): Account[] { return state.accounts },
  get currentName(): string | null { return state.currentName },
  get current(): Account | null {
    return state.accounts.find((a) => a.name === state.currentName) ?? null
  },
  get token(): string { return this.current?.token ?? '' },
  get userName(): string { return this.current?.name ?? '' },
  get loggedIn(): boolean { return this.current !== null },

  currentIs(name: string) { return state.currentName === name },

  /** 直接用已获得的 token 建立/更新账号（登录与注册共用） */
  adoptToken(name: string, token: string, serverLabel: string) {
    const existing = state.accounts.find((a) => a.name === name)
    if (existing) {
      existing.token = token
      existing.serverLabel = serverLabel
      existing.savedAt = Date.now()
    } else {
      state.accounts.push({ name, token, serverLabel, savedAt: Date.now() })
    }
    state.currentName = name
    persist()
  },

  /** 登录成功后写入账号并切为当前；返回错误文案或 null */
  async login(name: string, password: string, serverLabel: string): Promise<string | null> {
    const res = await api.login(name, password)
    if (!res.ok) {
      if (res.errors?.length) return res.errors.map((e) => e.msg ?? '').join('；')
      return res.error ?? '登录失败'
    }
    const token = res.token!
    const existing = state.accounts.find((a) => a.name === name)
    if (existing) {
      existing.token = token
      existing.serverLabel = serverLabel
      existing.savedAt = Date.now()
    } else {
      state.accounts.push({ name, token, serverLabel, savedAt: Date.now() })
    }
    state.currentName = name
    persist()
    return null
  },

  switchTo(name: string) {
    state.currentName = name
    persist()
  },

  logout(name?: string) {
    const target = name ?? state.currentName
    state.accounts = state.accounts.filter((a) => a.name !== target)
    if (state.currentName === target) {
      state.currentName = state.accounts[0]?.name ?? null
    }
    persist()
  },

  _reloginCallback: null as null | (() => void),
  onRelogin(cb: () => void) { this._reloginCallback = cb },
  requireRelogin() {
    // token 失效：清掉当前账号的凭据，让用户重新登录
    if (state.currentName) {
      state.accounts = state.accounts.filter((a) => a.name !== state.currentName)
      state.currentName = state.accounts[0]?.name ?? null
      persist()
    }
    this._reloginCallback?.()
  },
})

export const sessionLabel = computed(() => useSession.current?.serverLabel ?? '未登录')
