import { describe, expect, it } from 'vitest'
import { buildActivity, changedSince } from './activity'
import { sampleMap } from './sample'
import type { DebateMap } from './types'

const at = (ms: number) => ({ toMillis: () => ms })

const map: DebateMap = {
  ...sampleMap,
  claims: sampleMap.claims.map((c) => (c.id === 'n1' ? { ...c, createdAt: at(50) } : c)),
  links: sampleMap.links.map((l, i) => ({ ...l, createdAt: at(10 + i) })),
  comments: [
    { id: 'r', targetId: 'p1', authorUid: 'ben', side: 'against', kind: 'restatement', text: 'x', status: 'confirmed', respondedBy: 'ana', respondedAt: at(70), createdAt: at(60) },
  ],
  evidence: [{ id: 'e', claimId: 'p1', url: null, title: 'Budget', kind: 'data', addedBy: 'ana', side: 'for', createdAt: at(80) }],
}

describe('buildActivity', () => {
  it('rebuilds the feed from links, notes, comments, sources and stance history, newest first', () => {
    const items = buildActivity(map, [
      { id: 'h', targetId: 'o1', side: 'for', from: null, to: { value: 'agree', confidence: 60 }, conceded: true, by: 'ana', at: at(90) },
    ])
    expect(items.map((i) => i.id).slice(0, 5)).toEqual(['stance-h', 'evidence-e', 'answer-r', 'comment-r', 'note-n1'])
    expect(items[0].action).toBe('conceded a fair point on')
    expect(items[2]).toMatchObject({ side: 'for', who: 'ana', action: 'confirmed Against’s restatement of', claimId: 'p1' })
    expect(items.filter((i) => i.id.startsWith('link-'))).toHaveLength(map.links.length)
  })

  it('skips items still waiting for a server timestamp', () => {
    expect(buildActivity({ ...map, evidence: [{ ...map.evidence[0], createdAt: null }] }).some((i) => i.id === 'evidence-e')).toBe(false)
  })

  it('marks the boxes touched since a time', () => {
    const changed = changedSince(buildActivity(map), 65)
    expect([...changed].sort()).toEqual(['p1'])
  })
})
