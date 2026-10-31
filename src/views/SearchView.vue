<script setup lang="ts">
/**
 * 搜索 — 支持命名空间语法与交互：
 *   $tag:标签$ / $va:声优$ / $circle:社团$ / $-tag:标签$ / "短语" / -排除
 *   输入中的 $tag: 会弹出候选（命名空间补全）
 * 服务端确认支持该语法，直接原样提交。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import SkeletonGrid from '../components/SkeletonGrid.vue'
import SortMenu from '../components/SortMenu.vue'
import { searchWorks, getCategories, type CategoryItem, type CategoryKind } from '../api/client'
import { useWorkFeed } from '../composables/useWorkFeed'
import { SORT_OPTIONS, DEFAULT_SORT, type SortOption } from '../constants/sort'
import { parseMulti, termLabel, termsToKeyword, NAMESPACES, type SearchTerm } from '../search/parser'
import { toast } from '../stores/toast'

const route = useRoute()
const router = useRouter()

const keyword = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const searched = ref(false)
const sortKey = ref(DEFAULT_SORT.key)
const sortOpt = ref<SortOption>(DEFAULT_SORT)
const helpOpen = ref(false)

const terms = computed(() => parseMulti(keyword.value))
const effectiveKeyword = computed(() => termsToKeyword(terms.value))

// ---------- 最近搜索 ----------
const RECENT_KEY = 'kikoeru-pc/recent'
const recent = ref<string[]>(loadRecent())
function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, 10) : []
  } catch { return [] }
}
function pushRecent(kw: string) {
  recent.value = [kw, ...recent.value.filter((x) => x !== kw)].slice(0, 10)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
}
function clearRecent() {
  recent.value = []
  localStorage.removeItem(RECENT_KEY)
}

// ---------- 结果流 ----------
const { works, total, loading, firstLoad, error, hasMore, scroller, sentinel, onScroll, maybeLoadMore, reload, reset } = useWorkFeed(
  (p, ps) => searchWorks(effectiveKeyword.value, p, sortOpt.value.order, sortOpt.value.sort, ps),
  60,
  false,
)

function runSearch() {
  const kw = effectiveKeyword.value.trim()
  if (!kw) {
    toast('请输入关键词', 'info')
    return
  }
  keyword.value = keyword.value.trim()
  searched.value = true
  pushRecent(kw)
  void reload((p, ps) => searchWorks(kw, p, sortOpt.value.order, sortOpt.value.sort, ps))
}

function onSort(opt: SortOption) {
  sortOpt.value = opt
  if (searched.value) runSearch()
}

/** 中文输入法回车只确认候选词 */
function onEnter(e: KeyboardEvent) {
  const composing = e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229
  if (composing) return
  if (suggestions.value.length) {
    pickSuggestion(suggestions.value[0])
    return
  }
  runSearch()
}

function clearAll() {
  keyword.value = ''
  searched.value = false
  reset()
  inputEl.value?.focus()
}

function removeTerm(t: SearchTerm) {
  // 从输入里删掉这一段（按原文匹配一次）
  const i = keyword.value.indexOf(t.raw)
  if (i >= 0) {
    keyword.value = (keyword.value.slice(0, i) + keyword.value.slice(i + t.raw.length)).trim()
  }
}

// ---------- 命名空间补全 ----------
const catCache = new Map<CategoryKind, CategoryItem[]>()
const suggestLoading = ref(false)

