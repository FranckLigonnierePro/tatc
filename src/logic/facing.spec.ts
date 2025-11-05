import { describe, it, expect } from 'vitest'
import { rotateFacing } from './utils'
import type { Facing } from './types'

describe('Facing Rotation', () => {
  it('should rotate N → E → S → W → N', () => {
    let facing: Facing = 'N'
    
    facing = rotateFacing(facing)
    expect(facing).toBe('E')
    
    facing = rotateFacing(facing)
    expect(facing).toBe('S')
    
    facing = rotateFacing(facing)
    expect(facing).toBe('W')
    
    facing = rotateFacing(facing)
    expect(facing).toBe('N')
  })

  it('should cycle correctly from any starting direction', () => {
    expect(rotateFacing('N')).toBe('E')
    expect(rotateFacing('E')).toBe('S')
    expect(rotateFacing('S')).toBe('W')
    expect(rotateFacing('W')).toBe('N')
  })
})
