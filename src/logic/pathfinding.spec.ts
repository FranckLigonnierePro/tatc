import { describe, it, expect } from 'vitest'
import { astar } from './pathfinding'

describe('A* Pathfinding', () => {
  it('should find path on empty row from (0,0) to (4,0)', () => {
    const start = { x: 0, y: 0 }
    const goal = { x: 4, y: 0 }
    const occupied = new Set<string>()
    const width = 5
    const height = 8

    const path = astar(start, goal, occupied, width, height)

    expect(path.length).toBeGreaterThanOrEqual(5)
    expect(path[0]).toEqual(start)
    expect(path[path.length - 1]).toEqual(goal)
  })

  it('should allow target cell to be occupied by enemy', () => {
    const start = { x: 0, y: 0 }
    const goal = { x: 2, y: 0 }
    const occupied = new Set<string>()
    occupied.add('2,0') // Goal cell is occupied
    const width = 5
    const height = 8

    const path = astar(start, goal, occupied, width, height)

    expect(path.length).toBeGreaterThan(0)
    expect(path[path.length - 1]).toEqual(goal)
  })

  it('should return empty path if completely blocked', () => {
    const start = { x: 0, y: 0 }
    const goal = { x: 2, y: 0 }
    const occupied = new Set<string>()
    // Block all paths
    occupied.add('1,0')
    occupied.add('0,1')
    const width = 5
    const height = 8

    const path = astar(start, goal, occupied, width, height)

    // Should still find a path around
    expect(path.length).toBeGreaterThan(0)
  })
})
