// The two people a debate is between: its two leaders. What they agree is shared
// across all their debates, keyed by the pair.
import type { Debate } from './types'

/** The pair's key: both leaders' uids, sorted and joined. Null until both sides have a leader. */
export function pairKey(debate: Pick<Debate, 'sides'>): string | null {
  const a = debate.sides.for.leaderUid
  const b = debate.sides.against.leaderUid
  if (!a || !b) return null
  return [a, b].sort().join('_')
}

export function inPair(debate: Pick<Debate, 'sides'>, uid: string) {
  const key = pairKey(debate)
  return !!key && key.split('_').includes(uid)
}
