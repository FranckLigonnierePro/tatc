<template>
  <div
    class="relative bg-slate-900/80 border border-slate-700 rounded-2xl shadow-xl"
    :style="boardStyle"
  >
    <!-- Zones overlay (A in blue, B in red) -->
    <div
      class="absolute pointer-events-none rounded-xl"
      :style="zoneAStyle"
    />
    <div
      class="absolute pointer-events-none rounded-xl"
      :style="zoneBStyle"
    />
    <!-- Grid tiles -->
    <div class="flex flex-col" :style="gapStyle">
      <div
        v-for="y in height"
        :key="`row-${y - 1}`"
        class="flex"
        :style="gapStyle"
      >
        <div
          v-for="x in width"
          :key="`tile-${x - 1}-${y - 1}`"
          class="tile rounded-xl border border-slate-700/60 bg-slate-800/60 transition-colors hover:bg-slate-700/60 cursor-pointer"
          :class="{
            'ring-2 ring-emerald-400/70': isInRange(x - 1, y - 1),
            'animate-tile-flash': hasFlash(x - 1, y - 1)
          }"
          :style="tileStyle"
          @drop="handleDrop($event, x - 1, y - 1)"
          @dragover.prevent
          @dragenter.prevent
        />
      </div>
    </div>

    <!-- SVG LOS layer -->
    <svg
      class="absolute inset-0 pointer-events-none"
      :width="boardWidth"
      :height="boardHeight"
    >
      <g>
        <template v-for="unit in units" :key="`path-${unit.id}`">
          <template v-if="pathsByUnit[unit.id] && pathsByUnit[unit.id].length > 1">
            <line
              v-for="(_, idx) in pathsByUnit[unit.id].slice(0, -1)"
              :key="`seg-${unit.id}-${idx}`"
              :x1="cellCenterX(pathsByUnit[unit.id][idx].x)"
              :y1="cellCenterY(pathsByUnit[unit.id][idx].y)"
              :x2="cellCenterX(pathsByUnit[unit.id][idx + 1].x)"
              :y2="cellCenterY(pathsByUnit[unit.id][idx + 1].y)"
              :stroke="unit.team === 'A' ? '#60a5fa' : '#f87171'"
              stroke-width="3"
              opacity="0.6"
            />
          </template>
        </template>
      </g>
      <line
        v-for="effect in attackEffects"
        :key="effect.id"
        :x1="cellCenterX(effect.fromX)"
        :y1="cellCenterY(effect.fromY)"
        :x2="cellCenterX(effect.toX)"
        :y2="cellCenterY(effect.toY)"
        stroke="#ef4444"
        stroke-width="2"
        opacity="0.8"
      />
    </svg>

    <!-- Units overlay -->
    <div class="absolute inset-0 pointer-events-none">
      <UnitSprite
        v-for="unit in units"
        :key="unit.id"
        :unit="unit"
        :cell-to-px="cellToPx"
        @rotate="$emit('rotate', unit.id)"
        @drag-start="$emit('dragStart', unit)"
      />
    </div>

    <!-- Particle effects -->
    <div
      v-for="particle in particleEffects"
      :key="particle.id"
      class="absolute w-8 h-8 rounded-full bg-orange-500 pointer-events-none animate-particle-burst"
      :style="{
        left: `${cellCenterX(particle.x) - 16}px`,
        top: `${cellCenterY(particle.y) - 16}px`
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Unit, AttackEffect, ParticleEffect, TileFlash, Coords } from '@/logic/types'
import { CELL_SIZE, CELL_GAP, BOARD_PADDING } from '@/composables/useGame'
import UnitSprite from './UnitSprite.vue'

interface Props {
  width: number
  height: number
  units: Unit[]
  attackEffects: AttackEffect[]
  particleEffects: ParticleEffect[]
  tileFlashes: TileFlash[]
  cellToPx: (x: number, y: number) => { px: number; py: number }
  hoveredUnit?: Unit | null
  pathsByUnit: Record<string, Coords[]>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  drop: [x: number, y: number, role: string]
  rotate: [unitId: string]
  dragStart: [unit: Unit]
}>()

const boardWidth = computed(() => {
  return BOARD_PADDING * 2 + props.width * CELL_SIZE + (props.width - 1) * CELL_GAP
})

const boardHeight = computed(() => {
  return BOARD_PADDING * 2 + props.height * CELL_SIZE + (props.height - 1) * CELL_GAP
})

const boardStyle = computed(() => ({
  width: `${boardWidth.value}px`,
  height: `${boardHeight.value}px`,
  padding: `${BOARD_PADDING}px`
}))

const tileStyle = computed(() => ({
  width: `${CELL_SIZE}px`,
  height: `${CELL_SIZE}px`
}))

// Use exact pixel gap to match logic sizing and overlays
const gapStyle = computed(() => ({
  gap: `${CELL_GAP}px`
}))

function cellCenterX(x: number): number {
  return BOARD_PADDING + x * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2
}

function cellCenterY(y: number): number {
  return BOARD_PADDING + y * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2
}

function handleDrop(event: DragEvent, x: number, y: number) {
  const role = event.dataTransfer?.getData('role')
  if (role) {
    emit('drop', x, y, role)
  }
}

// Helper to compute a style for a horizontal band of rows
function bandStyle(startRow: number, rowCount: number, color: { bg: string; border: string }) {
  const top = BOARD_PADDING + startRow * (CELL_SIZE + CELL_GAP)
  const height = rowCount * CELL_SIZE + Math.max(0, rowCount - 1) * CELL_GAP
  const left = BOARD_PADDING
  const width = boardWidth.value - 2 * BOARD_PADDING
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    background: color.bg,
    border: `2px solid ${color.border}`
  }
}

// Zone A: top 4 rows (blue)
const zoneAStyle = computed(() =>
  bandStyle(0, 4, { bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6' })
)

// Zone B: bottom 4 rows (red)
const zoneBStyle = computed(() =>
  bandStyle(props.height - 4, 4, { bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444' })
)

function isInRange(x: number, y: number): boolean {
  if (!props.hoveredUnit) return false
  const dx = Math.abs(x - props.hoveredUnit.x)
  const dy = Math.abs(y - props.hoveredUnit.y)
  const cheb = Math.max(dx, dy)
  return cheb <= props.hoveredUnit.range && cheb > 0
}

function hasFlash(x: number, y: number): boolean {
  return props.tileFlashes.some((f: TileFlash) => f.x === x && f.y === y)
}
</script>
