import { describe, expect, it } from 'vitest'
import { buildUserPrompt, cleanResult, costUsd, estimate, formatUsd, monthKey } from './analysis'
import type { DebateMap } from '../model/types'

const map = {
  debate: {
    id: 'd1',
    title: 'Fare-free buses',
    conclusion: { debateId: 'd1', claimId: 'c0' },
    sides: { for: { label: 'Mayor' }, against: { label: 'Councillor' } },
    source: { speakers: [{ label: 'MAYOR', side: 'for' }, { label: 'HOST', side: null }] },
  },
  claims: [
    { id: 'c0', text: 'Buses should be free.', side: 'for', placed: true },
    { id: 'c1', text: 'Fares cost more to collect than they raise.', side: 'for', placed: true },
    { id: 'n1', text: 'Unplaced note', side: 'for', placed: false },
  ],
  links: [{ id: 'l1', kind: 'reason', targetClaimId: 'c0', premiseClaimIds: ['c1'], side: 'for' }],
  stances: [],
  evidence: [],
  comments: [],
} as unknown as DebateMap

const segments = [
  { start: 0, speaker: 'HOST', text: 'Welcome.' },
  { start: 5, speaker: 'MAYOR', text: 'Fares barely cover collection.' },
]

describe('buildUserPrompt', () => {
  it('lists placed boxes, links, speakers and numbered transcript lines', () => {
    const p = buildUserPrompt(map, segments)
    expect(p).toContain('box c1 [for]: Fares cost more')
    expect(p).not.toContain('Unplaced note')
    expect(p).toContain('link l1 [for] reason for box c0: premises c1')
    expect(p).toContain('HOST = moderator')
    expect(p).toContain('1 MAYOR: Fares barely cover collection.')
  })
})

describe('cleanResult', () => {
  const base = { kind: 'missed_argument', side: 'against', targetClaimId: 'c0', linkId: '', text: 'Crowding.', explanation: 'x', segment: 1, relation: 'objection' }
  it('keeps valid suggestions and turns sentinels into nulls', () => {
    const r = cleanResult({ summary: { overall: 'o', for: 'f', against: 'a' }, suggestions: [base, { ...base, kind: 'fallacy', segment: -1 }] }, map, 2)
    expect(r.suggestions).toHaveLength(2)
    expect(r.suggestions[0]).toMatchObject({ linkId: null, segment: 1, relation: 'objection' })
    expect(r.suggestions[1]).toMatchObject({ segment: null, relation: 'reason' })
  })
  it('drops suggestions that point at unknown boxes, wrong links or bad kinds', () => {
    const r = cleanResult(
      {
        summary: {},
        suggestions: [
          { ...base, targetClaimId: 'nope' },
          { ...base, kind: 'hidden_premise', linkId: 'missing' },
          { ...base, kind: 'hidden_premise', linkId: 'l1', targetClaimId: 'c1' },
          { ...base, kind: 'other' },
          { ...base, text: '  ' },
        ],
      },
      map,
      2,
    )
    expect(r.suggestions).toEqual([])
    expect(r.summary).toEqual({ overall: '', for: '', against: '' })
  })
  it('keeps a hidden premise that completes a real link to its target', () => {
    const r = cleanResult({ summary: {}, suggestions: [{ ...base, kind: 'hidden_premise', linkId: 'l1', side: 'for', segment: 99 }] }, map, 2)
    expect(r.suggestions[0]).toMatchObject({ linkId: 'l1', segment: null })
  })
})

describe('costs', () => {
  it('prices runs per model and gives likely and worst-case estimates', () => {
    expect(costUsd('claude-opus-5-5', 1_000_000, 0)).toBe(4)
    expect(costUsd('claude-fable-5-1', 0, 1_000_000)).toBe(50)
    const e = estimate(50_000)
    expect(e.likelyUsd).toBeCloseTo(0.2 + 0.16)
    expect(e.maxUsd).toBeCloseTo(0.2 + 0.64)
    expect(formatUsd(0.004)).toBe('< $0.01')
    expect(monthKey(new Date(2026, 0, 5))).toBe('2026-01')
  })
})
