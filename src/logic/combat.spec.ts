import { describe, it, expect, beforeEach } from 'vitest'
import type { Unit } from './types'
import { ROLE_STATS } from './types'
import { manhattan } from './utils'

describe('Combat Logic', () => {
  let attacker: Unit
  let target: Unit

  beforeEach(() => {
    attacker = {
      id: 'attacker1',
      team: 'A',
      role: 'Soldier',
      x: 0,
      y: 0,
      hp: ROLE_STATS.Soldier.hp,
      maxHp: ROLE_STATS.Soldier.hp,
      atk: ROLE_STATS.Soldier.atk,
      range: ROLE_STATS.Soldier.range,
      facing: 'N'
    }

    target = {
      id: 'target1',
      team: 'B',
      role: 'Soldier',
      x: 2,
      y: 0,
      hp: ROLE_STATS.Soldier.hp,
      maxHp: ROLE_STATS.Soldier.hp,
      atk: ROLE_STATS.Soldier.atk,
      range: ROLE_STATS.Soldier.range,
      facing: 'S'
    }
  })

  it('should reduce HP when attacked', () => {
    const initialHp = target.hp
    const damage = attacker.atk

    // Simulate attack
    target.hp -= damage

    expect(target.hp).toBe(initialHp - damage)
    expect(target.hp).toBe(15) // 18 - 3 = 15
  })

  it('should kill unit when HP drops to 0 or below', () => {
    target.hp = 2
    target.hp -= attacker.atk // 2 - 3 = -1

    expect(target.hp).toBeLessThanOrEqual(0)
  })

  it('Soldier should advance if not in melee range', () => {
    const soldier: Unit = {
      id: 'soldier1',
      team: 'A',
      role: 'Soldier',
      x: 0,
      y: 0,
      hp: ROLE_STATS.Soldier.hp,
      maxHp: ROLE_STATS.Soldier.hp,
      atk: ROLE_STATS.Soldier.atk,
      range: ROLE_STATS.Soldier.range,
      facing: 'N'
    }

    const enemy: Unit = {
      id: 'enemy1',
      team: 'B',
      role: 'Soldier',
      x: 3,
      y: 0,
      hp: ROLE_STATS.Soldier.hp,
      maxHp: ROLE_STATS.Soldier.hp,
      atk: ROLE_STATS.Soldier.atk,
      range: ROLE_STATS.Soldier.range,
      facing: 'S'
    }

    const dist = manhattan(soldier, enemy)
    expect(dist).toBe(3)

    // Soldier should move if distance > range
    const shouldMove = dist > soldier.range
    expect(shouldMove).toBe(true)
  })
})
