<script setup lang="ts">
/**
 * 分类浏览 — 标签 / 社团 / 声优。
 * 数据来自 /api/tags|circles|vas，字段 {id,name,count}，按作品数降序。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import { getCategories, type CategoryItem, type CategoryKind } from '../api/client'
import { toast } from '../stores/toast'

const router = useRouter()

const KINDS: { key: CategoryKind; label: string; unit: string }[] = [
  { key: 'tag', label: '标签', unit: '个' },
  { key: 'circle', label: '社团', unit: '个' },
  { key: 'va', label: '声优', unit: '位' },
]

const kind = ref<CategoryKind>('tag')
const all = ref<CategoryItem[]>([])
const loading = ref(false)
const filter = ref('')
const expanded = ref(false)

const sorted = computed(() =>
  [...all.value].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
)

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return sorted.value
  return sorted.value.filter((x) => x.name.toLowerCase().includes(q))
})

const visible = computed(() =>
  filter.value.trim() || expanded.value ? filtered.value : filtered.value.slice(0, 120),
)

async function load() {
  loading.value = true
  try {
    all.value = await getCategories(kind.value)
    expanded.value = false
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
    all.value = []
  } finally {
    loading.value = false
  }
}

function open(item: CategoryItem) {
  void router.push({
    path: `/list/${kind.value}/${encodeURIComponent(String(item.id))}`,
    query: { name: item.name },
  })
}

watch(kind, load)
onMounted(load)

function currentKind() {
  return KINDS.find((k) => k.key === kind.value)!
}
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <div class="header-left">
        <span class="brand">{{ currentKind().label }}</span>
        <span v-if="all.length" class="count">{{ all.length.toLocaleString() }} {{ currentKind().unit }}</span>
      </div>
      <div class="header-search">
        <UiIcon name="search" :size="17" class="search-ico" />
        <input v-model="filter" class="search-input" :placeholder="`筛选${currentKind().label}…`" />
      </div>
    </header>

    <div class="page-scroll">
      <div class="library-tabs">
        <button
          v-for="k in KINDS" :key="k.key"
          class="lib-tab" :class="{ active: kind === k.key }"
          @click="kind = k.key"
        >{{ k.label }}</button>
      </div>

      <div v-if="loading" class="empty-state">加载中<span class="loading-dots">…</span></div>

      <div v-else class="cat-grid">
        <button v-for="item in visible" :key="item.id" class="cat-item" @click="open(item)">
          <span class="cat-name">{{ item.name }}</span>
          <span class="cat-count">{{ item.count }}</span>
        </button>
      </div>

      <div v-if="!filter && !expanded && filtered.length > visible.length" class="load-more">
        <button class="filled-btn slim" @click="expanded = true">
          显示全部 {{ filtered.length.toLocaleString() }} 个
        </button>
      </div>
    </div>
  </div>
</template>
