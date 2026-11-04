import { describe, expect, it } from 'vitest'
import { MAX_PREMISES, planAutoMap, premiseCount } from './automap'
import type { DebateMap } from '../model/types'

const map = {
  debate: { id: 'd1', conclusion: { debateId: 'd1', claimId: 'c0' } },
  claims: [{ id: 'c0', text: 'Buses should be free.', side: 'for', placed: true }],
  links: [],
} as unknown as DebateMap

const arg = (targetId: string, ids: string[], extra: object = {}) => ({
  targetId,
  kind: 'reason',
  side: 'for',
  premises: ids.map((id) => ({ id, text: `Claim ${id}`, type: 'fact', segment: 1 })),
  ...extra,
})

describe('planAutoMap', () => {
  it('orders arguments so each target exists first, even when Claude lists them out of order', () => {
    const plan = planAutoMap({ arguments: [arg('p1', ['p2']), arg('c0', ['p1'])] }, map, 5)
    expect(plan.map((a) => a.target)).toEqual([{ existing: 'c0' }, { planned: 'p1' }])
    expect(plan[0].premises[0]).toMatchObject({ key: 'p1', segment: 1, type: 'fact' })
  })

  it('drops arguments that point nowhere, reuse ids, or are malformed', () => {
    const plan = planAutoMap(
      {
        arguments: [
          arg('c0', ['p1', 'p2']),
          arg('ghost', ['p3']),
          arg('c0', ['p1']),
          arg('c0', ['p4'], { side: 'neither' }),
          arg('c0', ['p5'], { kind: 'maybe' }),
          { targetId: 'c0', kind: 'objection', side: 'against', premises: [{ id: 'p6', text: '  ', type: 'fact', segment: 0 }] },
          arg('c0', ['c0']),
        ],
      },
      map,
      5,
    )
    expect(plan).toHaveLength(1)
    expect(premiseCount(plan)).toBe(2)
  })

  it('cleans types and segments, and caps the total', () => {
    const odd = planAutoMap({ arguments: [{ targetId: 'c0', kind: 'objection', side: 'against', premises: [{ id: 'x', text: 't', type: 'rumour', segment: 99 }] }] }, map, 5)
    expect(odd[0]).toMatchObject({ kind: 'objection', side: 'against', premises: [{ type: 'unspecified', segment: null }] })
    const many = Array.from({ length: 40 }, (_, i) => arg('c0', [0, 1, 2, 3, 4].map((j) => `p${i}-${j}`)))
    expect(premiseCount(planAutoMap({ arguments: many }, map, 5))).toBe(MAX_PREMISES)
    expect(planAutoMap(null, map, 5)).toEqual([])
  })
})
