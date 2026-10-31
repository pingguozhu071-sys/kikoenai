<script setup lang="ts">
/** 提示浮层宿主 —— 挂在 App 根部即可 */
import { useToasts } from '../stores/toast'

const state = useToasts()
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in state.list" :key="t.id" class="toast" :class="t.kind">
        {{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>
