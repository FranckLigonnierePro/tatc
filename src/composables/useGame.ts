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
import { id, rotateFacing, cellName } from '@/logic/utils'

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
  function addTestOutput(msg: string) {
    testOutput.value.push(msg)
  }

  let tickTimer: number | null = null
  let animationFrame: number | null = null
  let tickCount = 0

  // History recording
  const history = ref<HistoryStep[]>([])
  let pendingMoves: MoveEvent[] = []
  let pendingAttacks: AttackEventHistory[] = []
  const unitInfoById = ref<Record<string, { role: Role; maxHp: number; facing: Facing; team: Team }>>({})
  const lastPosition = new Map<string, string>() // unitId -> 'x,y' of previous position
  const deniedStreak = new Map<string, number>() // unitId -> consecutive ticks without allowed move when intending
  const lockExpires = new Map<string, number>() // unitId -> tick number when movement lock may be reconsidered

  const benchA = reactive([
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false }
  ])

  const benchB = reactive([
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false },
    { role: 'Soldier' as Role, placed: false }
  ])

  const placementComplete = computed(() => {
    const hasA = units.value.some(u => u.team === 'A')
    const hasB = units.value.some(u => u.team === 'B')
    return hasA && hasB
  })

  function cellToPx(x: number, y: number): { px: number; py: number } {
    const px = BOARD_PADDING + x * (CELL_SIZE + CELL_GAP)
    const py = BOARD_PADDING + y * (CELL_SIZE + CELL_GAP)
    return { px, py }
  }

  // BFS to find the closest tile (by 4-neighbors) that strictly reduces Manhattan distance to target.
  // First step must be into a start-free cell; inner nodes can traverse start-occupied cells for planning.
  function bfsTowardReducing(unit: Unit, target: Unit, occupied: Set<string>): { x: number; y: number } | null {
    const startKey = `${unit.x},${unit.y}`
    const startDist = manhattan(unit, target)
    const q: Array<{ x: number; y: number } > = [{ x: unit.x, y: unit.y }]
    const prev = new Map<string, string | null>()
    prev.set(startKey, null)

    const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ]
    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    const canStand = (x: number, y: number) => inBounds(x, y)

    let goalKey: string | null = null
    while (q.length > 0) {
      const cur = q.shift()!
      const curKey = `${cur.x},${cur.y}`
      const curDist = manhattan(cur, target)
      if (curKey !== startKey && curDist < startDist) {
        goalKey = curKey
        break
      }
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx
        const ny = cur.y + dy
        const nk = `${nx},${ny}`
        if (!canStand(nx, ny)) continue
        // First step cannot go into a start-occupied cell
        if (curKey === startKey && occupied.has(nk)) continue
        if (prev.has(nk)) continue
        prev.set(nk, curKey)
        q.push({ x: nx, y: ny })
      }
    }

    if (!goalKey) return null
    // Reconstruct first step
    let stepKey = goalKey
    let parent = prev.get(stepKey) || null
    while (parent && parent !== startKey) {
      stepKey = parent
      parent = prev.get(stepKey) || null
    }
    const [sx, sy] = stepKey.split(',').map(n => parseInt(n, 10))
    if (sx === unit.x && sy === unit.y) return null
    return { x: sx, y: sy }
  }

  function createUnit(role: Role, team: Team, x: number, y: number): Unit {
    const stats = ROLE_STATS[role]
    return {
      id: id(),
      team,
      role,
      type: stats.type,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      atk: stats.atk,
      range: stats.range,
      facing: team === 'A' ? 'N' : 'S',
      canTaunt: stats.canTaunt,
      // Base attack speed: 1s
      attackCooldownMs: 1000,
      lastAttackAt: 0
    }
  }

  function placeUnit(role: Role, x: number, y: number, team: Team): boolean {
    if (phase.value !== 'placement') return false

    // Enforce team zones
    const inZoneA = y >= 0 && y <= 3
    const inZoneB = y >= BOARD_HEIGHT - 4 && y <= BOARD_HEIGHT - 1
    if ((team === 'A' && !inZoneA) || (team === 'B' && !inZoneB)) return false

    // Check if cell is occupied
    if (units.value.some(u => u.x === x && u.y === y)) return false

    // Find bench item for the selected team
    const benchSet = team === 'A' ? benchA : benchB
    const benchItem = benchSet.find(b => b.role === role && !b.placed)
    if (!benchItem) return false

    const unit = createUnit(role, team, x, y)
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
    benchA.forEach(b => (b.placed = false))
    benchB.forEach(b => (b.placed = false))
    attackEffects.value = []
    particleEffects.value = []
    tileFlashes.value = []
    history.value = []
    tickCount = 0
    lastPosition.clear()
    deniedStreak.clear()
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
    const tickInterval = 800 // ms
    tickTimer = window.setInterval(() => {
      tick()
    }, tickInterval)
  }

  function tick() {
    if (!running.value) return

    // Snapshot units for this tick
    const snapshot = [...units.value]

    // Reset per-tick recorded events
    pendingMoves = []
    pendingAttacks = []
    addTestOutput(`-- Tick ${tickCount} --`)

    // Build occupancy grid (start-of-tick)
    const occupied = new Set<string>()
    for (const u of snapshot) {
      if (u.hp > 0) occupied.add(`${u.x},${u.y}`)
    }

    for (const snap of snapshot) {
      const unit = units.value.find(u => u.id === snap.id)
      if (!unit || unit.hp <= 0) continue
      if (unit.animProgress !== undefined) continue

      // 1. Determine target with lock persistence
      let target: Unit | null = null
      if (unit.lockedTargetId) {
        target = units.value.find(u => u.id === unit.lockedTargetId && u.hp > 0) || null
        if (!target) unit.lockedTargetId = undefined
        else {
          const lockUntil = lockExpires.get(unit.id) ?? -1
          const canProg = canTwoStepProgress(unit, target, occupied)
          if (tickCount >= lockUntil) {
            const alt = selectTarget(unit, occupied)
            if (alt && alt.id !== target.id) {
              // Compare scores: break lock only if no progress or alt clearly better
              const curS = scoreTargetFor(unit, target, occupied)
              const altS = scoreTargetFor(unit, alt, occupied)
              const altBetter = altS.attackKey < curS.attackKey || altS.newDist < curS.newDist
              if (!canProg || altBetter) {
                unit.lockedTargetId = undefined
                target = alt
              }
            }
          }
        }
      }
      if (!target) target = selectTarget(unit, occupied)
      if (target && !unit.lockedTargetId) {
        unit.lockedTargetId = target.id
        lockExpires.set(unit.id, tickCount + 2)
      }
      if (!target) {
        addTestOutput(`T${tickCount} ${unit.id}(${unit.team}) ${cellName(unit.x, unit.y)} no target`)
        continue
      }

      // 2. Check if can attack (Chebyshev distance <= 1, diagonal allowed)
      if (canAttack(unit, target)) {
        const now = Date.now()
        const cd = unit.attackCooldownMs ?? 1000
        if (!unit.lastAttackAt || now - unit.lastAttackAt >= cd) {
          attack(unit, target)
        }
        delete pathsByUnit.value[unit.id]
      } else {
        // 3. Movement allowed only if not in attack cooldown
        const now = Date.now()
        const cd = unit.attackCooldownMs ?? 1000
        const inCooldown = !!unit.lastAttackAt && (now - (unit.lastAttackAt || 0) < cd)
        if (inCooldown) {
          // Do not move while recovering from an attack
          delete pathsByUnit.value[unit.id]
        } else {
          moveToward(unit, target, occupied)
        }
      }
    }

    // Resolve movement intents using maximum matching over candidate destinations
    const startOcc = new Map<string, string>() // cell -> unitId
    for (const u of snapshot) startOcc.set(`${u.x},${u.y}`, u.id)

    // Movers: units that intended to move this tick
    const moverIds = Array.from(new Set(pendingMoves.map(m => m.unitId)))

    // Build candidate edges per mover (4 neighbors), with metadata
    const edgesByUnit = new Map<string, MoveEvent[]>()
    for (const unitId of moverIds) {
      const u = units.value.find(x => x.id === unitId)
      if (!u) continue
      let target: Unit | null = null
      if (u.lockedTargetId) {
        target = units.value.find(x => x.id === u.lockedTargetId && x.hp > 0) || null
        if (target) {
          const canProg = canTwoStepProgress(u, target, occupied)
          if (!canProg) {
            const alt = selectTarget(u, occupied)
            if (alt && alt.id !== target.id) {
              u.lockedTargetId = undefined
              target = alt
            }
          }
        }
      }
      if (!target) target = selectTarget(u, occupied)
      if (!target) continue
      const startDist = manhattan(u, target)
      const neighbors = [
        { x: u.x + 1, y: u.y, axis: 'x', dir: 1 },
        { x: u.x - 1, y: u.y, axis: 'x', dir: -1 },
        { x: u.x, y: u.y + 1, axis: 'y', dir: 1 },
        { x: u.x, y: u.y - 1, axis: 'y', dir: -1 }
      ]
      const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
      const buildEdges = (t: Unit): (MoveEvent & { backtrack?: number })[] =>
        neighbors
          .filter(n => inBounds(n.x, n.y))
          .map(n => {
            const newDist = manhattan({ x: n.x, y: n.y }, t)
            const was = lastPosition.get(u.id)
            const isBack = was === `${n.x},${n.y}` ? 1 : 0
            return {
              unitId: u.id,
              team: u.team,
              fromX: u.x,
              fromY: u.y,
              toX: n.x,
              toY: n.y,
              from: cellName(u.x, u.y),
              to: cellName(n.x, n.y),
              delta: startDist - newDist,
              forward: (n.axis === 'y' && ((u.team === 'A' && n.dir === 1) || (u.team === 'B' && n.dir === -1))) ? 1 : 0,
              backtrack: isBack
            } as MoveEvent
          })

      let edges = buildEdges(target)
      // If no edge reduces distance to current target, try retargeting to a more approachable enemy for this tick
      if (!edges.some(e => (e.delta ?? 0) > 0)) {
        const alt = selectTarget(u, occupied)
        if (alt && alt.id !== target.id) {
          addTestOutput(`T${tickCount} ${u.id}(${u.team}) retarget ${target.id} -> ${alt.id} (no progress possible)`) 
          target = alt
          const newStart = manhattan(u, target)
          // Rebuild edges with new startDist
          edges = buildEdges(target).map(e => ({ ...e, delta: newStart - (newStart - (e.delta ?? 0)) }))
        }
      }

      // Sort edges by comparator prioritizing: attack-next, then empty-at-start, then delta, then forward
      const sa = deniedStreak.get(u.id) ?? 0
      edges.sort((a, b) => {
        const sba = sa, sbb = sa // same unit
        if (sba !== sbb) return sbb - sba
        // Prefer destinations from which we can attack the target immediately next tick
        const attackFrom = (x: number, y: number) => {
          const pseudo: Unit = { ...u, x, y }
          return canAttack(pseudo, target!)
        }
        const aAttack = attackFrom(a.toX, a.toY) ? 0 : 1
        const bAttack = attackFrom(b.toX, b.toY) ? 0 : 1
        if (aAttack !== bAttack) return aAttack - bAttack
        const ea = startOcc.has(`${a.toX},${a.toY}`) ? 1 : 0
        const eb = startOcc.has(`${b.toX},${b.toY}`) ? 1 : 0
        if (ea !== eb) return ea - eb // prefer empty-at-start (0) over occupied (1)
        const ab = a.backtrack ?? 0
        const bb = b.backtrack ?? 0
        if (ab !== bb) return ab - bb // prefer non-backtrack (0) over backtrack (1)
        const da = (a.delta ?? 0), db = (b.delta ?? 0)
        if (da !== db) return db - da
        const fa = (a.forward ?? 0), fb = (b.forward ?? 0)
        if (fa !== fb) return fb - fa
        return 0
      })
      edgesByUnit.set(unitId, edges)
    }

    // Order movers by fairness streak, then best delta, then id
    const moversOrdered = [...moverIds].sort((ua, ub) => {
      const sa = deniedStreak.get(ua) ?? 0
      const sb = deniedStreak.get(ub) ?? 0
      if (sa !== sb) return sb - sa
      const ea = edgesByUnit.get(ua) || []
      const eb = edgesByUnit.get(ub) || []
      const maxDa = Math.max(-Infinity, ...ea.map(e => e.delta ?? -Infinity))
      const maxDb = Math.max(-Infinity, ...eb.map(e => e.delta ?? -Infinity))
      if (maxDa !== maxDb) return (maxDb - maxDa)
      return ua < ub ? -1 : ua > ub ? 1 : 0
    })

    const destToUnit = new Map<string, string>()
    const unitToDest = new Map<string, string>()

    function dfs(uId: string, rootFromKey: string, seenUnits: Set<string>, seenDests: Set<string>): boolean {
      if (seenUnits.has(uId)) return false
      seenUnits.add(uId)
      const edges = edgesByUnit.get(uId) || []
      for (const e of edges) {
        const destKey = `${e.toX},${e.toY}`
        if (seenDests.has(destKey)) continue
        seenDests.add(destKey)
        const occupierId = startOcc.get(destKey)
        if (!occupierId) {
          // Empty-at-start destination: may already be matched, try to reassign that matched unit
          const matched = destToUnit.get(destKey)
          if (!matched) {
            destToUnit.set(destKey, uId)
            unitToDest.set(uId, destKey)
            return true
          } else {
            if (dfs(matched, rootFromKey, seenUnits, seenDests)) {
              destToUnit.set(destKey, uId)
              unitToDest.set(uId, destKey)
              return true
            }
          }
        } else {
          if (occupierId === uId) continue
          // Prevent direct swap: do not reassign occupier to root's start
          const occAssigned = unitToDest.get(occupierId)
          if (occAssigned === rootFromKey) continue
          if (dfs(occupierId, rootFromKey, seenUnits, seenDests)) {
            destToUnit.set(destKey, uId)
            unitToDest.set(uId, destKey)
            return true
          }
        }
      }
      return false
    }

    // Duel arbitration: if two opposing units would both step to enable an immediate attack on each other,
    // allow only one to keep such edges this tick based on fair tie-breakers.
    (function duelArbitration() {
      const processed = new Set<string>()
      const idToUnit = new Map<string, Unit>()
      for (const u of units.value) idToUnit.set(u.id, u as Unit)
      const favorTeam = (tickCount % 2 === 0) ? 'A' : 'B'
      const attackNext = (u: Unit, e: MoveEvent, v: Unit) => {
        const pseudo: Unit = { ...u, x: e.toX, y: e.toY }
        return canAttack(pseudo, v)
      }
      for (const ua of moverIds) {
        const u = idToUnit.get(ua)
        if (!u || processed.has(ua)) continue
        const eu = edgesByUnit.get(ua) || []
        // Find opponents v that u could attack next tick after edge
        const opps = moverIds
          .filter(vId => {
            if (vId === ua) return false
            const v = idToUnit.get(vId)
            if (!v || v.team === u.team) return false
            // Check mutual potential
            const uCan = eu.some(e => attackNext(u, e, v))
            if (!uCan) return false
            const ev = edgesByUnit.get(vId) || []
            const vCan = ev.some(e => attackNext(v!, e, u))
            return vCan
          })
        if (opps.length === 0) continue
        // For simplicity, arbitrate the first such opponent not processed
        const vb = opps.find(id => !processed.has(id))
        if (!vb) continue
        const v = idToUnit.get(vb)!
        const ev = edgesByUnit.get(vb) || []
        // Tie-breakers: deniedStreak desc, then LESS advanced unit moves (more advanced holds),
        // then initiative favorTeam, then id asc
        const su = deniedStreak.get(u.id) ?? 0
        const sv = deniedStreak.get(v.id) ?? 0
        let winner: Unit, loser: Unit
        if (su !== sv) {
          winner = su > sv ? u : v
        } else {
          const advance = (w: Unit) => w.team === 'A' ? w.y : (BOARD_HEIGHT - 1 - w.y)
          const au = advance(u)
          const av = advance(v)
          if (au !== av) {
            winner = au < av ? u : v // less advanced moves
          } else if (u.team !== v.team) {
            winner = (u.team === favorTeam) ? u : v
          } else {
            winner = (u.id < v.id) ? u : v
          }
        }
        loser = (winner.id === u.id) ? v : u
        // Strict: block all moves for the loser this tick to avoid both stepping
        edgesByUnit.set(loser.id, [])
        addTestOutput(`T${tickCount} DUEL ${winner.id} wins over ${loser.id}: only ${winner.id} may step to attack-range`)
        processed.add(u.id)
        processed.add(v.id)
      }
    })()

    // Run matching
    for (const uId of moversOrdered) {
      const u = units.value.find(x => x.id === uId)
      if (!u) continue
      const fromKey = `${u.x},${u.y}`
      dfs(uId, fromKey, new Set<string>(), new Set<string>())
    }

    // Build allowed moves from matching
    const allowed: MoveEvent[] = []
    for (const [uId, destKey] of unitToDest.entries()) {
      const u = units.value.find(x => x.id === uId)
      if (!u) continue
      const [tx, ty] = destKey.split(',').map(n => parseInt(n, 10))
      allowed.push({
        unitId: u.id,
        team: u.team,
        fromX: u.x,
        fromY: u.y,
        toX: tx,
        toY: ty,
        from: cellName(u.x, u.y),
        to: cellName(tx, ty)
      })
    }

    // Apply only allowed moves
    pathsByUnit.value = {}
    for (const mv of allowed) {
      const u = units.value.find(x => x.id === mv.unitId)
      if (!u) continue
      pathsByUnit.value[u.id] = [ { x: u.x, y: u.y }, { x: mv.toX, y: mv.toY } ]
      animateMove(u, mv.toX, mv.toY)
      // Update lastPosition to discourage immediate backtracking next tick
      lastPosition.set(u.id, `${u.x},${u.y}`)
    }
    pendingMoves = allowed

    // Update denied streaks for fairness
    const intendedIds = new Set<string>(moverIds)
    const allowedIds = new Set<string>(allowed.map(m => m.unitId))
    for (const id of intendedIds) {
      if (allowedIds.has(id)) deniedStreak.set(id, 0)
      else deniedStreak.set(id, (deniedStreak.get(id) ?? 0) + 1)
    }

    // Remove dead units
    units.value = units.value.filter(u => u.hp > 0)
    const aliveIds = new Set(units.value.map(u => u.id))
    for (const k of Object.keys(pathsByUnit.value)) {
      if (!aliveIds.has(k)) delete pathsByUnit.value[k]
    }

    // Push history step
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

  // Helper: Manhattan distance
  function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  }

  // Check if unit can make two-step progress toward target without immediately bouncing back
  function canTwoStepProgress(unit: Unit, target: Unit, occupied: Set<string>): boolean {
    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    const neighbors = [
      { x: unit.x + 1, y: unit.y },
      { x: unit.x - 1, y: unit.y },
      { x: unit.x, y: unit.y + 1 },
      { x: unit.x, y: unit.y - 1 }
    ]
    const distNow = manhattan(unit, target)
    for (const n of neighbors) {
      if (!inBounds(n.x, n.y)) continue
      if (occupied.has(`${n.x},${n.y}`)) continue
      const d1 = manhattan(n, target)
      if (d1 >= distNow) continue // must reduce on first step
      // If can attack from n, it's good
      const pseudo = { ...unit, x: n.x, y: n.y }
      if (canAttack(pseudo, target)) return true
      // From n, check a second step that reduces further and is not just stepping back
      const nbs2 = [
        { x: n.x + 1, y: n.y },
        { x: n.x - 1, y: n.y },
        { x: n.x, y: n.y + 1 },
        { x: n.x, y: n.y - 1 }
      ]
      for (const m of nbs2) {
        if (!inBounds(m.x, m.y)) continue
        if (occupied.has(`${m.x},${m.y}`)) continue
        if (m.x === unit.x && m.y === unit.y) continue // avoid immediate backtrack
        const d2 = manhattan(m, target)
        if (d2 < d1) return true
      }
    }
    return false
  }

  // 1. Select target with advanced logic: prefer in-range enemies to avoid unnecessary moves
  function selectTarget(unit: Unit, occupied: Set<string>): Unit | null {
    const now = Date.now()
    
    // Filter visible enemies
    const enemies = units.value.filter(u => 
      u.team !== unit.team && 
      u.hp > 0 && 
      !(u.invisibleTill && u.invisibleTill > now)
    )
    
    if (enemies.length === 0) return null

    // If any enemy is already in attack range, prefer attacking one of them instead of moving
    const inRange = enemies.filter(e => canAttack(unit, e))
    if (inRange.length > 0) {
      // Taunt priority within in-range pool
      const taunters = inRange.filter(e => e.canTaunt)
      const pool = taunters.length ? taunters : inRange
      if (unit.type === 'archer') {
        // Archer: attack the furthest within range
        let best = pool[0]
        let bestD = manhattan(unit, best)
        for (let i = 1; i < pool.length; i++) {
          const d = manhattan(unit, pool[i])
          if (d > bestD) { best = pool[i]; bestD = d }
        }
        return best
      } else {
        // Melee and others: attack the closest within range
        let best = pool[0]
        let bestD = manhattan(unit, best)
        for (let i = 1; i < pool.length; i++) {
          const d = manhattan(unit, pool[i])
          if (d < bestD) { best = pool[i]; bestD = d }
        }
        return best
      }
    }

    // Consider approachability: prefer enemies for which we can make progress this tick
    const canProgress = (t: Unit) => canTwoStepProgress(unit, t, occupied)
    const progressibles = enemies.filter(canProgress)
    const consider = progressibles.length > 0 ? progressibles : enemies

    // Exception: Archer targets furthest enemy (when none in range)
    if (unit.type === 'archer') {
      let furthest = consider[0]
      let maxDist = manhattan(unit, furthest)
      for (const e of consider) {
        const dist = manhattan(unit, e)
        if (dist > maxDist) {
          maxDist = dist
          furthest = e
        }
      }
      return furthest
    }

    // Taunt priority: if any enemy has taunt, only consider taunters
    const taunters = consider.filter(e => e.canTaunt)
    const pool = taunters.length > 0 ? taunters : consider

    // Rank by ease to attack next tick, then by best reduced distance after one step, then by current distance
    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    function scoreTarget(t: Unit) {
      const distNow = manhattan(unit, t)
      let bestNewDist = Number.POSITIVE_INFINITY
      let canAttackNext = false
      // Check 4-neighbors that are free at start and reduce distance
      const neighbors = [
        { x: unit.x + 1, y: unit.y },
        { x: unit.x - 1, y: unit.y },
        { x: unit.x, y: unit.y + 1 },
        { x: unit.x, y: unit.y - 1 }
      ]
      for (const n of neighbors) {
        if (!inBounds(n.x, n.y)) continue
        if (occupied.has(`${n.x},${n.y}`)) continue
        const d = manhattan({ x: n.x, y: n.y }, t)
        if (d < distNow) {
          bestNewDist = Math.min(bestNewDist, d)
          const pseudo: Unit = { ...unit, x: n.x, y: n.y }
          if (canAttack(pseudo, t)) canAttackNext = true
        }
      }
      // If no decreasing free neighbor, peek BFS suggestion
      if (!isFinite(bestNewDist)) {
        const step = bfsTowardReducing(unit, t, occupied) || bfsNextStep(unit, t, occupied)
        if (step) {
          bestNewDist = manhattan(step, t)
          const pseudo: Unit = { ...unit, x: step.x, y: step.y }
          if (canAttack(pseudo, t)) canAttackNext = true
        } else {
          bestNewDist = distNow // no progress
        }
      }
      // Sorting keys: attack-next first (true better), then bestNewDist, then distNow
      return {
        attackKey: canAttackNext ? 0 : 1,
        newDist: bestNewDist,
        curDist: distNow
      }
    }

    let best = pool[0]
    let bestS = scoreTarget(best)
    for (let i = 1; i < pool.length; i++) {
      const s = scoreTarget(pool[i])
      if (
        s.attackKey !== bestS.attackKey ? s.attackKey < bestS.attackKey :
        s.newDist !== bestS.newDist ? s.newDist < bestS.newDist :
        s.curDist < bestS.curDist
      ) {
        best = pool[i]
        bestS = s
      }
    }

    return best
  }

  // Externalized scoring helper to compare current vs alternative targets
  function scoreTargetFor(unit: Unit, t: Unit, occupied: Set<string>) {
    const distNow = manhattan(unit, t)
    let bestNewDist = Number.POSITIVE_INFINITY
    let canAttackNext = false
    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    const neighbors = [
      { x: unit.x + 1, y: unit.y },
      { x: unit.x - 1, y: unit.y },
      { x: unit.x, y: unit.y + 1 },
      { x: unit.x, y: unit.y - 1 }
    ]
    for (const n of neighbors) {
      if (!inBounds(n.x, n.y)) continue
      if (occupied.has(`${n.x},${n.y}`)) continue
      const d = manhattan({ x: n.x, y: n.y }, t)
      if (d < distNow) {
        bestNewDist = Math.min(bestNewDist, d)
        const pseudo: Unit = { ...unit, x: n.x, y: n.y }
        if (canAttack(pseudo, t)) canAttackNext = true
      }
    }
    if (!isFinite(bestNewDist)) {
      const step = bfsTowardReducing(unit, t, occupied) || bfsNextStep(unit, t, occupied)
      if (step) {
        bestNewDist = manhattan(step, t)
        const pseudo: Unit = { ...unit, x: step.x, y: step.y }
        if (canAttack(pseudo, t)) canAttackNext = true
      } else {
        bestNewDist = distNow
      }
    }
    return { attackKey: canAttackNext ? 0 : 1, newDist: bestNewDist, curDist: distNow }
  }

  // 2. Check if unit can attack target (type-specific range logic)
  function canAttack(unit: Unit, target: Unit): boolean {
    const dx = Math.abs(unit.x - target.x)
    const dy = Math.abs(unit.y - target.y)
    
    // Melee: 8-neighbors (Chebyshev, diagonal allowed)
    if (unit.type === 'melee') {
      return dx <= 1 && dy <= 1
    }
    
    // Archer: Manhattan distance <= range
    if (unit.type === 'archer') {
      return manhattan(unit, target) <= unit.range
    }
    
    // Default: Manhattan
    return manhattan(unit, target) <= unit.range
  }

  // BFS over 4-neighbors to find the shortest path to any tile where the unit can attack the target.
  // Returns the immediate next step toward that tile, or null if none found.
  function bfsNextStep(unit: Unit, target: Unit, occupied: Set<string>): { x: number; y: number } | null {
    const startKey = `${unit.x},${unit.y}`
    const q: Array<{ x: number; y: number } > = [{ x: unit.x, y: unit.y }]
    const prev = new Map<string, string | null>()
    prev.set(startKey, null)

    const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ]

    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    // For simultaneous chains, permit planning through currently occupied cells; resolver will decide
    const canStand = (x: number, y: number) => inBounds(x, y)

    const canAttackFrom = (x: number, y: number) => {
      const dx = Math.abs(x - target.x)
      const dy = Math.abs(y - target.y)
      if (unit.type === 'melee') return dx <= 1 && dy <= 1
      if (unit.type === 'archer') return (Math.abs(x - target.x) + Math.abs(y - target.y)) <= unit.range
      return (Math.abs(x - target.x) + Math.abs(y - target.y)) <= unit.range
    }

    let goalKey: string | null = null

    while (q.length > 0) {
      const cur = q.shift()!
      const curKey = `${cur.x},${cur.y}`
      if (curKey !== startKey && canAttackFrom(cur.x, cur.y)) {
        goalKey = curKey
        break
      }
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx
        const ny = cur.y + dy
        const nk = `${nx},${ny}`
        if (!canStand(nx, ny)) continue
        // Enforce: first step cannot go into a start-occupied cell
        if (curKey === startKey && occupied.has(nk)) continue
        if (prev.has(nk)) continue
        prev.set(nk, curKey)
        q.push({ x: nx, y: ny })
      }
    }

    if (!goalKey) return null

    // Reconstruct to find the first step after start
    let stepKey = goalKey
    let parent = prev.get(stepKey) || null
    while (parent && parent !== startKey) {
      stepKey = parent
      parent = prev.get(stepKey) || null
    }
    const [sx, sy] = stepKey.split(',').map(n => parseInt(n, 10))
    if (sx === unit.x && sy === unit.y) return null
    return { x: sx, y: sy }
  }

  // 3. Move toward target: prefer greedy decreasing step; fallback to BFS for contouring
  function moveToward(unit: Unit, target: Unit, occupied: Set<string>) {
    const neighbors = [
      { x: unit.x + 1, y: unit.y, axis: 'x', dir: 1 },
      { x: unit.x - 1, y: unit.y, axis: 'x', dir: -1 },
      { x: unit.x, y: unit.y + 1, axis: 'y', dir: 1 },
      { x: unit.x, y: unit.y - 1, axis: 'y', dir: -1 }
    ]
    const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
    const lastPos = lastPosition.get(unit.id)
    const valid = neighbors.filter(n => inBounds(n.x, n.y))
    const isFree = (n: {x:number;y:number}) => !occupied.has(`${n.x},${n.y}`)

    if (valid.length > 0) {
      const startDist = manhattan(unit, target)
      const nonBacktrack = valid.filter(n => `${n.x},${n.y}` !== lastPos)
      const pool = nonBacktrack.length > 0 ? nonBacktrack : valid

      // 1) Prefer strictly decreasing neighbors that are FREE at start
      const decFree = pool.filter(n => isFree(n) && manhattan({ x: n.x, y: n.y }, target) < startDist)
      if (decFree.length > 0) {
        // First, prioritize neighbors from which we can attack the target immediately next tick
        const canAttackFromNeighbor = (nx: number, ny: number) => {
          const pseudo: Unit = { ...unit, x: nx, y: ny }
          return canAttack(pseudo, target)
        }
        // Tie-breaks: attack-next, then distance, then axis preference, then forward
        const dx = Math.abs(target.x - unit.x)
        const dy = Math.abs(target.y - unit.y)
        decFree.sort((a, b) => {
          const aAttack = canAttackFromNeighbor(a.x, a.y) ? 0 : 1
          const bAttack = canAttackFromNeighbor(b.x, b.y) ? 0 : 1
          if (aAttack !== bAttack) return aAttack - bAttack
          const da = manhattan({ x: a.x, y: a.y }, target)
          const db = manhattan({ x: b.x, y: b.y }, target)
          if (da !== db) return da - db
          const aAxisScore = a.axis === 'x' ? (dx >= dy ? 0 : 1) : (dy > dx ? 0 : 1)
          const bAxisScore = b.axis === 'x' ? (dx >= dy ? 0 : 1) : (dy > dx ? 0 : 1)
          if (aAxisScore !== bAxisScore) return aAxisScore - bAxisScore
          const aForward = a.axis === 'y' && ((unit.team === 'A' && a.dir === 1) || (unit.team === 'B' && a.dir === -1)) ? 0 : 1
          const bForward = b.axis === 'y' && ((unit.team === 'A' && b.dir === 1) || (unit.team === 'B' && b.dir === -1)) ? 0 : 1
          if (aForward !== bForward) return aForward - bForward
          return 0
        })
        const best = decFree[0]
        const newDist = manhattan({ x: best.x, y: best.y }, target)
        addTestOutput(`T${tickCount} ${unit.id}(${unit.team}) ${cellName(unit.x, unit.y)} -> ${cellName(best.x, best.y)} d ${startDist}->${newDist} tgt:${target.id}`)
        lastPosition.set(unit.id, `${unit.x},${unit.y}`)
        pendingMoves.push({
          unitId: unit.id,
          team: unit.team,
          fromX: unit.x,
          fromY: unit.y,
          toX: best.x,
          toY: best.y,
          from: cellName(unit.x, unit.y),
          to: cellName(best.x, best.y),
          delta: startDist - newDist,
          forward: (best.axis === 'y' && ((unit.team === 'A' && best.dir === 1) || (unit.team === 'B' && best.dir === -1))) ? 1 : 0
        })
        return
      }

      // 2) No decreasing FREE neighbor: try BFS reducing step first, then BFS to attack position
      const nextReducing = bfsTowardReducing(unit, target, occupied)
      let nextFromBfs = nextReducing ?? bfsNextStep(unit, target, occupied)
      // Prevent oscillation: avoid stepping back to the immediate last position if a reasonable alternative exists
      if (nextFromBfs && `${nextFromBfs.x},${nextFromBfs.y}` === lastPos) {
        const alt = valid
          .filter(n => `${n.x},${n.y}` !== lastPos) // do not go back
          .sort((a, b) => {
            const aAttack = canAttack({ ...unit, x: a.x, y: a.y }, target) ? 0 : 1
            const bAttack = canAttack({ ...unit, x: b.x, y: b.y }, target) ? 0 : 1
            if (aAttack !== bAttack) return aAttack - bAttack
            const da = manhattan({ x: a.x, y: a.y }, target)
            const db = manhattan({ x: b.x, y: b.y }, target)
            if (da !== db) return da - db
            return 0
          })[0]
        if (alt) {
          nextFromBfs = { x: alt.x, y: alt.y }
        } else {
          nextFromBfs = null
        }
      }
      if (nextFromBfs) {
        const newDist = manhattan({ x: nextFromBfs.x, y: nextFromBfs.y }, target)
        addTestOutput(`T${tickCount} ${unit.id}(${unit.team}) ${cellName(unit.x, unit.y)} -> ${cellName(nextFromBfs.x, nextFromBfs.y)} d ${startDist}->${newDist} tgt:${target.id}`)
        lastPosition.set(unit.id, `${unit.x},${unit.y}`)
        pendingMoves.push({
          unitId: unit.id,
          team: unit.team,
          fromX: unit.x,
          fromY: unit.y,
          toX: nextFromBfs.x,
          toY: nextFromBfs.y,
          from: cellName(unit.x, unit.y),
          to: cellName(nextFromBfs.x, nextFromBfs.y),
          delta: startDist - newDist,
          forward: ((nextFromBfs.y - unit.y) !== 0) && ((unit.team === 'A' && (nextFromBfs.y - unit.y) === 1) || (unit.team === 'B' && (nextFromBfs.y - unit.y) === -1)) ? 1 : 0
        })
        return
      }

      // 3) As a last resort, pick best among remaining neighbors (can include occupied or non-decreasing)
      const dx = Math.abs(target.x - unit.x)
      const dy = Math.abs(target.y - unit.y)
      pool.sort((a, b) => {
        const da = manhattan({ x: a.x, y: a.y }, target)
        const db = manhattan({ x: b.x, y: b.y }, target)
        if (da !== db) return da - db
        const aAxisScore = a.axis === 'x' ? (dx >= dy ? 0 : 1) : (dy > dx ? 0 : 1)
        const bAxisScore = b.axis === 'x' ? (dx >= dy ? 0 : 1) : (dy > dx ? 0 : 1)
        if (aAxisScore !== bAxisScore) return aAxisScore - bAxisScore
        const aForward = a.axis === 'y' && ((unit.team === 'A' && a.dir === 1) || (unit.team === 'B' && a.dir === -1)) ? 0 : 1
        const bForward = b.axis === 'y' && ((unit.team === 'A' && b.dir === 1) || (unit.team === 'B' && b.dir === -1)) ? 0 : 1
        if (aForward !== bForward) return aForward - bForward
        return 0
      })
      const best = pool[0]
      const newDist = manhattan({ x: best.x, y: best.y }, target)
      addTestOutput(`T${tickCount} ${unit.id}(${unit.team}) ${cellName(unit.x, unit.y)} -> ${cellName(best.x, best.y)} d ${startDist}->${newDist} tgt:${target.id}`)
      lastPosition.set(unit.id, `${unit.x},${unit.y}`)
      pendingMoves.push({
        unitId: unit.id,
        team: unit.team,
        fromX: unit.x,
        fromY: unit.y,
        toX: best.x,
        toY: best.y,
        from: cellName(unit.x, unit.y),
        to: cellName(best.x, best.y),
        delta: startDist - newDist,
        forward: (best.axis === 'y' && ((unit.team === 'A' && best.dir === 1) || (unit.team === 'B' && best.dir === -1))) ? 1 : 0
      })
      return
    }

    // If no valid immediate step (rare), try BFS to find a contouring path
    const next = bfsNextStep(unit, target, occupied)
    if (next) {
      const startDist = manhattan(unit, target)
      const newDist = manhattan({ x: next.x, y: next.y }, target)
      addTestOutput(`T${tickCount} ${unit.id}(${unit.team}) ${cellName(unit.x, unit.y)} -> ${cellName(next.x, next.y)} d ${startDist}->${newDist} tgt:${target.id}`)
      lastPosition.set(unit.id, `${unit.x},${unit.y}`)
      pendingMoves.push({
        unitId: unit.id,
        team: unit.team,
        fromX: unit.x,
        fromY: unit.y,
        toX: next.x,
        toY: next.y,
        from: cellName(unit.x, unit.y),
        to: cellName(next.x, next.y),
        delta: startDist - newDist,
        forward: (((next.y - unit.y) !== 0) && ((unit.team === 'A' && (next.y - unit.y) === 1) || (unit.team === 'B' && (next.y - unit.y) === -1))) ? 1 : 0
      })
      return
    }

    // Otherwise, stay put for this tick
    delete pathsByUnit.value[unit.id]
  }

  function attack(attacker: Unit, target: Unit) {
    attacker.lastAttackAt = Date.now()
    target.hp -= attacker.atk
    if (!attacker.lockedTargetId) attacker.lockedTargetId = target.id

    addTestOutput(
      `T${tickCount} ATTACK ${attacker.id}(${attacker.team}) ${cellName(attacker.x, attacker.y)} -> ${target.id} ${cellName(target.x, target.y)} dmg ${attacker.atk}`
    )

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
    addTestOutput(`BO3 Reset`)
  }

  function shiftVisual() {
    visualShift.value = (visualShift.value + 1) % BOARD_WIDTH
  }

  return {
    units,
    phase,
    running,
    round,
    maxRounds,
    teamAWins,
    teamBWins,
    benchA,
    benchB,
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
  }
}
