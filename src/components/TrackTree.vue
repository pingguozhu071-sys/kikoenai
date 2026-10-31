<script setup lang="ts">
/** 音轨树 — 递归渲染服务端 /api/tracks/{id} 的树状 JSON */
import { ref } from 'vue'
import UiIcon from './UiIcon.vue'
import type { TrackNode } from '../api/types'
import { player } from '../stores/player'
import { extOf } from '../utils/format'

const props = defineProps<{
  nodes: TrackNode[]
  depth?: number
  /** 正在播放音轨的原始 mediaStreamUrl（唯一标识，避免同名文件重复高亮） */
  currentStream?: string
}>()

const emit = defineEmits<{
  play: [node: TrackNode]
  download: [node: TrackNode]
  open: [node: TrackNode]
}>()

const collapsed = ref<Set<string>>(new Set())

function key(n: TrackNode, i: number): string {
  return `${props.depth ?? 0}-${i}-${n.title}`
}

function isCollapsed(n: TrackNode, i: number): boolean {
  return collapsed.value.has(key(n, i))
}

function toggleFolder(n: TrackNode, i: number) {
  const k = key(n, i)
  const next = new Set(collapsed.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  collapsed.value = next
}

const typeIcon: Record<string, string> = {
  audio: 'music_note',
  text: 'description',
  image: 'image',
}

function isPlaying(n: TrackNode): boolean {
  return !!props.currentStream && n.mediaStreamUrl === props.currentStream
}

function countLeaves(list: TrackNode[]): number {
  let total = 0
  for (const n of list) {
    if (n.type === 'folder' && n.children) total += countLeaves(n.children)
    else if (n.type === 'audio') total++
  }
  return total
}
</script>

<template>
  <ul class="track-tree">
    <li v-for="(n, i) in nodes" :key="key(n, i)" class="tree-node">
      <!-- 文件夹 -->
      <template v-if="n.type === 'folder'">
        <div class="tree-folder" :class="{ collapsed: isCollapsed(n, i) }" @click="toggleFolder(n, i)">
          <span class="tree-indent" :style="{ width: `${(depth ?? 0) * 16}px` }" />
          <UiIcon class="chev" name="expand_more" :size="16" />
          <UiIcon :name="isCollapsed(n, i) ? 'folder' : 'folder_open'" :size="17" />
          <span class="tree-title">{{ n.title }}</span>
          <span class="ext">{{ n.children ? countLeaves(n.children) : 0 }}</span>
        </div>
        <TrackTree
          v-if="!isCollapsed(n, i) && n.children"
          :nodes="n.children"
          :depth="(depth ?? 0) + 1"
          :current-stream="currentStream"
          @play="(node) => emit('play', node)"
          @download="(node) => emit('download', node)"
          @open="(node) => emit('open', node)"
        />
      </template>

      <!-- 叶子 -->
      <template v-else>
        <div class="tree-row">
          <button
            class="tree-track"
            :class="{ playing: isPlaying(n) && n.type === 'audio' }"
            :title="n.type === 'image' || n.type === 'text' ? '双击查看' : ''"
            @click="emit('play', n)"
            @dblclick.stop="(n.type === 'image' || n.type === 'text') && emit('open', n)"
          >
            <span class="tree-indent" :style="{ width: `${(depth ?? 0) * 16}px` }" />
            <span v-if="isPlaying(n) && n.type === 'audio'" class="eq" :class="{ paused: !player.playing }">
              <i /><i /><i />
            </span>
            <UiIcon v-else :name="typeIcon[n.type] ?? 'music_note'" :size="16" />
            <span class="tree-title">{{ n.title }}</span>
            <span v-if="extOf(n.title)" class="ext">{{ extOf(n.title).replace('.', '').toUpperCase() }}</span>
          </button>
          <button
            v-if="n.mediaDownloadUrl"
            class="icon-btn tree-dl" title="下载此文件"
            @click.stop="emit('download', n)"
          >
            <UiIcon name="download" :size="15" />
          </button>
        </div>
      </template>
    </li>
  </ul>
</template>
