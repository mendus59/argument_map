// The debate as a conversation between two people: claims in the order they were
// made, each one opening up in place to answer it. The argument tree sits beside it.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { ArgumentMap, type Selection } from '../map/ArgumentMap'
import type { SubStatus } from '../map/nodes'
import { claimAgreement } from '../model/agreement'
import { ripple } from '../model/ripple'
import { standing } from '../model/summary'
import type { Claim, DebateMap, SideId } from '../model/types'
import { StatusPill } from './AgreementPanel'
import { ClaimPanel, LinkPanel, type TreeProps } from './EditPanel'
import type { CommonGround } from '../data/ground'

type Tab = 'tree' | 'ground' | 'more'

const firstName = (map: DebateMap, uid: string) => map.debate.people[uid]?.name.split(' ')[0] ?? 'Someone'
const short = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n)}…` : t)

export function ConversationView({
  map,
  user,
  role,
  selection,
  onSelect,
  tree,
  common,
  highlight,
  writers,
  subs,
  depth,
  crumbs,
  badges,
  groundPanel,
  morePanel,
}: {
  map: DebateMap
  user: User | null
  role: { side: SideId | null; leader: boolean } | null
  selection: Selection
  onSelect: (s: Selection) => void
  tree?: TreeProps
  common?: CommonGround | null
  highlight?: Set<string>
  writers?: Map<string, string[]>
  subs?: Map<string, SubStatus>
  depth?: number
  crumbs?: ReactNode
  badges?: ReactNode
  /** Common ground, for the pane beside the conversation. */
  groundPanel?: ReactNode
  /** Team, activity, sub-debates and the map check. */
  morePanel?: ReactNode
}) {
  const { debate } = map
  const [tab, setTab] = useState<Tab>('tree')
  const conclusionId = debate.conclusion.claimId
  // The conversation: the conclusion first, then every placed claim in the order it was made.
  const cards = useMemo(() => {
    const placed = map.claims.filter((c) => c.placed)
    const t = (c: Claim) => c.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
    return [...placed.filter((c) => c.id === conclusionId), ...placed.filter((c) => c.id !== conclusionId).sort((a, b) => t(a) - t(b))]
  }, [map.claims, conclusionId])
  const shaken = useMemo(() => ripple(map, subs), [map, subs])
  const parentOf = useMemo(() => {
    const m = new Map<string, { kind: 'reason' | 'objection'; target: string; coPremises: number }>()
    for (const l of map.links) for (const p of l.premiseClaimIds) m.set(p, { kind: l.kind, target: l.targetClaimId, coPremises: l.premiseClaimIds.length })
    return m
  }, [map.links])
  const selectedClaim = selection?.kind === 'claim' ? selection.id : null
  const selectedLink = selection?.kind === 'link' ? map.links.find((l) => l.id === selection.id) : undefined

  // Bring the chosen claim into view when it's picked on the tree.
  useEffect(() => {
    if (!selectedClaim) return
    const el = document.getElementById(`card-${selectedClaim}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedClaim])

  const sideNames = (s: SideId) => {
    const side = debate.sides[s]
    return side.memberUids.length ? side.memberUids.map((u) => firstName(map, u)).join(', ') : 'waiting for someone to join'
  }

  return (
    <div className="debate">
      <header className="debate-head">
        <div className="title">
          {crumbs ?? <span className="eyebrow">Debate</span>}
          <h1>{debate.title}</h1>
        </div>
        <div className="sides">
          <span className="side for">
            {debate.sides.for.label} · {sideNames('for')}
          </span>
          <span className="side against">
            {debate.sides.against.label} · {sideNames('against')}
          </span>
          {badges}
          <span className="depth" title="How deep the chain of open sub-debates goes">
            Unresolved depth {depth ?? debate.unresolvedDepth}
          </span>
        </div>
      </header>
      <main className="workspace conversation-layout">
        <section className="conversation" aria-label="Conversation">
          <HowItWorks />
          <StandingPanel map={map} onOpen={(id) => onSelect({ kind: 'claim', id })} />
          {cards.map((c) => {
            const a = claimAgreement(map, c)
            const iq = shaken.get(c.id)
            const parent = parentOf.get(c.id)
            const target = parent ? map.claims.find((x) => x.id === parent.target) : undefined
            const open = selectedClaim === c.id
            const typing = writers?.get(c.id) ?? []
            return (
              <article
                key={c.id}
                id={`card-${c.id}`}
                className={`card side-${c.side}${open ? ' open' : ''}${highlight?.has(c.id) ? ' new' : ''}${c.id === conclusionId ? ' conclusion' : ''}`}
              >
                <button className="card-head" type="button" aria-expanded={open} onClick={() => onSelect(open ? null : { kind: 'claim', id: c.id })}>
                  <span className="card-meta">
                    <span className={`side-tag ${c.side}`}>
                      <span className="side-dot" aria-hidden="true" />
                      <span className="side-name">{firstName(map, c.authorUid)}</span>
                    </span>
                    <span className="small muted">
                      {c.id === conclusionId
                        ? 'The claim being debated'
                        : parent && target
                          ? `${parent.kind === 'reason' ? 'Reason for' : 'Objection to'} “${short(target.text, 50)}”${parent.coPremises > 1 ? ' (with others)' : ''}`
                          : ''}
                    </span>
                    {highlight?.has(c.id) && <span className="badge new-badge">New</span>}
                  </span>
                  <span className={`card-text${c.id === conclusionId ? ' display' : ''}`}>{c.text}</span>
                  <span className="chips">
                    <StatusPill status={a.status} />
                    {iq && <span className={`status-pill ${iq.waiting ? 'status-unsettled' : 'status-disputed'}`}>{iq.waiting ? '⏸ On hold' : '⚠ In question'}</span>}
                    {a.openTerms.length > 0 && <span className="count">{a.openTerms.length} term{a.openTerms.length > 1 ? 's' : ''} to define</span>}
                    {a.openRewordings.length > 0 && <span className="count">wording challenged</span>}
                    {c.subDebateId && c.id !== conclusionId && <SubChip sub={subs?.get(c.id)} />}
                    {typing.length > 0 && <span className="writing">✎ {typing.join(', ')} writing…</span>}
                  </span>
                </button>
                {open && user && role && (
                  <div className="card-body">
                    <ClaimPanel key={`${c.id}-${role.side}`} map={map} claim={c} user={user} role={role} onSelect={onSelect} tree={tree} common={common} inCard />
                  </div>
                )}
                {open && (!user || !role) && <p className="small muted card-body">Sign in as one of the debaters to answer this.</p>}
              </article>
            )
          })}
          <p className="small muted conversation-end">
            To add to the conversation, open any claim and give a reason for it or an objection to it.
          </p>
        </section>
        <aside className="pane">
          <div className="pane-tabs" role="tablist">
            <button role="tab" type="button" aria-selected={tab === 'tree'} className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>
              Argument tree
            </button>
            {groundPanel && (
              <button role="tab" type="button" aria-selected={tab === 'ground'} className={tab === 'ground' ? 'on' : ''} onClick={() => setTab('ground')}>
                Common ground
              </button>
            )}
            <button role="tab" type="button" aria-selected={tab === 'more'} className={tab === 'more' ? 'on' : ''} onClick={() => setTab('more')}>
              Team & activity
            </button>
          </div>
          {tab === 'tree' && (
            <div className="pane-tree">
              <ArgumentMap map={map} selection={selection} onSelect={onSelect} highlight={highlight} writers={writers} subs={subs} />
              {selectedLink && user && role && (
                <div className="pane-link">
                  <LinkPanel key={selectedLink.id} map={map} link={selectedLink} role={role} user={user} />
                </div>
              )}
            </div>
          )}
          {tab === 'ground' && <div className="pane-body">{groundPanel}</div>}
          {tab === 'more' && <div className="pane-body stack">{morePanel}</div>}
        </aside>
      </main>
    </div>
  )
}

