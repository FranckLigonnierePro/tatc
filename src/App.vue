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

      <!-- Replay controls -->
      <div v-if="!running && history.length > 0" class="bg-slate-900/80 border border-slate-700 rounded-2xl p-3 shadow-xl flex items-center gap-3">
        <button class="btn" @click="enterReplay" v-if="!replayMode">
          ▶️ Enter Replay
        </button>
        <template v-else>
          <button class="btn" @click="prevTick" :disabled="replayTick <= 0">⟨ Prev</button>
          <input type="range" min="0" :max="history.length - 1" v-model.number="replayTick" class="flex-1" />
          <button class="btn" @click="nextTick" :disabled="replayTick >= history.length - 1">Next ⟩</button>
          <div class="text-sm text-slate-400 ml-2">Tick {{ replayTick + 1 }} / {{ history.length }}</div>
          <button class="btn ml-auto" @click="exitReplay">⏹ Exit Replay</button>
        </template>
      </div>

      <!-- Main content -->
      <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
        <!-- Board -->
        <Board
          :width="BOARD_WIDTH"
          :height="BOARD_HEIGHT"
          :units="displayedUnits"
          :attack-effects="attackEffects"
          :particle-effects="particleEffects"
          :tile-flashes="tileFlashes"
          :cell-to-px="cellToPx"
          :hovered-unit="hoveredUnit"
          :paths-by-unit="pathsByUnit"
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
import { ref, computed } from 'vue'
import { useGame, BOARD_WIDTH, BOARD_HEIGHT } from '@/composables/useGame'
import type { Unit, Role, UnitSnapshot } from '@/logic/types'
import { ROLE_STATS } from '@/logic/types'
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
  pathsByUnit,
  history,
  unitInfoById,
  placeUnit,
  rotateUnit,
  startBattle,
  resetBO3,
  shiftVisual,
  cellToPx
} = useGame()

const hoveredUnit = ref<Unit | null>(null)

// Replay state
const replayMode = ref(false)
const replayTick = ref(0)

const displayedUnits = computed<Unit[]>(() => {
  if (!replayMode.value) return units.value
  const step = history.value[replayTick.value]
  if (!step) return units.value
  const mapped = step.units.map((s: UnitSnapshot) => {
    const info = unitInfoById.value[s.id]
    if (!info) return null
    const stats = ROLE_STATS[info.role]
    const u: Unit = {
      id: s.id,
      team: info.team,
      role: info.role,
      type: stats.type,
      x: s.x,
      y: s.y,
      hp: s.hp,
      maxHp: info.maxHp,
      atk: stats.atk,
      range: stats.range,
      facing: info.facing
    }
    return u
  })
  return mapped.filter((u): u is Unit => u !== null)
})

function handleDrop(x: number, y: number, role: string) {
  placeUnit(role as Role, x, y)
}

function handleDragStart(unit: Unit) {
  hoveredUnit.value = unit
}

function enterReplay() {
  replayMode.value = true
  replayTick.value = 0
}
function exitReplay() {
  replayMode.value = false
}
function prevTick() {
  if (replayTick.value > 0) replayTick.value--
}
function nextTick() {
  if (replayTick.value < history.value.length - 1) replayTick.value++
}
</script>
