<script setup lang="ts">
/**
 * 下载页 —— 原来的小弹窗改成整页：任务多的时候信息量够放得下。
 * 支持暂停 / 继续 / 取消 / 重试 / 打开所在文件夹。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import {
  downloadState, cancelDownload, clearFinished, retryDownload, revealDownload,
  pauseDownload, resumeDownload, downloadSettings, pickDownloadDir,
} from '../stores/downloads'
import { fmtBytes } from '../utils/format'
import { toast } from '../stores/toast'

const router = useRouter()

const tasks = computed(() => downloadState.tasks)
const activeCount = computed(() => tasks.value.filter((t) => t.state === 'running' || t.state === 'queued').length)
const pausedCount = computed(() => tasks.value.filter((t) => t.state === 'paused').length)
const doneCount = computed(() => tasks.value.filter((t) => t.state === 'done').length)

function pct(t: { received: number; total: number }): number {
  if (!t.total) return 0
  return Math.min(100, Math.round((t.received / t.total) * 100))
}

function statusText(t: { state: string; total: number; received: number }): string {
  switch (t.state) {
    case 'queued': return '排队中'
    case 'paused': return '已暂停'
    case 'done': return '已完成'
    case 'error': return '失败'
    case 'canceled': return '已取消'
    default: return t.total ? `${pct(t)}%` : '下载中'
  }
}

async function chooseDir() {
  const dir = await pickDownloadDir()
  if (!dir) return
  downloadSettings.dir = dir
  downloadSettings.persist()
  toast('下载目录已更新', 'success')
}

function openSettings() {
  void router.push('/settings')
}
</script>

<template>
  <div class="view">
    <header class="app-header">
      <div class="header-left">
        <span class="brand">下载</span>
        <span class="count">
          {{ activeCount }} 进行中<template v-if="pausedCount"> · {{ pausedCount }} 已暂停</template>
          · {{ doneCount }} 已完成
        </span>
      </div>
      <div class="header-right">
        <button class="chip" :disabled="!tasks.length" @click="clearFinished">清除已完成</button>
        <button class="chip" @click="openSettings">下载设置</button>
      </div>
    </header>

    <div class="page-scroll">
      <div class="m3-card dsum">
        <div class="dsum-row">
          <div class="dsum-label">
            <div>保存目录</div>
            <div class="card-sub">留空则使用系统「下载」文件夹；未完成的任务重启后会续传</div>
          </div>
          <div class="dsum-dir" :title="downloadSettings.dir || '（系统下载文件夹）'">
            {{ downloadSettings.dir || '（系统下载文件夹）' }}
          </div>
          <button class="chip" @click="chooseDir">选择…</button>
        </div>
      </div>

      <div v-if="!tasks.length" class="empty-state" style="padding: 56px 0">
        <UiIcon name="download" :size="38" />
        <div>还没有下载任务</div>
        <div class="card-sub">在作品详情页点「下载全部」，或在音轨行右侧点下载</div>
      </div>

      <div v-else class="dlist">
        <article v-for="t in tasks" :key="t.id" class="m3-card ditem" :class="t.state">
          <div class="ditem-main">
            <div class="ditem-title">
              <span class="ditem-name" :title="t.fileName">{{ t.fileName }}</span>
              <span class="ditem-state">{{ statusText(t) }}</span>
            </div>
            <div class="ditem-sub">
              <span>{{ t.workTitle }}</span>
              <span>
                {{ fmtBytes(t.received) }}<template v-if="t.total"> / {{ fmtBytes(t.total) }}</template>
              </span>
            </div>

            <div v-if="t.state !== 'done' && t.state !== 'canceled'" class="dbar">
              <i :style="{ width: pct(t) + '%' }" />
            </div>
            <div v-if="t.state === 'error'" class="derror">{{ t.message }}</div>
          </div>

          <div class="ditem-actions">
            <template v-if="t.state === 'running' || t.state === 'queued'">
              <button v-if="t.state === 'running'" class="chip" @click="pauseDownload(t.id)">暂停</button>
              <button class="chip plain" @click="cancelDownload(t.id)">取消</button>
            </template>
            <template v-else-if="t.state === 'paused'">
              <button class="chip" @click="resumeDownload(t.id)">继续</button>
              <button class="chip plain" @click="cancelDownload(t.id)">取消</button>
            </template>
            <template v-else-if="t.state === 'done'">
              <button class="chip plain" @click="revealDownload(t)">打开所在文件夹</button>
            </template>
            <template v-else>
              <button class="chip" @click="retryDownload(t)">重试</button>
              <button class="chip plain" @click="revealDownload(t)">打开所在文件夹</button>
            </template>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dsum { margin-bottom: 14px; }
.dsum-row { display: flex; align-items: center; gap: 12px; }
.dsum-label { flex: 1; min-width: 0; font-size: 13px; }
.dsum-dir {
  max-width: 380px; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; color: var(--md-on-surface-variant);
}
.card-sub { font-weight: 400; font-size: 11.5px; color: var(--md-on-surface-variant); }

.dlist { display: flex; flex-direction: column; gap: 10px; }
.ditem {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 16px;
}
.ditem-main { flex: 1; min-width: 0; }
.ditem-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.ditem-name {
  font-size: 13.5px; font-weight: 600; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ditem-state { font-size: 11px; color: var(--md-on-surface-variant); flex-shrink: 0; }
.ditem-sub {
  display: flex; gap: 14px; margin-top: 5px;
  font-size: 11.5px; color: var(--md-on-surface-variant);
}
.ditem-sub span:first-child {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dbar {
  height: 6px; border-radius: 3px; margin-top: 9px;
  background: color-mix(in srgb, var(--md-on-surface) 14%, transparent);
  overflow: hidden;
}
.dbar > i {
  display: block; height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, var(--md-primary), color-mix(in srgb, var(--md-primary) 60%, var(--md-tertiary)));
  transition: width 0.25s linear;
}
.ditem.paused .dbar > i { background: color-mix(in srgb, var(--md-on-surface) 40%, transparent); }
.derror { margin-top: 8px; font-size: 11.5px; color: var(--md-error); }
.ditem-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
