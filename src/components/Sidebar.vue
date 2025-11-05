<template>
  <div class="space-y-4">
    <!-- Bench -->
    <div class="bg-slate-900/80 border border-slate-700 rounded-2xl p-3 shadow-xl">
      <Bench :bench="bench" />
    </div>

    <!-- Round info -->
    <div class="bg-slate-900/80 border border-slate-700 rounded-2xl p-3 shadow-xl">
      <h3 class="text-sm font-bold text-slate-300 uppercase tracking-wide mb-2">
        Match Status
      </h3>
      <div class="space-y-1 text-sm text-slate-400">
        <div class="flex justify-between">
          <span>Round:</span>
          <span class="font-bold text-slate-200">{{ round }} / {{ maxRounds }}</span>
        </div>
        <div class="flex justify-between">
          <span>Team A Wins:</span>
          <span class="font-bold text-blue-400">{{ teamAWins }}</span>
        </div>
        <div class="flex justify-between">
          <span>Team B Wins:</span>
          <span class="font-bold text-red-400">{{ teamBWins }}</span>
        </div>
        <div class="flex justify-between">
          <span>Phase:</span>
          <span class="font-bold text-emerald-400 capitalize">{{ phase }}</span>
        </div>
      </div>
    </div>

    <!-- Test output -->
    <div class="bg-slate-900/80 border border-slate-700 rounded-2xl p-3 shadow-xl">
      <h3 class="text-sm font-bold text-slate-300 uppercase tracking-wide mb-2">
        Test Output
      </h3>
      <div class="h-32 overflow-y-auto text-xs text-slate-400 font-mono space-y-0.5">
        <div
          v-for="(line, idx) in testOutput"
          :key="idx"
        >
          {{ line }}
        </div>
        <div
          v-if="testOutput.length === 0"
          class="text-slate-600 italic"
        >
          No events yet...
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Phase } from '@/logic/types'
import Bench from './Bench.vue'

interface BenchItem {
  role: string
  placed: boolean
}

interface Props {
  bench: BenchItem[]
  round: number
  maxRounds: number
  teamAWins: number
  teamBWins: number
  phase: Phase
  testOutput: string[]
}

defineProps<Props>()
</script>
