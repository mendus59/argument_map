import type { Debate } from './types'

/**
 * How deep a debate's chain of open sub-debates goes.
 *
 * 0 when the debate has no open sub-debates; otherwise 1 + the deepest open
 * sub-debate. Resolved sub-debates and settled references add nothing.
 * There is no depth limit, but cycles are guarded against in case of bad data.
 */
export function unresolvedDepth(debateId: string, debates: Map<string, Debate>): number {
  const childrenOf = new Map<string, Debate[]>()
  for (const d of debates.values()) {
    if (!d.parent) continue
    const list = childrenOf.get(d.parent.debateId) ?? []
    list.push(d)
    childrenOf.set(d.parent.debateId, list)
  }

  const visit = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    const next = new Set(seen).add(id)
    let deepest = 0
    for (const child of childrenOf.get(id) ?? []) {
      if (child.status !== 'open') continue
      deepest = Math.max(deepest, 1 + visit(child.id, next))
    }
    return deepest
  }

  return visit(debateId, new Set())
}

/** A sub-debate resolves only when both leaders record the same outcome. */
export function agreedOutcome(debate: Pick<Debate, 'outcomeVotes'>) {
  const { for: f, against: a } = debate.outcomeVotes
  return f && f === a ? f : null
}
