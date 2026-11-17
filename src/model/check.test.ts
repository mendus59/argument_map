import { describe, expect, it } from 'vitest'
import { checkMap, hasConfirmedRestatement, issueCount } from './check'
import { sampleMap } from './sample'
import type { DebateMap } from './types'

const at = (ms: number) => ({ toMillis: () => ms })
const DAY = 86_400_000

describe('checkMap', () => {
  it('lists unsourced facts and predictions until material is attached', () => {
    const before = checkMap(sampleMap)
    expect(before.unsourced).toContain('p1')
    expect(before.unsourced).not.toContain('o2') // a value claim
    const map: DebateMap = { ...sampleMap, evidence: [{ id: 'e', claimId: 'p1', url: null, title: 'Budget', kind: 'data', addedBy: 'ana', side: 'for' }] }
    expect(checkMap(map).unsourced).not.toContain('p1')
  })

  it('finds the other side’s boxes a side hasn’t answered on a native debate', () => {
    const forBoxes = sampleMap.claims.filter((c) => c.placed && c.side === 'for').map((c) => c.id)
    const check = checkMap({ ...sampleMap, acceptances: [] })
    const against = check.missingStances.find((m) => m.side === 'against')
    expect(against?.claimIds.length).toBeGreaterThan(0)
    expect(against?.claimIds.every((id) => forBoxes.includes(id))).toBe(true)
    const answered = checkMap({ ...sampleMap, acceptances: (against?.claimIds ?? []).map((id) => ({ claimId: id, side: 'against' as const, version: 1, value: 'accepted' as const, by: 'b' })) })
    expect(answered.missingStances.find((m) => m.side === 'against')).toBeUndefined()
  })

  it('finds boxes a side has no stance on, skipping sides without a leader', () => {
    const bare: DebateMap = { ...sampleMap, stances: [], debate: { ...sampleMap.debate, origin: 'imported' } }
    expect(checkMap(bare).missingStances.map((m) => m.side)).toEqual(['for', 'against'])
    expect(checkMap(bare).missingStances[0].claimIds).toContain('c')
    expect(checkMap(bare).missingStances[0].claimIds).not.toContain('n1') // unplaced
    const native: DebateMap = { ...bare, debate: { ...bare.debate, origin: 'native' } }
    const noLeader: DebateMap = { ...native, stances: native.claims.map((c) => ({ targetId: c.id, side: 'for' as const, value: 'agree' as const, confidence: 50 })), debate: { ...native.debate, sides: { ...native.debate.sides, against: { label: 'Against', leaderUid: null, memberUids: [] } } } }
    expect(checkMap(noLeader).missingStances.map((m) => m.side)).toEqual(['for'])
  })

  it('flags notes left unplaced for more than three days', () => {
    const now = 10 * DAY
    const map: DebateMap = {
      ...sampleMap,
      claims: sampleMap.claims.map((c) => (c.id === 'n1' ? { ...c, createdAt: at(now - 4 * DAY) } : c)),
    }
    expect(checkMap(map, now).oldNotes).toEqual(['n1'])
    expect(checkMap(map, now - 2 * DAY).oldNotes).toEqual([])
  })

  it('tracks restatements waiting for confirmation', () => {
    const map: DebateMap = {
      ...sampleMap,
      comments: [
        { id: 'r', targetId: 'p1', authorUid: 'ben', side: 'against', kind: 'restatement', text: 'You say fares are small.', status: 'pending' },
        { id: 'r2', targetId: 'p2', authorUid: 'ben', side: 'against', kind: 'restatement', text: 'More riders.', status: 'confirmed' },
      ],
    }
    const check = checkMap(map)
    expect(check.pendingRestatements.map((c) => c.id)).toEqual(['r'])
    expect(issueCount(check)).toBeGreaterThan(0)
    expect(hasConfirmedRestatement(map, 'p2', 'against')).toBe(true)
    expect(hasConfirmedRestatement(map, 'p1', 'against')).toBe(false)
  })
})