function HowItWorks() {
  return (
    <details className="how-it-works">
      <summary>How this works</summary>
      <ol className="small">
        <li>Open a claim and give a reason for it or an objection to it.</li>
        <li>The other person answers each claim: accept it, ask what a term means, challenge the wording, or dispute it.</li>
        <li>Definitions go back and forth until you agree, or until you find the real disagreement.</li>
        <li>Agreed claims and terms become common ground you can reuse in any debate together.</li>
        <li>If something agreed changes, everything that rests on it is flagged as in question until it’s settled again.</li>
      </ol>
    </details>
  )
}

function SubChip({ sub }: { sub?: SubStatus }) {
  if (!sub || sub.status === 'open') return <span className="badge fork">⑂ Being argued in a sub-debate</span>
  const label = sub.outcome === 'accepted' ? '✓ Accepted in its sub-debate' : sub.outcome === 'rejected' ? '✗ Rejected in its sub-debate' : '⇄ Agreed to disagree'
  return <span className={`badge outcome-${sub.outcome}`}>{label}</span>
}

/** How much is agreed so far, and the few disputed points the rest of the argument hangs on. */
function StandingPanel({ map, onOpen }: { map: DebateMap; onOpen: (claimId: string) => void }) {
  const s = useMemo(() => standing(map), [map])
  if (s.total <= 1) return null
  const pct = Math.round((s.agreed / s.total) * 100)
  const text = (id: string) => map.claims.find((c) => c.id === id)?.text ?? ''
  return (
    <section className="standing" aria-label="Where you stand">
      <div className="row-sm">
        <strong className="small">Where you stand</strong>
        <span className="small muted">
          {s.agreed} of {s.total} claims agreed · {s.disputed} disputed{s.agreedTerms ? ` · ${s.agreedTerms} term${s.agreedTerms > 1 ? 's' : ''} agreed` : ''}
        </span>
      </div>
      <div className="meter" role="img" aria-label={`${pct}% of claims agreed`}>
        <span className="meter-agreed" style={{ width: `${pct}%` }} />
        <span className="meter-disputed" style={{ width: `${Math.round((s.disputed / s.total) * 100)}%` }} />
      </div>
      {s.cores.length > 0 ? (
        <div className="stack-xs">
          <span className="small">
            <strong>Your core disagreement{s.cores.length > 1 ? 's' : ''}</strong> <span className="muted">— the points the rest of the argument hangs on</span>
          </span>
          <ul className="history-list">
            {s.cores.slice(0, 3).map((c) => (
              <li key={`${c.claimId}-${c.phrase ?? ''}`} className="small">
                <button className="linklike" type="button" onClick={() => onOpen(c.claimId)}>
                  {c.kind === 'term' ? `What “${c.phrase}” means` : `“${short(text(c.claimId), 80)}”`}
                </button>{' '}
                <span className="muted">
                  {c.kind === 'term' ? `in “${short(text(c.claimId), 40)}”` : 'is disputed'}
                  {c.restingOn > 0 ? `; ${c.restingOn} claim${c.restingOn > 1 ? 's' : ''} rest${c.restingOn > 1 ? '' : 's'} on it` : ''}
                </span>
              </li>
            ))}
          </ul>
          <span className="small muted">Settle one, or spin it off into its own debate so the rest can move on.</span>
        </div>
      ) : (
        <span className="small muted">No core disagreement pinned down yet. When you find the premise you really disagree on, dispute it, and it shows up here.</span>
      )}
    </section>
  )
}