async function ensureCategories(kind: CategoryKind): Promise<CategoryItem[]> {
  const hit = catCache.get(kind)
  if (hit) return hit
  suggestLoading.value = true
  try {
    const list = await getCategories(kind)
    const sorted = [...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    catCache.set(kind, sorted)
    return sorted
  } catch {
    return []
  } finally {
    suggestLoading.value = false
  }
}

/** 当前正在补全的片段（末尾未闭合的 $ns 或 $ns:value） */
const pending = computed(() => {
  const t = terms.value[terms.value.length - 1]
  if (!t) return null
  if (t.type === 'partial') return { ns: t.namespace, value: t.value }
  if (t.type === 'namespace') return { ns: t.namespace, value: '' }
  return null
})

const suggestions = ref<{ label: string; insert: string }[]>([])
const nsOptions = computed(() =>
  NAMESPACES.filter((n) => !pending.value || n.key.startsWith(pending.value.ns)),
)

watch([pending, keyword], async () => {
  const p = pending.value
  if (!p) { suggestions.value = []; return }
  const ns = String(p.ns || '').toLowerCase()
  const kind: CategoryKind | null = ns.startsWith('tag') ? 'tag' : ns === 'va' ? 'va' : ns === 'circle' ? 'circle' : null
  if (!kind) { suggestions.value = []; return }

  const list = await ensureCategories(kind)
  const q = p.value.trim().toLowerCase()
  suggestions.value = list
    .filter((x) => !q || String(x.name).toLowerCase().includes(q))
    .slice(0, 8)
    .map((x) => ({
      label: `${x.name}`,
      insert: `$${ns.startsWith('tag') ? 'tag' : ns}:${x.name}$ `,
    }))
}, { immediate: true })

function pickSuggestion(s: { insert: string }) {
  const i = keyword.value.lastIndexOf('$')
  if (i >= 0) keyword.value = keyword.value.slice(0, i) + s.insert
  else keyword.value = `${keyword.value} ${s.insert}`.trim()
  suggestions.value = []
  inputEl.value?.focus()
}

function insertNs(nsKey: string) {
  const i = keyword.value.lastIndexOf('$')
  const insert = `$${nsKey}:`
  if (i >= 0) keyword.value = keyword.value.slice(0, i) + insert
  else keyword.value = `${keyword.value} ${insert}`.trim()
  inputEl.value?.focus()
}

// ---------- 初始化 ----------
function fromRoute() {
  const kw = route.query.kw ? String(route.query.kw) : ''
  if (kw) {
    keyword.value = kw
    runSearch()
  } else {
    inputEl.value?.focus()
  }
}

watch(() => route.query.kw, (kw) => {
  const q = kw ? String(kw) : ''
  if (!q || q === effectiveKeyword.value) return
  keyword.value = q
  runSearch()
})

onMounted(() => {
  const pendingKw = sessionStorage.getItem('kikoeru-pc/pendingKw')
  if (pendingKw) {
    sessionStorage.removeItem('kikoeru-pc/pendingKw')
    if (!route.query.kw) {
      keyword.value = pendingKw
      runSearch()
      return
    }
  }
  fromRoute()
})

const hasSpecial = computed(() => terms.value.some((t) => t.type === 'special'))
</script>

<template>
  <div class="view">
    <div v-if="loading" class="loading-bar" />
    <header class="app-header">
      <div class="header-left">
        <span class="brand">搜索</span>
        <span v-if="searched && total" class="count">{{ total.toLocaleString() }} 条</span>
      </div>

      <div class="search-wrap">
        <div class="header-search">
          <UiIcon name="search" :size="17" class="search-ico" />
          <input
            ref="inputEl" v-model="keyword" class="search-input"
            placeholder='支持 $tag:舔耳$ / $va:名字$ / -排除 / "短语"'
            @keydown.enter="onEnter"
          />
          <button v-if="keyword" class="icon-btn clear-btn" title="清空" @click="clearAll">
            <UiIcon name="close" :size="15" />
          </button>
        </div>

        <!-- 补全 / 命名空间 -->
        <div v-if="pending || suggestions.length" class="suggest-panel">
          <div class="suggest-section" v-if="!suggestions.length">
            <div class="suggest-title">按命名空间过滤</div>
            <div class="tag-row" style="margin: 4px 0 0">
              <button v-for="n in nsOptions" :key="n.key" class="chip" @click="insertNs(n.key)">
                ${{ n.key }}: {{ n.label }}
              </button>
            </div>
          </div>
          <div class="suggest-section" v-else>
            <div class="suggest-title">
              {{ suggestLoading ? '加载候选…' : `候选（${pending?.ns}）` }}
            </div>
            <button
              v-for="(s, i) in suggestions" :key="s.insert"
              class="suggest-item" :class="{ active: i === 0 }"
              @click="pickSuggestion(s)"
            >{{ s.label }}</button>
          </div>
        </div>
      </div>

      <div class="header-right">
        <SortMenu v-model="sortKey" @change="onSort" />
        <button class="icon-btn" title="搜索语法" @click="helpOpen = !helpOpen">
          <UiIcon name="help" :size="19" />
        </button>
        <button class="filled-btn slim" :disabled="!effectiveKeyword" @click="runSearch">搜索</button>
      </div>
    </header>

    <!-- 语法帮助 -->
    <Transition name="fade">
      <div v-if="helpOpen" class="syntax-help">
        <div class="syntax-row"><code>$tag:舔耳$</code><span>只搜带该标签的作品</span></div>
        <div class="syntax-row"><code>$va:陽向葵ゅか$</code><span>只搜该声优</span></div>
        <div class="syntax-row"><code>$circle:HONEY NOIR$</code><span>只搜该社团</span></div>
        <div class="syntax-row"><code>$-tag:舔耳$</code><span>排除该标签（- 放在 $ 前）</span></div>
        <div class="syntax-row"><code>"耳かき 添い寝"</code><span>整句匹配，不拆词</span></div>
        <div class="syntax-row"><code>-NTR</code><span>纯文本排除</span></div>
        <div class="syntax-note">输入 <code>$tag:</code> 时会自动弹出标签候选；回车确认第一项。</div>
      </div>
    </Transition>

    <div ref="scroller" class="page-scroll" @scroll.passive="onScroll">
      <!-- 已解析的词组 -->
      <div v-if="hasSpecial" class="term-row">
        <span class="term-hint">生效条件</span>
        <button v-for="t in terms" :key="t.raw" class="term-chip" :class="{ exclude: t.isExclude }" @click="removeTerm(t)">
          {{ termLabel(t) }}
          <UiIcon name="close" :size="12" />
        </button>
      </div>

      <!-- 初始 -->
      <div v-if="!searched && !loading" class="empty-state" style="padding: 44px 0">
        <template v-if="recent.length">
          <div style="font-size: 13px; color: var(--md-on-surface-variant)">最近搜索</div>
          <div class="tag-row" style="justify-content: center; max-width: 680px">
            <button v-for="r in recent" :key="r" class="chip plain" @click="keyword = r; runSearch()">{{ r }}</button>
          </div>
          <button class="chip" @click="clearRecent">清空记录</button>
        </template>
        <template v-else>
          <UiIcon name="search" :size="40" />
          <div>
            输入 RJ 号直达作品，或试试<br />
            <code>$tag:舔耳$ $va:陽向葵ゅか$ -NTR</code>
          </div>
        </template>
      </div>

      <SkeletonGrid v-else-if="loading && !works.length" :count="12" />

      <div v-else-if="error" class="empty-state">
        <UiIcon name="refresh" :size="36" />
        <div>{{ error }}</div>
        <button class="filled-btn" @click="runSearch">重试</button>
      </div>

      <div v-else-if="searched && !works.length" class="empty-state">
        <UiIcon name="search" :size="38" />
        <div>没有找到匹配的作品</div>
        <div class="term-hint">试试去掉部分条件，或检查 <code>$tag:</code> 里的名字是否完整</div>
      </div>

      <div v-else class="works-grid">
        <WorkCard v-for="w in works" :key="w.id" :work="w" />
      </div>

      <div ref="sentinel" class="sentinel" />

      <div v-if="works.length && loading" class="load-more">
        <span class="spinner" style="border-color: color-mix(in srgb, var(--md-on-surface) 18%, transparent); border-top-color: var(--md-primary)" />
        加载中
      </div>
      <div v-else-if="works.length && hasMore" class="load-more">
        <button class="filled-btn slim" @click="maybeLoadMore">加载更多</button>
      </div>
      <div v-else-if="works.length" class="load-more done">
        共 {{ total.toLocaleString() }} 条结果
      </div>
    </div>
  </div>
</template>

<style scoped>
.clear-btn { position: absolute; right: 2px; width: 32px; height: 32px; }
.search-wrap { position: relative; flex: 1; max-width: 620px; }
.suggest-panel {
  position: absolute; top: 46px; left: 0; right: 0; z-index: 40;
  background: var(--md-surface-container-high);
  border-radius: 12px; padding: 10px;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--md-scrim) 45%, transparent);
}
.suggest-section + .suggest-section { margin-top: 8px; }
.suggest-title { font-size: 11.5px; color: var(--md-on-surface-variant); margin-bottom: 4px; }
.suggest-item {
  display: block; width: 100%; text-align: left;
  border: none; background: transparent; color: var(--md-on-surface);
  font-family: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px; cursor: pointer;
}
.suggest-item:hover, .suggest-item.active { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
.syntax-help {
  position: absolute; right: 28px; top: 66px; z-index: 45;
  width: 348px; padding: 14px 16px;
  background: var(--md-surface-container-high); border-radius: 14px;
  box-shadow: 0 12px 34px color-mix(in srgb, var(--md-scrim) 45%, transparent);
  display: flex; flex-direction: column; gap: 8px;
}
.syntax-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.syntax-row code, .syntax-note code { background: color-mix(in srgb, var(--md-on-surface) 10%, transparent); padding: 1px 6px; border-radius: 5px; font-size: 11.5px; }
.syntax-row span { color: var(--md-on-surface-variant); }
.syntax-note { font-size: 11.5px; color: var(--md-on-surface-variant); margin-top: 4px; line-height: 1.6; }
.term-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 10px 0 14px; }
.term-hint { font-size: 11.5px; color: var(--md-on-surface-variant); }
.term-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 9px; border-radius: 7px; border: none;
  background: var(--md-primary-container); color: var(--md-on-primary-container);
  font-family: inherit; font-size: 11.5px; cursor: pointer;
}
.term-chip.exclude { background: var(--md-error-container); color: var(--md-on-error-container); }
.term-chip:hover { filter: brightness(1.06); }
</style>
