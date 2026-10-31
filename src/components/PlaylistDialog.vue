<script setup lang="ts">
/**
 * 加入播放列表 —— 收藏夹在服务端就是一个 playlist：
 * 可加入默认收藏夹，或新建一个（私有）。
 */
import { onMounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import {
  addWorksToPlaylist, createPlaylist, getDefaultMarkPlaylist,
} from '../api/client'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const props = defineProps<{ modelValue: boolean; workId: number; workTitle: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const session = useSession
const defaultId = ref<number | string | null>(null)
const defaultName = ref('')
const newName = ref('')
const busy = ref(false)
const loading = ref(false)

async function loadDefault() {
  if (!session.loggedIn) return
  loading.value = true
  try {
    const meta = await getDefaultMarkPlaylist()
    defaultId.value = (meta?.id as number | string) ?? null
    defaultName.value = (meta?.name as string) || '默认收藏夹'
  } catch {
    defaultId.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDefault)
watch(() => props.modelValue, (v) => { if (v) void loadDefault() })

function close() { emit('update:modelValue', false) }

async function addToDefault() {
  if (!session.loggedIn) { ui.openLogin('播放列表需要登录'); return }
  if (defaultId.value === null) { toast('没有默认收藏夹，请新建一个', 'info'); return }
  busy.value = true
  try {
    await addWorksToPlaylist(defaultId.value, [props.workId])
    toast(`已加入「${defaultName.value}」`, 'success')
    close()
  } catch (e) {
    toast(`加入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    busy.value = false
  }
}

async function createAndAdd() {
  if (!session.loggedIn) { ui.openLogin('播放列表需要登录'); return }
  const name = newName.value.trim()
  if (!name) { toast('请输入播放列表名称', 'info'); return }
  busy.value = true
  try {
    await createPlaylist(name, 'private', [props.workId])
    toast(`已新建「${name}」并加入`, 'success')
    newName.value = ''
    close()
  } catch (e) {
    toast(`创建失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" :duration="{ enter: 240, leave: 180 }">
      <div v-if="modelValue" class="dl-backdrop" @click.self="close">
        <div class="pl-dialog">
          <header class="pl-head">
            <UiIcon name="queue_music" :size="18" />
            <span>加入播放列表</span>
            <div style="flex: 1" />
            <button class="icon-btn" @click="close"><UiIcon name="close" :size="16" /></button>
          </header>

          <div class="pl-body">
            <div class="pl-work">{{ workTitle }}</div>

            <div v-if="!session.loggedIn" class="pl-empty">
              登录后才能使用播放列表
              <button class="chip" @click="ui.openLogin('播放列表需要登录')">去登录</button>
            </div>

            <template v-else>
              <button class="pl-item" :disabled="busy || loading" @click="addToDefault">
                <UiIcon name="favorite" :size="17" />
                <span class="pl-name">{{ loading ? '读取中…' : defaultName || '默认收藏夹' }}</span>
                <span class="pl-tag">收藏夹</span>
              </button>

              <div class="pl-divider">或者新建一个</div>
              <div class="pl-create">
                <input v-model="newName" class="text-field" placeholder="播放列表名称" @keyup.enter="createAndAdd" />
                <button class="filled-btn slim" :disabled="busy || !newName.trim()" @click="createAndAdd">新建并加入</button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pl-dialog {
  width: 420px; max-height: 70vh;
  background: var(--md-surface-container-high);
  border-radius: 20px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 14px 50px color-mix(in srgb, var(--md-scrim) 55%, transparent);
}
.pl-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; font-weight: 700; font-size: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
}
.pl-body { padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.pl-work {
  font-size: 12px; color: var(--md-on-surface-variant);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: none; border-radius: 10px;
  background: color-mix(in srgb, var(--md-surface-container-lowest) 55%, transparent);
  color: var(--md-on-surface); font-family: inherit; font-size: 13px;
  cursor: pointer; text-align: left;
}
.pl-item:hover { background: var(--md-surface-container-highest); }
.pl-item:disabled { opacity: 0.5; cursor: default; }
.pl-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-tag {
  font-size: 10.5px; padding: 1px 6px; border-radius: 5px;
  background: color-mix(in srgb, var(--md-primary) 18%, transparent);
  color: var(--md-primary);
}
.pl-divider {
  font-size: 11.5px; color: var(--md-on-surface-variant);
  margin-top: 4px;
}
.pl-create { display: flex; gap: 8px; }
.pl-empty { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--md-on-surface-variant); }
</style>
