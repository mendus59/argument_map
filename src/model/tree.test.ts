import { describe, expect, it } from 'vitest'
import { ancestors, settledClaims, subStatusByClaim, treeBelow } from './tree'
import { unresolvedDepth } from './depth'
import { sampleMap } from './sample'
import type { Debate } from './types'

function d(id: string, parent: string | null, claim = `c-${id}`, extra: Partial<Debate> = {}): Debate {
  const ref = parent ? { debateId: parent, claimId: claim } : { debateId: id, claimId: 'root-claim' }
  return { ...sampleMap.debate, id, title: `T ${id}`, root: parent ? 'root' : null, parent: parent ? ref : null, conclusion: ref, status: 'open', outcome: null, outcomeVotes: {}, ...extra }
}

const tree = new Map(
  [
    d('root', null),
    d('a', 'root', 'p1'),
    d('a1', 'a', 'q1'),
    d('b', 'root', 'p2', { status: 'resolved', outcome: 'accepted', outcomeVotes: { for: 'accepted', against: 'accepted' } }),
  ].map((x) => [x.id, x]),
)

describe('debate trees', () => {
  it('measures depth through open sub-debates only', () => {
    expect(unresolvedDepth('root', tree)).toBe(2)
    expect(unresolvedDepth('a', tree)).toBe(1)
  })

  it('lists settled claims from resolved sub-debates', () => {
    expect(settledClaims(tree)).toEqual([{ debateId: 'root', claimId: 'p2', text: 'T b', outcome: 'accepted' }])
  })

  it('builds breadcrumbs and the status of each forked box', () => {
    expect(ancestors(tree, 'a1').map((x) => x.id)).toEqual(['root', 'a'])
    const status = subStatusByClaim(tree, 'root')
    expect(status.get('p1')).toMatchObject({ id: 'a', status: 'open', depth: 2 })
    expect(status.get('p2')).toMatchObject({ id: 'b', status: 'resolved', outcome: 'accepted', depth: 0 })
  })

  it('nests the tree below a debate', () => {
    const nodes = treeBelow(tree, 'root')
    expect(nodes.map((n) => n.debate.id).sort()).toEqual(['a', 'b'])
    expect(nodes.find((n) => n.debate.id === 'a')?.children.map((n) => n.debate.id)).toEqual(['a1'])
  })
})
