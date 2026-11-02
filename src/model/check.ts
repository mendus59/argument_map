import { connectedClaims, findCruxes, stanceOf } from './crux'
import { SIDES, type Comment, type DebateMap, type SideId } from './types'

export const OLD_NOTE_DAYS = 3

export interface MapCheck {
  /** Boxes on the map where one side agrees and the other disagrees. */
  cruxes: string[]
  /** Boxes on the path to the conclusion that a side hasn't taken a stance on yet. */
  missingStances: { side: SideId; claimIds: string[] }[]
  /** Facts and predictions with no supporting material. */
  unsourced: string[]
  /** Notes left off the map for a while. */
  oldNotes: string[]
  /** Restatements waiting for the restated side to confirm. */
  pendingRestatements: Comment[]
}

/** Rule-based review of a map, run in the browser. Nothing here is enforced. */
export function checkMap(map: DebateMap, now = Date.now()): MapCheck {
  const connected = connectedClaims(map)
  const onMap = map.claims.filter((c) => c.placed && connected.has(c.id))
  const sourced = new Set(map.evidence.map((e) => e.claimId))
  // A side without a leader yet can't take stances, except on imports, where the admin sets both.
  const sides = SIDES.filter((s) => map.debate.origin === 'imported' || map.debate.sides[s].leaderUid)
  return {
    cruxes: [...findCruxes(map)],
    missingStances: sides
      .map((side) => ({ side, claimIds: onMap.filter((c) => !stanceOf(map, c.id, side)).map((c) => c.id) }))
      .filter((m) => m.claimIds.length > 0),
    unsourced: onMap.filter((c) => (c.type === 'fact' || c.type === 'prediction') && !sourced.has(c.id)).map((c) => c.id),
    oldNotes: map.claims
      .filter((c) => !c.placed && c.createdAt && now - c.createdAt.toMillis() > OLD_NOTE_DAYS * 86_400_000)
      .map((c) => c.id),
    pendingRestatements: map.comments.filter((c) => c.kind === 'restatement' && c.status === 'pending'),
  }
}

export function issueCount(check: MapCheck) {
  return (
    check.missingStances.reduce((n, m) => n + m.claimIds.length, 0) +
    check.unsourced.length +
    check.oldNotes.length +
    check.pendingRestatements.length
  )
}

/** Whether `side` has a confirmed restatement of `claimId` on record. */
export function hasConfirmedRestatement(map: DebateMap, claimId: string, side: SideId) {
  return map.comments.some((c) => c.kind === 'restatement' && c.targetId === claimId && c.side === side && c.status === 'confirmed')
}
