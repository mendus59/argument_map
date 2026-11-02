import type { Claim, DebateMap, Link } from '../model/types'

export const CLAIM_W = 210
export const CLAIM_H = 132
const H_GAP = 28
const V_GAP = 64
const GROUP_PAD = 14
const GROUP_LABEL = 22

export interface PlacedClaim {
  claim: Claim
  x: number
  y: number
  /** The link this claim is a premise of, if any. */
  link?: Link
}

export interface PlacedGroup {
  link: Link
  x: number
  y: number
  width: number
  height: number
}

export interface MapLayout {
  claims: PlacedClaim[]
  groups: PlacedGroup[]
}

/**
 * A simple top-down tree layout. The conclusion sits at the top; each link is
 * drawn as a box around its co-premises, centred under the claim it targets.
 * Whatever hangs off a premise is laid out below that premise's group.
 */
export function layoutMap(map: DebateMap): MapLayout {
  const claimsById = new Map(map.claims.map((c) => [c.id, c]))
  const linksTo = new Map<string, Link[]>()
  for (const l of map.links) {
    const list = linksTo.get(l.targetClaimId) ?? []
    list.push(l)
    linksTo.set(l.targetClaimId, list)
  }
  // Reasons first, then objections, so support sits on the left.
  for (const list of linksTo.values()) list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'reason' ? -1 : 1))

  const widthCache = new Map<string, number>()
  const seen = new Set<string>()

  const childrenWidth = (claimId: string): number => {
    const links = linksTo.get(claimId) ?? []
    if (!links.length) return 0
    return links.reduce((sum, l) => sum + linkWidth(l), 0) + H_GAP * (links.length - 1)
  }
  const premiseSlot = (claimId: string): number => Math.max(CLAIM_W, childrenWidth(claimId))
  const linkWidth = (l: Link): number => {
    const key = 'link:' + l.id
    if (widthCache.has(key)) return widthCache.get(key)!
    const slots = l.premiseClaimIds.reduce((s, p) => s + premiseSlot(p), 0)
    const w = slots + H_GAP * (l.premiseClaimIds.length - 1) + GROUP_PAD * 2
    widthCache.set(key, w)
    return w
  }

  const out: MapLayout = { claims: [], groups: [] }

  const placeChildren = (claimId: string, centerX: number, top: number) => {
    const links = linksTo.get(claimId) ?? []
    let x = centerX - childrenWidth(claimId) / 2
    for (const link of links) {
      const w = linkWidth(link)
      const h = CLAIM_H + GROUP_PAD * 2 + GROUP_LABEL
      out.groups.push({ link, x, y: top, width: w, height: h })
      let px = x + GROUP_PAD
      for (const pid of link.premiseClaimIds) {
        const claim = claimsById.get(pid)
        const slot = premiseSlot(pid)
        if (claim && !seen.has(pid)) {
          seen.add(pid)
          const cx = px + slot / 2
          out.claims.push({ claim, x: cx - CLAIM_W / 2, y: top + GROUP_PAD + GROUP_LABEL, link })
          placeChildren(pid, cx, top + h + V_GAP)
        }
        px += slot + H_GAP
      }
      x += w + H_GAP
    }
  }

  const rootId = map.debate.conclusion.claimId
  const root = claimsById.get(rootId)
  if (root) {
    seen.add(rootId)
    const center = Math.max(CLAIM_W, childrenWidth(rootId)) / 2
    out.claims.push({ claim: root, x: center - CLAIM_W / 2, y: 0 })
    placeChildren(rootId, center, CLAIM_H + V_GAP)
  }
  return out
}
