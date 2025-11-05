export type Team = 'A' | 'B'
export type Role = 'Soldier'
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
  x: number
  y: number
  hp: number
  maxHp: number
  atk: number
  range: number
  facing: Facing
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
}

export const ROLE_STATS: Record<Role, RoleStats> = {
  Soldier: { hp: 18, atk: 3, range: 1 }
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

export interface TileFlash {
  x: number
  y: number
  timestamp: number
}
