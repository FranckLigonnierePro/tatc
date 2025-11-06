export type Team = 'A' | 'B'
export type Role = 'Soldier' | 'Archer'
export type UnitType = 'melee' | 'archer'
export type Facing = 'N' | 'E' | 'S' | 'W'
export type Phase = 'placement' | 'battle'

export interface Coords {
  x: number
  y: number
}

export interface Unit {
  id: string
  team: Team
  role: Role
  type: UnitType
  x: number
  y: number
  hp: number
  maxHp: number
  atk: number
  range: number
  facing: Facing
  // Target persistence: once an attack starts, keep focusing the same target
  lockedTargetId?: string
  // Special abilities
  canTaunt?: boolean
  invisibleTill?: number // timestamp until which unit is invisible
  // Animation state
  animX?: number
  animY?: number
  animProgress?: number
  animToX?: number
  animToY?: number
  // Combat timing
  lastAttackAt?: number
  attackCooldownMs?: number
}

export interface RoleStats {
  hp: number
  atk: number
  range: number
  type: UnitType
  canTaunt?: boolean
}

export const ROLE_STATS: Record<Role, RoleStats> = {
  Soldier: { hp: 18, atk: 3, range: 1, type: 'melee' },
  Archer: { hp: 12, atk: 2, range: 3, type: 'archer' }
}

export interface AttackEffect {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  timestamp: number
}

export interface ParticleEffect {
  id: string
  x: number
  y: number
  timestamp: number
}

export interface ProjectileEffect {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  progress: number // 0..1
  color: string
}

export interface TileFlash {
  x: number
  y: number
  timestamp: number
}

// History for post-battle replay/step-through
export interface MoveEvent {
  unitId: string
  team: Team
  fromX: number
  fromY: number
  toX: number
  toY: number
  from: string // named cell
  to: string   // named cell
  // Optional metadata for resolver tie-breaks
  delta?: number // startDist - newDist (Manhattan improvement toward current target)
  forward?: number // 1 if moving forward toward enemy baseline, else 0
}

export interface AttackEventHistory {
  attackerId: string
  targetId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  from: string // attacker cell name at time of hit
  to: string   // target cell name at time of hit
  damage: number
}

export interface UnitSnapshot {
  id: string
  team: Team
  x: number
  y: number
  hp: number
}

export interface HistoryStep {
  tick: number
  moves: MoveEvent[]
  attacks: AttackEventHistory[]
  units: UnitSnapshot[] // positions and hp after the tick is processed
}
