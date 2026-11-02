import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { roleIn, watchMyDebates } from '../data/debates'
import type { Debate } from '../model/types'

export default function HomePage() {
  const { user, signIn } = useAuth()
  if (!user) {
    return (
      <div className="page narrow stack">
        <span className="eyebrow">Parrhesia · frank and honest debate</span>
        <h1 className="display">Map the argument. Find what you really disagree about.</h1>
        <p className="lede">
          Two people or two teams lay out their premises and conclusions as a shared map, mark where each side stands on
          every box, and fork the pivotal premises into their own debates.
        </p>
        <div className="row">
          <button className="btn pri" type="button" onClick={() => signIn().catch(console.error)}>
            Sign in with Google
          </button>
          <Link className="btn" to="/sample">
            See a sample debate
          </Link>
        </div>
      </div>
    )
  }
  return <MyDebates uid={user.uid} />
}

function MyDebates({ uid }: { uid: string }) {
  const { isAdmin } = useAuth()
  const [debates, setDebates] = useState<Debate[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      watchMyDebates(db, uid, setDebates, (e) => {
        console.error(e)
        setError('Your debates could not be loaded. Check your connection and reload the page.')
      }),
    [uid],
  )

  return (
    <div className="page narrow stack">
      <div className="row between">
        <h1>My debates</h1>
        <span className="row-sm">
          {isAdmin && (
            <Link className="btn" to="/import">
              Import a debate
            </Link>
          )}
          <Link className="btn pri" to="/new">
            New debate
          </Link>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {!debates && !error && <p className="muted">Loading…</p>}
      {debates && debates.length === 0 && (
        <div className="empty stack-sm">
          <p>You aren’t in any debates yet.</p>
          <p className="muted">Start one, or open an invite link someone sent you.</p>
        </div>
      )}
      {debates && debates.length > 0 && (
        <ul className="debate-list">
          {debates.map((d) => {
            const r = roleIn(d, uid)
            const imported = d.origin === 'imported'
            const role = imported ? `Imported · ${d.visibility}` : r.reader ? 'Reader' : r.side ? `${d.sides[r.side].label}${r.leader ? ' · leader' : ''}` : ''
            const waiting = !imported && (!d.sides.for.leaderUid || !d.sides.against.leaderUid)
            return (
              <li key={d.id}>
                <Link to={`/d/${d.id}`} className="debate-item">
                  <span className="debate-item-title">{d.title}</span>
                  <span className="row-sm">
                    <span className="tag">{role}</span>
                    {waiting && <span className="tag warn">Waiting for the other side</span>}
                    {d.subjects.map((s) => (
                      <span key={s} className="tag subtle">
                        {s}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
