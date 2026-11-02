import type { DebateMap, SideId, Stance } from './types'

export function stanceOf(map: DebateMap, targetId: string, side: SideId): Stance | undefined {
  return map.stances.find((s) => s.targetId === targetId && s.side === side)
}

/**
 * A crux is a claim connected to the conclusion where one side agrees and the
 * other disagrees. Unsure on either side is not a crux.
 */
export function findCruxes(map: DebateMap): Set<string> {
  const connected = connectedClaims(map)
  const cruxes = new Set<string>()
  for (const claimId of connected) {
    if (claimId === map.debate.conclusion.claimId) continue
    const f = stanceOf(map, claimId, 'for')?.value
    const a = stanceOf(map, claimId, 'against')?.value
    if ((f === 'agree' && a === 'disagree') || (f === 'disagree' && a === 'agree')) cruxes.add(claimId)
  }
  return cruxes
}

/** Claims that reach the conclusion through any chain of links. */
export function connectedClaims(map: DebateMap): Set<string> {
  const root = map.debate.conclusion.claimId
  const seen = new Set<string>([root])
  const queue = [root]
  while (queue.length) {
    const target = queue.shift()!
    for (const link of map.links) {
      if (link.targetClaimId !== target) continue
      for (const p of link.premiseClaimIds) {
        if (!seen.has(p)) {
          seen.add(p)
          queue.push(p)
        }
      }
    }
  }
  return seen
}
