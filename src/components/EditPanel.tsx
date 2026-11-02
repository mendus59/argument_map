import { useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { addArgument, addNote, editClaim, placeNote, setStance, type PremiseInput } from '../data/map'
import { stanceOf } from '../model/crux'
import type { Claim, ClaimType, DebateMap, Link, SideId, Stance, StanceValue } from '../model/types'
import type { Selection } from '../map/ArgumentMap'

const TYPES: { value: ClaimType; label: string }[] = [
  { value: 'unspecified', label: 'Claim' },
  { value: 'fact', label: 'Fact' },
  { value: 'prediction', label: 'Prediction' },
  { value: 'value', label: 'Value' },
  { value: 'definition', label: 'Definition' },
]

interface Role {
  side: SideId | null
  leader: boolean
}

export function EditPanel({ map, selection, user, role, onSelect }: { map: DebateMap; selection: Selection; user: User; role: Role; onSelect: (s: Selection) => void }) {
  const claim = selection?.kind === 'claim' ? map.claims.find((c) => c.id === selection.id) : undefined
  const link = selection?.kind === 'link' ? map.links.find((l) => l.id === selection.id) : undefined

  return (
    <div className="stack">
      {!claim && !link && (
        <p className="small muted">
          Select a box to add reasons or objections to it{role.leader ? ', or to set your team’s stance' : ''}. Select a
          group’s outline to check whether its premises lead where they point.
        </p>
      )}
      {claim && <ClaimPanel key={claim.id} map={map} claim={claim} user={user} role={role} onSelect={onSelect} />}
      {link && <LinkPanel key={link.id} map={map} link={link} role={role} />}
      {role.side && <NoteComposer debateId={map.debate.id} user={user} side={role.side} />}
    </div>
  )
}

function authorName(map: DebateMap, uid: string) {
  return map.debate.people[uid]?.name ?? 'Someone'
}

function StanceSummary({ map, targetId }: { map: DebateMap; targetId: string }) {
  return (
    <div className="row-sm">
      {(['for', 'against'] as SideId[]).map((s) => {
        const st = stanceOf(map, targetId, s)
        return (
          <span key={s} className={`chip ${st?.value ?? 'none'}`}>
            {map.debate.sides[s].label}: {st ? `${st.value} · ${st.confidence}%` : 'no stance yet'}
          </span>
        )
      })}
    </div>
  )
}

function ClaimPanel({ map, claim, user, role, onSelect }: { map: DebateMap; claim: Claim; user: User; role: Role; onSelect: (s: Selection) => void }) {
  const [editing, setEditing] = useState(false)
  const isConclusion = claim.id === map.debate.conclusion.claimId
  const notes = map.claims.filter((c) => !c.placed)

  return (
    <section className="stack-sm">
      <span className="eyebrow">{isConclusion ? 'Conclusion' : 'Selected box'}</span>
      {editing ? (
        <EditClaimForm map={map} claim={claim} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="selected-text">{claim.text}</p>
          <p className="small muted">
            {TYPES.find((t) => t.value === claim.type)?.label} · posted by {authorName(map, claim.authorUid)} ({map.debate.sides[claim.side].label})
            {claim.authorUid === user.uid && (
              <>
                {' · '}
                <button className="linklike" type="button" onClick={() => setEditing(true)}>
                  Edit wording
                </button>
              </>
            )}
          </p>
        </>
      )}
      <StanceSummary map={map} targetId={claim.id} />
      {role.leader && role.side && <StanceEditor key={claim.id} map={map} targetId={claim.id} side={role.side} label="Your team’s stance" />}
      {role.side && <ArgumentComposer map={map} target={claim} user={user} side={role.side} onAdded={() => onSelect({ kind: 'claim', id: claim.id })} />}
      {role.side && notes.length > 0 && (
        <div className="stack-xs">
          <span className="eyebrow">Place a note under this box</span>
          {notes.map((n) => (
            <div key={n.id} className="note stack-xs">
              <span>{n.text}</span>
              <span className="row-sm">
                <button className="btn small-btn" type="button" onClick={() => placeNote(db, user, map.debate.id, role.side!, n.id, 'reason', claim.id).catch(console.error)}>
                  As a reason
                </button>
                <button className="btn small-btn" type="button" onClick={() => placeNote(db, user, map.debate.id, role.side!, n.id, 'objection', claim.id).catch(console.error)}>
                  As an objection
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EditClaimForm({ map, claim, onDone }: { map: DebateMap; claim: Claim; onDone: () => void }) {
  const [text, setText] = useState(claim.text)
  const [type, setType] = useState<ClaimType>(claim.type)
  const [error, setError] = useState<string | null>(null)
  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      await editClaim(db, map.debate.id, claim.id, text, type)
      onDone()
    } catch (err) {
      console.error(err)
      setError('Your change couldn’t be saved. Try again.')
    }
  }
  return (
    <form className="stack-xs" onSubmit={save}>
      <textarea id="edit-claim-text" className="input" rows={3} maxLength={1000} required value={text} onChange={(e) => setText(e.target.value)} aria-label="Wording" />
      <TypeSelect id="edit-claim-type" value={type} onChange={setType} />
      {error && <small className="error">{error}</small>}
      <span className="row-sm">
        <button className="btn pri small-btn" type="submit">
          Save
        </button>
        <button className="btn small-btn" type="button" onClick={onDone}>
          Cancel
        </button>
      </span>
    </form>
  )
}

function TypeSelect({ id, value, onChange }: { id: string; value: ClaimType; onChange: (t: ClaimType) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as ClaimType)} aria-label="Kind of claim">
      {TYPES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  )
}

function StanceEditor({ map, targetId, side, label }: { map: DebateMap; targetId: string; side: SideId; label: string }) {
  const current: Stance | undefined = stanceOf(map, targetId, side)
  const [value, setValue] = useState<StanceValue>(current?.value ?? 'unsure')
  const [confidence, setConfidence] = useState(current?.confidence ?? 50)
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const dirty = !current || current.value !== value || current.confidence !== confidence

  async function save() {
    try {
      await setStance(db, map.debate.id, targetId, side, value, confidence)
      setState('saved')
    } catch (e) {
      console.error(e)
      setState('error')
    }
  }

  return (
    <div className="box stack-xs">
      <span className="eyebrow">{label}</span>
      <div className="seg seg-sm" role="radiogroup" aria-label={label}>
        {(['agree', 'unsure', 'disagree'] as StanceValue[]).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? `on ${v}` : ''} onClick={() => { setValue(v); setState('idle') }}>
            {v === 'agree' ? 'Agree' : v === 'unsure' ? 'Unsure' : 'Disagree'}
          </button>
        ))}
      </div>
      <label className="slider" htmlFor={`conf-${targetId}`}>
        Confidence
        <input id={`conf-${targetId}`} type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => { setConfidence(Number(e.target.value)); setState('idle') }} />
        <span className="num">{confidence}%</span>
      </label>
      <span className="row-sm">
        <button className="btn pri small-btn" type="button" disabled={!dirty} onClick={save}>
          Save stance
        </button>
        {state === 'saved' && !dirty && <small className="ok">Saved.</small>}
        {state === 'error' && <small className="error">Couldn’t save. Only your team’s leader can set stances.</small>}
      </span>
    </div>
  )
}

function defaultKind(map: DebateMap, target: Claim, side: SideId): Link['kind'] {
  if (target.id === map.debate.conclusion.claimId) return side === 'for' ? 'reason' : 'objection'
  return target.side === side ? 'reason' : 'objection'
}

function ArgumentComposer({ map, target, user, side, onAdded }: { map: DebateMap; target: Claim; user: User; side: SideId; onAdded: () => void }) {
  const [kind, setKind] = useState<Link['kind']>(defaultKind(map, target, side))
  const [premises, setPremises] = useState<PremiseInput[]>([{ text: '', type: 'unspecified' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, p: Partial<PremiseInput>) => setPremises((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const filled = premises.filter((p) => p.text.trim())
  const looksDouble = filled.some((p) => p.text.length > 140 && /\b(and|also|plus)\b/i.test(p.text))
  const unsourced = filled.some((p) => p.type === 'fact' || p.type === 'prediction')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!filled.length) return
    setBusy(true)
    setError(null)
    try {
      await addArgument(db, user, map.debate.id, side, kind, target.id, filled)
      setPremises([{ text: '', type: 'unspecified' }])
      onAdded()
    } catch (err) {
      console.error(err)
      setError('This couldn’t be added. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="composer stack-xs" onSubmit={submit}>
      <div className="seg seg-sm" role="radiogroup" aria-label="Kind of argument">
        <button type="button" role="radio" aria-checked={kind === 'reason'} className={kind === 'reason' ? 'on agree' : ''} onClick={() => setKind('reason')}>
          Reason for it
        </button>
        <button type="button" role="radio" aria-checked={kind === 'objection'} className={kind === 'objection' ? 'on disagree' : ''} onClick={() => setKind('objection')}>
          Objection to it
        </button>
      </div>
      {premises.map((p, i) => (
        <div key={i} className="stack-xs premise-input">
          <textarea
            id={`premise-${i}`}
            className="input"
            rows={2}
            maxLength={1000}
            placeholder={i === 0 ? 'State one claim…' : 'And this must also hold…'}
            value={p.text}
            onChange={(e) => update(i, { text: e.target.value })}
            aria-label={`Premise ${i + 1}`}
          />
          <span className="row-sm">
            <TypeSelect id={`premise-type-${i}`} value={p.type} onChange={(t) => update(i, { type: t })} />
            {premises.length > 1 && (
              <button className="linklike small" type="button" onClick={() => setPremises((ps) => ps.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </span>
        </div>
      ))}
      {premises.length < 8 && (
        <button className="linklike small" type="button" onClick={() => setPremises((ps) => [...ps, { text: '', type: 'unspecified' }])}>
          + Add a co-premise (all must hold together)
        </button>
      )}
      {looksDouble && <p className="hint">This might be two claims in one. Splitting them into co-premises lets the other side accept one and dispute the other.</p>}
      {!looksDouble && unsourced && <p className="hint">Facts and predictions are stronger with a source. You can post as is.</p>}
      {error && <small className="error">{error}</small>}
      <button className="btn pri small-btn" type="submit" disabled={busy || !filled.length}>
        {busy ? 'Adding…' : 'Add to map'}
      </button>
    </form>
  )
}

function LinkPanel({ map, link, role }: { map: DebateMap; link: Link; role: Role }) {
  const target = map.claims.find((c) => c.id === link.targetClaimId)
  const premises = link.premiseClaimIds.map((id) => map.claims.find((c) => c.id === id)).filter(Boolean) as Claim[]
  return (
    <section className="stack-sm">
      <span className="eyebrow">Inference check</span>
      <p className="small">
        If {premises.length > 1 ? 'all of these were' : 'this were'} true, would it {link.kind === 'reason' ? 'support' : 'count against'} “{target?.text}”?
      </p>
      <ul className="premise-list">
        {premises.map((p) => (
          <li key={p.id}>{p.text}</li>
        ))}
      </ul>
      <StanceSummary map={map} targetId={link.id} />
      {role.leader && role.side && <StanceEditor key={link.id} map={map} targetId={link.id} side={role.side} label="Your team’s answer" />}
    </section>
  )
}

function NoteComposer({ debateId, user, side }: { debateId: string; user: User; side: SideId }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    try {
      await addNote(db, user, debateId, side, text)
      setText('')
      setError(null)
    } catch (err) {
      console.error(err)
      setError('Your note couldn’t be saved. Try again.')
    }
  }
  return (
    <form className="stack-xs" onSubmit={submit}>
      <span className="eyebrow">Quick note</span>
      <textarea id="note-text" className="input" rows={2} maxLength={1000} placeholder="A rough thought you can place on the map later" value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" />
      {error && <small className="error">{error}</small>}
      <span>
        <button className="btn small-btn" type="submit" disabled={!text.trim()}>
          Save note
        </button>
      </span>
    </form>
  )
}
