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
      }
      if (!target) target = selectTarget(unit)
      if (!target) {
        addTestOutput(`T${tickCount} ${unit.team} ${cellName(unit.x, unit.y)} no target`)
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
      if (u.lockedTargetId) target = units.value.find(x => x.id === u.lockedTargetId && x.hp > 0) || null
      if (!target) target = selectTarget(u)
      if (!target) continue
      const startDist = manhattan(u, target)
      const neighbors = [
        { x: u.x + 1, y: u.y, axis: 'x', dir: 1 },
        { x: u.x - 1, y: u.y, axis: 'x', dir: -1 },
        { x: u.x, y: u.y + 1, axis: 'y', dir: 1 },
        { x: u.x, y: u.y - 1, axis: 'y', dir: -1 }
      ]
      const inBounds = (x: number, y: number) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT
      const edges: MoveEvent[] = neighbors
        .filter(n => inBounds(n.x, n.y))
        .map(n => {
          const newDist = manhattan({ x: n.x, y: n.y }, target!)
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
            forward: (n.axis === 'y' && ((u.team === 'A' && n.dir === 1) || (u.team === 'B' && n.dir === -1))) ? 1 : 0
          } as MoveEvent
        })

      // Sort edges by fairness-aware comparator (and prefer empty-at-start destinations)
      const sa = deniedStreak.get(u.id) ?? 0
      edges.sort((a, b) => {
        const sba = sa, sbb = sa // same unit
        if (sba !== sbb) return sbb - sba
        const ea = startOcc.has(`${a.toX},${a.toY}`) ? 1 : 0
        const eb = startOcc.has(`${b.toX},${b.toY}`) ? 1 : 0
        if (ea !== eb) return ea - eb // prefer empty-at-start (0) over occupied (1)
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

  // 1. Select target with advanced logic: prefer in-range enemies to avoid unnecessary moves
  function selectTarget(unit: Unit): Unit | null {
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

    // Exception: Archer targets furthest enemy (when none in range)
    if (unit.type === 'archer') {
      let furthest = enemies[0]
      let maxDist = manhattan(unit, furthest)
      for (const e of enemies) {
        const dist = manhattan(unit, e)
        if (dist > maxDist) {
          maxDist = dist
          furthest = e
        }
      }
      return furthest
    }

    // Taunt priority: if any enemy has taunt, only consider taunters
    const taunters = enemies.filter(e => e.canTaunt)
    const pool = taunters.length > 0 ? taunters : enemies

    // Find closest (Manhattan)
    let closest = pool[0]
    let minDist = manhattan(unit, closest)
    for (let i = 1; i < pool.length; i++) {
      const dist = manhattan(unit, pool[i])
      if (dist < minDist) {
        minDist = dist
        closest = pool[i]
      }
    }

    return closest
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
        // Tie-breaks: axis then forward
        const dx = Math.abs(target.x - unit.x)
        const dy = Math.abs(target.y - unit.y)
        decFree.sort((a, b) => {
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
        addTestOutput(`T${tickCount} ${unit.team} ${cellName(unit.x, unit.y)} -> ${cellName(best.x, best.y)} d ${startDist}->${newDist}`)
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
      const nextFromBfs = nextReducing ?? bfsNextStep(unit, target, occupied)
      if (nextFromBfs) {
        const newDist = manhattan({ x: nextFromBfs.x, y: nextFromBfs.y }, target)
        addTestOutput(`T${tickCount} ${unit.team} ${cellName(unit.x, unit.y)} -> ${cellName(nextFromBfs.x, nextFromBfs.y)} d ${startDist}->${newDist}`)
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
      addTestOutput(`T${tickCount} ${unit.team} ${cellName(unit.x, unit.y)} -> ${cellName(best.x, best.y)} d ${startDist}->${newDist}`)
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
      addTestOutput(`T${tickCount} ${unit.team} ${cellName(unit.x, unit.y)} -> ${cellName(next.x, next.y)} d ${startDist}->${newDist}`)
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
