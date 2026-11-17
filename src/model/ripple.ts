// The ripple: when a claim that others rest on stops being agreed, every
// conclusion it supports (directly or further up the tree) is put in question.
import { claimAgreement } from './agreement'
import type { Claim, DebateMap, Outcome } from './types'

/** Why a claim no longer holds as agreed. */
export type ShakenReason = 'changed' | 'disputed' | 'reopened' | 'subdebate' | 'rejected'

export const SHAKEN_LABEL: Record<ShakenReason, string> = {
  changed: 'its wording changed after it was accepted',
  disputed: 'it’s disputed',
  reopened: 'a term or its wording is being reconsidered',
  subdebate: 'it’s being argued in a sub-debate',
  rejected: 'it was rejected in a sub-debate',
}

export interface InQuestion {
  /** The claims at the root of the trouble, and why each one is shaken. */
  causes: { claimId: string; reason: ShakenReason }[]
  /** Every cause is waiting on a sub-debate, so this is on hold rather than in question. */
  waiting: boolean
}

type SubInfo = { status: 'open' | 'resolved'; outcome: Outcome | null }

/**
 * Whether a claim itself has stopped holding. A claim that was never accepted
 * isn't shaken, only not yet agreed; conclusions above it aren't put in question.
 */
export function shakenReason(map: DebateMap, claim: Claim, sub?: SubInfo): ShakenReason | null {
  if (sub?.status === 'open') return 'subdebate'
  if (sub?.status === 'resolved') {
    if (sub.outcome === 'accepted') return null
    return sub.outcome === 'rejected' ? 'rejected' : 'disputed'
  }
  const a = claimAgreement(map, claim)
  if (a.status === 'changed' || a.status === 'disputed') return a.status
  if (a.status === 'unsettled' && a.acceptance?.value === 'accepted') return 'reopened'
  return null
}

/** Every claim that rests, through reasons, on a shaken claim. */
export function ripple(map: DebateMap, subs?: Map<string, SubInfo>): Map<string, InQuestion> {
  const byId = new Map(map.claims.map((c) => [c.id, c]))
  const shaken = new Map<string, ShakenReason>()
  for (const c of map.claims) {
    const r = shakenReason(map, c, subs?.get(c.id))
    if (r) shaken.set(c.id, r)
  }
  // Supporting premises of each claim: the premises of every reason aimed at it.
  const supporters = new Map<string, string[]>()
  for (const l of map.links) {
    if (l.kind !== 'reason') continue
    supporters.set(l.targetClaimId, [...(supporters.get(l.targetClaimId) ?? []), ...l.premiseClaimIds])
  }
  const memo = new Map<string, Set<string>>()
  const causesOf = (id: string, path: Set<string>): Set<string> => {
    if (memo.has(id)) return memo.get(id)!
    const found = new Set<string>()
    for (const p of supporters.get(id) ?? []) {
      if (path.has(p) || !byId.has(p)) continue
      if (shaken.has(p)) found.add(p)
      path.add(p)
      for (const c of causesOf(p, path)) found.add(c)
      path.delete(p)
    }
    memo.set(id, found)
    return found
  }
  const out = new Map<string, InQuestion>()
  for (const c of map.claims) {
    const found = causesOf(c.id, new Set([c.id]))
    if (!found.size) continue
    const causes = [...found].map((claimId) => ({ claimId, reason: shaken.get(claimId)! }))
    out.set(c.id, { causes, waiting: causes.every((x) => x.reason === 'subdebate') })
  }
  return out
}
