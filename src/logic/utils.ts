import type { Coords, Facing } from './types'

let idCounter = 0
export function id(): string {
  return `id_${++idCounter}_${Date.now()}`
}

export function manhattan(a: Coords, b: Coords): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function chebyshev(a: Coords, b: Coords): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function rotateFacing(facing: Facing): Facing {
  const cycle: Facing[] = ['N', 'E', 'S', 'W']
  const idx = cycle.indexOf(facing)
  return cycle[(idx + 1) % 4]
}

export function facingToArrow(facing: Facing): string {
  const arrows: Record<Facing, string> = {
    N: '↑',
    E: '→',
    S: '↓',
    W: '←'
  }
  return arrows[facing]
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Name a cell using chess-like notation with letters for columns (A,B,...) and 1-based rows
export function cellName(x: number, y: number): string {
  const col = String.fromCharCode('A'.charCodeAt(0) + x)
  const row = (y + 1).toString()
  return `${col}${row}`
}
