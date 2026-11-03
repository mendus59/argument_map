import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { endRound, startRound, type Presence } from '../data/live'
import { buildActivity } from '../model/activity'
import type { Debate, DebateMap, SideId, StanceChange } from '../model/types'
import type { Selection } from '../map/ArgumentMap'

/** Who else has the debate open right now. */
export function PresenceChips({ map, online }: { map: DebateMap; online: Presence[] }) {
  if (!online.length) return null
  return (
    <span className="presence" title="Online now">
      {online.map((p) => (
        <span key={p.uid} className={`online ${p.side ?? ''}`}>
          <span className="dot" aria-hidden="true" />
          {p.name.split(' ')[0]}
          {p.side ? '' : ' (reading)'}
        </span>
      ))}
      <span className="sr-only">{online.length === 1 ? 'is' : 'are'} online in {map.debate.title}</span>
    </span>
  )
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The current timed round, if one is running. */
export function RoundBadge({ debate }: { debate: Debate }) {
  const now = useNow()
  const r = debate.round
  if (!r) return null
  const left = r.endsAt - now
  return (
    <span className={`round ${r.side}${left <= 0 ? ' over' : ''}`} role="status">
      Round {r.number} · {debate.sides[r.side].label}’s turn · {left > 0 ? `${clock(left)} left` : 'time’s up'}
    </span>
  )
}

/** Leader controls for optional timed rounds. Rounds are a guide; nobody is locked out. */
export function RoundControls({ debate, user }: { debate: Debate; user: User }) {
  const [side, setSide] = useState<SideId>(debate.round ? (debate.round.side === 'for' ? 'against' : 'for') : debate.creatorSide)
  const [minutes, setMinutes] = useState(debate.round?.minutes ?? 5)
  const [error, setError] = useState(false)
  const run = (p: Promise<unknown>) => p.then(() => setError(false), () => setError(true))
  return (
    <div className="stack-xs">
      <span className="eyebrow">Timed rounds</span>
      <p className="small muted">Optional. Shows whose turn it is and a countdown to both sides. Nobody is locked out.</p>
      <span className="row-sm">
        <select className="input" value={side} onChange={(e) => setSide(e.target.value as SideId)} aria-label="Whose turn">
          {(['for', 'against'] as SideId[]).map((s) => (
            <option key={s} value={s}>
              {debate.sides[s].label}’s turn
            </option>
          ))}
        </select>
        <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Length">
          {[2, 3, 5, 10, 15, 30].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </span>
      <span className="row-sm">
        <button className="btn small-btn" type="button" onClick={() => run(startRound(db, debate, user, side, minutes))}>
          {debate.round ? 'Start next round' : 'Start a round'}
        </button>
        {debate.round && (
          <button className="btn small-btn" type="button" onClick={() => run(endRound(db, debate))}>
            Stop rounds
          </button>
        )}
      </span>
      {error && <small className="error">Couldn’t update the round. Try again.</small>}
    </div>
  )
}

function ago(ms: number, now: number) {
  const m = Math.round((now - ms) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ms).toLocaleDateString()
}

/** Everything that's happened, newest first, with what's new since the last visit marked. */
export function ActivityFeed({
  map,
  lastVisit,
  me,
  onSelect,
}: {
  map: DebateMap
  lastVisit: number | null | undefined
  /** The viewer: their own changes don't count as new. */
  me?: string
  onSelect: (s: Selection) => void
}) {
  const [history, setHistory] = useState<StanceChange[]>([])
  const [limit, setLimit] = useState(15)
  const now = useNow(60_000)
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'debates', map.debate.id, 'stanceHistory'),
        (snap) => setHistory(snap.docs.map((d) => ({ ...(d.data() as Omit<StanceChange, 'id'>), id: d.id }))),
        () => {},
      ),
    [map.debate.id],
  )
  const items = useMemo(() => buildActivity(map, history), [map, history])
  const isFresh = (i: { at: number; who: string | null }) => !!lastVisit && i.at > lastVisit && i.who !== me
  const fresh = items.filter(isFresh).length
  const text = (id: string | null) => (id ? map.claims.find((c) => c.id === id)?.text : undefined)
  const name = (uid: string | null) => (uid ? (map.debate.people[uid]?.name.split(' ')[0] ?? 'Someone') : map.debate.sides.for.label)

  if (!items.length) return null
  return (
    <section className="stack-xs">
      <span className="eyebrow">Activity</span>
      {lastVisit !== undefined && (
        <p className="small">{lastVisit === null ? 'Your first visit.' : fresh ? <strong>{fresh} new since your last visit, highlighted on the map.</strong> : 'Nothing new since your last visit.'}</p>
      )}
      <ol className="activity">
        {items.slice(0, limit).map((i) => {
          const t = text(i.claimId)
          return (
            <li key={i.id} className={`${i.side}${isFresh(i) ? ' fresh' : ''}`}>
              <span className="small">
                <strong>{name(i.who)}</strong> {i.action}{' '}
                {t && (
                  <button className="linklike" type="button" onClick={() => onSelect({ kind: 'claim', id: i.claimId! })}>
                    “{t.length > 70 ? `${t.slice(0, 70)}…` : t}”
                  </button>
                )}
                {i.detail && ` (${i.detail})`}
              </span>
              <span className="small muted"> · {ago(i.at, now)}</span>
            </li>
          )
        })}
      </ol>
      {items.length > limit && (
        <button className="linklike small" type="button" onClick={() => setLimit((n) => n + 30)}>
          Show older
        </button>
      )}
    </section>
  )
}
