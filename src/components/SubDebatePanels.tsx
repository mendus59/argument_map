import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { forkClaim, voteOutcome } from '../data/subdebates'
import type { TreeNode } from '../model/tree'
import type { Claim, Debate, DebateMap, Outcome, SideId } from '../model/types'
import type { SubStatus } from '../map/nodes'

const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: 'accepted', label: 'Accept it', hint: 'Both sides now accept this claim.' },
  { value: 'rejected', label: 'Reject it', hint: 'Both sides now reject this claim.' },
  { value: 'disputed', label: 'Agree to disagree', hint: 'It stays marked as a crux in the parent.' },
]

const outcomeLabel = (o: Outcome | null | undefined) =>
  o === 'accepted' ? 'accepted' : o === 'rejected' ? 'rejected' : o === 'disputed' ? 'agreed to disagree' : 'no outcome yet'

/** On a selected box: open its sub-debate, or fork one. */
export function ForkSection({ map, claim, user, side, sub }: { map: DebateMap; claim: Claim; user: User; side: SideId | null; sub?: SubStatus }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  if (claim.id === map.debate.conclusion.claimId || map.debate.origin !== 'native') return null
  if (claim.subDebateId) {
    return (
      <div className="box stack-xs">
        <span className="eyebrow">Sub-debate</span>
        <p className="small">
          {sub?.status === 'resolved' ? `Settled: ${outcomeLabel(sub.outcome)}.` : `This box is being argued in its own debate${sub ? ` (unresolved depth ${sub.depth})` : ''}.`}
        </p>
        <Link className="btn small-btn" to={`/d/${claim.subDebateId}`}>
          Open the sub-debate
        </Link>
      </div>
    )
  }
  if (!side) return null
  async function fork() {
    if (!side) return
    setBusy(true)
    setError(false)
    try {
      const id = await forkClaim(db, user, map, claim, side)
      navigate(`/d/${id}`)
    } catch (e) {
      console.error(e)
      setError(true)
      setBusy(false)
    }
  }
  return (
    <div className="stack-xs">
      <button className="btn small-btn" type="button" onClick={fork} disabled={busy} title="Argue this box out in its own debate. Its stances stay shared.">
        ⑂ {busy ? 'Forking…' : 'Fork into a sub-debate'}
      </button>
      {error && <small className="error">The sub-debate couldn’t be created. Try again.</small>}
    </div>
  )
}

/** In a sub-debate: where each side stands on the outcome, and the leaders' controls. */
export function OutcomePanel({ debate, user }: { debate: Debate; user?: User | null }) {
  const [error, setError] = useState(false)
  const mySide = (['for', 'against'] as SideId[]).find((s) => debate.sides[s].leaderUid === user?.uid) ?? null
  const resolved = debate.status === 'resolved'
  return (
    <section className={`box stack-xs outcome ${resolved ? `done ${debate.outcome}` : ''}`}>
      <span className="eyebrow">Outcome</span>
      {resolved ? (
        <p className="small">
          <strong>Settled: {outcomeLabel(debate.outcome)}.</strong> The box in the parent debate now shows this
          {debate.outcome === 'accepted' ? ', and it can be cited as a settled premise anywhere in this debate.' : '.'}
        </p>
      ) : (
        <p className="small muted">The sub-debate resolves when both leaders pick the same outcome.</p>
      )}
      <ul className="vote-list small">
        {(['for', 'against'] as SideId[]).map((s) => (
          <li key={s}>
            {debate.sides[s].label}: <strong>{outcomeLabel(debate.outcomeVotes[s])}</strong>
          </li>
        ))}
      </ul>
      {mySide && !resolved && (
        <div className="stack-xs">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`btn small-btn${debate.outcomeVotes[mySide] === o.value ? ' pri' : ''}`}
              title={o.hint}
              onClick={() => voteOutcome(db, debate, mySide, o.value).then(() => setError(false), () => setError(true))}
            >
              {o.label}
            </button>
          ))}
          {error && <small className="error">Couldn’t record the outcome. Try again.</small>}
        </div>
      )}
    </section>
  )
}

/** Breadcrumbs from the top-level debate down to this one. */
export function Crumbs({ chain }: { chain: Debate[] }) {
  if (!chain.length) return null
  return (
    <nav className="crumbs eyebrow" aria-label="Parent debates">
      {chain.map((d) => (
        <span key={d.id}>
          <Link to={`/d/${d.id}`}>{d.title.length > 48 ? `${d.title.slice(0, 48)}…` : d.title}</Link> ›{' '}
        </span>
      ))}
      <span>Sub-debate</span>
    </nav>
  )
}

/** Every sub-debate below this one, with status and depth. */
export function TreePanel({ nodes, current }: { nodes: TreeNode[]; current: string }) {
  if (!nodes.length) return null
  const render = (list: TreeNode[]) => (
    <ul className="tree">
      {list.map((n) => (
        <li key={n.debate.id}>
          <Link to={`/d/${n.debate.id}`} className={n.debate.id === current ? 'here' : ''}>
            {n.debate.title.length > 80 ? `${n.debate.title.slice(0, 80)}…` : n.debate.title}
          </Link>
          <span className="small muted">
            {' '}
            · {n.debate.status === 'resolved' ? outcomeLabel(n.debate.outcome) : `open${n.depth ? `, depth ${n.depth + 1}` : ''}`}
          </span>
          {n.children.length > 0 && render(n.children)}
        </li>
      ))}
    </ul>
  )
  return (
    <section className="stack-xs">
      <span className="eyebrow">Sub-debates</span>
      {render(nodes)}
    </section>
  )
}
