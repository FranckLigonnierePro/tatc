import { ref, computed, reactive } from 'vue'
import type {
  Unit,
  Team,
  Role,
  Phase,
  AttackEffect,
  ParticleEffect,
  TileFlash,
  Coords,
  MoveEvent,
  AttackEventHistory,
  UnitSnapshot,
  HistoryStep,
  Facing
} from '@/logic/types'
import { ROLE_STATS } from '@/logic/types'
import { id, chebyshev, rotateFacing, cellName } from '@/logic/utils'

export const BOARD_WIDTH = 5
export const BOARD_HEIGHT = 8

// Board metrics (CSS vars will use these)
export const CELL_SIZE = 64
export const CELL_GAP = 4
export const BOARD_PADDING = 12

export function useGame() {
  const units = ref<Unit[]>([])
  const phase = ref<Phase>('placement')
  const running = ref(false)
  const round = ref(1)
  const maxRounds = ref(3)
  const teamAWins = ref(0)
  const teamBWins = ref(0)
  const visualShift = ref(0)

  // Effects
  const attackEffects = ref<AttackEffect[]>([])
  const particleEffects = ref<ParticleEffect[]>([])
  const tileFlashes = ref<TileFlash[]>([])
  const pathsByUnit = ref<Record<string, Coords[]>>({})

  // Test output
  const testOutput = ref<string[]>([])

  let tickTimer: number | null = null
  let animationFrame: number | null = null
  let tickCount = 0

  // History recording
  const history = ref<HistoryStep[]>([])
  let pendingMoves: MoveEvent[] = []
  let pendingAttacks: AttackEventHistory[] = []
  const unitInfoById = ref<Record<string, { role: Role; maxHp: number; facing: Facing; team: Team }>>({})

  const bench = reactive([
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false }
  ])

  const placementComplete = computed(() => bench.every(b => b.placed))

  function cellToPx(x: number, y: number): { px: number; py: number } {
    const px = BOARD_PADDING + x * (CELL_SIZE + CELL_GAP)
    const py = BOARD_PADDING + y * (CELL_SIZE + CELL_GAP)
    return { px, py }
  }

  function createUnit(role: Role, team: Team, x: number, y: number): Unit {
    const stats = ROLE_STATS[role]
    return {
      id: id(),
      team,
      role,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      atk: stats.atk,
      range: stats.range,
      facing: team === 'A' ? 'N' : 'S',
      // Base attack speed: 1s
      attackCooldownMs: 1000,
      lastAttackAt: 0
    }
  }

  function placeUnit(role: Role, x: number, y: number): boolean {
    // Only allow placement in rows y <= 1
    if (y > 3) return false
    if (phase.value !== 'placement') return false

    // Check if cell is occupied
    if (units.value.some(u => u.x === x && u.y === y)) return false

    // Find bench item
    const benchItem = bench.find(b => b.role === role && !b.placed)
    if (!benchItem) return false

    const unit = createUnit(role, 'A', x, y)
    units.value.push(unit)
    benchItem.placed = true

    return true
  }

  function rotateUnit(unitId: string) {
    const unit = units.value.find(u => u.id === unitId)
    if (unit && phase.value === 'placement') {
      unit.facing = rotateFacing(unit.facing)
    }
  }

  function enterPlacement() {
    phase.value = 'placement'
    running.value = false
    units.value = []
    bench.forEach(b => (b.placed = false))
    attackEffects.value = []
    particleEffects.value = []
    tileFlashes.value = []
    history.value = []
    tickCount = 0
    if (tickTimer !== null) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
  }

  function startBattle() {
    if (!placementComplete.value) return

    phase.value = 'battle'

    // Auto-place team B randomly within their zone (bottom 4 rows)
    const teamAUnits = units.value.filter(u => u.team === 'A')
    const bMinY = Math.max(0, BOARD_HEIGHT - 4)
    const bMaxY = BOARD_HEIGHT - 1
    for (const ua of teamAUnits) {
      // Try random free positions up to some attempts
      let placed = false
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const rx = Math.floor(Math.random() * BOARD_WIDTH)
        const ry = Math.floor(Math.random() * (bMaxY - bMinY + 1)) + bMinY
        const occupied = units.value.some(u => u.x === rx && u.y === ry)
        if (!occupied) {
          const unit = createUnit(ua.role, 'B', rx, ry)
          units.value.push(unit)
          placed = true
        }
      }
      // Fallback: if not found, place mirrored as last resort
      if (!placed) {
        const mirrorY = BOARD_HEIGHT - 1 - ua.y
        const unit = createUnit(ua.role, 'B', ua.x, mirrorY)
        // Avoid collision by shifting x if needed
        let px = unit.x
        let tries = 0
        while (units.value.some(u => u.x === px && u.y === unit.y) && tries < BOARD_WIDTH) {
          px = (px + 1) % BOARD_WIDTH
          tries++
        }
        unit.x = px
        units.value.push(unit)
      }
    }

    // Reset history on battle start
    history.value = []
    tickCount = 0
    // Capture base unit info for replay rendering
    unitInfoById.value = {}
    for (const u of units.value) {
      unitInfoById.value[u.id] = { role: u.role, maxHp: u.maxHp, facing: u.facing, team: u.team }
    }
    running.value = true
    startTicking()
  }

  function startTicking() {
    const tickInterval = 400 // ms
    tickTimer = window.setInterval(() => {
      tick()
    }, tickInterval)
  }

  function tick() {
    if (!running.value) return

    // Snapshot units
    const snapshot = [...units.value]

    // Reset per-tick recorded events
    pendingMoves = []
    pendingAttacks = []

    for (const snap of snapshot) {
      // Always operate on the live unit from state, not the snapshot copy
      const unit = units.value.find(u => u.id === snap.id)
      if (!unit || unit.hp <= 0) continue
      // If unit is currently animating a move, skip acting this tick to avoid double-issuing moves
      if (unit.animProgress !== undefined) continue

      // Use locked target if any and alive
      let enemy: Unit | null = null
      if (unit.lockedOnId) {
        enemy = units.value.find(u => u.id === unit.lockedOnId) || null
        if (!enemy || enemy.hp <= 0) {
          unit.lockedOnId = undefined
          enemy = null
        }
      }
      if (!enemy) enemy = findClosestEnemy(unit)
      if (!enemy) continue

      const dist = chebyshev(unit, enemy)

      if (dist <= unit.range) {
        // Attack if cooldown ready
        const now = Date.now()
        const cd = unit.attackCooldownMs ?? 1000
        if (!unit.lastAttackAt || now - unit.lastAttackAt >= cd) {
          attack(unit, enemy)
        }
        // No movement when in range
        delete pathsByUnit.value[unit.id]
      } else {
        // Movement rules: if locked, do not move. Else, forward-first steering with lateral toward nearby enemy column
        if (!unit.lockedOnId) {
          moveSteered(unit, enemy)
        } else {
          delete pathsByUnit.value[unit.id]
        }
      }
    }

    // Remove dead units
    units.value = units.value.filter(u => u.hp > 0)
    // Prune paths of missing units
    const aliveIds = new Set(units.value.map(u => u.id))
    for (const k of Object.keys(pathsByUnit.value)) {
      if (!aliveIds.has(k)) delete pathsByUnit.value[k]
    }
    // Clear locks pointing to dead units (safety)
    for (const u of units.value) {
      if (u.lockedOnId && !aliveIds.has(u.lockedOnId)) u.lockedOnId = undefined
    }

    // Push history step for this tick
    const unitSnaps: UnitSnapshot[] = units.value.map(u => ({ id: u.id, team: u.team, x: u.x, y: u.y, hp: u.hp }))
    history.value.push({
      tick: tickCount,
      moves: pendingMoves,
      attacks: pendingAttacks,
      units: unitSnaps
    })
    tickCount++

    // Check round end
    const teamA = units.value.filter(u => u.team === 'A')
    const teamB = units.value.filter(u => u.team === 'B')

    if (teamA.length === 0 || teamB.length === 0) {
      endRound(teamA.length > 0 ? 'A' : 'B')
    }
  }

  function findClosestEnemy(unit: Unit): Unit | null {
    const enemies = units.value.filter(u => u.team !== unit.team && u.hp > 0)
    if (enemies.length === 0) return null

    let closest = enemies[0]
    let minDist = Math.abs(unit.x - closest.x) + Math.abs(unit.y - closest.y)

    for (const e of enemies) {
      const d = Math.abs(unit.x - e.x) + Math.abs(unit.y - e.y)
      if (d < minDist) {
        minDist = d
        closest = e
      }
    }

    return closest
  }

  function attack(attacker: Unit, target: Unit) {
    attacker.lastAttackAt = Date.now()
    target.hp -= attacker.atk
    // Lock onto this target after first successful hit
    if (!attacker.lockedOnId) attacker.lockedOnId = target.id

    // Record attack in history
    pendingAttacks.push({
      attackerId: attacker.id,
      targetId: target.id,
      fromX: attacker.x,
      fromY: attacker.y,
      toX: target.x,
      toY: target.y,
      from: cellName(attacker.x, attacker.y),
      to: cellName(target.x, target.y),
      damage: attacker.atk
    })

    // Visual effects
    const atkEffect: AttackEffect = {
      id: id(),
      fromX: attacker.x,
      fromY: attacker.y,
      toX: target.x,
      toY: target.y,
      timestamp: Date.now()
    }
    attackEffects.value.push(atkEffect)
    setTimeout(() => {
      attackEffects.value = attackEffects.value.filter(e => e.id !== atkEffect.id)
    }, 300)

    const particle: ParticleEffect = {
      id: id(),
      x: target.x,
      y: target.y,
      timestamp: Date.now()
    }
    particleEffects.value.push(particle)
    setTimeout(() => {
      particleEffects.value = particleEffects.value.filter(p => p.id !== particle.id)
    }, 400)

    const flash: TileFlash = {
      x: target.x,
      y: target.y,
      timestamp: Date.now()
    }
    tileFlashes.value.push(flash)
    setTimeout(() => {
      tileFlashes.value = tileFlashes.value.filter(f => f !== flash)
    }, 300)
  }

  function moveSteered(unit: Unit, target: Unit) {
    // If already in range (Chebyshev), don't move
    if (chebyshev(unit, target) <= unit.range) {
      delete pathsByUnit.value[unit.id]
      return
    }

    const key = (x: number, y: number) => `${x},${y}`
    const occ = new Set<string>()
    for (const u of units.value) {
      if (u.hp <= 0) continue
      if (u.id !== unit.id) occ.add(key(u.x, u.y))
      if (u.id !== unit.id && u.animToX !== undefined && u.animToY !== undefined) {
        occ.add(key(u.animToX, u.animToY))
      }
    }

    // Determine forward direction: Team A goes down (+1), Team B goes up (-1)
    const forwardDy = unit.team === 'A' ? 1 : -1
    const forwardX = unit.x
    const forwardY = unit.y + forwardDy

    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    const isFree = (x: number, y: number) => inBounds(x, y) && !occ.has(key(x, y))

    // Check if there is a nearby enemy on a parallel column; if so, bias lateral toward enemy.x
    // "Proche": use Manhattan distance <= 2 as heuristic
    let lateralBias: -1 | 0 | 1 = 0
    const manhattanDist = Math.abs(unit.x - target.x) + Math.abs(unit.y - target.y)
    if (manhattanDist <= 2 && target.x !== unit.x) {
      lateralBias = target.x < unit.x ? -1 : 1
    }

    // Candidate moves by priority:
    // 1) If lateralBias set and lateral cell is free, step toward enemy column
    // 2) Else, go straight forward if free
    // 3) Else, try the other lateral (to navigate around blockers)
    // 4) Else, stay
    const tryMoves: Array<{ x: number; y: number }> = []
    if (lateralBias !== 0) tryMoves.push({ x: unit.x + lateralBias, y: unit.y })
    tryMoves.push({ x: forwardX, y: forwardY })
    if (lateralBias !== 0) tryMoves.push({ x: unit.x - lateralBias, y: unit.y })

    let chosen: { x: number; y: number } | null = null
    for (const m of tryMoves) {
      if (isFree(m.x, m.y)) { chosen = m; break }
    }

    if (chosen) {
      // Minimal path for visualization: current -> chosen
      pathsByUnit.value[unit.id] = [ { x: unit.x, y: unit.y }, { x: chosen.x, y: chosen.y } ]

      // Record move in history (logical move for this tick)
      pendingMoves.push({
        unitId: unit.id,
        team: unit.team,
        fromX: unit.x,
        fromY: unit.y,
        toX: chosen.x,
        toY: chosen.y,
        from: cellName(unit.x, unit.y),
        to: cellName(chosen.x, chosen.y)
      })
      animateMove(unit, chosen.x, chosen.y)
    } else {
      delete pathsByUnit.value[unit.id]
    }
  }

  // Simple single-cell animation
  function animateMove(unit: Unit, toX: number, toY: number) {
    const fromPx = cellToPx(unit.x, unit.y)
    const toPx = cellToPx(toX, toY)

    unit.animX = fromPx.px
    unit.animY = fromPx.py
    unit.animProgress = 0
    unit.animToX = toX
    unit.animToY = toY

    const duration = 200 // ms per cell
    const startTime = Date.now()

    function step() {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      unit.animProgress = progress
      unit.animX = fromPx.px + (toPx.px - fromPx.px) * progress
      unit.animY = fromPx.py + (toPx.py - fromPx.py) * progress

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step)
      } else {
        // Animation complete - update logical position
        unit.x = toX
        unit.y = toY
        unit.animX = undefined
        unit.animY = undefined
        unit.animProgress = undefined
        unit.animToX = undefined
        unit.animToY = undefined
      }
    }

    step()
  }

  function endRound(winner: Team) {
    running.value = false
    if (tickTimer !== null) {
      clearInterval(tickTimer)
      tickTimer = null
    }

    if (winner === 'A') teamAWins.value++
    else teamBWins.value++

    addTestOutput(`Round ${round.value} winner: Team ${winner}`)

    if (round.value >= maxRounds.value) {
      // BO3 complete
      const finalWinner = teamAWins.value > teamBWins.value ? 'A' : 'B'
      addTestOutput(`BO3 Complete! Final winner: Team ${finalWinner}`)
      alert(`BO3 Complete! Team ${finalWinner} wins ${Math.max(teamAWins.value, teamBWins.value)}-${Math.min(teamAWins.value, teamBWins.value)}`)
    } else {
      round.value++
      // Do not auto-reset to placement to allow replay stepping
    }
  }

  function resetBO3() {
    round.value = 1
    teamAWins.value = 0
    teamBWins.value = 0
    testOutput.value = []
    enterPlacement()
  }

  function shiftVisual() {
    visualShift.value = (visualShift.value + 1) % BOARD_WIDTH
  }

  function addTestOutput(msg: string) {
    testOutput.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
  }

  return {
    // State
    units,
    phase,
    running,
    round,
    maxRounds,
    teamAWins,
    teamBWins,
    bench,
    placementComplete,
    visualShift,
    attackEffects,
    particleEffects,
    tileFlashes,
    testOutput,
    pathsByUnit,
    history,
    unitInfoById,

    // Methods
    placeUnit,
    rotateUnit,
    enterPlacement,
    startBattle,
    resetBO3,
    shiftVisual,
    cellToPx,
    addTestOutput
  }
}
