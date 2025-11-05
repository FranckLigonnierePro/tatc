import type { Coords } from './types'
import { manhattan } from './utils'

interface Node {
  x: number
  y: number
  g: number
  h: number
  f: number
  parent: Node | null
}

/**
 * A* pathfinding with Manhattan heuristic, 4-neighbors.
 * Allows the goal cell to be occupied (by the target enemy).
 * Returns path as array of coords from start to goal, or empty if unreachable.
 */
export function astar(
  start: Coords,
  goal: Coords,
  occupied: Set<string>,
  width: number,
  height: number
): Coords[] {
  const key = (x: number, y: number) => `${x},${y}`
  const startKey = key(start.x, start.y)
  const goalKey = key(goal.x, goal.y)

  if (startKey === goalKey) return [start]

  const openSet = new Map<string, Node>()
  const closedSet = new Set<string>()

  const startNode: Node = {
    x: start.x,
    y: start.y,
    g: 0,
    h: manhattan(start, goal),
    f: manhattan(start, goal),
    parent: null
  }
  openSet.set(startKey, startNode)

  while (openSet.size > 0) {
    // Find node with lowest f; tie-break on lowest h (straighter toward goal)
    let current: Node | null = null
    let currentKey = ''
    for (const [k, node] of openSet) {
      if (!current || node.f < current.f || (node.f === current.f && node.h < current.h)) {
        current = node
        currentKey = k
      }
    }

    if (!current) break

    // Reached goal
    if (currentKey === goalKey) {
      const path: Coords[] = []
      let node: Node | null = current
      while (node) {
        path.unshift({ x: node.x, y: node.y })
        node = node.parent
      }
      return path
    }

    openSet.delete(currentKey)
    closedSet.add(currentKey)

    // Explore 4-neighbors, sorted by heuristic distance to goal (smallest first)
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ].sort((a, b) => manhattan(a, goal) - manhattan(b, goal))

    for (const neighbor of neighbors) {
      const { x, y } = neighbor
      if (x < 0 || x >= width || y < 0 || y >= height) continue

      const nKey = key(x, y)
      if (closedSet.has(nKey)) continue

      // Allow goal cell even if occupied
      const isGoal = nKey === goalKey
      if (!isGoal && occupied.has(nKey)) continue

      const g = current.g + 1
      const h = manhattan(neighbor, goal)
      const f = g + h

      const existing = openSet.get(nKey)
      if (!existing || g < existing.g) {
        openSet.set(nKey, {
          x,
          y,
          g,
          h,
          f,
          parent: current
        })
      }
    }
  }

  return []
}
