<script setup lang="ts">
/**
 * 播放列表 —— 列出账号下的所有列表，可新建、删除、查看里面的作品。
 * 收藏夹本身也是其中一个列表（默认 mark playlist）。
 */
import { computed, onMounted, ref } from 'vue'
import UiIcon from '../components/UiIcon.vue'
import WorkCard from '../components/WorkCard.vue'
import { createPlaylist, deletePlaylist, getPlaylistWorks, getPlaylists } from '../api/client'
import type { PlaylistMeta, Work } from '../api/types'
import { useSession } from '../stores/session'
import { toast } from '../stores/toast'
import { ui } from '../stores/ui'

const session = useSession

const loading = ref(false)
const lists = ref<PlaylistMeta[]>([])
const newName = ref('')
const creating = ref(false)

const active = ref<PlaylistMeta | null>(null)
const works = ref<Work[]>([])
const worksLoading = ref(false)

const isLoggedIn = computed(() => session.loggedIn)

async function load() {
  if (!isLoggedIn.value) return
  loading.value = true
  try {
    // __SYS_PLAYLIST_MARKED / _LIKED 是服务端自建的收藏夹，不能当普通列表展示或删除
    lists.value = (await getPlaylists()).filter((p) => !String(p.name || '').startsWith('__SYS'))
  } catch (e) {
    toast(`加载播放列表失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    loading.value = false
  }
}

async function open(list: PlaylistMeta) {
  active.value = list
  works.value = []
  worksLoading.value = true
  try {
    // 元数据接口只给数量，作品要单独分页取
    const all: Work[] = []
    let page = 1
    for (;;) {
      const res = await getPlaylistWorks(list.id, page, 60)
      all.push(...(res.works ?? []))
      const total = res.pagination?.totalCount ?? all.length
      if (!res.works?.length || all.length >= total || page > 50) break
      page++
    }
    works.value = all
  } catch (e) {
    toast(`读取列表失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    worksLoading.value = false
  }
}

function back() {
  active.value = null
  works.value = []
}

async function create() {
  const name = newName.value.trim()
  if (!name) { toast('先填列表名称', 'info'); return }
  creating.value = true
  try {
    await createPlaylist(name)
    newName.value = ''
    toast('已创建播放列表', 'success')
    await load()
  } catch (e) {
    toast(`创建失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    creating.value = false
  }
}

async function remove(list: PlaylistMeta) {
  if (String(list.name || '').startsWith('__SYS')) return
  const label = list.name || String(list.id)
  if (!window.confirm(`删除播放列表「${label}」？只会删列表，不会删作品本身。`)) return
  try {
    await deletePlaylist(list.id)
    toast('已删除', 'success')
    if (active.value && active.value.id === list.id) back()
    await load()
  } catch (e) {
    toast(`删除失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="view">
    <header class="app-header">
      <div class="header-left">
        <span class="brand">播放列表</span>
        <span v-if="!active && lists.length" class="count">{{ lists.length }} 个</span>
      </div>
      <div class="header-right">
        <button v-if="active" class="chip" @click="back">
          <UiIcon name="expand_more" :size="15" style="transform: rotate(90deg)" /> 返回列表
        </button>
      </div>
    </header>

    <div class="page-scroll">
      <div v-if="!isLoggedIn" class="empty-state" style="padding: 48px 0">
        <UiIcon name="subscriptions" :size="36" />
        <div>播放列表需要登录</div>
        <button class="filled-btn" @click="ui.openLogin()">登录</button>
      </div>

      <template v-else-if="!active">
        <div class="m3-card" style="margin-bottom: 16px">
          <div class="card-head"><UiIcon name="queue_music" :size="18" /> 新建播放列表</div>
          <div class="tag-row" style="margin: 0">
            <input
              v-model="newName" class="text-field" style="max-width: 320px"
              placeholder="列表名称" spellcheck="false"
              @keydown.enter="create"
            />
            <button class="filled-btn slim" :disabled="creating" @click="create">创建</button>
          </div>
        </div>

        <div v-if="loading" class="empty-state" style="padding: 40px 0">加载中…</div>

        <div v-else-if="!lists.length" class="empty-state" style="padding: 40px 0">
          <UiIcon name="queue_music" :size="34" />
          <div>还没有播放列表</div>
        </div>

        <div v-else class="pl-grid">
          <div v-for="l in lists" :key="String(l.id)" class="m3-card pl-card">
            <div class="pl-main" @click="open(l)">
              <div class="pl-name">{{ l.name || `列表 ${l.id}` }}</div>
              <div class="card-sub">
                {{ l.workCount ?? l.works?.length ?? 0 }} 部
                <template v-if="l.privacy === 'public'"> · 公开</template>
                <template v-else-if="l.privacy"> · 私密</template>
              </div>
            </div>
            <button class="icon-btn" title="删除列表" @click.stop="remove(l)">
              <UiIcon name="close" :size="15" />
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="card-head pl-active-title">{{ active.name || `列表 ${active.id}` }}</div>
        <div v-if="worksLoading" class="empty-state" style="padding: 40px 0">加载中…</div>
        <div v-else-if="!works.length" class="empty-state" style="padding: 40px 0">
          <UiIcon name="queue_music" :size="34" />
          <div>这个列表还是空的</div>
          <div class="card-sub">在作品详情页点「加入列表」即可添加</div>
        </div>
        <div v-else class="works-grid">
          <WorkCard v-for="w in works" :key="w.id" :work="w" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.pl-card {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 14px 14px 16px;
  cursor: default;
}
.pl-main { flex: 1; min-width: 0; cursor: pointer; }
.pl-name {
  font-size: 13.5px; font-weight: 600; margin-bottom: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-active-title { margin: 4px 0 14px; font-weight: 700; }
</style>
