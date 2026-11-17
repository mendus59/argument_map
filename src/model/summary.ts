// Where the two sides stand: how much is agreed, and the few points the rest of
// the argument hangs on (the core disagreements).
import { claimAgreement } from './agreement'
import type { DebateMap } from './types'

export interface CorePoint {
  claimId: string
  /** 'claim': the claim itself is disputed. 'term': the two sides mean different things by a term in it. */
  kind: 'claim' | 'term'
  phrase?: string
  /** How many claims rest on it, directly or further up. */
  restingOn: number
}

export interface Standing {
  total: number
  agreed: number
  disputed: number
  open: number
  agreedTerms: number
  cores: CorePoint[]
}

/** Claims that rest on `id` through reasons, at any depth. */
export function dependents(map: DebateMap, id: string): Set<string> {
  const up = new Map<string, string[]>()
  for (const l of map.links) {
    if (l.kind !== 'reason') continue
    for (const p of l.premiseClaimIds) up.set(p, [...(up.get(p) ?? []), l.targetClaimId])
  }
  const seen = new Set<string>()
  const queue = [...(up.get(id) ?? [])]
  while (queue.length) {
    const c = queue.shift()!
    if (seen.has(c) || c === id) continue
    seen.add(c)
    queue.push(...(up.get(c) ?? []))
  }
  return seen
}

export function standing(map: DebateMap): Standing {
  const placed = map.claims.filter((c) => c.placed)
  const conclusion = map.debate.conclusion.claimId
  let agreed = 0
  let disputed = 0
  let agreedTerms = 0
  const cores: CorePoint[] = []
  for (const c of placed) {
    const a = claimAgreement(map, c)
    if (a.status === 'agreed') agreed++
    if (a.status === 'disputed') disputed++
    agreedTerms += a.terms.filter((t) => t.state === 'agreed').length
    if (c.id === conclusion) continue
    const restingOn = dependents(map, c.id).size
    if (a.status === 'disputed') cores.push({ claimId: c.id, kind: 'claim', restingOn })
    for (const t of a.terms) if (t.contested && t.state !== 'agreed') cores.push({ claimId: c.id, kind: 'term', phrase: t.term.phrase, restingOn })
  }
  cores.sort((x, y) => y.restingOn - x.restingOn)
  return { total: placed.length, agreed, disputed, open: placed.length - agreed - disputed, agreedTerms, cores }
}
