import { describe, expect, it } from 'vitest'
import { claimAgreement, containsPhrase, meaningOf, replacePhrase, termState } from './agreement'
import { sampleMap } from './sample'
import type { Definition, DebateMap, SideId, Term } from './types'

const t = (n: number) => ({ toMillis: () => n })
const term: Term = { id: 't', claimId: 'c', phrase: 'undocumented immigrant criminals', openedBy: 'ben', side: 'against' }
const def = (id: string, over: Partial<Definition>): Definition => ({
  id, termId: 't', claimId: 'c', text: id, kind: 'definition', parentId: null, by: 'x', side: 'for', status: 'pending', respondedBy: null, ...over,
})

describe('terms', () => {
  it('is undefined with no definitions, pending while one waits, agreed once accepted', () => {
    expect(termState(term, []).state).toBe('undefined')
    expect(termState(term, [def('a', { createdAt: t(1) })]).state).toBe('pending')
    const s = termState(term, [def('a', { createdAt: t(1), status: 'accepted' })])
    expect(s.state).toBe('agreed')
    expect(s.meaning).toBe('a')
  })

  it('follows rejections to the counter-definition, and flags a term both sides rejected', () => {
    const defs = [
      def('a', { createdAt: t(1), side: 'for', status: 'rejected', answeredWith: 'b' }),
      def('b', { createdAt: t(2), side: 'against', kind: 'counter', parentId: 'a', status: 'rejected', answeredWith: 'c' }),
      def('c', { createdAt: t(3), side: 'for', kind: 'counter', parentId: 'b' }),
    ]
    const s = termState(term, defs)
    expect(s.current?.id).toBe('c')
    expect(s.state).toBe('pending')
    expect(s.contested).toBe(true)
  })

  it('reads an accepted addendum together with what it adds to', () => {
    const defs = [
      def('a', { text: 'People convicted of a crime.', status: 'rejected', answeredWith: 'b' }),
      def('b', { text: 'other than immigration offences', kind: 'addendum', parentId: 'a', side: 'against', status: 'accepted' }),
    ]
    expect(meaningOf(defs[1], defs)).toBe('People convicted of a crime, other than immigration offences')
  })
})

describe('claim status', () => {
  const claim = sampleMap.claims[1]
  const opponent: SideId = claim.side === 'for' ? 'against' : 'for'
  const base: DebateMap = { ...sampleMap, acceptances: [], terms: [], definitions: [], rewordings: [] }

  it('waits for an answer, then is agreed', () => {
    expect(claimAgreement(base, claim).status).toBe('proposed')
    const accepted = { ...base, acceptances: [{ claimId: claim.id, side: opponent, version: 1, value: 'accepted' as const, by: 'b' }] }
    expect(claimAgreement(accepted, claim).status).toBe('agreed')
    expect(claimAgreement(accepted, { ...claim, version: 2 }).status).toBe('changed')
    const withTerm = { ...accepted, terms: [{ ...term, claimId: claim.id }] }
    expect(claimAgreement(withTerm, claim).status).toBe('unsettled')
  })

  it('is disputed when the other side says so', () => {
    const map = { ...base, acceptances: [{ claimId: claim.id, side: opponent, version: 1, value: 'disputed' as const, by: 'b' }] }
    expect(claimAgreement(map, claim).status).toBe('disputed')
  })
})

describe('phrases', () => {
  it('finds and replaces a phrase regardless of case and spacing', () => {
    expect(containsPhrase('All illegal  immigrant criminals', 'Illegal immigrant')).toBe(true)
    expect(replacePhrase('All illegal immigrant criminals should be deported', 'illegal immigrant', 'undocumented immigrant')).toBe(
      'All undocumented immigrant criminals should be deported',
    )
  })
})
