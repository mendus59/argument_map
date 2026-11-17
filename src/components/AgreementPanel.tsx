// The heart of a claim between two people: does the other side accept it, which
// terms need defining, and is the wording fair?
import { useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import {
  acceptDefinition,
  acceptRewording,
  answerClaim,
  challengeWording,
  declineRewording,
  openTerm,
  proposeDefinition,
  rejectDefinition,
  withdrawAnswer,
} from '../data/agreement'
import { STATUS_LABEL, claimAgreement, containsPhrase, meaningOf, replacePhrase, type ClaimStatus, type TermState } from '../model/agreement'
import type { Claim, DebateMap, Definition, Rewording, SideId } from '../model/types'

interface Role {
  side: SideId | null
  leader: boolean
}

const nameOf = (map: DebateMap, uid: string | null | undefined) => (uid && map.debate.people[uid]?.name.split(' ')[0]) || 'Someone'
const sideName = (map: DebateMap, s: SideId) => map.debate.sides[s].label

/** Text the reader has highlighted, if it comes from this claim. */
function highlighted(claim: Claim) {
  const sel = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() ?? '' : ''
  return sel && containsPhrase(claim.text, sel) ? sel : ''
}

export function StatusPill({ status }: { status: ClaimStatus }) {
  const icon = status === 'agreed' ? '✓' : status === 'disputed' ? '✗' : status === 'proposed' ? '…' : '!'
  return (
    <span className={`status-pill status-${status}`}>
      {icon} {STATUS_LABEL[status]}
    </span>
  )
}

function explain(map: DebateMap, status: ClaimStatus, opponent: SideId, version: number) {
  const them = sideName(map, opponent)
  switch (status) {
    case 'proposed':
      return `${them} hasn’t answered yet. They can accept it, ask for a term to be defined, challenge the wording, or dispute it.`
    case 'agreed':
      return 'Both sides accept this as worded, with every term agreed. It can be used as a premise without arguing it again.'
    case 'changed':
      return `The wording changed (now version ${version}) after ${them} accepted it. They need to look again.`
    case 'unsettled':
      return 'Some terms or wording are still being worked out.'
    case 'disputed':
      return `${them} disputes this. Add reasons or objections, or spin it off into its own sub-debate.`
  }
}

export function AgreementSection({ map, claim, user, role }: { map: DebateMap; claim: Claim; user: User; role: Role }) {
  const a = claimAgreement(map, claim)
  const [open, setOpen] = useState<null | 'define' | 'reword'>(null)
  const [error, setError] = useState<string | null>(null)
  const answering = role.leader && role.side === a.opponent
  const run = (p: Promise<unknown>) =>
    p.catch((e) => {
      console.error(e)
      setError('That couldn’t be saved. Try again.')
    })
  const resolved = (map.rewordings ?? []).filter((r) => r.claimId === claim.id && r.status !== 'open')
  const versions = (map.versions ?? []).filter((v) => v.claimId === claim.id).sort((x, y) => y.version - x.version)

  return (
    <section className="agreement stack-sm">
      <div className="row-sm">
        <StatusPill status={a.status} />
        {a.version > 1 && <span className="small muted">version {a.version}</span>}
      </div>
      <p className="small muted">{explain(map, a.status, a.opponent, a.version)}</p>

      {answering && (
        <div className="row-sm">
          {a.acceptance?.value === 'accepted' && a.acceptance.version === a.version ? (
            <span className="small ok">You accepted this.</span>
          ) : (
            <button className="btn pri small-btn" type="button" onClick={() => run(answerClaim(db, user, map.debate.id, claim, role.side!, 'accepted'))}>
              Accept{a.status === 'changed' ? ' new wording' : ''}
            </button>
          )}
          {a.acceptance?.value !== 'disputed' && (
            <button className="btn small-btn" type="button" onClick={() => run(answerClaim(db, user, map.debate.id, claim, role.side!, 'disputed'))}>
              Dispute
            </button>
          )}
          {a.acceptance && (
            <button className="linklike small" type="button" onClick={() => run(withdrawAnswer(db, map.debate.id, claim.id, role.side!))}>
              Take back my answer
            </button>
          )}
        </div>
      )}

      {role.side && (
        <div className="row-sm">
          <button className={`btn small-btn${open === 'define' ? ' on' : ''}`} type="button" onClick={() => setOpen(open === 'define' ? null : 'define')}>
            Define a term
          </button>
          {role.side !== claim.side && (
            <button className={`btn small-btn${open === 'reword' ? ' on' : ''}`} type="button" onClick={() => setOpen(open === 'reword' ? null : 'reword')}>
              Challenge wording
            </button>
          )}
        </div>
      )}
      {open === 'define' && role.side && (
        <DefineForm map={map} claim={claim} user={user} side={role.side} onDone={() => setOpen(null)} />
      )}
      {open === 'reword' && role.side && (
        <RewordForm map={map} claim={claim} user={user} side={role.side} onDone={() => setOpen(null)} />
      )}
      {error && <small className="error">{error}</small>}

      {a.terms.length > 0 && (
        <div className="stack-xs">
          <span className="eyebrow">Terms</span>
          {a.terms.map((t) => (
            <TermCard key={t.term.id} map={map} state={t} user={user} role={role} />
          ))}
        </div>
      )}

      {a.openRewordings.length > 0 && (
        <div className="stack-xs">
          <span className="eyebrow">Wording challenges</span>
          {a.openRewordings.map((r) => (
            <RewordingCard key={r.id} map={map} claim={claim} r={r} user={user} />
          ))}
        </div>
      )}

      {(resolved.length > 0 || versions.length > 0) && (
        <details className="small">
          <summary>Earlier wording and answered challenges</summary>
          <ul className="history-list">
            {versions.map((v) => (
              <li key={v.version}>
                <span className="muted">Version {v.version}:</span> {v.text}
              </li>
            ))}
            {resolved.map((r) => (
              <li key={r.id}>
                {nameOf(map, r.by)} suggested “{r.suggestion}” for “{r.phrase}”:{' '}
                {r.status === 'accepted' ? <span className="ok">taken</span> : <span>kept as is{r.reply ? ` (“${r.reply}”)` : ''}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function DefineForm({ map, claim, user, side, onDone }: { map: DebateMap; claim: Claim; user: User; side: SideId; onDone: () => void }) {
  const [phrase, setPhrase] = useState(() => highlighted(claim))
  const [meaning, setMeaning] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inClaim = containsPhrase(claim.text, phrase)
  const existing = (map.terms ?? []).find((t) => t.claimId === claim.id && t.phrase.toLowerCase() === phrase.trim().toLowerCase())
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!inClaim) return
    try {
      if (existing) await proposeDefinition(db, user, map.debate.id, side, existing, meaning)
      else await openTerm(db, user, map.debate.id, side, claim.id, phrase, meaning)
      onDone()
    } catch (err) {
      console.error(err)
      setError('That couldn’t be saved. Try again.')
    }
  }
  return (
    <form className="box stack-xs" onSubmit={submit}>
      <label className="small" htmlFor="term-phrase">
        Which words? <span className="muted">Highlight them in the claim, or type them.</span>
      </label>
      <input id="term-phrase" className="input" maxLength={200} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="e.g. undocumented immigrant criminals" />
      {phrase.trim() && !inClaim && <small className="error">Those words aren’t in the claim.</small>}
      <label className="small" htmlFor="term-meaning">
        What do they mean? <span className="muted">{side === claim.side ? 'Say what you meant.' : 'Leave empty to ask the author to define them.'}</span>
      </label>
      <textarea id="term-meaning" className="input" rows={2} maxLength={2000} value={meaning} onChange={(e) => setMeaning(e.target.value)} required={!!existing} />
      {error && <small className="error">{error}</small>}
      <span className="row-sm">
        <button className="btn pri small-btn" type="submit" disabled={!inClaim || (!!existing && !meaning.trim())}>
          {meaning.trim() ? 'Propose definition' : 'Ask for a definition'}
        </button>
        <button className="btn small-btn" type="button" onClick={onDone}>
          Cancel
        </button>
      </span>
    </form>
  )
}

function RewordForm({ map, claim, user, side, onDone }: { map: DebateMap; claim: Claim; user: User; side: SideId; onDone: () => void }) {
  const [phrase, setPhrase] = useState(() => highlighted(claim))
  const [suggestion, setSuggestion] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inClaim = containsPhrase(claim.text, phrase)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!inClaim) return
    try {
      await challengeWording(db, user, map.debate.id, side, claim, { phrase, suggestion, reason })
      onDone()
    } catch (err) {
      console.error(err)
      setError('That couldn’t be saved. Try again.')
    }
  }
  return (
    <form className="box stack-xs" onSubmit={submit}>
      <label className="small" htmlFor="reword-phrase">
        Which words are unfair or unclear? <span className="muted">Highlight them in the claim, or type them.</span>
      </label>
      <input id="reword-phrase" className="input" maxLength={300} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="e.g. illegal immigrant" />
      {phrase.trim() && !inClaim && <small className="error">Those words aren’t in the claim.</small>}
      <label className="small" htmlFor="reword-suggestion">
        Suggested wording <span className="muted">(leave empty to suggest removing them)</span>
      </label>
      <input id="reword-suggestion" className="input" maxLength={300} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} placeholder="e.g. undocumented immigrant" />
      <label className="small" htmlFor="reword-reason">
        Why?
      </label>
      <textarea id="reword-reason" className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. “Illegal” assumes a crime that’s still in question." />
      {inClaim && (
        <p className="small muted">
          It would read: “{replacePhrase(claim.text, phrase, suggestion)}”
        </p>
      )}
      {error && <small className="error">{error}</small>}
      <span className="row-sm">
        <button className="btn pri small-btn" type="submit" disabled={!inClaim}>
          Send to {sideName(map, claim.side)}
        </button>
        <button className="btn small-btn" type="button" onClick={onDone}>
          Cancel
        </button>
      </span>
    </form>
  )
}

const KIND_LABEL: Record<Definition['kind'], string> = { definition: 'defines it as', counter: 'counters with', addendum: 'adds' }

function TermCard({ map, state, user, role }: { map: DebateMap; state: TermState; user: User; role: Role }) {
  const { term, current, history } = state
  const [mode, setMode] = useState<null | 'reject' | 'redefine'>(null)
  const [kind, setKind] = useState<'counter' | 'addendum'>('counter')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canAnswer = !!current && current.status === 'pending' && role.leader && role.side !== null && role.side !== current.side

  async function act(p: Promise<unknown>) {
    try {
      await p
      setMode(null)
      setText('')
      setError(null)
    } catch (e) {
      console.error(e)
      setError('That couldn’t be saved. Try again.')
    }
  }

  return (
    <div className={`term-card term-${state.state}`}>
      <div className="row-sm">
        <strong>“{term.phrase}”</strong>
        <span className={`status-pill status-${state.state === 'agreed' ? 'agreed' : 'unsettled'}`}>
          {state.state === 'agreed' ? '✓ Agreed' : state.state === 'pending' ? 'Waiting for an answer' : 'Needs a definition'}
        </span>
        {state.contested && <span className="status-pill status-disputed">Real disagreement</span>}
      </div>
      {state.state === 'agreed' && <p className="small">{state.meaning}</p>}
      {state.state === 'pending' && current && (
        <p className="small">
          <span className="muted">
            {nameOf(map, current.by)} ({sideName(map, current.side)}) {KIND_LABEL[current.kind]}:
          </span>{' '}
          {current.kind === 'addendum' ? meaningOf(current, history) : current.text}
        </p>
      )}
      {state.state === 'undefined' && (
        <p className="small muted">
          {nameOf(map, term.openedBy)} asked what this means.
        </p>
      )}
      {state.contested && state.state !== 'agreed' && (
        <p className="small muted">You’ve each rejected the other’s meaning. This may be your core disagreement: consider spinning it off into a sub-debate.</p>
      )}
      {error && <small className="error">{error}</small>}
      {canAnswer && mode === null && (
        <span className="row-sm">
          <button className="btn pri small-btn" type="button" onClick={() => act(acceptDefinition(db, user, map.debate.id, current!))}>
            Accept
          </button>
          <button className="btn small-btn" type="button" onClick={() => setMode('reject')}>
            Reject…
          </button>
        </span>
      )}
      {role.side && mode === null && state.state !== 'pending' && (
        <button className="linklike small" type="button" onClick={() => setMode('redefine')}>
          {state.state === 'agreed' ? 'Propose a new definition' : 'Propose a definition'}
        </button>
      )}
      {mode && (
        <form
          className="stack-xs"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim() || !role.side) return
            act(
              mode === 'reject'
                ? rejectDefinition(db, user, map.debate.id, role.side, current!, { kind, text })
                : proposeDefinition(db, user, map.debate.id, role.side, term, text),
            )
          }}
        >
          {mode === 'reject' && (
            <div className="seg seg-sm" role="radiogroup" aria-label="How you answer">
              <button type="button" role="radio" aria-checked={kind === 'counter'} className={kind === 'counter' ? 'on' : ''} onClick={() => setKind('counter')}>
                My own definition
              </button>
              <button type="button" role="radio" aria-checked={kind === 'addendum'} className={kind === 'addendum' ? 'on' : ''} onClick={() => setKind('addendum')}>
                Add to theirs
              </button>
            </div>
          )}
          <textarea
            className="input"
            rows={2}
            maxLength={2000}
            required
            aria-label="Definition"
            placeholder={mode === 'reject' && kind === 'addendum' ? 'e.g. …but not counting immigration offences' : 'What it means'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {mode === 'reject' && <small className="muted">To reject a definition, offer your own or add to it, so you keep narrowing in on the real difference.</small>}
          {mode === 'redefine' && state.state === 'agreed' && (
            <small className="muted">The term goes back to “waiting” until the other side answers, and this claim is open again.</small>
          )}
          <span className="row-sm">
            <button className="btn pri small-btn" type="submit" disabled={!text.trim()}>
              {mode === 'reject' ? 'Reject and send' : 'Propose'}
            </button>
            <button className="btn small-btn" type="button" onClick={() => setMode(null)}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {history.length > 1 && (
        <details className="small">
          <summary>How you got here ({history.length} definitions)</summary>
          <ol className="history-list">
            {history.map((d) => (
              <li key={d.id}>
                <span className="muted">
                  {nameOf(map, d.by)} {KIND_LABEL[d.kind]}:
                </span>{' '}
                {d.text} <span className={d.status === 'accepted' ? 'ok' : d.status === 'rejected' ? 'error' : 'muted'}>({d.status})</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}

function RewordingCard({ map, claim, r, user }: { map: DebateMap; claim: Claim; r: Rewording; user: User }) {
  const [declining, setDeclining] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mine = claim.authorUid === user.uid
  const stillThere = containsPhrase(claim.text, r.phrase)
  const run = (p: Promise<unknown>) =>
    p.catch((e) => {
      console.error(e)
      setError('That couldn’t be saved. Try again.')
    })
  return (
    <div className="term-card">
      <p className="small">
        <span className="muted">{nameOf(map, r.by)} suggests</span> {r.suggestion ? <strong>“{r.suggestion}”</strong> : 'removing'}{' '}
        <span className="muted">{r.suggestion ? 'in place of' : ''}</span> <s>“{r.phrase}”</s>
      </p>
      {r.reason && <p className="small">“{r.reason}”</p>}
      {stillThere && <p className="small muted">New wording: “{replacePhrase(claim.text, r.phrase, r.suggestion)}”</p>}
      {error && <small className="error">{error}</small>}
      {mine && !declining && (
        <span className="row-sm">
          <button className="btn pri small-btn" type="button" disabled={!stillThere} onClick={() => run(acceptRewording(db, user, map.debate.id, claim, r))}>
            Use this wording
          </button>
          <button className="btn small-btn" type="button" onClick={() => setDeclining(true)}>
            Keep mine…
          </button>
        </span>
      )}
      {mine && declining && (
        <form
          className="stack-xs"
          onSubmit={(e) => {
            e.preventDefault()
            run(declineRewording(db, user, map.debate.id, r, reply))
          }}
        >
          <textarea className="input" rows={2} maxLength={2000} aria-label="Why you’re keeping your wording" placeholder="Why your wording is fair" value={reply} onChange={(e) => setReply(e.target.value)} />
          <span className="row-sm">
            <button className="btn pri small-btn" type="submit">
              Keep my wording
            </button>
            <button className="btn small-btn" type="button" onClick={() => setDeclining(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {!mine && <p className="small muted">Waiting for {nameOf(map, claim.authorUid)} to take it or keep their wording.</p>}
    </div>
  )
}
