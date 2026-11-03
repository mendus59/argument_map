import { unresolvedDepth } from './depth'
import type { Debate, Outcome } from './types'

export interface SettledClaim {
  debateId: string
  claimId: string
  text: string
  outcome: Outcome
}

/** Claims settled by resolved sub-debates in a tree. Accepted ones can be cited as premises. */
export function settledClaims(tree: Map<string, Debate>): SettledClaim[] {
  return [...tree.values()]
    .filter((d) => d.root && d.status === 'resolved' && d.outcome)
    .map((d) => ({ debateId: d.conclusion.debateId, claimId: d.conclusion.claimId, text: d.title, outcome: d.outcome! }))
}

/** The chain from the root down to (not including) this debate, for breadcrumbs. */
export function ancestors(tree: Map<string, Debate>, debateId: string): Debate[] {
  const chain: Debate[] = []
  let d = tree.get(debateId)
  const seen = new Set<string>()
  while (d?.parent && !seen.has(d.id)) {
    seen.add(d.id)
    const up = tree.get(d.parent.debateId)
    if (!up) break
    chain.unshift(up)
    d = up
  }
  return chain
}

/** Sub-debate status by the claim it was forked from, for badges on the parent's map. */
export function subStatusByClaim(tree: Map<string, Debate>, debateId: string) {
  const out = new Map<string, { id: string; status: Debate['status']; outcome: Outcome | null; depth: number }>()
  for (const d of tree.values()) {
    if (d.parent?.debateId === debateId) {
      out.set(d.parent.claimId, { id: d.id, status: d.status, outcome: d.outcome, depth: d.status === 'open' ? 1 + unresolvedDepth(d.id, tree) : 0 })
    }
  }
  return out
}

export interface TreeNode {
  debate: Debate
  depth: number
  children: TreeNode[]
}

/** The tree below a debate, for the tree panel. */
export function treeBelow(tree: Map<string, Debate>, debateId: string): TreeNode[] {
  const seen = new Set<string>([debateId])
  const build = (id: string): TreeNode[] =>
    [...tree.values()]
      .filter((d) => d.parent?.debateId === id && !seen.has(d.id) && seen.add(d.id))
      .map((d) => ({ debate: d, depth: unresolvedDepth(d.id, tree), children: build(d.id) }))
  return build(debateId)
}
