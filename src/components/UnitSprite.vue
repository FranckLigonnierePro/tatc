<template>
  <div
    class="absolute pointer-events-auto cursor-pointer transition-transform hover:scale-105"
    :style="spriteStyle"
    :draggable="draggable"
    @contextmenu.prevent="$emit('rotate')"
    @dragstart="handleDragStart"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <!-- Facing arrow -->
    <div
      class="absolute -top-5 left-1/2 -translate-x-1/2 text-lg font-bold"
      :class="teamColor"
    >
      {{ arrow }}
    </div>

    <!-- Unit chip -->
    <div
      class="w-16 h-16 rounded-xl font-extrabold text-white grid place-items-center shadow-lg text-sm"
      :class="chipClass"
    >
      {{ idLabel }}
    </div>

    <!-- HP bar -->
    <div class="absolute -bottom-2 left-0 right-0 h-1.5 bg-slate-700 rounded-full overflow-hidden">
      <div
        class="h-full transition-all duration-200"
        :class="hpBarColor"
        :style="{ width: `${hpPercent}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Unit } from '@/logic/types'
import { facingToArrow } from '@/logic/utils'

interface Props {
  unit: Unit
  cellToPx: (x: number, y: number) => { px: number; py: number }
}

const props = defineProps<Props>()
const emit = defineEmits<{
  rotate: []
  dragStart: [unit: Unit]
}>()

const hovering = ref(false)

const draggable = computed(() => props.unit.team === 'A')

const arrow = computed(() => facingToArrow(props.unit.facing))

const teamColor = computed(() => {
  return props.unit.team === 'A' ? 'text-blue-400' : 'text-red-400'
})

const chipClass = computed(() => {
  const base = props.unit.team === 'A' ? 'bg-blue-600' : 'bg-red-600'
  return base
})

const idLabel = computed(() => props.unit.id.slice(-4))

const hpPercent = computed(() => {
  return Math.max(0, (props.unit.hp / props.unit.maxHp) * 100)
})

const hpBarColor = computed(() => {
  if (hpPercent.value > 60) return 'bg-green-500'
  if (hpPercent.value > 30) return 'bg-yellow-500'
  return 'bg-red-500'
})

const spriteStyle = computed(() => {
  let x: number, y: number

  if (props.unit.animX !== undefined && props.unit.animY !== undefined) {
    // Animating
    x = props.unit.animX
    y = props.unit.animY
  } else {
    // Static position
    const pos = props.cellToPx(props.unit.x, props.unit.y)
    x = pos.px
    y = pos.py
  }

  return {
    left: `${x}px`,
    top: `${y}px`,
    width: '64px',
    height: '64px'
  }
})

function handleDragStart(event: DragEvent) {
  if (props.unit.team === 'A') {
    event.dataTransfer!.effectAllowed = 'move'
    event.dataTransfer!.setData('unitId', props.unit.id)
    emit('dragStart', props.unit)
  }
}
</script>
