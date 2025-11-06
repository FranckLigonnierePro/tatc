<template>
  <div class="space-y-2">
    <h3 class="text-sm font-bold text-slate-300 uppercase tracking-wide">
      Bench {{ team }}
    </h3>
    <div class="flex gap-2">
      <div
        v-for="(item, idx) in bench"
        :key="idx"
        class="bench-card w-20 h-20 rounded-xl border-2 font-bold text-white grid place-items-center shadow-lg transition-all cursor-grab active:cursor-grabbing"
        :class="item.placed ? 'bg-slate-700 border-slate-600 opacity-40' : cardClass(item.role)"
        :draggable="!item.placed"
        @dragstart="handleDragStart($event, item.role)"
      >
        {{ item.role[0] }}
      </div>
    </div>
  </div>
  </template>

<script setup lang="ts">
import type { Role, Team } from '@/logic/types'

interface BenchItem {
  role: Role
  placed: boolean
}

interface Props {
  bench: BenchItem[]
  team: Team
}

const props = defineProps<Props>()

function cardClass(_role: Role): string {
  return props.team === 'A' ? 'bg-blue-600 border-blue-500' : 'bg-red-600 border-red-500'
}

function handleDragStart(event: DragEvent, role: Role) {
  event.dataTransfer!.effectAllowed = 'copy'
  event.dataTransfer!.setData('role', role)
  event.dataTransfer!.setData('team', props.team)
}
</script>
