<script setup lang="ts">
/**
 * 登录 / 注册弹窗：
 *   GET  /api/auth/reg  检查是否开放注册
 *   POST /api/auth/me   {name,password} → {token}
 *   POST /api/auth/reg  {name,password,recommenderUuid}
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import { login, register, regEnabled } from '../api/client'
import { useSession } from '../stores/session'
import { recommenderUuid } from '../stores/recommender'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const session = useSession

const name = ref('')
const password = ref('')
const password2 = ref('')
const busy = ref(false)
const error = ref('')
const canRegister = ref(false)
const mode = ref<'login' | 'register'>('login')

watch(() => ui.loginOpen, (open) => {
  if (open) {
    mode.value = ui.loginMode
    error.value = ''
    password.value = ''
    password2.value = ''
  }
})

const title = computed(() => (mode.value === 'login' ? '登录' : '注册账号'))

onMounted(async () => {
  canRegister.value = await regEnabled()
})
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.loginOpen) ui.closeLogin()
}

function switchMode(m: 'login' | 'register') {
  mode.value = m
  error.value = ''
}

async function submit() {
  error.value = ''
  const n = name.value.trim()
  if (n.length < 5) { error.value = '用户名至少 5 个字符（服务端规则）'; return }
  if (password.value.length < 5) { error.value = '密码至少 5 个字符（服务端规则）'; return }
  if (mode.value === 'register' && password.value !== password2.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  busy.value = true
  try {
    const res = mode.value === 'login'
      ? await login(n, password.value)
      : await register(n, password.value, recommenderUuid())

    if (!res.ok) {
      error.value = res.errors?.length
        ? res.errors.map((e) => e.msg ?? '').filter(Boolean).join('；')
        : (res.error ?? '操作失败')
      return
    }
    session.adoptToken(n, res.token!, 'Kikoeru')
    ui.closeLogin()
    toast(mode.value === 'login' ? `欢迎回来，${n}` : `注册成功，${n}`, 'success')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" :duration="{ enter: 260, leave: 200 }">
      <div v-if="ui.loginOpen" class="dialog-backdrop" @click.self="ui.closeLogin()">
        <div class="dialog-card" role="dialog" aria-modal="true">
          <button class="dialog-close icon-btn" title="关闭" @click="ui.closeLogin()">
            <UiIcon name="close" :size="18" />
          </button>

          <div class="dialog-head">
            <div class="dialog-logo">K</div>
            <div>
              <div class="dialog-title">{{ title }}</div>
              <div class="dialog-sub">
                {{ ui.loginReason || '登录后可同步收藏与播放进度' }}
              </div>
            </div>
          </div>

          <div class="dialog-tabs">
            <button class="dialog-tab" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
            <button
              class="dialog-tab" :class="{ active: mode === 'register' }"
              :disabled="!canRegister" :title="canRegister ? '' : '该服务器未开放注册'"
              @click="switchMode('register')"
            >注册</button>
          </div>

          <Transition name="fade">
            <div v-if="error" class="login-error">{{ error }}</div>
          </Transition>

          <input
            v-model="name" class="text-field" placeholder="用户名（≥5 字符）"
            autocomplete="username" @keyup.enter="submit"
          />
          <input
            v-model="password" class="text-field" type="password" placeholder="密码（≥5 字符）"
            autocomplete="current-password" @keyup.enter="submit"
          />
          <input
            v-if="mode === 'register'"
            v-model="password2" class="text-field" type="password" placeholder="再次输入密码"
            autocomplete="new-password" @keyup.enter="submit"
          />

          <button class="filled-btn dialog-submit" :disabled="busy" @click="submit">
            {{ busy ? '处理中…' : (mode === 'login' ? '登录' : '注册并登录') }}
          </button>

          <div class="dialog-foot">
            <template v-if="mode === 'login'">
              还没有账号？
              <button class="link" :disabled="!canRegister" @click="switchMode('register')">
                {{ canRegister ? '注册一个' : '该服务器未开放注册' }}
              </button>
            </template>
            <template v-else>
              已有账号？<button class="link" @click="switchMode('login')">去登录</button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
