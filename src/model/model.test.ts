import { describe, expect, it } from 'vitest'
import { agreedOutcome, unresolvedDepth } from './depth'
import { connectedClaims, findCruxes } from './crux'
import { sampleMap } from './sample'
import type { Debate } from './types'

const base = sampleMap.debate

function debate(id: string, parentId: string | null, status: Debate['status'] = 'open'): Debate {
  return {
    ...base,
    id,
    parent: parentId ? { debateId: parentId, claimId: 'x' } : null,
    status,
  }
}

function index(...ds: Debate[]) {
  return new Map(ds.map((d) => [d.id, d]))
}

describe('unresolvedDepth', () => {
  it('is 0 with no sub-debates', () => {
    expect(unresolvedDepth('root', index(debate('root', null)))).toBe(0)
  })

  it('counts the deepest chain of open sub-debates', () => {
    const ds = index(
      debate('root', null),
      debate('a', 'root'),
      debate('a1', 'a'),
      debate('a1x', 'a1'),
      debate('b', 'root'),
    )
    expect(unresolvedDepth('root', ds)).toBe(3)
    expect(unresolvedDepth('a', ds)).toBe(2)
  })

  it('ignores resolved sub-debates and everything below them', () => {
    const ds = index(debate('root', null), debate('a', 'root', 'resolved'), debate('a1', 'a'), debate('b', 'root'))
    expect(unresolvedDepth('root', ds)).toBe(1)
  })

  it('does not loop on cyclic data', () => {
    const ds = index(debate('x', 'y'), debate('y', 'x'))
    expect(unresolvedDepth('x', ds)).toBe(2)
  })
})

describe('agreedOutcome', () => {
  it('needs both sides to record the same outcome', () => {
    expect(agreedOutcome({ outcomeVotes: { for: 'accepted' } })).toBeNull()
    expect(agreedOutcome({ outcomeVotes: { for: 'accepted', against: 'rejected' } })).toBeNull()
    expect(agreedOutcome({ outcomeVotes: { for: 'disputed', against: 'disputed' } })).toBe('disputed')
  })
})

describe('cruxes', () => {
  it('finds claims where one side agrees and the other disagrees', () => {
    expect([...findCruxes(sampleMap)].sort()).toEqual(['o1', 'o2', 'p3'])
  })

  it('skips unplaced notes because they are not linked', () => {
    expect(connectedClaims(sampleMap).has('n1')).toBe(false)
    expect(connectedClaims(sampleMap).has('r1')).toBe(true)
  })
})
