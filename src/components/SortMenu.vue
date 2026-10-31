<script setup lang="ts">
/** 排序菜单 — 选项见 constants/sort.ts */
import { ref, onMounted, onUnmounted } from 'vue'
import UiIcon from './UiIcon.vue'
import { SORT_OPTIONS, type SortOption } from '../constants/sort'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [key: string]; change: [opt: SortOption] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function current(): SortOption {
  return SORT_OPTIONS.find((o) => o.key === props.modelValue) ?? SORT_OPTIONS[1]
}

function choose(opt: SortOption) {
  open.value = false
  emit('update:modelValue', opt.key)
  emit('change', opt)
}

function onDocClick(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="sort-root">
    <button class="sort-btn" :class="{ open }" @click="open = !open">
      <UiIcon name="sort" :size="17" />
      <span>{{ current().label }}</span>
      <UiIcon name="expand_more" :size="16" class="chev" />
    </button>

    <Transition name="menu">
      <div v-if="open" class="menu sort-menu">
        <button
          v-for="opt in SORT_OPTIONS" :key="opt.key"
          class="menu-item" :class="{ active: opt.key === modelValue }"
          @click="choose(opt)"
        >
          <span>{{ opt.label }}</span>
          <UiIcon v-if="opt.key === modelValue" name="check" :size="15" />
        </button>
      </div>
    </Transition>
  </div>
</template>
