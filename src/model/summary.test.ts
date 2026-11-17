import { describe, expect, it } from 'vitest'
import { dependents, standing } from './summary'
import { sampleMap } from './sample'

describe('standing', () => {
  it('counts what is agreed and finds the disputed points others rest on', () => {
    const s = standing(sampleMap)
    expect(s.total).toBe(7)
    expect(s.agreed).toBeGreaterThan(0)
    expect(s.cores.map((c) => c.claimId)).toContain('p3')
    // p3 supports the conclusion, so the conclusion rests on it.
    expect(s.cores.find((c) => c.claimId === 'p3')?.restingOn).toBe(1)
  })

  it('follows reasons upward, not objections', () => {
    expect([...dependents(sampleMap, 'p1')]).toEqual(['c'])
    expect(dependents(sampleMap, 'r1').size).toBe(0)
  })
})
