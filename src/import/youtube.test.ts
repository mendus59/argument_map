import { describe, expect, it } from 'vitest'
import { segmentAt } from './youtube'

describe('segmentAt', () => {
  it('finds the line playing at a time', () => {
    const starts = [0, 4, 9, 15]
    expect(segmentAt(starts, 0)).toBe(0)
    expect(segmentAt(starts, 8.9)).toBe(1)
    expect(segmentAt(starts, 100)).toBe(3)
    expect(segmentAt([2, 4], 1)).toBe(-1)
    expect(segmentAt([null, null], 5)).toBe(-1)
  })
})
