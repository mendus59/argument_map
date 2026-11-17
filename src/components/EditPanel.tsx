import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { addArgument, addNote, placeNote, setStance, type PremiseInput } from '../data/map'
import { editClaim } from '../data/agreement'
import { AgreementSection, GroundedNote } from './AgreementPanel'
import { ClaimBuilder, type Suggestion } from './ClaimBuilder'
import type { CommonGround } from '../data/ground'
import { containsPhrase, replacePhrase, wordingSlips } from '../model/agreement'
import { claimAgreement } from '../model/agreement'
import { stanceOf } from '../model/crux'
import type { Claim, ClaimSource, ClaimType, DebateMap, Link, SideId, Stance, StanceValue } from '../model/types'
import { formatTime } from '../import/transcript'
import { objectWithRestatement } from '../data/honest'
import { stanceHome } from '../data/subdebates'
import { ForkSection } from './SubDebatePanels'
import type { SubStatus } from '../map/nodes'
import type { SettledClaim } from '../model/tree'
import { Link as RouterLink } from 'react-router-dom'
import { CommentThread, EvidenceSection, MapCheckPanel, StanceHistory } from './HonestPanels'
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

/** Imported debates: a transcript passage waiting to be mapped, and how to play a box's moment. */
export interface SourceProps {
  draft: ClaimSource | null
  onDraftUsed: () => void
  onSeek?: (seconds: number) => void
}

/** Sub-debate context: status of forked boxes, and settled claims that can be cited. */
export interface TreeProps {
  subs: Map<string, SubStatus>
  settled: SettledClaim[]
}

