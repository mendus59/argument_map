import { describe, expect, it } from 'vitest'
import { ripple } from './ripple'
import { sampleMap } from './sample'
import type { Acceptance, Claim, DebateMap, Link } from './types'

const claim = (id: string, side: Claim['side'], version = 1): Claim => ({ id, text: id, type: 'value', authorUid: side, side, placed: true, version })
const reason = (id: string, target: string, premises: string[]): Link => ({ id, kind: 'reason', targetClaimId: target, premiseClaimIds: premises, authorUid: 'for', side: 'for' })
const accept = (claimId: string, version = 1, value: Acceptance['value'] = 'accepted'): Acceptance => ({ claimId, side: 'against', version, value, by: 'b' })

// c <- p1 (reason) ; p1 <- q (reason). q is accepted at version 1.
function map(over: Partial<DebateMap> = {}): DebateMap {
  return {
    ...sampleMap,
    claims: [claim('c', 'for'), claim('p1', 'for'), claim('q', 'for')],
    links: [reason('l1', 'c', ['p1']), reason('l2', 'p1', ['q'])],
    acceptances: [accept('p1'), accept('q')],
    terms: [],
    definitions: [],
    rewordings: [],
    ...over,
  }
}

describe('ripple', () => {
  it('leaves everything alone while the premises hold', () => {
    expect(ripple(map()).size).toBe(0)
  })

  it('puts every conclusion above an edited premise in question', () => {
    const m = map({ claims: [claim('c', 'for'), claim('p1', 'for'), claim('q', 'for', 2)] })
    const r = ripple(m)
    expect(r.get('p1')?.causes).toEqual([{ claimId: 'q', reason: 'changed' }])
    expect(r.get('c')?.causes).toEqual([{ claimId: 'q', reason: 'changed' }])
    expect(r.has('q')).toBe(false)
  })

  it('reopens when a new definition waits on an accepted premise', () => {
    const m = map({
      terms: [{ id: 't', claimId: 'q', phrase: 'q', openedBy: 'a', side: 'for' }],
      definitions: [{ id: 'd', termId: 't', claimId: 'q', text: 'x', kind: 'definition', parentId: null, by: 'a', side: 'for', status: 'pending', respondedBy: null }],
    })
    expect(ripple(m).get('c')?.causes[0].reason).toBe('reopened')
  })

  it('does not count a premise that was never accepted, and ignores objections', () => {
    const m = map({
      acceptances: [accept('p1')],
      links: [reason('l1', 'c', ['p1']), reason('l2', 'p1', ['q']), { ...reason('l3', 'c', ['x']), kind: 'objection' }],
      claims: [claim('c', 'for'), claim('p1', 'for'), claim('q', 'for'), claim('x', 'against')],
    })
    expect(ripple(m).size).toBe(0)
  })

  it('holds conclusions as waiting while a premise is argued in a sub-debate, and clears once it is accepted there', () => {
    const open = ripple(map(), new Map([['q', { status: 'open' as const, outcome: null }]]))
    expect(open.get('c')?.waiting).toBe(true)
    const done = ripple(map(), new Map([['q', { status: 'resolved' as const, outcome: 'accepted' as const }]]))
    expect(done.size).toBe(0)
  })

  it('survives a cycle', () => {
    const m = map({ links: [reason('l1', 'c', ['p1']), reason('l2', 'p1', ['c'])], acceptances: [accept('p1', 1, 'disputed')] })
    expect(ripple(m).get('c')?.causes).toEqual([{ claimId: 'p1', reason: 'disputed' }])
  })
})
