<script setup lang="ts">
/** 标签纠错 —— 对作品标签投赞成/反对（/api/vote/vote-work-tag） */
import { ref } from 'vue'
import UiIcon from './UiIcon.vue'
import type { TagRef } from '../api/types'
import { voteWorkTag } from '../api/client'
import { useSession } from '../stores/session'
import { ui } from '../stores/ui'
import { toast } from '../stores/toast'

const props = defineProps<{ modelValue: boolean; workId: number; tags: TagRef[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const session = useSession
const busy = ref<number | null>(null)
const done = ref<Record<number, 1 | 2>>({})

async function vote(tag: TagRef, status: 1 | 2) {
  if (!session.loggedIn) { ui.openLogin('标签投票需要登录'); return }
  if (busy.value !== null) return
  busy.value = tag.id
  try {
    await voteWorkTag(props.workId, tag.id, status)
    done.value = { ...done.value, [tag.id]: status }
    toast(status === 1 ? `已赞成「${tag.name}」` : `已反对「${tag.name}」`, 'success')
  } catch (e) {
    toast(`投票失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    busy.value = null
  }
}

function close() { emit('update:modelValue', false) }
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" :duration="{ enter: 240, leave: 180 }">
      <div v-if="modelValue" class="dl-backdrop" @click.self="close">
        <div class="vote-dialog">
          <header class="vote-head">
            <UiIcon name="check" :size="18" />
            <span>标签纠错</span>
            <div style="flex: 1" />
            <button class="icon-btn" @click="close"><UiIcon name="close" :size="16" /></button>
          </header>
          <div class="vote-body">
            <div v-if="!tags.length" class="empty-state" style="padding: 26px 0; font-size: 12.5px">这个作品还没有标签</div>
            <div v-for="t in tags" :key="t.id" class="vote-row">
              <span class="vote-name">{{ t.name }}</span>
              <button class="vote-btn up" :class="{ on: done[t.id] === 1 }" :disabled="busy === t.id" @click="vote(t, 1)">
                <UiIcon name="thumb_up" :size="15" />
              </button>
              <button class="vote-btn down" :class="{ on: done[t.id] === 2 }" :disabled="busy === t.id" @click="vote(t, 2)">
                <UiIcon name="thumb_down" :size="15" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vote-dialog {
  width: 420px; max-height: 72vh;
  background: var(--md-surface-container-high);
  border-radius: 20px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 14px 50px color-mix(in srgb, var(--md-scrim) 55%, transparent);
}
.vote-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; font-weight: 700; font-size: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
}
.vote-body { padding: 8px 12px 14px; overflow-y: auto; }
.vote-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--md-outline-variant) 22%, transparent);
}
.vote-name { flex: 1; min-width: 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vote-btn {
  width: 30px; height: 28px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--md-outline-variant) 60%, transparent);
  background: transparent; color: var(--md-on-surface-variant);
  display: grid; place-items: center; cursor: pointer;
  transition: background-color 0.18s, color 0.18s, border-color 0.18s;
}
.vote-btn.up:hover { color: #2e7d32; border-color: #2e7d32; }
.vote-btn.down:hover { color: #c62828; border-color: #c62828; }
.vote-btn.up.on { background: color-mix(in srgb, #2e7d32 22%, transparent); color: #66bb6a; border-color: #2e7d32; }
.vote-btn.down.on { background: color-mix(in srgb, #c62828 22%, transparent); color: #ef5350; border-color: #c62828; }
</style>
