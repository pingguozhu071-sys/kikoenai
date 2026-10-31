/** 轻量提示（toast）—— 收藏成功、加载失败之类的即时反馈 */
import { reactive } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

const state = reactive<{ list: ToastItem[] }>({ list: [] })
let seq = 0

export function toast(text: string, kind: ToastKind = 'info', ms = 2600) {
  const id = ++seq
  state.list.push({ id, text, kind })
  window.setTimeout(() => {
    const i = state.list.findIndex((t) => t.id === id)
    if (i >= 0) state.list.splice(i, 1)
  }, ms)
}

export function useToasts() {
  return state
}
