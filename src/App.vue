<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4">
    <div class="max-w-7xl mx-auto space-y-4">
      <!-- Header -->
      <header class="text-center py-4">
        <h1 class="text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Vue Auto-Battler
        </h1>
        <p class="text-slate-400 text-sm mt-1">
          5×8 Grid • A* Pathfinding • BO3 • Drag & Drop
        </p>
      </header>

      <!-- Controls -->
      <ControlsBar
        :phase="phase"
        :placement-complete="placementComplete"
        :running="running"
        @start-battle="startBattle"
        @shift-visual="shiftVisual"
        @reset="resetBO3"
      />

      <!-- Main content -->
      <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
        <!-- Board -->
        <Board
          :width="BOARD_WIDTH"
          :height="BOARD_HEIGHT"
          :units="units"
          :attack-effects="attackEffects"
          :particle-effects="particleEffects"
          :tile-flashes="tileFlashes"
          :cell-to-px="cellToPx"
          :hovered-unit="hoveredUnit"
          @drop="handleDrop"
          @rotate="rotateUnit"
          @drag-start="handleDragStart"
        />

        <!-- Sidebar -->
        <Sidebar
          :bench="bench"
          :round="round"
          :max-rounds="maxRounds"
          :team-a-wins="teamAWins"
          :team-b-wins="teamBWins"
          :phase="phase"
          :test-output="testOutput"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGame, BOARD_WIDTH, BOARD_HEIGHT } from '@/composables/useGame'
import type { Unit, Role } from '@/logic/types'
import Board from '@/components/Board.vue'
import Sidebar from '@/components/Sidebar.vue'
import ControlsBar from '@/components/ControlsBar.vue'

const {
  units,
  phase,
  running,
  round,
  maxRounds,
  teamAWins,
  teamBWins,
  bench,
  placementComplete,
  attackEffects,
  particleEffects,
  tileFlashes,
  testOutput,
  placeUnit,
  rotateUnit,
  startBattle,
  resetBO3,
  shiftVisual,
  cellToPx
} = useGame()

const hoveredUnit = ref<Unit | null>(null)

function handleDrop(x: number, y: number, role: string) {
  placeUnit(role as Role, x, y)
}

function handleDragStart(unit: Unit) {
  hoveredUnit.value = unit
}
</script>
