import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { addComment, addEvidence, removeEvidence, respondToRestatement, setRestateFirst, watchStanceHistory } from '../data/honest'
import { checkMap, issueCount } from '../model/check'
import type { Claim, Comment, Debate, DebateMap, EvidenceKind, SideId, StanceChange } from '../model/types'
import type { Selection } from '../map/ArgumentMap'

const KINDS: { value: EvidenceKind; label: string; hint: string }[] = [
  { value: 'study', label: 'Study', hint: 'Peer-reviewed or formal research' },
  { value: 'data', label: 'Data', hint: 'Official figures or a dataset' },
  { value: 'news', label: 'News', hint: 'Reporting' },
  { value: 'anecdote', label: 'Anecdote', hint: 'A first-hand account or example' },
  { value: 'opinion', label: 'Opinion', hint: 'Commentary or expert view' },
]

const nameOf = (map: DebateMap, uid: string) => map.debate.people[uid]?.name ?? 'Someone'

function safeUrl(url: string | null) {
  return url && /^https?:\/\//i.test(url) ? url : null
}

/** Supporting material on a box. Any debater adds to it; facts and predictions ask for it. */
export function EvidenceSection({ map, claim, user, side }: { map: DebateMap; claim: Claim; user?: User; side?: SideId | null }) {
  const items = map.evidence.filter((e) => e.claimId === claim.id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<EvidenceKind>(claim.type === 'fact' ? 'data' : 'study')
  const [error, setError] = useState<string | null>(null)
  const wantsSource = (claim.type === 'fact' || claim.type === 'prediction') && items.length === 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user || !side) return
    if (url.trim() && !/^https?:\/\/\S+$/i.test(url.trim())) {
      setError('Links must start with http:// or https://.')
      return
    }
    try {
      await addEvidence(db, user, map.debate.id, side, claim.id, { title, url, kind })
      setTitle('')
      setUrl('')
      setOpen(false)
      setError(null)
    } catch (err) {
      console.error(err)
      setError('The source couldn’t be added. Try again.')
    }
  }

  if (!items.length && !side) return null
  return (
    <section className="stack-xs">
      <span className="eyebrow">Sources{items.length ? ` (${items.length})` : ''}</span>
      {wantsSource && side && <p className="hint">This is a {claim.type}. A source makes it easier for the other side to accept.</p>}
      {items.length > 0 && (
        <ul className="evidence-list">
          {items.map((e) => {
            const href = safeUrl(e.url)
            return (
              <li key={e.id}>
                <span className={`ev-kind ev-${e.kind}`}>{KINDS.find((k) => k.value === e.kind)?.label}</span>{' '}
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
                <span className="small muted">
                  {' '}
                  · {nameOf(map, e.addedBy)}
                  {user?.uid === e.addedBy && (
                    <>
                      {' · '}
                      <button className="linklike" type="button" onClick={() => removeEvidence(db, map.debate.id, e.id).catch(console.error)}>
                        Remove
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {side && user && !open && (
        <button className="linklike small" type="button" onClick={() => setOpen(true)}>
          + Add a source
        </button>
      )}
      {side && user && open && (
        <form className="box stack-xs" onSubmit={submit}>
          <input id="ev-title" className="input" required maxLength={300} placeholder="What it is, such as “City transit budget 2025”" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Source title" />
          <input id="ev-url" className="input" inputMode="url" maxLength={2000} placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Source link" />
          <select id="ev-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)} aria-label="Kind of source">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}: {k.hint}
              </option>
            ))}
          </select>
          {error && <small className="error">{error}</small>}
          <span className="row-sm">
            <button className="btn pri small-btn" type="submit" disabled={!title.trim()}>
              Add source
            </button>
            <button className="btn small-btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
    </section>
  )
}

/** Comments and restatements on a box or link. */
export function CommentThread({ map, targetId, user, side }: { map: DebateMap; targetId: string; user?: User; side?: SideId | null }) {
  const items = map.comments.filter((c) => c.targetId === targetId)
  const claim = map.claims.find((c) => c.id === targetId)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user || !side || !text.trim()) return
    try {
      await addComment(db, user, map.debate.id, side, targetId, text)
      setText('')
      setError(null)
    } catch (err) {
      console.error(err)
      setError('Your comment couldn’t be posted. Try again.')
    }
  }

  if (!items.length && !side) return null
  return (
    <section className="stack-xs">
      <span className="eyebrow">Discussion{items.length ? ` (${items.length})` : ''}</span>
      {items.map((c) => (
        <CommentItem key={c.id} map={map} comment={c} canRespond={!!user && !!side && !!claim && claim.side === side && c.side !== side} user={user} />
      ))}
      {side && user && (
        <form className="stack-xs" onSubmit={submit}>
          <textarea id={`comment-${targetId}`} className="input" rows={2} maxLength={2000} placeholder="Ask a question or clarify a point" value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" />
          {error && <small className="error">{error}</small>}
          <span>
            <button className="btn small-btn" type="submit" disabled={!text.trim()}>
              Comment
            </button>
          </span>
        </form>
      )}
    </section>
  )
}

function CommentItem({ map, comment: c, canRespond, user }: { map: DebateMap; comment: Comment; canRespond: boolean; user?: User }) {
  const [reply, setReply] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const side = map.debate.sides[c.side].label
  async function respond(confirmed: boolean) {
    if (!user) return
    try {
      await respondToRestatement(db, user, map.debate.id, c.id, confirmed, confirmed ? '' : reply)
    } catch (e) {
      console.error(e)
    }
  }
  if (c.kind === 'comment') {
    return (
      <div className={`comment ${c.side}`}>
        <span className="small muted">
          {nameOf(map, c.authorUid)} ({side})
        </span>
        <p className="small">{c.text}</p>
      </div>
    )
  }
  return (
    <div className={`comment restatement ${c.status}`}>
      <span className="small muted">
        {nameOf(map, c.authorUid)} ({side}) restated this before objecting
      </span>
      <p className="small">“{c.text}”</p>
      {c.status === 'confirmed' && <p className="small ok">✓ Confirmed as a fair summary{c.respondedBy ? ` by ${nameOf(map, c.respondedBy)}` : ''}.</p>}
      {c.status === 'disputed' && (
        <p className="small">
          <span className="error">Not quite</span>
          {c.respondedBy ? `, says ${nameOf(map, c.respondedBy)}` : ''}
          {c.reply ? `: ${c.reply}` : '.'}
        </p>
      )}
      {c.status === 'pending' && !canRespond && <p className="small muted">Waiting for the other side to confirm.</p>}
      {c.status === 'pending' && canRespond && !correcting && (
        <span className="row-sm">
          <button className="btn pri small-btn" type="button" onClick={() => respond(true)}>
            That’s my point
          </button>
          <button className="btn small-btn" type="button" onClick={() => setCorrecting(true)}>
            Not quite
          </button>
        </span>
      )}
      {c.status === 'pending' && canRespond && correcting && (
        <div className="stack-xs">
          <textarea className="input" rows={2} maxLength={2000} placeholder="What did they miss?" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Correction" />
          <span className="row-sm">
            <button className="btn pri small-btn" type="button" disabled={!reply.trim()} onClick={() => respond(false)}>
              Send correction
            </button>
            <button className="btn small-btn" type="button" onClick={() => setCorrecting(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

const VALUE_LABEL = { agree: 'agree', unsure: 'unsure', disagree: 'disagree' } as const

/** How each side's stance on a box has moved, including concessions. */
export function StanceHistory({ map, targetId }: { map: DebateMap; targetId: string }) {
  const [history, setHistory] = useState<StanceChange[]>([])
  useEffect(() => watchStanceHistory(db, map.debate.id, targetId, setHistory), [map.debate.id, targetId])
  if (!history.length) return null
  return (
    <details className="stack-xs history">
      <summary className="eyebrow">Stance history ({history.length})</summary>
      <ol className="history-list">
        {history.map((h) => (
          <li key={h.id} className="small">
            <strong>{map.debate.sides[h.side].label}</strong>{' '}
            {h.from ? `${VALUE_LABEL[h.from.value]} ${h.from.confidence}% → ` : ''}
            {VALUE_LABEL[h.to.value]} {h.to.confidence}%{h.conceded && <span className="badge concede">Fair point</span>}
            {h.at && <span className="muted"> · {new Date(h.at.toMillis()).toLocaleDateString()}</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Rule-based review of the whole map: what's missing, what's waiting, where the disagreement is. */
export function MapCheckPanel({ map, onSelect }: { map: DebateMap; onSelect: (s: Selection) => void }) {
  const check = useMemo(() => checkMap(map), [map])
  const text = (id: string) => map.claims.find((c) => c.id === id)?.text ?? ''
  const issues = issueCount(check)
  const Item = ({ id, children }: { id: string; children?: React.ReactNode }) => (
    <li>
      <button className="linklike check-item" type="button" onClick={() => onSelect({ kind: 'claim', id })}>
        {text(id)}
      </button>
      {children}
    </li>
  )
  return (
    <section className="stack-xs map-check">
      <span className="eyebrow">Map check</span>
      {check.cruxes.length > 0 && (
        <div className="stack-xs">
          <p className="small">
            <span className="badge crux">Crux</span> {check.cruxes.length === 1 ? 'One box is' : `${check.cruxes.length} boxes are`} where the sides split. Arguing these moves the debate most.
          </p>
          <ul className="check-list">
            {check.cruxes.map((id) => (
              <Item key={id} id={id} />
            ))}
          </ul>
        </div>
      )}
      {issues === 0 && check.cruxes.length === 0 && <p className="small muted">Nothing to flag yet.</p>}
      {issues === 0 && check.cruxes.length > 0 && <p className="small ok">Every box has stances and the facts have sources.</p>}
      {check.pendingRestatements.length > 0 && (
        <CheckGroup title={`Restatements waiting for confirmation (${check.pendingRestatements.length})`}>
          {check.pendingRestatements.map((c) => (
            <Item key={c.id} id={c.targetId} />
          ))}
        </CheckGroup>
      )}
      {check.missingStances.map((m) => (
        <CheckGroup key={m.side} title={`${map.debate.sides[m.side].label} hasn’t taken a stance (${m.claimIds.length})`}>
          {m.claimIds.map((id) => (
            <Item key={id} id={id} />
          ))}
        </CheckGroup>
      ))}
      {check.unsourced.length > 0 && (
        <CheckGroup title={`Facts and predictions without a source (${check.unsourced.length})`}>
          {check.unsourced.map((id) => (
            <Item key={id} id={id} />
          ))}
        </CheckGroup>
      )}
      {check.oldNotes.length > 0 && (
        <CheckGroup title={`Notes waiting more than 3 days to be placed (${check.oldNotes.length})`}>
          {check.oldNotes.map((id) => (
            <li key={id} className="small">
              {text(id)}
            </li>
          ))}
        </CheckGroup>
      )}
    </section>
  )
}

function CheckGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="check-group">
      <summary className="small">{title}</summary>
      <ul className="check-list">{children}</ul>
    </details>
  )
}

/** Leader setting: ask for a restatement before objecting to the other side's box. */
export function RestateSetting({ debate }: { debate: Debate }) {
  const on = debate.settings?.restateFirst !== false
  const [error, setError] = useState(false)
  return (
    <label className="check-row small" htmlFor="restate-first">
      <input
        id="restate-first"
        type="checkbox"
        checked={on}
        onChange={(e) => setRestateFirst(db, debate.id, e.target.checked).then(() => setError(false), () => setError(true))}
      />
      Restate the other side’s point before objecting to it
      {error && <span className="error"> Couldn’t save.</span>}
    </label>
  )
}
