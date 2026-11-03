import type { DebateMap, SideId, StanceChange } from './types'

export interface ActivityItem {
  id: string
  /** Milliseconds since the epoch. */
  at: number
  side: SideId
  who: string | null
  /** What happened, without the actor's name: "added a reason to". */
  action: string
  /** The claim the item is about, so the feed can select it. */
  claimId: string | null
  /** Shown after the claim, such as a confidence. */
  detail?: string
  /** Boxes this created or changed, for highlighting on the map. */
  touched: string[]
}

const ms = (t: { toMillis(): number } | null | undefined) => t?.toMillis() ?? null

/**
 * Everything that has happened in a debate, newest first, rebuilt from the
 * debate's own data so no separate activity log has to be written.
 */
export function buildActivity(map: DebateMap, history: StanceChange[] = []): ActivityItem[] {
  const items: ActivityItem[] = []
  const placedBy = new Map<string, string>()
  const targetOfLink = new Map(map.links.map((l) => [l.id, l.targetClaimId]))
  const sideLabel = (s: SideId) => map.debate.sides[s].label

  for (const l of map.links) {
    for (const p of l.premiseClaimIds) placedBy.set(p, l.id)
    const at = ms(l.createdAt)
    if (at === null) continue
    const n = l.premiseClaimIds.length
    const what = l.kind === 'reason' ? 'a reason' : 'an objection'
    items.push({ id: `link-${l.id}`, at, side: l.side, who: l.authorUid, action: n > 1 ? `added ${what} with ${n} premises to` : `added ${what} to`, claimId: l.targetClaimId, touched: l.premiseClaimIds })
  }
  for (const c of map.claims) {
    const at = ms(c.createdAt)
    if (at === null || placedBy.has(c.id) || c.id === map.debate.conclusion.claimId) continue
    items.push({ id: `note-${c.id}`, at, side: c.side, who: c.authorUid, action: 'saved a note:', claimId: c.id, touched: [] })
  }
  for (const c of map.comments) {
    const claimId = map.claims.some((x) => x.id === c.targetId) ? c.targetId : (targetOfLink.get(c.targetId) ?? null)
    const at = ms(c.createdAt)
    if (at !== null) {
      items.push({ id: `comment-${c.id}`, at, side: c.side, who: c.authorUid, action: c.kind === 'restatement' ? 'restated' : 'commented on', claimId, touched: claimId ? [claimId] : [] })
    }
    const answered = ms(c.respondedAt)
    if (c.kind === 'restatement' && answered !== null && c.status !== 'pending') {
      const other: SideId = c.side === 'for' ? 'against' : 'for'
      items.push({
        id: `answer-${c.id}`,
        at: answered,
        side: other,
        who: c.respondedBy ?? null,
        action: c.status === 'confirmed' ? `confirmed ${sideLabel(c.side)}’s restatement of` : `corrected ${sideLabel(c.side)}’s restatement of`,
        claimId,
        touched: claimId ? [claimId] : [],
      })
    }
  }
  for (const e of map.evidence) {
    const at = ms(e.createdAt)
    if (at !== null) items.push({ id: `evidence-${e.id}`, at, side: e.side, who: e.addedBy, action: 'added a source to', claimId: e.claimId, touched: [e.claimId] })
  }
  for (const h of history) {
    const at = ms(h.at)
    if (at === null) continue
    const claimId = map.claims.some((x) => x.id === h.targetId) ? h.targetId : (targetOfLink.get(h.targetId) ?? null)
    const onLink = !map.claims.some((x) => x.id === h.targetId)
    const verb = h.conceded
      ? 'conceded a fair point on'
      : onLink
        ? 'answered the inference check under'
        : h.to.value === 'unsure'
          ? 'is now unsure about'
          : `now ${h.to.value}s with`
    items.push({
      id: `stance-${h.id}`,
      at,
      side: h.side,
      who: h.by,
      action: verb,
      claimId,
      detail: onLink ? `${h.to.value}, ${h.to.confidence}%` : `${h.to.confidence}%`,
      touched: claimId ? [claimId] : [],
    })
  }
  return items.sort((a, b) => b.at - a.at)
}

/** Claims touched since `since` (milliseconds), for highlighting what's new on the map. */
export function changedSince(items: ActivityItem[], since: number): Set<string> {
  return new Set(items.filter((i) => i.at > since).flatMap((i) => i.touched))
}
