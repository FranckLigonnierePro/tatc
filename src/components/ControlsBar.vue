<template>
  <div class="bg-slate-900/80 border border-slate-700 rounded-2xl p-3 shadow-xl">
    <div class="flex flex-wrap gap-2 items-center">
      <button
        v-if="phase === 'placement'"
        class="btn"
        :disabled="!placementComplete"
        @click="$emit('start-battle')"
      >
        <span class="text-lg">⚔️</span>
        <span>Start Battle</span>
      </button>

      <button
        class="btn"
        @click="$emit('shift-visual')"
      >
        <span class="text-lg">🔄</span>
        <span>Shift Visual</span>
      </button>

      <button
        class="btn"
        @click="$emit('reset')"
      >
        <span class="text-lg">🔁</span>
        <span>Reset BO3</span>
      </button>

      <div class="ml-auto flex items-center gap-2 text-sm text-slate-400">
        <div
          class="w-2 h-2 rounded-full"
          :class="running ? 'bg-green-500 animate-pulse' : 'bg-slate-600'"
        />
        <span>{{ running ? 'Running' : 'Idle' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Phase } from '@/logic/types'

interface Props {
  phase: Phase
  placementComplete: boolean
  running: boolean
}

defineProps<Props>()

defineEmits<{
  startBattle: []
  shiftVisual: []
  reset: []
}>()
</script>

<style scoped>
.btn {
  @apply inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-800;
}
</style>