export function EditPanel({
  map,
  selection,
  user,
  role,
  onSelect,
  source,
  tree,
  common,
}: {
  map: DebateMap
  selection: Selection
  user: User
  role: Role
  onSelect: (s: Selection) => void
  source?: SourceProps
  tree?: TreeProps
  /** What the two people agreed across their debates (only for the two of them). */
  common?: CommonGround | null
}) {
  const claim = selection?.kind === 'claim' ? map.claims.find((c) => c.id === selection.id) : undefined
  const link = selection?.kind === 'link' ? map.links.find((l) => l.id === selection.id) : undefined

  return (
    <div className="stack">
      {source?.draft && !claim && (
        <div className="hint">Now select the box this passage supports or objects to, or save it as a note below.</div>
      )}
      {!claim && !link && !source?.draft && (
        <p className="small muted">
          {map.debate.origin === 'native' ? (
            'Open a claim in the conversation, or pick a box on the tree, to answer it, define its terms, or add a reason or objection.'
          ) : (
            <>
              Select a box to add reasons or objections to it{role.leader ? ', or to set your team’s stance' : ''}. Select a group’s outline to check whether its
              premises lead where they point.
            </>
          )}
        </p>
      )}
      {!claim && !link && <MapCheckPanel map={map} onSelect={onSelect} />}
      {claim && <ClaimPanel key={`${claim.id}-${role.side}`} map={map} claim={claim} user={user} role={role} onSelect={onSelect} source={source} tree={tree} common={common} />}
      {link && <LinkPanel key={link.id} map={map} link={link} role={role} user={user} />}
      {role.side && <NoteComposer key={role.side} debateId={map.debate.id} user={user} side={role.side} source={source} />}
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

function SourceQuote({ src, onSeek }: { src: ClaimSource; onSeek?: (s: number) => void }) {
  return (
    <blockquote className="source-quote">
      <p>“{src.quote}”</p>
      <footer className="row-sm small muted">
        {src.speaker ?? 'Unnamed speaker'}
        {src.start !== null && (
          <>
            {' · '}
            {onSeek ? (
              <button className="linklike" type="button" onClick={() => onSeek(src.start!)}>
                ▶ Play from {formatTime(src.start)}
              </button>
            ) : (
              formatTime(src.start)
            )}
          </>
        )}
      </footer>
    </blockquote>
  )
}

/** Everything about one claim: its answer, terms, wording, the claim builder, sources, discussion and the composer. */
export function ClaimPanel({
  map,
  claim,
  user,
  role,
  onSelect,
  source,
  tree,
  common,
  inCard,
}: {
  map: DebateMap
  claim: Claim
  user: User
  role: Role
  onSelect: (s: Selection) => void
  source?: SourceProps
  tree?: TreeProps
  common?: CommonGround | null
  /** Shown inside a conversation card, which already shows the claim's wording. */
  inCard?: boolean
}) {
  // In a sub-debate the conclusion is the parent's box: its sources and discussion stay there.
  const borrowed = claim.id === map.debate.conclusion.claimId && map.debate.conclusion.debateId !== map.debate.id
  const [editing, setEditing] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const isConclusion = claim.id === map.debate.conclusion.claimId
  const notes = map.claims.filter((c) => !c.placed)

  return (
    <section className="stack-sm">
      {!inCard && <span className="eyebrow">{isConclusion ? 'Conclusion' : 'Selected box'}</span>}
      {editing ? (
        <EditClaimForm map={map} claim={claim} user={user} pair={common?.pair} onDone={() => setEditing(false)} />
      ) : (
        <>
          {!inCard && <p className="selected-text">{claim.text}</p>}
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
      {claim.source && <SourceQuote src={claim.source} onSeek={source?.onSeek} />}
      {map.debate.origin === 'native' && !borrowed && claim.groundRef && <GroundedNote map={map} claim={claim} />}
      {map.debate.origin === 'native' && !borrowed && !claim.groundRef && <AgreementSection map={map} claim={claim} user={user} role={role} subs={tree?.subs} onSelect={onSelect} pair={common?.pair} />}
      {map.debate.origin === 'native' && borrowed && (
        <p className="small muted">
          Accept it, define its terms or challenge its wording in the{' '}
          <RouterLink to={`/d/${map.debate.conclusion.debateId}`}>parent debate</RouterLink>.
        </p>
      )}
      {map.debate.origin !== 'native' && <StanceSummary map={map} targetId={claim.id} />}
      {map.debate.origin !== 'native' && role.leader && role.side && (
        <StanceEditor
          key={claim.id}
          map={map}
          targetId={claim.id}
          side={role.side}
          uid={user.uid}
          label="Your team’s stance"
          concedable={claim.side !== role.side && claim.id !== map.debate.conclusion.claimId}
        />
      )}
      {claim.settledRef && (
        <p className="small">
          ✓ Settled in a sub-debate. <RouterLink to={`/d/${claim.settledRef.debateId}`}>See where</RouterLink>
        </p>
      )}
      {map.debate.origin === 'native' && (
        <ClaimBuilder text={claim.text} canUse={!!role.side} onUse={(s) => {
            setSuggestion({ ...s, n: (suggestion?.n ?? 0) + 1 })
            setTimeout(() => document.querySelector('.composer textarea')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
          }} />
      )}
      <ForkSection map={map} claim={claim} user={user} side={role.side} sub={tree?.subs.get(claim.id)} />
      {borrowed ? (
        <p className="small muted">
          This is the box being argued. Its sources and discussion are in the{' '}
          <RouterLink to={`/d/${map.debate.conclusion.debateId}`}>parent debate</RouterLink>.
        </p>
      ) : (
        <EvidenceSection map={map} claim={claim} user={user} side={role.side} />
      )}
      {role.side && (
        <ArgumentComposer
          map={map}
          target={claim}
          user={user}
          side={role.side}
          draft={source?.draft ?? null}
          onSeek={source?.onSeek}
          settled={tree?.settled}
          suggestion={suggestion}
          common={common}
          onAdded={() => {
            source?.onDraftUsed()
            onSelect({ kind: 'claim', id: claim.id })
          }}
        />
      )}
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
      {!borrowed && <CommentThread map={map} targetId={claim.id} user={user} side={role.side} />}
      <StanceHistory map={map} targetId={claim.id} />
    </section>
  )
}

function EditClaimForm({ map, claim, user, pair, onDone }: { map: DebateMap; claim: Claim; user: User; pair?: string; onDone: () => void }) {
  const accepted = map.debate.origin === 'native' && claimAgreement(map, claim).acceptance?.value === 'accepted'
  const [text, setText] = useState(claim.text)
  const [type, setType] = useState<ClaimType>(claim.type)
  const [error, setError] = useState<string | null>(null)
  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      await editClaim(db, user, map.debate.id, claim.id, text, type, pair)
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
      {accepted && <p className="hint">The other side accepted the current wording. If you change it, they’ll need to accept it again, and every conclusion resting on it will show as in question until they do. The old wording stays in the history.</p>}
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

function StanceEditor({
  map,
  targetId,
  side,
  uid,
  label,
  concedable,
}: {
  map: DebateMap
  targetId: string
  side: SideId
  uid: string
  label: string
  /** The box is the other side's: offer a one-click "Fair point". */
  concedable?: boolean
}) {
  const current: Stance | undefined = stanceOf(map, targetId, side)
  const [value, setValue] = useState<StanceValue>(current?.value ?? 'unsure')
  const [confidence, setConfidence] = useState(current?.confidence ?? 50)
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const dirty = !current || current.value !== value || current.confidence !== confidence

  async function save() {
    try {
      await setStance(db, stanceHome(map, targetId), targetId, side, value, confidence, { by: uid, from: current })
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
      {concedable && current?.value !== 'agree' && (
        <button className="btn small-btn concede-btn" type="button" onClick={concede} title="Agree with this box, and record it as a concession">
          Fair point
        </button>
      )}
    </div>
  )

  async function concede() {
    const conf = Math.max(confidence, 60)
    try {
      await setStance(db, stanceHome(map, targetId), targetId, side, 'agree', conf, { by: uid, from: current, conceded: true })
      setValue('agree')
      setConfidence(conf)
      setState('saved')
    } catch (e) {
      console.error(e)
      setState('error')
    }
  }
}

function defaultKind(map: DebateMap, target: Claim, side: SideId): Link['kind'] {
  if (target.id === map.debate.conclusion.claimId) return side === 'for' ? 'reason' : 'objection'
  return target.side === side ? 'reason' : 'objection'
}

function ArgumentComposer({
  map,
  target,
  user,
  side,
  draft,
  onSeek,
  settled,
  suggestion,
  common,
  onAdded,
}: {
  map: DebateMap
  target: Claim
  user: User
  side: SideId
  draft?: ClaimSource | null
  onSeek?: (s: number) => void
  settled?: SettledClaim[]
  /** A statement from the claim builder to start from. */
  suggestion?: Suggestion | null
  common?: CommonGround | null
  onAdded: () => void
}) {
  const citable = (settled ?? []).filter((c) => c.outcome === 'accepted' && c.claimId !== target.id)
  const [kind, setKind] = useState<Link['kind']>(defaultKind(map, target, side))
  const [premises, setPremises] = useState<PremiseInput[]>([{ text: '', type: 'unspecified' }])
  const [restatement, setRestatement] = useState('')
  // Objecting to the other side's box starts with restating it, unless this side already has.
  const alreadyRestated = map.comments.some(
    (c) => c.kind === 'restatement' && c.targetId === target.id && c.side === side && c.status !== 'disputed',
  )
  const mustRestate =
    kind === 'objection' &&
    target.side !== side &&
    target.id !== map.debate.conclusion.claimId &&
    map.debate.origin !== 'imported' &&
    map.debate.settings?.restateFirst !== false &&
    !alreadyRestated

  // A transcript passage picked for mapping fills the next empty premise.
  useEffect(() => {
    if (!draft) return
    setPremises((ps) => {
      if (ps.some((p) => p.source === draft)) return ps
      const entry = { text: draft.quote, type: 'unspecified' as ClaimType, source: draft }
      const empty = ps.findIndex((p) => !p.text.trim())
      if (empty >= 0) return ps.map((p, i) => (i === empty ? entry : p))
      return ps.length < 8 ? [...ps, entry] : ps
    })
  }, [draft])
  // Common ground: claims to reuse, agreed terms to insert, and agreed wording to keep to.
  const terms = (common?.glossary ?? []).filter((g) => g.kind === 'term')
  const wording = (common?.glossary ?? []).filter((g) => g.kind === 'wording' && g.replacement)
  const reusable = (common?.ground ?? []).filter(
    (g) => !(g.debateId === map.debate.id && g.claimId === target.id) && !premises.some((p) => p.groundRef?.claimId === g.claimId && p.groundRef.debateId === g.debateId),
  )
  const caret = useRef<{ i: number; at: number | null }>({ i: 0, at: null })
  // A statement picked in the claim builder fills the first premise.
  const [lastSuggestion, setLastSuggestion] = useState(suggestion?.n ?? 0)
  if (suggestion && suggestion.n !== lastSuggestion) {
    setLastSuggestion(suggestion.n)
    setKind(suggestion.kind)
    setPremises((ps) => [{ text: suggestion.text, type: 'unspecified' }, ...ps.slice(1)])
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, p: Partial<PremiseInput>) => setPremises((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const filled = premises.filter((p) => p.text.trim())
  const looksDouble = filled.some((p) => p.text.length > 140 && /\b(and|also|plus)\b/i.test(p.text))
  const unsourced = filled.some((p) => p.type === 'fact' || p.type === 'prediction')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!filled.length || (mustRestate && !restatement.trim())) return
    setBusy(true)
    setError(null)
    try {
      if (mustRestate) await objectWithRestatement(db, user, map.debate.id, side, target.id, restatement, filled)
      else await addArgument(db, user, map.debate.id, side, kind, target.id, filled)
      setPremises([{ text: '', type: 'unspecified' }])
      setRestatement('')
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
      {mustRestate && (
        <div className="stack-xs restate">
          <label className="small" htmlFor="restatement">
            <strong>First, restate their point in your own words.</strong> {map.debate.sides[target.side].label} will confirm you’ve got it right, so you argue
            with what they actually mean.
          </label>
          <textarea
            id="restatement"
            className="input"
            rows={2}
            maxLength={2000}
            placeholder="So you’re saying that…"
            value={restatement}
            onChange={(e) => setRestatement(e.target.value)}
          />
        </div>
      )}
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
            onSelect={(e) => (caret.current = { i, at: e.currentTarget.selectionStart })}
            readOnly={!!p.settledRef || !!p.groundRef}
            aria-label={`Premise ${i + 1}`}
          />
          {p.settledRef && <span className="small ok">✓ Settled claim, cited as is.</span>}
          {p.groundRef && <span className="small ok">✓ You both agreed this already. It’s reused as is, and stays linked to where you agreed it.</span>}
          {!p.groundRef &&
            wordingSlips(p.text, wording).map((w) => (
              <span key={w.id} className="hint slip">
                You agreed to say “{w.replacement}” instead of “{w.phrase}”.
                <button className="btn small-btn" type="button" onClick={() => update(i, { text: replacePhrase(p.text, w.phrase, w.replacement ?? '') })}>
                  Use “{w.replacement}”
                </button>
              </span>
            ))}
          {!p.groundRef &&
            terms
              .filter((t) => containsPhrase(p.text, t.phrase))
              .map((t) => (
                <span key={t.id} className="small muted">
                  “{t.phrase}” has an agreed meaning: {t.meaning}
                </span>
              ))}
          {p.source && (
            <span className="small muted">
              From {p.source.speaker ?? 'the transcript'}
              {p.source.start !== null && (onSeek ? (
                <>
                  {' at '}
                  <button className="linklike" type="button" onClick={() => onSeek(p.source!.start!)}>
                    {formatTime(p.source.start)}
                  </button>
                </>
              ) : ` at ${formatTime(p.source.start)}`)}
              . Trim it to one clear claim.
            </span>
          )}
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
      {terms.length + wording.length > 0 && (
        <select
          className="input"
          value=""
          aria-label="Insert an agreed term"
          onChange={(e) => {
            const phrase = e.target.value
            if (!phrase) return
            const { i, at } = caret.current
            setPremises((ps) =>
              ps.map((p, j) => {
                if (j !== Math.min(i, ps.length - 1) || p.groundRef || p.settledRef) return p
                const pos = Math.min(at ?? p.text.length, p.text.length)
                const before = p.text.slice(0, pos)
                const after = p.text.slice(pos)
                const pad = (x: string, left: boolean) => (x && !(left ? /\s$/ : /^\s/).test(x) ? ' ' : '')
                return { ...p, text: `${before}${pad(before, true)}${phrase}${pad(after, false)}${after}` }
              }),
            )
          }}
        >
          <option value="">Insert an agreed term…</option>
          {terms.map((t) => (
            <option key={t.id} value={t.phrase} title={t.meaning ?? ''}>
              {t.phrase}: {(t.meaning ?? '').slice(0, 60)}
            </option>
          ))}
          {wording.map((w) => (
            <option key={w.id} value={w.replacement ?? ''}>
              {w.replacement} (agreed in place of “{w.phrase}”)
            </option>
          ))}
        </select>
      )}
      {reusable.length > 0 && premises.length < 8 && (
        <select
          className="input"
          value=""
          aria-label="Reuse an agreed claim"
          onChange={(e) => {
            const g = reusable.find((x) => x.id === e.target.value)
            if (!g) return
            const entry: PremiseInput = { text: g.text, type: 'unspecified', groundRef: { debateId: g.debateId, claimId: g.claimId, version: g.version } }
            setPremises((ps) => {
              const empty = ps.findIndex((p) => !p.text.trim())
              return empty >= 0 ? ps.map((p, i) => (i === empty ? entry : p)) : [...ps, entry]
            })
          }}
        >
          <option value="">Reuse a claim you both agreed…</option>
          {reusable.map((g) => (
            <option key={g.id} value={g.id}>
              {g.text.length > 90 ? `${g.text.slice(0, 90)}…` : g.text}
            </option>
          ))}
        </select>
      )}
      {citable.length > 0 && premises.length < 8 && (
        <select
          className="input"
          value=""
          aria-label="Cite a settled claim"
          onChange={(e) => {
            const c = citable.find((x) => `${x.debateId}/${x.claimId}` === e.target.value)
            if (!c) return
            const entry: PremiseInput = { text: c.text, type: 'unspecified', settledRef: { debateId: c.debateId, claimId: c.claimId } }
            setPremises((ps) => {
              const empty = ps.findIndex((p) => !p.text.trim())
              return empty >= 0 ? ps.map((p, i) => (i === empty ? entry : p)) : [...ps, entry]
            })
          }}
        >
          <option value="">Cite a settled claim (adds no depth)…</option>
          {citable.map((c) => (
            <option key={`${c.debateId}/${c.claimId}`} value={`${c.debateId}/${c.claimId}`}>
              {c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text}
            </option>
          ))}
        </select>
      )}
      {looksDouble && <p className="hint">This might be two claims in one. Splitting them into co-premises lets the other side accept one and dispute the other.</p>}
      {!looksDouble && unsourced && <p className="hint">Facts and predictions are stronger with a source. You can post as is.</p>}
      {error && <small className="error">{error}</small>}
      <button className="btn pri small-btn" type="submit" disabled={busy || !filled.length || (mustRestate && !restatement.trim())}>
        {busy ? 'Adding…' : map.debate.origin === 'native' ? 'Post' : 'Add to map'}
      </button>
    </form>
  )
}

export function LinkPanel({ map, link, role, user }: { map: DebateMap; link: Link; role: Role; user: User }) {
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
      {role.leader && role.side && <StanceEditor key={link.id} map={map} targetId={link.id} side={role.side} uid={user.uid} label="Your team’s answer" />}
      <CommentThread map={map} targetId={link.id} user={user} side={role.side} />
      <StanceHistory map={map} targetId={link.id} />
    </section>
  )
}

export function NoteComposer({ debateId, user, side, source }: { debateId: string; user: User; side: SideId; source?: SourceProps }) {
  const draft = source?.draft ?? null
  const [text, setText] = useState(draft?.quote ?? '')
  const [lastQuote, setLastQuote] = useState(draft?.quote ?? null)
  // Follow the passage being mapped; once it's used elsewhere, clear it from here too.
  if ((draft?.quote ?? null) !== lastQuote) {
    setLastQuote(draft?.quote ?? null)
    setText(draft ? draft.quote : text === lastQuote ? '' : text)
  }
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    try {
      await addNote(db, user, debateId, side, text, draft ?? undefined)
      setText('')
      if (draft) source?.onDraftUsed()
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
